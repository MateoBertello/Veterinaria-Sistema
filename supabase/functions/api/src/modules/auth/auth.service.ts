import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getDb, getServiceDb } from "../../shared/db.ts";
import type {
  LoginDto,
  RecuperarPasswordDto,
  RecuperarUsuarioDto,
  RefreshDto,
  ResetPasswordDto,
} from "./auth.schemas.ts";

// ─── Rate Limiter (RN-AUT5) ──────────────────────────────────────────────────
// El estado vive en la tabla `intentos_login`, NO en memoria del isolate: en
// serverless el proceso se recicla constantemente y hay varias instancias en
// paralelo, así que un Map de módulo se reiniciaba solo y no frenaba nada.
// Ver la migración 20260725000004 para el detalle del diseño.

const WINDOW_MINUTES = 15;

/** Intentos permitidos contra UNA cuenta antes de bloquearla. */
const MAX_POR_USUARIO = 5;

/**
 * Intentos permitidos desde UNA IP. Deliberadamente holgado: una clínica entera
 * sale por una sola IP pública, así que un umbral bajo acá castiga al local
 * completo por las contraseñas mal tipeadas de cualquiera. Sirve para frenar el
 * barrido automatizado de muchas cuentas, no para proteger una cuenta puntual
 * —de eso se ocupa MAX_POR_USUARIO—.
 */
const MAX_POR_IP = 50;

/**
 * Buckets contra los que se cuenta un intento, con su techo respectivo.
 *
 * El bucket por IDENTIFICADOR es el que hace el trabajo: quien ataca una cuenta
 * concreta no puede escaparle, porque el identificador es justamente lo que
 * necesita mantener fijo. El bucket por IP es defensa secundaria y se asume
 * falsificable (llega de un header).
 */
function bucketsDeIntento(ip: string, identificador: string): {
  claves: string[];
  maximos: number[];
} {
  return {
    claves:  [`user:${identificador.trim().toLowerCase()}`, `ip:${ip}`],
    maximos: [MAX_POR_USUARIO, MAX_POR_IP],
  };
}

/** Suma el intento y devuelve `true` si quedó bloqueado. */
async function registrarIntento(
  db: ReturnType<typeof getServiceDb>,
  buckets: { claves: string[]; maximos: number[] },
): Promise<boolean> {
  const { data, error } = await db.rpc("registrar_intento_login", {
    p_claves:          buckets.claves,
    p_maximos:         buckets.maximos,
    p_ventana_minutos: WINDOW_MINUTES,
  });

  if (error) {
    // Si el contador no está disponible no se bloquea el login: sin base de
    // datos el login va a fallar igual unas líneas más abajo, y dejar a todo el
    // mundo afuera por un problema del limitador es peor que el riesgo que cubre.
    console.error("[rate-limit] No se pudo registrar el intento:", error.message);
    return false;
  }

  return data === true;
}

/** Limpia los buckets tras un login exitoso. */
async function limpiarIntentos(
  db: ReturnType<typeof getServiceDb>,
  buckets: { claves: string[] },
): Promise<void> {
  const { error } = await db.rpc("limpiar_intentos_login", { p_claves: buckets.claves });
  if (error) {
    console.error("[rate-limit] No se pudieron limpiar los intentos:", error.message);
  }
}

// ─── Rol y permisos del usuario ───────────────────────────────────────────────

interface RolResuelto {
  name:        string;
  displayName: string;
  permissions: string[];
}

/**
 * Normaliza el embed `roles(... rol_permiso(permisos(name)))` a un rol plano.
 *
 * Los embeds anidados de permisos son LEFT JOIN a propósito: con `!inner`, un
 * rol al que todavía no se le asignó ningún permiso hacía desaparecer al
 * usuario entero de la consulta, y el login respondía "Credenciales inválidas"
 * — indistinguible de una contraseña mal puesta — en vez de dejarlo entrar sin
 * permisos. Además PostgREST devuelve el embed to-one como objeto o como array
 * según el caso; acá se contempla cualquiera de las dos formas.
 */
function extraerRol(embed: unknown): RolResuelto {
  const rol = (Array.isArray(embed) ? embed[0] : embed) as {
    name?:         string;
    display_name?: string;
    rol_permiso?:  Array<{ permisos?: { name?: string } | Array<{ name?: string }> | null }> | null;
  } | null | undefined;

  const permissions = (rol?.rol_permiso ?? [])
    .map((rp) => {
      const permiso = Array.isArray(rp?.permisos) ? rp.permisos[0] : rp?.permisos;
      return permiso?.name;
    })
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  return {
    name:        rol?.name ?? "",
    displayName: rol?.display_name ?? "",
    permissions,
  };
}

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  /**
   * Refresh token de GoTrue. Sin esto la sesión moría seca al vencer el access
   * token (`jwt_expiry = 3600`): el 401 llegaba en mitad de una carga y el
   * usuario perdía lo que tenía en pantalla.
   */
  refreshToken: string;
  user: {
    id:          string;
    username:    string;
    fullName:    string;
    roleName:    string;
    permissions: string[];
  };
}

export interface LogoutParams {
  userId:      string;
  tenantId:    string;
  userName:    string;
  userRole:    string;
  accessToken: string;
}

// ─── AuthService ──────────────────────────────────────────────────────────────

export const AuthService = {
  async login(dto: LoginDto, ip: string): Promise<LoginResponse> {
    const serviceDb = getServiceDb();

    // El intento se cuenta ANTES de tocar nada: así también cuentan los
    // identificadores inexistentes (que es como se enumera usuarios).
    const buckets = bucketsDeIntento(ip, dto.username);
    if (await registrarIntento(serviceDb, buckets)) {
      throw new DomainError(
        ErrorCode.RATE_LIMITED,
        429,
        `Demasiados intentos. Probá de nuevo en ${WINDOW_MINUTES} minutos.`,
      );
    }

    // 1. Resolver el usuario por su identificador (necesitamos su email para
    //    Supabase Auth). Dos decisiones acá:
    //
    //    • Se compara contra las columnas NORMALIZADAS (username_ci/email_ci),
    //      no contra las crudas: `Juanpa` tiene que poder entrar tipeando
    //      `juanpa`. La igualdad de TEXT en Postgres es case-sensitive y eso
    //      producía un 401 indistinguible de "contraseña mal".
    //    • Se acepta username O email. El username es único POR TENANT, así
    //      que dos clínicas pueden tener su propio `admin`; el email es único
    //      globalmente (lo impone GoTrue) y sirve para desempatar.
    //
    //    `limit(2)` en vez de `single()`: alcanza con saber si hay más de uno,
    //    y `single()` devolvía error ante la colisión — dejando sin login a
    //    AMBOS usuarios homónimos en vez de a ninguno.
    const identificador = dto.username.trim();
    const columnaId     = identificador.includes("@") ? "email_ci" : "username_ci";

    const { data: candidatos, error: usuarioError } = await serviceDb
      .from("usuarios")
      .select(`
        id, tenant_id, username, email, full_name, active, last_login,
        roles!inner(
          id, name, display_name,
          rol_permiso(
            permisos(name)
          )
        )
      `)
      .eq(columnaId, identificador.toLowerCase())
      .limit(2);

    const filas = (candidatos ?? []) as unknown as Array<Record<string, unknown>>;

    if (usuarioError || filas.length === 0) {
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Credenciales inválidas");
    }

    // Homónimos en distintos tenants: no hay forma de elegir sin más datos.
    // Se responde un código propio en vez del 401 genérico porque el usuario
    // NO puede resolverlo reintentando — necesita saber que tiene que usar su
    // email. La filtración es mínima (que un username se repite en ≥2
    // clínicas) y la alternativa era dejarlos a todos afuera para siempre.
    if (filas.length > 1) {
      throw new DomainError(
        ErrorCode.AMBIGUOUS_IDENTIFIER,
        409,
        "Ese nombre de usuario existe en más de una clínica. Ingresá con tu email.",
      );
    }

    const usuario = filas[0]!;

    // 2. Verificar que está activo (RN-AUT1)
    if (!usuario["active"]) {
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Credenciales inválidas");
    }

    // 3. Autenticar con Supabase Auth (valida la contraseña)
    const anonKey = process.env["SUPABASE_ANON_KEY"] ??
      (globalThis as Record<string, unknown>)["SUPABASE_ANON_KEY"] as string ?? "";
    const userDb = getDb(`Bearer ${anonKey}`);

    const { data: authData, error: authError } = await (userDb.auth as {
      signInWithPassword: (c: { email: string; password: string }) => Promise<{
        data: { session: { access_token: string; refresh_token?: string } | null } | null;
        error: { message: string } | null;
      }>;
    }).signInWithPassword({
      email:    usuario["email"] as string,
      password: dto.password,
    });

    if (authError || !authData?.session) {
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Credenciales inválidas");
    }

    // Login exitoso: los buckets vuelven a cero.
    await limpiarIntentos(serviceDb, buckets);

    // 4. Actualizar last_login
    await serviceDb
      .from("usuarios")
      .update({ last_login: new Date().toISOString() })
      .eq("id", usuario["id"] as string);

    // 5. Extraer permisos del rol
    const rol = extraerRol(usuario["roles"]);

    // 6. Auditoría LOGIN (RN-AUT4)
    await recordAudit(serviceDb as unknown as SupabaseClient, {
      tenantId:  usuario["tenant_id"] as string,
      userId:    usuario["id"] as string,
      userName:  usuario["username"] as string,
      userRole:  rol.name,
      action:    "LOGIN",
      module:    "security",
      ipAddress: ip,
    });

    return {
      token:        authData.session.access_token,
      refreshToken: authData.session.refresh_token ?? "",
      user:  {
        id:          usuario["id"] as string,
        username:    usuario["username"] as string,
        fullName:    usuario["full_name"] as string,
        roleName:    rol.displayName,
        permissions: rol.permissions,
      },
    };
  },

  /**
   * Renueva la sesión a partir del refresh token (RN-AUT: continuidad de sesión).
   *
   * GoTrue rota el refresh token en cada uso (`enable_refresh_token_rotation`),
   * así que el llamador DEBE guardar el que vuelve. Un usuario baneado —lo que
   * ahora hace la desactivación— no puede renovar: GoTrue rechaza el refresh,
   * y así la baja surte efecto sin esperar a que venza el access token.
   */
  async refresh(dto: RefreshDto): Promise<{ token: string; refreshToken: string }> {
    const anonKey = process.env["SUPABASE_ANON_KEY"] ??
      (globalThis as Record<string, unknown>)["SUPABASE_ANON_KEY"] as string ?? "";
    const userDb = getDb(`Bearer ${anonKey}`);

    const { data, error } = await (userDb.auth as {
      refreshSession: (c: { refresh_token: string }) => Promise<{
        data: { session: { access_token: string; refresh_token?: string } | null } | null;
        error: { message: string } | null;
      }>;
    }).refreshSession({ refresh_token: dto.refreshToken });

    if (error || !data?.session) {
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        401,
        "La sesión expiró. Volvé a iniciar sesión.",
      );
    }

    return {
      token:        data.session.access_token,
      refreshToken: data.session.refresh_token ?? "",
    };
  },

  async logout(params: LogoutParams): Promise<void> {
    const serviceDb = getServiceDb();

    // admin.signOut invalida el token en GoTrue, que además VERIFICA firma y
    // sesión en esa misma llamada (forjado → bad_jwt; ya deslogueado →
    // session_not_found). El tenantId/userId de params viene de un JWT solo
    // decodificado (tenantContext no verifica firma): si GoTrue rechaza el
    // token, esa identidad no es confiable y NO debe asentarse auditoría.
    const userDb = getDb(params.accessToken);
    const { error } = await (userDb.auth.admin as {
      signOut: (token: string) => Promise<{ error: unknown }>;
    }).signOut(params.accessToken.replace("Bearer ", ""));

    if (error) {
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        401,
        "Token de autenticación inválido",
      );
    }

    // Auditoría LOGOUT (RN-AUT4) — solo con identidad verificada por GoTrue:
    // la firma cubre el payload, así que los claims decodificados son genuinos.
    await recordAudit(serviceDb as unknown as SupabaseClient, {
      tenantId: params.tenantId,
      userId:   params.userId,
      userName: params.userName,
      userRole: params.userRole,
      action:   "LOGOUT",
      module:   "security",
    });
  },

  async me(userId: string, tenantId: string, authHeader: string): Promise<object> {
    const db = getDb(authHeader);

    const { data, error } = await db
      .from("usuarios")
      .select(`
        id, username, email, full_name, phone, active, last_login, created_at,
        roles!inner(
          name, display_name,
          rol_permiso(
            permisos(name)
          )
        )
      `)
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Usuario no encontrado");
    }

    // Mismo criterio que el login: los permisos van por LEFT JOIN para que un
    // rol sin permisos asignados devuelva su perfil (con `permissions: []`) en
    // vez de un 401 que parecería sesión vencida.
    const rol = extraerRol(data.roles);

    return {
      id:          data.id,
      username:    data.username,
      email:       data.email,
      fullName:    data.full_name,
      phone:       data.phone,
      active:      data.active,
      lastLogin:   data.last_login,
      createdAt:   data.created_at,
      roleName:    rol.displayName,
      permissions: rol.permissions,
    };
  },

  async recuperarPassword(dto: RecuperarPasswordDto): Promise<void> {
    const serviceDb = getServiceDb();

    const redirectTo = process.env["AUTH_REDIRECT_URL"] ??
      (globalThis as Record<string, unknown>)["AUTH_REDIRECT_URL"] as string ??
      "http://localhost:3000/reset-password";

    // Supabase maneja internamente si el email existe o no (RN-REC2: respuesta genérica)
    const anonKey = process.env["SUPABASE_ANON_KEY"] ??
      (globalThis as Record<string, unknown>)["SUPABASE_ANON_KEY"] as string ?? "";
    const userDb = getDb(`Bearer ${anonKey}`);

    await (userDb.auth as {
      resetPasswordForEmail: (
        email: string,
        opts: { redirectTo: string }
      ) => Promise<unknown>;
    }).resetPasswordForEmail(dto.email, { redirectTo });

    // Auditoría (RN-REC4)
    await recordAudit(serviceDb as unknown as SupabaseClient, {
      tenantId: null,
      userId:   null,
      userName: null,
      userRole: null,
      action:   "UPDATE",
      module:   "security",
      details:  `Solicitud de recuperación de contraseña para ${dto.email}`,
    });
  },

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const db = getDb(`Bearer ${dto.accessToken}`);

    const { error } = await (db.auth as {
      updateUser: (u: { password: string }) => Promise<{ error: unknown }>;
    }).updateUser({ password: dto.nuevaPassword });

    if (error) {
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        401,
        "No se pudo actualizar la contraseña. El token puede haber expirado",
      );
    }
  },

  async recuperarUsuario(dto: RecuperarUsuarioDto): Promise<void> {
    const serviceDb = getServiceDb();

    // Buscar usuario por email — respuesta siempre genérica (RN-REC2).
    // Se compara contra `email_ci`: el usuario escribe su mail como se le
    // ocurre y GoTrue ya lo guarda normalizado.
    const { data: usuario } = await serviceDb
      .from("usuarios")
      .select("id, username, email")
      .eq("email_ci", dto.email.trim().toLowerCase())
      .eq("active", true)
      .single();

    if (usuario) {
      // PENDIENTE (requiere proveedor SMTP configurado): enviar el username al
      // email. Hasta entonces NO se loguea ni el username ni el email — los
      // logs de la Edge Function no son un canal de entrega y volcar ahí datos
      // personales los expone a cualquiera con acceso al panel de Supabase.
      // Se deja constancia solo del hecho, sin identificar a nadie.
      console.info("[recuperarUsuario] Solicitud con email registrado; envío pendiente de proveedor SMTP");
    }

    // Auditoría (RN-REC4)
    await recordAudit(serviceDb as unknown as SupabaseClient, {
      tenantId: null,
      userId:   null,
      userName: null,
      userRole: null,
      action:   "VIEW",
      module:   "security",
      details:  `Solicitud de recuperación de usuario para ${dto.email}`,
    });
  },
};
