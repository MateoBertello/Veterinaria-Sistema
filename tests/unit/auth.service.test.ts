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
import { makeJwt } from "./_helpers/permissionMock.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockGetDb        = vi.mocked(getDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID = "tenant-uuid-1";
const USER_ID   = "user-uuid-1";

// ─── Builder de mocks de Supabase ─────────────────────────────────────────────

function buildChain(overrides?: {
  single?:               () => Promise<unknown>;
  /** Filas que devuelve `limit()`: el login resuelve el identificador así. */
  filas?:                unknown[];
  /** `true` = el rate limiter (RPC) reporta bloqueo. */
  bloqueado?:            boolean;
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
    // El login usa `limit(2)` (no `single()`) para poder detectar homónimos
    // entre tenants sin que la consulta falle.
    limit:  vi.fn().mockResolvedValue({ data: overrides?.filas ?? [], error: null }),
    // Rate limit persistido: `registrar_intento_login` devuelve si bloquea,
    // `limpiar_intentos_login` no devuelve nada.
    rpc:    vi.fn().mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "registrar_intento_login"
          ? { data: overrides?.bloqueado ?? false, error: null }
          : { data: null, error: null },
      )),
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
});

// ─── RN-AUT1: credenciales inválidas ─────────────────────────────────────────

describe("RN-AUT1: Autenticación — credenciales inválidas", () => {
  it("RN-AUT1: usuario no encontrado → UNAUTHORIZED con mensaje genérico", async () => {
    const serviceDb = buildChain({ filas: [] });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.login({ username: "inexistente", password: "123456" }, "127.0.0.1"),
    ).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
      message: "Credenciales inválidas",
    });
  });

  it("RN-AUT1: usuario inactivo → UNAUTHORIZED con mensaje genérico", async () => {
    const serviceDb = buildChain({ filas: [{ ...usuarioActivo, active: false }] });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.login({ username: "admin1", password: "Pass1234!" }, "127.0.0.1"),
    ).rejects.toMatchObject({
      code:    ErrorCode.UNAUTHORIZED,
      message: "Credenciales inválidas",
    });
  });

  it("RN-AUT1: contraseña incorrecta → UNAUTHORIZED con mensaje genérico", async () => {
    const serviceDb = buildChain({ filas: [usuarioActivo] });
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
    const serviceDb = buildChain({ filas: [usuarioActivo] });
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
    const serviceDb = buildChain({ filas: [usuarioActivo] });
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

  it("RN-AUT4: logout con token inválido → UNAUTHORIZED y NO registra auditoría", async () => {
    const serviceDb = buildChain();
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    // GoTrue rechaza el token (forjado o vencido): admin.signOut devuelve error.
    const userDb = buildChain({
      signOut: vi.fn().mockResolvedValue({
        error: { message: "invalid JWT: unable to parse or verify signature", status: 403 },
      }),
    });
    mockGetDb.mockReturnValue(userDb as never);

    await expect(
      AuthService.logout({
        userId:      "usuario-forjado",
        tenantId:    "tenant-forjado",
        userName:    "unknown",
        userRole:    "unknown",
        accessToken: "Bearer token-forjado",
      }),
    ).rejects.toMatchObject({
      code:       ErrorCode.UNAUTHORIZED,
      statusCode: 401,
    });

    // La identidad decodificada del token NO verificado nunca llega a auditoría.
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ─── RN-AUT5: rate limiting ───────────────────────────────────────────────────

describe("RN-AUT5: Rate limiting", () => {
  // El CONTEO vive ahora en la base (RPC `registrar_intento_login`), no en un
  // Map del isolate que se perdía en cada arranque en frío. Acá se verifica el
  // contrato con esa RPC; que efectivamente bloquee al 6º intento lo cubre el
  // test de integración, que es donde corre el SQL.

  it("RN-AUT5: cuenta el intento contra la cuenta Y la IP, con umbrales distintos", async () => {
    const serviceDb = buildChain({ filas: [] });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.login({ username: "Admin1", password: "wrong" }, "10.0.0.99"),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });

    expect(serviceDb.rpc).toHaveBeenCalledWith("registrar_intento_login", {
      // El bucket de usuario va normalizado: `Admin1` y `admin1` son la misma
      // cuenta y tienen que compartir contador.
      p_claves:          ["user:admin1", "ip:10.0.0.99"],
      // La IP tiene techo mucho más alto: una clínica entera sale por una sola.
      p_maximos:         [5, 50],
      p_ventana_minutos: 15,
    });
  });

  it("RN-AUT5: si la RPC reporta bloqueo → 429 RATE_LIMITED y no se consulta al usuario", async () => {
    const serviceDb = buildChain({ bloqueado: true, filas: [usuarioActivo] });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.login({ username: "admin1", password: "Pass1234!" }, "10.0.0.99"),
    ).rejects.toMatchObject({
      code:       ErrorCode.RATE_LIMITED,
      statusCode: 429,
    });

    // Cortocircuito: bloqueado no se toca la tabla de usuarios.
    expect(serviceDb.from).not.toHaveBeenCalled();
  });

  it("RN-AUT5: el login exitoso limpia los contadores", async () => {
    const serviceDb = buildChain({ filas: [usuarioActivo] });
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({
      signIn: vi.fn().mockResolvedValue({ data: { session: tokenDeSupabase }, error: null }),
    }) as never);

    await AuthService.login({ username: "admin1", password: "Pass1234!" }, "10.0.0.99");

    expect(serviceDb.rpc).toHaveBeenCalledWith("limpiar_intentos_login", {
      p_claves: ["user:admin1", "ip:10.0.0.99"],
    });
  });
});

// ─── Identificador de login: mayúsculas, espacios, email y homónimos ─────────

describe("Resolución del identificador de login", () => {
  function loginOk(filas: unknown[]) {
    const serviceDb = buildChain({ filas });
    mockGetServiceDb.mockReturnValue(serviceDb as never);
    mockGetDb.mockReturnValue(buildChain({
      signIn: vi.fn().mockResolvedValue({ data: { session: tokenDeSupabase }, error: null }),
    }) as never);
    return serviceDb;
  }

  it("busca por `username_ci` en minúscula: `Juanpa` entra tipeando `juanpa`", async () => {
    // El bug real: el alta guardó `Juanpa` y la igualdad de TEXT en Postgres es
    // case-sensitive, así que tipear el usuario devolvía 0 filas → 401 genérico.
    const serviceDb = loginOk([usuarioActivo]);

    await AuthService.login({ username: "JuanPa", password: "Pass1234!" }, "127.0.0.1");

    expect(serviceDb.eq).toHaveBeenCalledWith("username_ci", "juanpa");
  });

  it("un identificador con @ se resuelve por `email_ci`", async () => {
    const serviceDb = loginOk([usuarioActivo]);

    await AuthService.login({ username: "Admin@Test.com", password: "Pass1234!" }, "127.0.0.1");

    expect(serviceDb.eq).toHaveBeenCalledWith("email_ci", "admin@test.com");
  });

  it("homónimos en dos tenants → AMBIGUOUS_IDENTIFIER en vez de dejar a ambos afuera", async () => {
    // El username es único POR TENANT: dos clínicas pueden tener su `admin`.
    // Antes `single()` fallaba ante la colisión y ninguno de los dos podía entrar.
    const serviceDb = buildChain({
      filas: [usuarioActivo, { ...usuarioActivo, id: "user-uuid-2", tenant_id: "tenant-uuid-2" }],
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.login({ username: "admin1", password: "Pass1234!" }, "127.0.0.1"),
    ).rejects.toMatchObject({
      code:       ErrorCode.AMBIGUOUS_IDENTIFIER,
      statusCode: 409,
    });
  });

  it("un rol SIN permisos asignados puede loguear (permisos por LEFT JOIN)", async () => {
    // Con `rol_permiso!inner` el usuario desaparecía de la consulta y recibía
    // "Credenciales inválidas", indistinguible de una contraseña mal puesta.
    loginOk([{ ...usuarioActivo, roles: { ...usuarioActivo.roles, rol_permiso: [] } }]);

    const result = await AuthService.login(
      { username: "admin1", password: "Pass1234!" },
      "127.0.0.1",
    );

    expect(result.user.permissions).toEqual([]);
    expect(result.user.roleName).toBe("Administrador");
  });

  it("devuelve el refresh token para poder renovar la sesión", async () => {
    loginOk([usuarioActivo]);
    mockGetDb.mockReturnValue(buildChain({
      signIn: vi.fn().mockResolvedValue({
        data:  { session: { ...tokenDeSupabase, refresh_token: "refresh-abc" } },
        error: null,
      }),
    }) as never);

    const result = await AuthService.login(
      { username: "admin1", password: "Pass1234!" },
      "127.0.0.1",
    );

    expect(result.refreshToken).toBe("refresh-abc");
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

// ─── A3: recuperación de usuario con email repetido entre tenants ────────────

describe("A3: `usuarios` NO garantiza email único global — la recuperación lo contempla", () => {
  it("dos tenants con el mismo email resuelven sin error (no 500, no descarte silencioso)", async () => {
    // La unicidad del esquema es UNIQUE (tenant_id, email): dos clínicas pueden
    // tener filas con el mismo email. Lo que hoy lo evita es GoTrue, no la
    // tabla. Con `.single()` PostgREST devolvía error ante dos filas y el
    // pedido se descartaba en silencio — misma forma que el bug DT-19 del login.
    const serviceDb = buildChain({
      filas: [
        { id: "u-a", tenant_id: "tenant-a", username: "admin_a", email: "compartido@test.com" },
        { id: "u-b", tenant_id: "tenant-b", username: "admin_b", email: "compartido@test.com" },
      ],
    });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await expect(
      AuthService.recuperarUsuario({ email: "compartido@test.com" }),
    ).resolves.toBeUndefined();

    // La consulta resuelve las coincidencias con `limit()`, NO con `single()`.
    expect(serviceDb.limit).toHaveBeenCalled();
    expect(serviceDb.single).not.toHaveBeenCalled();
  });

  it("la búsqueda por email es cross-tenant a propósito: el endpoint es público, no hay tenant en contexto", async () => {
    const serviceDb = buildChain({ filas: [] });
    mockGetServiceDb.mockReturnValue(serviceDb as never);

    await AuthService.recuperarUsuario({ email: "Alguien@Test.com " });

    // Normaliza contra email_ci y filtra por active — nunca por tenant_id.
    const columnasFiltradas = serviceDb.eq.mock.calls.map((c) => c[0]);
    expect(columnasFiltradas).toContain("email_ci");
    expect(columnasFiltradas).toContain("active");
    expect(columnasFiltradas).not.toContain("tenant_id");
    expect(serviceDb.eq).toHaveBeenCalledWith("email_ci", "alguien@test.com");
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


describe("RN-AUT2: el token emitido en login trae una expiración (exp)", () => {
  it("RN-AUT2: result.token decodifica con una claim exp numérica", async () => {
    const serviceDb = buildChain({ filas: [usuarioActivo] });
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
