import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getDb, getServiceDb } from "../../shared/db.ts";
import type { LoginDto, RecuperarPasswordDto, RecuperarUsuarioDto, ResetPasswordDto } from "./auth.schemas.ts";

// ─── Rate Limiter (RN-AUT5) ──────────────────────────────────────────────────
// Map en módulo: key = `${ip}:${username}`, value = { count, firstAttemptAt }
const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000; // 15 minutos

interface RateLimitEntry {
  count:          number;
  firstAttemptAt: number;
}

const rateLimiter = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string, username: string): void {
  const key   = `${ip}:${username}`;
  const now   = Date.now();
  const entry = rateLimiter.get(key);

  if (entry) {
    if (now - entry.firstAttemptAt > WINDOW_MS) {
      // Ventana expirada: reiniciar
      rateLimiter.delete(key);
    } else if (entry.count >= MAX_ATTEMPTS) {
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        429,
        "Demasiados intentos. Intente nuevamente en 15 minutos",
      );
    }
  }
}

function registerFailedAttempt(ip: string, username: string): void {
  const key   = `${ip}:${username}`;
  const now   = Date.now();
  const entry = rateLimiter.get(key);

  if (!entry || now - entry.firstAttemptAt > WINDOW_MS) {
    rateLimiter.set(key, { count: 1, firstAttemptAt: now });
  } else {
    rateLimiter.set(key, { ...entry, count: entry.count + 1 });
  }
}

function clearRateLimit(ip: string, username: string): void {
  rateLimiter.delete(`${ip}:${username}`);
}

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
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
  // Expuesto para reset en tests
  resetRateLimiter(): void {
    rateLimiter.clear();
  },

  async login(dto: LoginDto, ip: string): Promise<LoginResponse> {
    checkRateLimit(ip, dto.username);

    const serviceDb = getServiceDb();

    // 1. Buscar usuario por username (necesitamos su email para Supabase Auth)
    const { data: usuario, error: usuarioError } = await serviceDb
      .from("usuarios")
      .select(`
        id, tenant_id, username, email, full_name, active, last_login,
        roles!inner(
          id, name, display_name,
          rol_permiso!inner(
            permisos!inner(name)
          )
        )
      `)
      .eq("username", dto.username)
      .single();

    if (usuarioError || !usuario) {
      registerFailedAttempt(ip, dto.username);
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Credenciales inválidas");
    }

    // 2. Verificar que está activo (RN-AUT1)
    if (!usuario.active) {
      registerFailedAttempt(ip, dto.username);
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Credenciales inválidas");
    }

    // 3. Autenticar con Supabase Auth (valida la contraseña)
    const anonKey = process.env["SUPABASE_ANON_KEY"] ??
      (globalThis as Record<string, unknown>)["SUPABASE_ANON_KEY"] as string ?? "";
    const userDb = getDb(`Bearer ${anonKey}`);

    const { data: authData, error: authError } = await (userDb.auth as {
      signInWithPassword: (c: { email: string; password: string }) => Promise<{
        data: { session: { access_token: string } | null } | null;
        error: { message: string } | null;
      }>;
    }).signInWithPassword({
      email:    usuario.email,
      password: dto.password,
    });

    if (authError || !authData?.session) {
      registerFailedAttempt(ip, dto.username);
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Credenciales inválidas");
    }

    // Login exitoso: limpiar rate limit
    clearRateLimit(ip, dto.username);

    // 4. Actualizar last_login
    await serviceDb
      .from("usuarios")
      .update({ last_login: new Date().toISOString() })
      .eq("id", usuario.id);

    // 5. Extraer permisos del rol
    const rol = usuario.roles as unknown as {
      id: string;
      name: string;
      display_name: string;
      rol_permiso: Array<{ permisos: { name: string } }>;
    };
    const permissions = rol.rol_permiso.map((rp) => rp.permisos.name);

    // 6. Auditoría LOGIN (RN-AUT4)
    await recordAudit(serviceDb as unknown as SupabaseClient, {
      tenantId:  usuario.tenant_id as string,
      userId:    usuario.id as string,
      userName:  usuario.username as string,
      userRole:  rol.name,
      action:    "LOGIN",
      module:    "security",
      ipAddress: ip,
    });

    return {
      token: authData.session.access_token,
      user:  {
        id:          usuario.id as string,
        username:    usuario.username as string,
        fullName:    usuario.full_name as string,
        roleName:    rol.display_name,
        permissions,
      },
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
          rol_permiso!inner(
            permisos!inner(name)
          )
        )
      `)
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "Usuario no encontrado");
    }

    const rol = data.roles as unknown as {
      name: string;
      display_name: string;
      rol_permiso: Array<{ permisos: { name: string } }>;
    };

    return {
      id:          data.id,
      username:    data.username,
      email:       data.email,
      fullName:    data.full_name,
      phone:       data.phone,
      active:      data.active,
      lastLogin:   data.last_login,
      createdAt:   data.created_at,
      roleName:    rol.display_name,
      permissions: rol.rol_permiso.map((rp) => rp.permisos.name),
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

    // Buscar usuario por email — respuesta siempre genérica (RN-REC2)
    const { data: usuario } = await serviceDb
      .from("usuarios")
      .select("id, username, email")
      .eq("email", dto.email)
      .eq("active", true)
      .single();

    if (usuario) {
      // En una implementación completa, aquí se enviaría el username por email
      // usando Supabase Edge Function de email custom o un servicio SMTP.
      // Por ahora se loguea para testing en desarrollo.
      console.info(
        `[recuperarUsuario] Usuario encontrado: ${usuario.username as string} para ${dto.email}`,
      );
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
