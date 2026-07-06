import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks declarados ANTES de imports del módulo ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getDb, getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { AuthService } from "../../supabase/functions/api/src/modules/auth/auth.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";
import { RecuperarUsuarioSchema, RecuperarPasswordSchema } from "../../supabase/functions/api/src/modules/auth/auth.schemas.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockGetDb        = vi.mocked(getDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID = "tenant-uuid-1";
const USER_ID   = "user-uuid-1";

// ─── Builder de mocks de Supabase ─────────────────────────────────────────────

function buildChain(overrides?: {
  single?:               () => Promise<unknown>;
  signIn?:               () => Promise<unknown>;
  signOut?:              () => Promise<unknown>;
  update?:               () => Promise<unknown>;
  resetPasswordForEmail?: () => Promise<unknown>;
}) {
  const chain = {
    from:   vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    neq:    vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: overrides?.single ?? vi.fn().mockResolvedValue({ data: null, error: null }),
    count:  vi.fn().mockResolvedValue({ count: 0, error: null }),
    auth: {
      signInWithPassword:    overrides?.signIn  ?? vi.fn().mockResolvedValue({ data: null, error: null }),
      admin: {
        signOut: overrides?.signOut ?? vi.fn().mockResolvedValue({ error: null }),
      },
      updateUser:            overrides?.update ?? vi.fn().mockResolvedValue({ data: null, error: null }),
      resetPasswordForEmail: overrides?.resetPasswordForEmail ?? vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  };
  return chain;
}

// ─── Datos de prueba ──────────────────────────────────────────────────────────

const usuarioActivo = {
  id:        USER_ID,
  tenant_id: TENANT_ID,
  username:  "admin1",
  email:     "admin@test.com",
  full_name: "Admin Uno",
  active:    true,
  last_login: null,
  roles: {
    id:           "role-1",
    name:         "admin",
    display_name: "Administrador",
    rol_permiso:  [
      { permisos: { name: "manage_users" } },
      { permisos: { name: "manage_clients" } },
    ],
  },
};

const tokenDeSupabase = { access_token: "supabase-jwt-xyz", expires_in: 3600 };

beforeEach(() => {
  vi.clearAllMocks();
  // Reiniciar el rate limiter entre tests
  AuthService.resetRateLimiter();
});

// ─── RN-AUT1: credenciales inválidas ─────────────────────────────────────────

describe("RN-AUT1: Autenticación — credenciales inválidas", () => {
  it("RN-AUT1: usuario no encontrado → UNAUTHORIZED con mensaje genérico", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "No rows" } }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.login({ username: "inexistente", password: "123456" }, "127.0.0.1"),
    ).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
      message: "Credenciales inválidas",
    });
  });

  it("RN-AUT1: usuario inactivo → UNAUTHORIZED con mensaje genérico", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({
        data: { ...usuarioActivo, active: false },
        error: null,
      }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.login({ username: "admin1", password: "Pass1234!" }, "127.0.0.1"),
    ).rejects.toMatchObject({
      code:    ErrorCode.UNAUTHORIZED,
      message: "Credenciales inválidas",
    });
  });

  it("RN-AUT1: contraseña incorrecta → UNAUTHORIZED con mensaje genérico", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: usuarioActivo, error: null }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    const userDb = buildChain({
      signIn: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Invalid login credentials" },
      }),
    });
    mockGetDb.mockReturnValue(userDb as never);

    await expect(
      AuthService.login({ username: "admin1", password: "wrong" }, "127.0.0.1"),
    ).rejects.toMatchObject({
      code:    ErrorCode.UNAUTHORIZED,
      message: "Credenciales inválidas",
    });
  });
});

// ─── RN-AUT3: login exitoso ───────────────────────────────────────────────────

describe("RN-AUT3: Login exitoso", () => {
  it("RN-AUT3: devuelve token + rol + permisos al autenticar correctamente", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: usuarioActivo, error: null }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    const userDb = buildChain({
      signIn: vi.fn().mockResolvedValue({
        data:  { session: tokenDeSupabase },
        error: null,
      }),
    });
    mockGetDb.mockReturnValue(userDb as never);

    const result = await AuthService.login(
      { username: "admin1", password: "Pass1234!" },
      "127.0.0.1",
    );

    expect(result.token).toBe("supabase-jwt-xyz");
    expect(result.user.username).toBe("admin1");
    expect(result.user.fullName).toBe("Admin Uno");
    expect(result.user.roleName).toBe("Administrador");
    expect(result.user.permissions).toContain("manage_users");
    expect(result.user.permissions).toContain("manage_clients");
    // RN-S1: no hay campo "password" ni "passwordHash" en la respuesta
    expect(result.user).not.toHaveProperty("password");
    expect(result.user).not.toHaveProperty("passwordHash");
  });
});

// ─── RN-AUT4: auditoría ───────────────────────────────────────────────────────

describe("RN-AUT4: Auditoría de login/logout", () => {
  it("RN-AUT4: login exitoso registra auditoría LOGIN en módulo security", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: usuarioActivo, error: null }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    const userDb = buildChain({
      signIn: vi.fn().mockResolvedValue({
        data:  { session: tokenDeSupabase },
        error: null,
      }),
    });
    mockGetDb.mockReturnValue(userDb as never);

    await AuthService.login({ username: "admin1", password: "Pass1234!" }, "192.168.1.1");

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0][1];
    expect(auditCall.action).toBe("LOGIN");
    expect(auditCall.module).toBe("security");
    expect(auditCall.tenantId).toBe(TENANT_ID);
    expect(auditCall.userId).toBe(USER_ID);
    expect(auditCall.ipAddress).toBe("192.168.1.1");
  });

  it("RN-AUT4: logout registra auditoría LOGOUT en módulo security", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    const userDb = buildChain({
      signOut: vi.fn().mockResolvedValue({ error: null }),
    });
    mockGetDb.mockReturnValue(userDb as never);

    await AuthService.logout({
      userId:      USER_ID,
      tenantId:    TENANT_ID,
      userName:    "admin1",
      userRole:    "admin",
      accessToken: "Bearer token-xyz",
    });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0][1];
    expect(auditCall.action).toBe("LOGOUT");
    expect(auditCall.module).toBe("security");
    expect(auditCall.userId).toBe(USER_ID);
  });
});

// ─── RN-AUT5: rate limiting ───────────────────────────────────────────────────

describe("RN-AUT5: Rate limiting", () => {
  it("RN-AUT5: bloquea tras 5 intentos fallidos consecutivos desde la misma IP", async () => {
    // Simular 5 intentos fallidos
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    const ip = "10.0.0.99";
    const attempt = () => AuthService.login({ username: "admin1", password: "wrong" }, ip);

    // 5 intentos fallidos
    for (let i = 0; i < 5; i++) {
      await expect(attempt()).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    }

    // El 6° debe ser bloqueado con statusCode 429
    await expect(attempt()).rejects.toMatchObject({
      statusCode: 429,
    });
  });
});

// ─── RN-REC1: email inválido ─────────────────────────────────────────────────

describe("RN-REC1: se valida el formato del email antes de procesar", () => {
  it("RN-REC1: RecuperarUsuarioSchema rechaza un email con formato inválido", () => {
    expect(RecuperarUsuarioSchema.safeParse({ email: "no-es-un-email" }).success).toBe(false);
  });

  it("RN-REC1: RecuperarPasswordSchema rechaza un email con formato inválido", () => {
    expect(RecuperarPasswordSchema.safeParse({ email: "no-es-un-email" }).success).toBe(false);
  });
});

// ─── RN-REC2: anti-enumeración ───────────────────────────────────────────────

describe("RN-REC2: la respuesta es genérica, no revela si el email existe", () => {
  it("RN-REC2: recuperarUsuario con email inexistente resuelve sin error, igual que con email existente", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "No rows" } }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.recuperarUsuario({ email: "no-existe@test.com" }),
    ).resolves.toBeUndefined();
  });

  it("RN-REC2: recuperarPassword con email inexistente resuelve sin error (Supabase Auth no distingue)", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    const userDb = buildChain();
    mockGetDb.mockReturnValue(userDb as never);

    await expect(
      AuthService.recuperarPassword({ email: "no-existe@test.com" }),
    ).resolves.toBeUndefined();
  });
});

// ─── RN-REC3: token de restablecimiento, nunca password en claro ─────────────

describe("RN-REC3: el reset usa accessToken (no una password vieja) y nunca expone la password", () => {
  it("RN-REC3: resetPassword autentica con el accessToken del dto, no con una password vieja", async () => {
    const updateUserMock = vi.fn().mockResolvedValue({ error: null });
    const userDb = buildChain({ update: updateUserMock });
    mockGetDb.mockReturnValue(userDb as never);

    await AuthService.resetPassword({ accessToken: "reset-token-abc", nuevaPassword: "NuevaPass1!" });

    expect(mockGetDb).toHaveBeenCalledWith("Bearer reset-token-abc");
    expect(updateUserMock).toHaveBeenCalledWith({ password: "NuevaPass1!" });
    expect(updateUserMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ accessToken: expect.anything() }),
    );
  });

  it("RN-REC3: token expirado/inválido → 401 con mensaje genérico, sin filtrar el error real de Supabase", async () => {
    const userDb = buildChain({
      update: vi.fn().mockResolvedValue({ error: { message: "JWT expired" } }),
    });
    mockGetDb.mockReturnValue(userDb as never);

    await expect(
      AuthService.resetPassword({ accessToken: "vencido", nuevaPassword: "NuevaPass1!" }),
    ).rejects.toMatchObject({
      code:       ErrorCode.UNAUTHORIZED,
      statusCode: 401,
      message:    expect.stringContaining("token puede haber expirado"),
    });
  });
});

// ─── RN-REC4: auditoría de la solicitud de recuperación ──────────────────────

describe("RN-REC4: la solicitud de recuperación audita en módulo security", () => {
  it("RN-REC4: recuperarUsuario registra auditoría VIEW en módulo security", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "No rows" } }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await AuthService.recuperarUsuario({ email: "alguien@test.com" });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0][1];
    expect(auditCall.action).toBe("VIEW");
    expect(auditCall.module).toBe("security");
  });

  it("RN-REC4: recuperarPassword registra auditoría UPDATE en módulo security", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    const userDb = buildChain();
    mockGetDb.mockReturnValue(userDb as never);

    await AuthService.recuperarPassword({ email: "alguien@test.com" });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0][1];
    expect(auditCall.action).toBe("UPDATE");
    expect(auditCall.module).toBe("security");
  });
});

// ─── RN-AUT2: el login emite un JWT con expiración ───────────────────────────

function makeJwt(payload: object): string {
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "HS256" })}.${encode(payload)}.sig`;
}

describe("RN-AUT2: el token emitido en login trae una expiración (exp)", () => {
  it("RN-AUT2: result.token decodifica con una claim exp numérica", async () => {
    const serviceDb = buildChain({
      single: vi.fn().mockResolvedValue({ data: usuarioActivo, error: null }),
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwtConExpiracion = makeJwt({ sub: USER_ID, exp });

    const userDb = buildChain({
      signIn: vi.fn().mockResolvedValue({
        data:  { session: { access_token: jwtConExpiracion, expires_in: 3600 } },
        error: null,
      }),
    });
    mockGetDb.mockReturnValue(userDb as never);

    const result = await AuthService.login({ username: "admin1", password: "Pass1234!" }, "127.0.0.1");

    const base64 = result.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
    expect(typeof payload.exp).toBe("number");
  });
});
