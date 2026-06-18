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
import { DomainError, ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockGetDb        = vi.mocked(getDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID = "tenant-uuid-1";
const USER_ID   = "user-uuid-1";

// ─── Builder de mocks de Supabase ─────────────────────────────────────────────

function buildChain(overrides?: {
  single?: () => Promise<unknown>;
  signIn?:  () => Promise<unknown>;
  signOut?: () => Promise<unknown>;
  update?:  () => Promise<unknown>;
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
      signInWithPassword: overrides?.signIn  ?? vi.fn().mockResolvedValue({ data: null, error: null }),
      admin: {
        signOut: overrides?.signOut ?? vi.fn().mockResolvedValue({ error: null }),
      },
      updateUser: overrides?.update ?? vi.fn().mockResolvedValue({ data: null, error: null }),
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
