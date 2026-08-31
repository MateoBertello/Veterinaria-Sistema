/**
 * Autenticación de PLATAFORMA — `PlatformAuthService` (Super Admin).
 *
 * El Super Admin no tiene fila en `usuarios` (esa tabla exige `tenant_id NOT
 * NULL`): es un usuario de Supabase Auth con `app_metadata.platform_role =
 * 'super_admin'`. Por eso NO puede entrar por `POST /auth/login`, que resuelve
 * el identificador contra `usuarios` y responde 401 al no encontrar fila. Este
 * service es su camino propio, hablando directo con GoTrue.
 *
 * Regla que atraviesa todos los casos: el login de plataforma NO revela si el
 * usuario existe, si la contraseña era correcta ni si le falta el claim. Todos
 * los fracasos salen por el mismo 401 con el mismo mensaje, igual que el login
 * de tenant (RN-AUT1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks declarados ANTES de imports del módulo ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
  CALLER_UNRESOLVED: "unknown",
}));

import { getDb, getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { PlatformAuthService } from "../../supabase/functions/api/src/modules/admin/platformAuth.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";
import { makeJwt } from "./_helpers/permissionMock.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockGetDb        = vi.mocked(getDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const SUPER_ADMIN_ID = "sa-uuid-1";
const EMAIL          = "super@leo.local";
const IP             = "203.0.113.7";
const EXP_FUTURO     = Math.floor(Date.now() / 1000) + 3600;

/** JWT realmente firmado (HS256) que acredita Super Admin de plataforma. */
function jwtDePlataforma(overrides: Record<string, unknown> = {}): string {
  return makeJwt({
    sub:          SUPER_ADMIN_ID,
    email:        EMAIL,
    exp:          EXP_FUTURO,
    app_metadata: { platform_role: "super_admin" },
    ...overrides,
  });
}

/** JWT de un usuario de TENANT: credenciales válidas, pero sin claim de plataforma. */
function jwtDeTenant(): string {
  return makeJwt({
    sub:          "u-tenant-1",
    email:        "admin@demo.local",
    exp:          EXP_FUTURO,
    app_metadata: { tenant_id: "tenant-uuid-1" },
  });
}

// ─── Builder de mocks de Supabase ─────────────────────────────────────────────

function buildChain(overrides?: {
  /** `true` = el rate limiter (RPC) reporta bloqueo. */
  bloqueado?:  boolean;
  signIn?:     () => Promise<unknown>;
  refresh?:    () => Promise<unknown>;
  signOut?:    () => Promise<unknown>;
}) {
  return {
    from:   vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    // Rate limit persistido (mismo mecanismo que el login de tenant):
    // `registrar_intento_login` devuelve si bloquea, `limpiar_intentos_login` no.
    rpc:    vi.fn().mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "registrar_intento_login"
          ? { data: overrides?.bloqueado ?? false, error: null }
          : { data: null, error: null },
      )),
    auth: {
      signInWithPassword: overrides?.signIn  ?? vi.fn().mockResolvedValue({ data: null, error: null }),
      refreshSession:     overrides?.refresh ?? vi.fn().mockResolvedValue({ data: null, error: null }),
      admin: {
        signOut: overrides?.signOut ?? vi.fn().mockResolvedValue({ error: null }),
      },
    },
  };
}

/** Sesión tal como la devuelve GoTrue tras un `signInWithPassword` exitoso. */
function sesionGoTrue(accessToken: string, refreshToken = "refresh-token-1") {
  return vi.fn().mockResolvedValue({
    data:  { session: { access_token: accessToken, refresh_token: refreshToken } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["SUPABASE_ANON_KEY"] ??= "anon-key-de-test";
});

// ─── Login: el camino feliz ───────────────────────────────────────────────────

describe("PlatformAuthService.login — Super Admin con credenciales válidas", () => {
  it("devuelve la sesión de plataforma (el JWT acredita platform_role=super_admin)", async () => {
    const serviceDb = buildChain();
    const token = jwtDePlataforma();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signIn: sesionGoTrue(token) }) as never);

    const sesion = await PlatformAuthService.login(
      { email: EMAIL, password: "Super1234!" },
      IP,
    );

    expect(sesion.token).toBe(token);
    expect(sesion.superAdmin).toEqual({ id: SUPER_ADMIN_ID, email: EMAIL });
  });

  it("SIEMPRE devuelve el refresh token: sin él la consola moría al vencer el access token", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(
      buildChain({ signIn: sesionGoTrue(jwtDePlataforma(), "refresh-abc") }) as never,
    );

    const sesion = await PlatformAuthService.login({ email: EMAIL, password: "Super1234!" }, IP);

    expect(sesion.refreshToken).toBe("refresh-abc");
  });

  it("normaliza el email antes de mandarlo a GoTrue (se tipea como se le ocurre a cada uno)", async () => {
    const serviceDb = buildChain();
    const signIn = sesionGoTrue(jwtDePlataforma());
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signIn }) as never);

    await PlatformAuthService.login({ email: "  Super@Leo.Local ", password: "Super1234!" }, IP);

    expect(signIn).toHaveBeenCalledWith({ email: EMAIL, password: "Super1234!" });
  });

  it("audita el LOGIN en el módulo `platform`, fuera de todo tenant", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signIn: sesionGoTrue(jwtDePlataforma()) }) as never);

    await PlatformAuthService.login({ email: EMAIL, password: "Super1234!" }, IP);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId:  null,
        userId:    SUPER_ADMIN_ID,
        userRole:  "super_admin",
        action:    "LOGIN",
        module:    "platform",
        ipAddress: IP,
      }),
    );
  });

  it("limpia los buckets del rate limit tras el login exitoso", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signIn: sesionGoTrue(jwtDePlataforma()) }) as never);

    await PlatformAuthService.login({ email: EMAIL, password: "Super1234!" }, IP);

    expect(serviceDb.rpc).toHaveBeenCalledWith(
      "limpiar_intentos_login",
      expect.objectContaining({ p_claves: [`user:${EMAIL}`, `ip:${IP}`] }),
    );
  });
});

// ─── Login: fracasos, todos indistinguibles entre sí ──────────────────────────

describe("PlatformAuthService.login — no revela qué falló", () => {
  it("credenciales inválidas → 401 con el mensaje genérico", async () => {
    mockGetServiceDb.mockReturnValue(buildChain() as never);
    mockGetDb.mockReturnValue(
      buildChain({
        signIn: vi.fn().mockResolvedValue({ data: null, error: { message: "Invalid login credentials" } }),
      }) as never,
    );

    await expect(
      PlatformAuthService.login({ email: EMAIL, password: "mal" }, IP),
    ).rejects.toMatchObject({
      code:       ErrorCode.UNAUTHORIZED,
      statusCode: 401,
      message:    "Credenciales inválidas",
    });
  });

  it("un usuario de TENANT que entra por el camino de plataforma → 401, igual que una contraseña mal puesta", async () => {
    // GoTrue autentica bien (sus credenciales SON válidas), pero el JWT trae
    // tenant_id y no el claim de plataforma. Si esto respondiera 403 sería un
    // oráculo: el atacante sabría que acertó la contraseña.
    mockGetServiceDb.mockReturnValue(buildChain() as never);
    mockGetDb.mockReturnValue(buildChain({ signIn: sesionGoTrue(jwtDeTenant()) }) as never);

    await expect(
      PlatformAuthService.login({ email: "admin@demo.local", password: "Demo1234!" }, IP),
    ).rejects.toMatchObject({
      code:       ErrorCode.UNAUTHORIZED,
      statusCode: 401,
      message:    "Credenciales inválidas",
    });
  });

  it("un usuario de Supabase Auth sin ningún claim de plataforma → el mismo 401", async () => {
    mockGetServiceDb.mockReturnValue(buildChain() as never);
    mockGetDb.mockReturnValue(
      buildChain({
        signIn: sesionGoTrue(makeJwt({ sub: "u-suelto", email: "x@y.z", exp: EXP_FUTURO })),
      }) as never,
    );

    await expect(
      PlatformAuthService.login({ email: "x@y.z", password: "Correcta123!" }, IP),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED, statusCode: 401 });
  });

  it("platform_role con otro valor (p. ej. `soporte`) tampoco abre la consola", async () => {
    mockGetServiceDb.mockReturnValue(buildChain() as never);
    mockGetDb.mockReturnValue(
      buildChain({
        signIn: sesionGoTrue(
          makeJwt({
            sub: "u-soporte", email: EMAIL, exp: EXP_FUTURO,
            app_metadata: { platform_role: "soporte" },
          }),
        ),
      }) as never,
    );

    await expect(
      PlatformAuthService.login({ email: EMAIL, password: "Correcta123!" }, IP),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED, statusCode: 401 });
  });

  it("un login sin el claim NO limpia el rate limit: no regala reintentos", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signIn: sesionGoTrue(jwtDeTenant()) }) as never);

    await expect(
      PlatformAuthService.login({ email: "admin@demo.local", password: "Demo1234!" }, IP),
    ).rejects.toThrow();

    expect(serviceDb.rpc).not.toHaveBeenCalledWith("limpiar_intentos_login", expect.anything());
  });

  it("ningún fracaso deja asiento de auditoría de LOGIN", async () => {
    mockGetServiceDb.mockReturnValue(buildChain() as never);
    mockGetDb.mockReturnValue(buildChain({ signIn: sesionGoTrue(jwtDeTenant()) }) as never);

    await expect(
      PlatformAuthService.login({ email: "admin@demo.local", password: "Demo1234!" }, IP),
    ).rejects.toThrow();

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ─── Login: rate limit compartido con el login de tenant ──────────────────────

describe("PlatformAuthService.login — rate limit (RN-AUT5)", () => {
  it("cuenta el intento contra los MISMOS buckets que el login de tenant", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signIn: sesionGoTrue(jwtDePlataforma()) }) as never);

    await PlatformAuthService.login({ email: EMAIL, password: "Super1234!" }, IP);

    expect(serviceDb.rpc).toHaveBeenCalledWith(
      "registrar_intento_login",
      expect.objectContaining({ p_claves: [`user:${EMAIL}`, `ip:${IP}`] }),
    );
  });

  it("con el bucket agotado → 429 RATE_LIMITED sin llegar a GoTrue", async () => {
    const serviceDb = buildChain({ bloqueado: true });
    const signIn = sesionGoTrue(jwtDePlataforma());
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signIn }) as never);

    await expect(
      PlatformAuthService.login({ email: EMAIL, password: "Super1234!" }, IP),
    ).rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED, statusCode: 429 });

    expect(signIn).not.toHaveBeenCalled();
  });
});

// ─── Refresh: la consola renueva como cualquier otra sesión ───────────────────

describe("PlatformAuthService.refresh", () => {
  it("renueva la sesión y devuelve el par rotado por GoTrue", async () => {
    const nuevo = jwtDePlataforma();
    mockGetDb.mockReturnValue(
      buildChain({
        refresh: vi.fn().mockResolvedValue({
          data:  { session: { access_token: nuevo, refresh_token: "refresh-2" } },
          error: null,
        }),
      }) as never,
    );

    const renovada = await PlatformAuthService.refresh({ refreshToken: "refresh-1" });

    expect(renovada).toEqual({ token: nuevo, refreshToken: "refresh-2" });
  });

  it("refresh token inválido o ya usado → 401", async () => {
    mockGetDb.mockReturnValue(
      buildChain({
        refresh: vi.fn().mockResolvedValue({ data: null, error: { message: "Invalid Refresh Token" } }),
      }) as never,
    );

    await expect(
      PlatformAuthService.refresh({ refreshToken: "viejo" }),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED, statusCode: 401 });
  });

  it("si al Super Admin le sacaron el claim, la renovación se corta con 403 FORBIDDEN", async () => {
    // GoTrue relee `app_metadata` en cada refresh: el token nuevo ya no acredita
    // plataforma. Acá el 403 no filtra nada —quien llama YA tiene el refresh
    // token en la mano— y es el mismo veredicto que da `requireSuperAdmin`.
    mockGetDb.mockReturnValue(
      buildChain({
        refresh: vi.fn().mockResolvedValue({
          data:  { session: { access_token: jwtDeTenant(), refresh_token: "refresh-2" } },
          error: null,
        }),
      }) as never,
    );

    await expect(
      PlatformAuthService.refresh({ refreshToken: "refresh-1" }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe("PlatformAuthService.logout", () => {
  it("invalida la sesión en GoTrue y audita el LOGOUT de plataforma", async () => {
    const serviceDb = buildChain();
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({ signOut }) as never);

    await PlatformAuthService.logout({
      superAdminId: SUPER_ADMIN_ID,
      email:        EMAIL,
      accessToken:  "Bearer token-de-plataforma",
    });

    expect(signOut).toHaveBeenCalledWith("token-de-plataforma");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: null,
        userId:   SUPER_ADMIN_ID,
        userRole: "super_admin",
        action:   "LOGOUT",
        module:   "platform",
      }),
    );
  });

  it("si GoTrue rechaza el token → 401 y NO se asienta auditoría", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(
      buildChain({ signOut: vi.fn().mockResolvedValue({ error: { message: "bad_jwt" } }) }) as never,
    );

    await expect(
      PlatformAuthService.logout({
        superAdminId: SUPER_ADMIN_ID,
        email:        EMAIL,
        accessToken:  "Bearer forjado",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED, statusCode: 401 });

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
