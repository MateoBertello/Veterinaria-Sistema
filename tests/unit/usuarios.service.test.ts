import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks declarados ANTES de imports del módulo ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { UsuariosService } from "../../supabase/functions/api/src/modules/usuarios/usuarios.service.ts";
import { DomainError, ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID       = "11111111-1111-1111-1111-111111111111";
const CALLER_USER_ID  = "22222222-2222-2222-2222-222222222222";
const NEW_USER_ID     = "33333333-3333-3333-3333-333333333333";
const ADMIN_ROLE_ID   = "44444444-4444-4444-4444-444444444444";
const VET_ROLE_ID     = "55555555-5555-5555-5555-555555555555";

// ─── Helper para construir el mock de DB ──────────────────────────────────────

type DbMockState = {
  usuarioExistente?: object | null;
  conflictoUsername?: boolean;
  conflictoEmail?:    boolean;
  adminCount?:        number;
  authCreateResult?:  object;
  authDeleteResult?:  object;
  insertResult?:      object;
  updateResult?:      object;
  rolName?:           string;
};

function buildMockDb(state: DbMockState = {}) {
  let callCount = 0;

  const db = {
    // Para cada llamada from().select().eq().single() devolvemos datos distintos
    // según el contexto. Usamos un contador para diferenciar llamadas.
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue(
        state.insertResult ?? { data: [{ id: NEW_USER_ID }], error: null }
      ),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      neq:    vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(async () => {
        callCount++;

        // Búsqueda de unicidad username
        if (table === "usuarios" && callCount === 1 && state.conflictoUsername) {
          return { data: { id: "other-user" }, error: null };
        }
        // Búsqueda de unicidad email
        if (table === "usuarios" && callCount === 2 && state.conflictoEmail) {
          return { data: { id: "other-user" }, error: null };
        }
        // Búsqueda del usuario a editar
        if (table === "usuarios" && state.usuarioExistente !== undefined) {
          return { data: state.usuarioExistente, error: null };
        }
        // Búsqueda del rol
        if (table === "roles") {
          return {
            data: { id: ADMIN_ROLE_ID, name: state.rolName ?? "admin" },
            error: null,
          };
        }
        return { data: null, error: { message: "not found" } };
      }),
      // Para COUNT de admins activos
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ error: null }),
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue(
          state.authCreateResult ?? {
            data:  { user: { id: NEW_USER_ID } },
            error: null,
          }
        ),
        deleteUser: vi.fn().mockResolvedValue(
          state.authDeleteResult ?? { error: null }
        ),
        listUsers: vi.fn().mockResolvedValue({
          data: {
            users: Array.from(
              { length: state.adminCount ?? 2 },
              (_, i) => ({ id: `admin-${i}` })
            ),
          },
          error: null,
        }),
      },
    },
  };
  return db;
}

const callerContext = {
  tenantId:     TENANT_ID,
  callerUserId: CALLER_USER_ID,
  callerName:   "Admin Principal",
  callerRole:   "admin",
  authHeader:   "Bearer fake-token",
};

const dtoValido = {
  username: "nuevo_usuario",
  password: "Password123!",
  fullName: "Nuevo Usuario",
  email:    "nuevo@test.com",
  roleId:   ADMIN_ROLE_ID,
  active:   true as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── RN-SEC1: campos obligatorios ────────────────────────────────────────────

describe("RN-SEC1: Validación de campos obligatorios", () => {
  it("RN-SEC1: username faltante → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear(
        { ...dtoValido, username: "" },
        callerContext,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it("RN-SEC1: email inválido → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear(
        { ...dtoValido, email: "no-es-email" },
        callerContext,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it("RN-SEC1: password corta → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear(
        { ...dtoValido, password: "123" },
        callerContext,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});

// ─── RN-SEC4: unicidad ────────────────────────────────────────────────────────

describe("RN-SEC4: Unicidad de username y email", () => {
  it("RN-SEC4: username duplicado → DUPLICATE_USER (409)", async () => {
    const db = buildMockDb({ conflictoUsername: true });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear(dtoValido, callerContext),
    ).rejects.toMatchObject({
      code:       ErrorCode.DUPLICATE_USER,
      statusCode: 409,
    });
  });

  it("RN-SEC4: email duplicado → DUPLICATE_USER (409)", async () => {
    const db = buildMockDb({ conflictoEmail: true });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear(dtoValido, callerContext),
    ).rejects.toMatchObject({
      code:       ErrorCode.DUPLICATE_USER,
      statusCode: 409,
    });
  });
});

// ─── RN-SEC6: LAST_ADMIN ──────────────────────────────────────────────────────

describe("RN-SEC6: Protección último admin activo", () => {
  it("RN-SEC6: desactivar el último admin activo → LAST_ADMIN (409)", async () => {
    const adminUser = {
      id:        CALLER_USER_ID,
      tenant_id: TENANT_ID,
      username:  "admin1",
      email:     "admin@test.com",
      full_name: "Admin Uno",
      active:    true,
      rol_id:    ADMIN_ROLE_ID,
    };

    const db = buildMockDb({
      usuarioExistente: adminUser,
      adminCount:       1,        // solo un admin activo
      rolName:          "admin",
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.editar(
        CALLER_USER_ID,
        { active: false },
        callerContext,
      ),
    ).rejects.toMatchObject({
      code:       ErrorCode.LAST_ADMIN,
      statusCode: 409,
    });
  });

  it("RN-SEC6: desactivar cuando hay 2 admins activos → OK", async () => {
    const adminUser = {
      id:        "other-admin-id",
      tenant_id: TENANT_ID,
      username:  "admin2",
      email:     "admin2@test.com",
      full_name: "Admin Dos",
      active:    true,
      rol_id:    ADMIN_ROLE_ID,
    };

    const db = buildMockDb({
      usuarioExistente: adminUser,
      adminCount:       2,       // dos admins activos
      rolName:          "admin",
    });
    mockGetServiceDb.mockReturnValue(db as never);

    // No debe lanzar — pero el mock de update devuelve null así que
    // el service devolverá null; simplemente verificamos que no hay excepción
    await expect(
      UsuariosService.editar(
        "other-admin-id",
        { active: false },
        callerContext,
      ),
    ).resolves.not.toThrow();
  });
});

// ─── RN-SEC7: auditoría ───────────────────────────────────────────────────────

describe("RN-SEC7: Auditoría de escrituras de usuarios", () => {
  it("RN-SEC7: crear usuario registra auditoría CREATE en módulo users", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.crear(dtoValido, callerContext);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0][1];
    expect(auditCall.action).toBe("CREATE");
    expect(auditCall.module).toBe("users");
    expect(auditCall.tenantId).toBe(TENANT_ID);
    // RN-S1: newValues NO debe contener el campo password
    expect(auditCall.newValues).not.toHaveProperty("password");
  });

  it("RN-SEC7: editar usuario registra auditoría UPDATE con oldValues y newValues", async () => {
    const adminUser = {
      id:        NEW_USER_ID,
      tenant_id: TENANT_ID,
      username:  "usuario_orig",
      email:     "orig@test.com",
      full_name: "Nombre Original",
      active:    true,
      rol_id:    ADMIN_ROLE_ID,
    };
    const db = buildMockDb({
      usuarioExistente: adminUser,
      adminCount:       2,
      rolName:          "admin",
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(
      NEW_USER_ID,
      { fullName: "Nombre Actualizado" },
      callerContext,
    );

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0][1];
    expect(auditCall.action).toBe("UPDATE");
    expect(auditCall.module).toBe("users");
    expect(auditCall.oldValues).toBeDefined();
    expect(auditCall.newValues).toBeDefined();
  });
});

// ─── RN-SEC5: Doctor automático ───────────────────────────────────────────────

describe("RN-SEC5: Crear Doctor automáticamente si rol=veterinario", () => {
  it("RN-SEC5: crear usuario con rol veterinario dispara INSERT en doctores", async () => {
    const db = buildMockDb({ rolName: "veterinario" });
    const insertSpy = vi.fn().mockResolvedValue({ data: [{ id: "doctor-1" }], error: null });

    // Override específico para la tabla doctores
    const originalFrom = db.from;
    db.from = vi.fn().mockImplementation((table: string) => {
      if (table === "doctores") {
        return { insert: insertSpy };
      }
      return originalFrom(table);
    });

    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.crear(
      { ...dtoValido, roleId: VET_ROLE_ID },
      callerContext,
    );

    expect(insertSpy).toHaveBeenCalledOnce();
    const insertArg = insertSpy.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      tenant_id: TENANT_ID,
      user_id:   NEW_USER_ID,
    });
  });
});
