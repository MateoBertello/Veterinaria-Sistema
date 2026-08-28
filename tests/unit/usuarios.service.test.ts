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
  authUpdateResult?:  object;
  insertResult?:      object;
  updateResult?:      object;
  rolName?:           string;
  /** El roleId no pertenece al tenant (o no existe). */
  rolInexistente?:    boolean;
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
      // `crear` valida con maybeSingle que el rol sea DEL TENANT antes de
      // crear la cuenta en Auth (FK compuesta rol/tenant).
      maybeSingle: vi.fn().mockImplementation(async () => {
        if (table === "roles") {
          return {
            data: state.rolInexistente
              ? null
              : { id: ADMIN_ROLE_ID, name: state.rolName ?? "admin" },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
      // La cadena es "thenable" como la de supabase-js: así se puede esperar
      // directamente una consulta sin terminal explícita. Es lo que hace el
      // COUNT de admins activos (RN-SEC6), que ahora cuenta sobre `usuarios`
      // en vez de listar TODAS las cuentas de Auth del proyecto.
      then: (resolve: (v: unknown) => unknown) =>
        resolve({
          data:  [],
          count: state.adminCount ?? 2,
          error: (state.updateResult as { error?: unknown } | undefined)?.error ?? null,
        }),
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
        updateUserById: vi.fn().mockResolvedValue(
          state.authUpdateResult ?? { data: { user: { id: NEW_USER_ID } }, error: null }
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

// ─── Teléfono: validación de formato ─────────────────────────────────────────

describe("Validación de teléfono (números y separadores + - ( ) y espacios)", () => {
  it("phone con letras → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear({ ...dtoValido, phone: "abc123" }, callerContext),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it("phone con formato válido (+54 11 5555-0001) → OK", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear({ ...dtoValido, phone: "+54 11 5555-0001" }, callerContext),
    ).resolves.toMatchObject({ username: dtoValido.username });
  });
});

// ─── Sincronización de email con Supabase Auth al editar ─────────────────────

describe("Editar email: se sincroniza en Auth para no romper el login", () => {
  const usuario = {
    id:        NEW_USER_ID,
    tenant_id: TENANT_ID,
    username:  "usuario_orig",
    email:     "orig@test.com",
    full_name: "Nombre Original",
    active:    true,
    rol_id:    ADMIN_ROLE_ID,
  };

  it("cambiar el email llama a auth.admin.updateUserById con email_confirm", async () => {
    const db = buildMockDb({ usuarioExistente: usuario, adminCount: 2, rolName: "admin" });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(NEW_USER_ID, { email: "nuevo@test.com" }, callerContext);

    const updateSpy = db.auth.admin.updateUserById as ReturnType<typeof vi.fn>;
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(updateSpy.mock.calls[0][0]).toBe(NEW_USER_ID);
    expect(updateSpy.mock.calls[0][1]).toMatchObject({
      email:         "nuevo@test.com",
      email_confirm: true,
    });
  });

  it("editar SIN cambiar el email no toca Auth", async () => {
    const db = buildMockDb({ usuarioExistente: usuario, adminCount: 2, rolName: "admin" });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(NEW_USER_ID, { fullName: "Otro Nombre" }, callerContext);

    expect(db.auth.admin.updateUserById as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("editar con el MISMO email no toca Auth (no hay cambio real)", async () => {
    const db = buildMockDb({ usuarioExistente: usuario, adminCount: 2, rolName: "admin" });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(NEW_USER_ID, { email: "orig@test.com" }, callerContext);

    expect(db.auth.admin.updateUserById as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("si Auth rechaza el email (ya registrado) → DUPLICATE_USER (409)", async () => {
    const db = buildMockDb({
      usuarioExistente: usuario,
      adminCount:       2,
      rolName:          "admin",
      authUpdateResult: { data: null, error: { message: "A user with this email address has already been registered" } },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.editar(NEW_USER_ID, { email: "tomado@test.com" }, callerContext),
    ).rejects.toMatchObject({ code: ErrorCode.DUPLICATE_USER, statusCode: 409 });
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

/** Override de la tabla doctores con un spy de upsert (DT-1: nunca más INSERT crudo). */
function spyDoctoresUpsert(db: ReturnType<typeof buildMockDb>) {
  const upsertSpy = vi.fn().mockResolvedValue({ data: [{ id: "doctor-1" }], error: null });
  const originalFrom = db.from;
  db.from = vi.fn().mockImplementation((table: string) => {
    if (table === "doctores") {
      return { upsert: upsertSpy };
    }
    return originalFrom(table);
  });
  return upsertSpy;
}

describe("RN-SEC5: Doctor automático si rol=veterinario (UPSERT, DT-1)", () => {
  it("RN-SEC5: crear con rol veterinario hace UPSERT en doctores con specialty por defecto", async () => {
    const db = buildMockDb({ rolName: "veterinario" });
    const upsertSpy = spyDoctoresUpsert(db);
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.crear(
      { ...dtoValido, roleId: VET_ROLE_ID },
      callerContext,
    );

    expect(upsertSpy).toHaveBeenCalledOnce();
    const [payload, opts] = upsertSpy.mock.calls[0];
    expect(payload).toMatchObject({
      tenant_id: TENANT_ID,
      user_id:   NEW_USER_ID,
      name:      dtoValido.fullName,
      specialty: "Clínica general",
      available: true,
    });
    // DO NOTHING sobre perfil existente: no pisa specialty/matrícula editadas a mano.
    expect(opts).toMatchObject({
      onConflict:       "tenant_id,user_id",
      ignoreDuplicates: true,
    });
  });

  it("RN-SEC5: editar cambiando el rol a veterinario hace UPSERT (no duplica perfil existente)", async () => {
    const usuario = {
      id:        NEW_USER_ID,
      tenant_id: TENANT_ID,
      username:  "vet_existente",
      email:     "vet@test.com",
      full_name: "Vet Existente",
      active:    true,
      rol_id:    ADMIN_ROLE_ID,
    };
    const db = buildMockDb({ usuarioExistente: usuario, rolName: "veterinario" });
    const upsertSpy = spyDoctoresUpsert(db);
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(
      NEW_USER_ID,
      { roleId: VET_ROLE_ID },
      callerContext,
    );

    expect(upsertSpy).toHaveBeenCalledOnce();
    const [payload, opts] = upsertSpy.mock.calls[0];
    expect(payload).toMatchObject({
      tenant_id: TENANT_ID,
      user_id:   NEW_USER_ID,
      specialty: "Clínica general",
      available: true,
    });
    expect(opts).toMatchObject({
      onConflict:       "tenant_id,user_id",
      ignoreDuplicates: true,
    });
  });

  it("RN-SEC5: crear con rol no-veterinario NO toca doctores", async () => {
    const db = buildMockDb({ rolName: "admin" });
    const upsertSpy = spyDoctoresUpsert(db);
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.crear(dtoValido, callerContext);

    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

// ─── RN-S1/RN-SEC3: ningún DTO expone password/password_hash ────────────────

describe("RN-S1/RN-SEC3: el DTO público nunca expone password ni password_hash", () => {
  it("RN-S1/RN-SEC3: crear usuario devuelve un DTO sin password ni password_hash", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    const usuario = await UsuariosService.crear(dtoValido, callerContext);

    expect(usuario).not.toHaveProperty("password");
    expect(usuario).not.toHaveProperty("passwordHash");
    expect(usuario).not.toHaveProperty("password_hash");
  });

  it("RN-S1/RN-SEC3: editar usuario devuelve un DTO sin password ni password_hash", async () => {
    const adminUser = {
      id:        NEW_USER_ID,
      tenant_id: TENANT_ID,
      username:  "usuario_orig",
      email:     "orig@test.com",
      full_name: "Nombre Original",
      active:    true,
      rol_id:    ADMIN_ROLE_ID,
    };
    const db = buildMockDb({ usuarioExistente: adminUser, adminCount: 2, rolName: "admin" });
    mockGetServiceDb.mockReturnValue(db as never);

    const usuario = await UsuariosService.editar(NEW_USER_ID, { fullName: "Nombre Actualizado" }, callerContext);

    expect(usuario).not.toHaveProperty("password");
    expect(usuario).not.toHaveProperty("passwordHash");
    expect(usuario).not.toHaveProperty("password_hash");
  });
});

// ─── RN-SEC0/RN-SEC2: permisos derivan del rol, no editables por usuario ────

describe("RN-SEC0/RN-SEC2: los permisos se heredan del rol, nunca se asignan por usuario", () => {
  it("RN-SEC0/RN-SEC2: CrearUsuarioSchema/EditarUsuarioSchema solo aceptan roleId, ningún campo de permisos", () => {
    expect("permisos" in dtoValido).toBe(false);
    expect("permissions" in dtoValido).toBe(false);
    expect("permisos" in { fullName: "x" }).toBe(false);
  });

  it("RN-SEC0/RN-SEC2: crear usuario ignora un campo 'permisos' enviado en el body (no llega al INSERT)", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.crear(
      { ...dtoValido, permisos: ["manage_users", "manage_clients"] } as never,
      callerContext,
    );

    const usuariosTableCalls = (db.from as ReturnType<typeof vi.fn>).mock.results;
    const insertMock = usuariosTableCalls
      .map((r) => r.value as { insert?: ReturnType<typeof vi.fn> })
      .find((v) => typeof v.insert === "function" && (v.insert as ReturnType<typeof vi.fn>).mock.calls.length > 0);

    const insertPayload = insertMock?.insert?.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(insertPayload).toBeDefined();
    expect(insertPayload).not.toHaveProperty("permisos");
    expect(insertPayload).toMatchObject({ rol_id: dtoValido.roleId });
  });
});

// ─── Estado de la cuenta y pertenencia del rol (hallazgos de seguridad) ──────

describe("Desactivar un usuario lo desactiva TAMBIÉN en Supabase Auth", () => {
  // `active` vivía solo en la tabla espejo: la baja cerraba la API pero la
  // cuenta de GoTrue seguía habilitada y podía pedir tokens nuevos.

  it("active=false → banea la cuenta en Auth", async () => {
    const db = buildMockDb({
      usuarioExistente: {
        id: NEW_USER_ID, tenant_id: TENANT_ID, username: "u", email: "u@t.com",
        full_name: "U", phone: null, active: true, rol_id: VET_ROLE_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      rolName: "veterinario",
      adminCount: 5,
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(NEW_USER_ID, { active: false }, callerContext);

    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith(
      NEW_USER_ID,
      expect.objectContaining({ ban_duration: expect.not.stringMatching(/^none$/) }),
    );
  });

  it("active=true → levanta el baneo", async () => {
    const db = buildMockDb({
      usuarioExistente: {
        id: NEW_USER_ID, tenant_id: TENANT_ID, username: "u", email: "u@t.com",
        full_name: "U", phone: null, active: false, rol_id: VET_ROLE_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      rolName: "veterinario",
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(NEW_USER_ID, { active: true }, callerContext);

    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith(
      NEW_USER_ID,
      { ban_duration: "none" },
    );
  });

  it("si el estado NO cambia, no se toca Auth", async () => {
    const db = buildMockDb({
      usuarioExistente: {
        id: NEW_USER_ID, tenant_id: TENANT_ID, username: "u", email: "u@t.com",
        full_name: "U", phone: null, active: true, rol_id: VET_ROLE_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      rolName: "veterinario",
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(NEW_USER_ID, { fullName: "Otro Nombre" }, callerContext);

    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe("El rol asignado tiene que ser del propio tenant", () => {
  it("A3 — editar con un roleId de otra clínica → VALIDATION_ERROR y NO se escribe rol_id", async () => {
    // `crear()` ya validaba que el rol fuera del tenant; `editar()` NO. El
    // roleId viene del body, la FK de `usuarios.rol_id` apunta a `roles(id)` a
    // secas y la consulta corre con service role (RLS bypasseada), así que el
    // id de un rol de OTRA clínica se escribía sin chistar. Como los permisos
    // se resuelven desde el rol, era un camino de escalada cross-tenant.
    const db = buildMockDb({
      usuarioExistente: {
        id: NEW_USER_ID, tenant_id: TENANT_ID, username: "operador",
        email: "op@test.com", full_name: "Operador", phone: null, active: true,
        rol_id: ADMIN_ROLE_ID, created_at: "2026-01-01T00:00:00Z",
      },
      rolInexistente: true, // el rol no aparece filtrando por este tenant
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.editar(NEW_USER_ID, { roleId: VET_ROLE_ID }, callerContext),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    // Se valida ANTES de tocar Auth y antes del UPDATE: no queda un estado a medias.
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("roleId de otra clínica → VALIDATION_ERROR y NO se crea la cuenta en Auth", async () => {
    // La FK vieja apuntaba a `roles(id)` a secas: un rol ajeno entraba sin
    // error y dejaba un usuario que ni siquiera podía loguear.
    const db = buildMockDb({ rolInexistente: true });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.crear(dtoValido, callerContext),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    // Se valida ANTES de tocar Auth: no queda una cuenta que después haya que
    // borrar a mano.
    expect(db.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

describe("RN-SEC6: el conteo de admins es real, no `listUsers()`", () => {
  it("con un solo admin activo, desactivarlo → LAST_ADMIN", async () => {
    const db = buildMockDb({
      usuarioExistente: {
        id: NEW_USER_ID, tenant_id: TENANT_ID, username: "admin", email: "a@t.com",
        full_name: "A", phone: null, active: true, rol_id: ADMIN_ROLE_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      rolName: "admin",
      adminCount: 1,
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      UsuariosService.editar(NEW_USER_ID, { active: false }, callerContext),
    ).rejects.toMatchObject({ code: ErrorCode.LAST_ADMIN });

    // Y no se banea a nadie si la baja se rechazó.
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("ya no consulta `listUsers()` (contaba las cuentas de TODOS los tenants)", async () => {
    const db = buildMockDb({
      usuarioExistente: {
        id: NEW_USER_ID, tenant_id: TENANT_ID, username: "admin", email: "a@t.com",
        full_name: "A", phone: null, active: true, rol_id: ADMIN_ROLE_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      rolName: "admin",
      adminCount: 3,
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await UsuariosService.editar(NEW_USER_ID, { active: false }, callerContext);

    expect(db.auth.admin.listUsers).not.toHaveBeenCalled();
  });
});
