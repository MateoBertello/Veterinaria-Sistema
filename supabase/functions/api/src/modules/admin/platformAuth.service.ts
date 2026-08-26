import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getDb, getServiceDb } from "../../shared/db.ts";
import { verifyJwt } from "../../shared/jwt.ts";
import {
  bucketsDeIntento,
  limpiarIntentos,
  registrarIntento,
  WINDOW_MINUTES,
} from "../../shared/loginRateLimit.ts";
import type { PlatformLoginDto, PlatformRefreshDto } from "./platformAuth.schemas.ts";

/**
 * Autenticación de PLATAFORMA (Super Admin) — `/api/v1/admin/auth/*`.
 *
 * Por qué es un camino aparte y no una rama de `POST /auth/login`
 * ──────────────────────────────────────────────────────────────
 * El Super Admin opera FUERA de todo tenant: no tiene fila en `usuarios` (esa
 * tabla exige `tenant_id UUID NOT NULL`), sino que es un usuario de Supabase
 * Auth con `app_metadata.platform_role = 'super_admin'`. El login de tenant
 * resuelve el identificador contra `usuarios`, así que para el Super Admin
 * siempre devolvía 401 y no existía forma de obtener una sesión de plataforma
 * desde la aplicación: había que pegar un token a mano en `localStorage`.
 *
 * La alternativa era agregarle a `/auth/login` un fallback "si no hay fila,
 * probá contra GoTrue". Se descartó: mete una segunda rama de autenticación en
 * el endpoint más expuesto del sistema y mezcla dos modelos de identidad que no
 * comparten nada (uno tiene tenant, rol y permisos; el otro, un claim de
 * plataforma). La consola de plataforma ya es un sistema aparte —shell propio,
 * guard propio, RLS propia—; su login también lo es.
 *
 * Qué NO hace este service
 * ────────────────────────
 * No emite ni escribe claims. `platform_role` lo pone un administrador con la
 * service_role key (`scripts/crear-super-admin.mjs`); acá solo se LEE del JWT
 * que devuelve GoTrue, y se lee después de VERIFICAR LA FIRMA. Nada de lo que
 * mande el cliente influye en si la sesión acredita plataforma o no.
 */

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface PlatformLoginResponse {
  token: string;
  /**
   * Refresh token de GoTrue. Es la razón de existir de este endpoint tanto como
   * el login mismo: mientras la sesión de plataforma se armaba a mano, nunca
   * había refresh token y la consola se moría a la hora exacta (`jwt_expiry =
   * 3600`), obligando a volver a correr un script para entrar.
   */
  refreshToken: string;
  superAdmin: {
    id:    string;
    email: string | null;
  };
}

export interface PlatformLogoutParams {
  superAdminId: string;
  email:        string | null;
  accessToken:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 401 genérico del login de plataforma.
 *
 * TODOS los fracasos de `login()` salen por acá con el mismo código, el mismo
 * status y el mismo texto: contraseña equivocada, email inexistente, usuario de
 * tenant entrando por la puerta equivocada o cuenta sin el claim. Distinguirlos
 * convertiría al endpoint en un oráculo de credenciales — un 403 en el caso
 * "credenciales bien, claim ausente" le confirma al atacante que acertó la
 * contraseña. Es el mismo criterio que sostiene `auth.service.ts` en el login de
 * tenant (RN-AUT1: nunca se revela cuál de los dos campos falló).
 */
function credencialesInvalidas(): DomainError {
  return new DomainError(ErrorCode.UNAUTHORIZED, 401, "Credenciales inválidas");
}

/** Cliente de GoTrue con la anon key (el password grant no lleva sesión previa). */
function authDb() {
  const anonKey = process.env["SUPABASE_ANON_KEY"] ??
    (globalThis as Record<string, unknown>)["SUPABASE_ANON_KEY"] as string ?? "";
  return getDb(`Bearer ${anonKey}`);
}

interface SesionGoTrue {
  access_token:  string;
  refresh_token?: string;
}

interface RespuestaGoTrue {
  data:  { session: SesionGoTrue | null } | null;
  error: { message: string } | null;
}

/**
 * Verifica el JWT recién emitido y devuelve su payload SOLO si acredita
 * plataforma; `null` en cualquier otro caso.
 *
 * Se verifica la firma aunque el token venga de GoTrue: es la misma función que
 * usa `requireSuperAdmin`, así que la sesión que entregamos es exactamente la
 * que el middleware va a aceptar después. Si acá se leyera el payload sin
 * verificar, el criterio de "esto es una sesión de plataforma" quedaría
 * definido en dos lugares distintos.
 */
async function payloadDePlataforma(
  accessToken: string,
): Promise<{ sub: string; email: string | null } | null> {
  const payload = await verifyJwt(accessToken).catch(() => null);
  if (!payload) return null;

  const platformRole = (payload.app_metadata as Record<string, unknown> | undefined)
    ?.["platform_role"];
  if (platformRole !== "super_admin") return null;
  if (!payload.sub) return null;

  return {
    sub:   payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}

// ─── PlatformAuthService ──────────────────────────────────────────────────────

export const PlatformAuthService = {
  async login(dto: PlatformLoginDto, ip: string): Promise<PlatformLoginResponse> {
    const serviceDb = getServiceDb();
    const email     = dto.email.trim().toLowerCase();

    // El intento se cuenta ANTES de tocar nada, contra los MISMOS buckets que el
    // login de tenant: si cada endpoint llevara su propio contador, éste sería
    // una segunda ventanilla para seguir probando contraseñas de una cuenta ya
    // frenada en la otra.
    const buckets = bucketsDeIntento(ip, email);
    if (await registrarIntento(serviceDb, buckets)) {
      throw new DomainError(
        ErrorCode.RATE_LIMITED,
        429,
        `Demasiados intentos. Probá de nuevo en ${WINDOW_MINUTES} minutos.`,
      );
    }

    // 1. Password grant contra GoTrue. Es GoTrue quien valida la contraseña: acá
    //    no se consulta `usuarios` en ningún momento (el Super Admin no está).
    const { data, error } = await (authDb().auth as {
      signInWithPassword: (c: { email: string; password: string }) => Promise<RespuestaGoTrue>;
    }).signInWithPassword({ email, password: dto.password });

    if (error || !data?.session) throw credencialesInvalidas();

    // 2. La sesión sirve solo si el JWT acredita plataforma. Si no, se descarta
    //    sin decir por qué (ver `credencialesInvalidas`) y SIN limpiar los
    //    buckets: unas credenciales correctas de alguien que no es Super Admin
    //    no le devuelven los intentos al que está probando.
    const identidad = await payloadDePlataforma(data.session.access_token);
    if (!identidad) throw credencialesInvalidas();

    // 3. Login exitoso: los buckets vuelven a cero.
    await limpiarIntentos(serviceDb, buckets);

    // 4. Auditoría (RN-SA5). Fuera de todo tenant: `tenant_id = NULL`. La
    //    identidad va resuelta desde el JWT — `recordAudit` no puede resolverla
    //    contra `usuarios`, donde el Super Admin no existe.
    await recordAudit(serviceDb as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    identidad.sub,
      userName:  identidad.email,
      userRole:  "super_admin",
      action:    "LOGIN",
      module:    "platform",
      ipAddress: ip,
    });

    return {
      token:        data.session.access_token,
      refreshToken: data.session.refresh_token ?? "",
      superAdmin:   { id: identidad.sub, email: identidad.email },
    };
  },

  /**
   * Renueva la sesión de plataforma con su refresh token.
   *
   * GoTrue rota el refresh token en cada uso, así que el llamador DEBE guardar
   * el que vuelve. Y relee `app_metadata` al emitir: si a la cuenta le sacaron
   * el claim de plataforma, el token nuevo ya no lo trae y la renovación se
   * corta acá — la baja surte efecto sin esperar a que venza el access token.
   */
  async refresh(dto: PlatformRefreshDto): Promise<{ token: string; refreshToken: string }> {
    const { data, error } = await (authDb().auth as {
      refreshSession: (c: { refresh_token: string }) => Promise<RespuestaGoTrue>;
    }).refreshSession({ refresh_token: dto.refreshToken });

    if (error || !data?.session) {
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        401,
        "La sesión expiró. Volvé a iniciar sesión.",
      );
    }

    if (!await payloadDePlataforma(data.session.access_token)) {
      // Acá SÍ corresponde 403 y no el 401 genérico del login: quien llama ya
      // tiene el refresh token en la mano, así que no hay credencial que
      // proteger, y el veredicto es el mismo que da `requireSuperAdmin` ante un
      // token válido sin el claim.
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        403,
        "La sesión ya no acredita Super Admin de plataforma",
      );
    }

    return {
      token:        data.session.access_token,
      refreshToken: data.session.refresh_token ?? "",
    };
  },

  /**
   * Cierra la sesión de plataforma en GoTrue (invalida access y refresh token).
   *
   * Mismo criterio que el logout de tenant: `admin.signOut` verifica el token en
   * la misma llamada, así que si GoTrue lo rechaza, la identidad no es confiable
   * y NO debe asentarse auditoría.
   */
  async logout(params: PlatformLogoutParams): Promise<void> {
    const serviceDb = getServiceDb();
    const userDb    = getDb(params.accessToken);

    const { error } = await (userDb.auth.admin as {
      signOut: (token: string) => Promise<{ error: unknown }>;
    }).signOut(params.accessToken.replace("Bearer ", ""));

    if (error) {
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Token de autenticación inválido");
    }

    await recordAudit(serviceDb as unknown as SupabaseClient, {
      tenantId: null,
      userId:   params.superAdminId,
      userName: params.email,
      userRole: "super_admin",
      action:   "LOGOUT",
      module:   "platform",
    });
  },
};
