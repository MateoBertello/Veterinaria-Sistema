import { vi } from "vitest";
import { createHmac } from "node:crypto";

/**
 * Secreto con el que se firman los JWT de test.
 *
 * Se publica en el entorno al importar este helper porque `verifyJwt` lo lee de
 * `SUPABASE_JWT_SECRET` en cada verificación. Antes los tests armaban tokens con
 * la firma literal `"sig"`: servían mientras los middlewares solo decodificaban
 * el payload, pero ahora la firma se verifica de verdad (era justamente el
 * agujero que permitía fabricar un token de Super Admin).
 */
export const JWT_SECRET_DE_TEST = "secreto-de-test-para-firmar-jwt-en-unitarios";

process.env["SUPABASE_JWT_SECRET"] ??= JWT_SECRET_DE_TEST;

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** JWT HS256 REALMENTE firmado, para tests de middleware/controller. */
export function makeJwt(payload: object): string {
  const encode = (obj: object) => base64Url(Buffer.from(JSON.stringify(obj)));

  const header = encode({ alg: "HS256", typ: "JWT" });
  const cuerpo = encode(payload);
  const firma  = base64Url(
    createHmac("sha256", JWT_SECRET_DE_TEST).update(`${header}.${cuerpo}`).digest(),
  );

  return `${header}.${cuerpo}.${firma}`;
}

/**
 * JWT con los claims pedidos pero firma inválida: el vector de ataque que
 * cierran `tenantContext` y `requireSuperAdmin`.
 */
export function makeJwtForjado(payload: object): string {
  const partes = makeJwt(payload).split(".");
  return `${partes[0]}.${partes[1]}.firma-que-no-es`;
}

/** JWT con `alg: none` y sin firma: la otra variante clásica de forjado. */
export function makeJwtAlgNone(payload: object): string {
  const encode = (obj: object) => base64Url(Buffer.from(JSON.stringify(obj)));
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

/**
 * Tipo de guard que produjo cada resultado encolado.
 *
 * Existe porque `requireActiveTenant` y `requirePermission` dejaron de hacer una
 * consulta cada uno: ahora comparten UNA sola (ver middleware/accessSnapshot.ts).
 * Los tests siguen declarando qué responde cada guard —que es lo legible— y este
 * helper los combina en la única respuesta que la cadena va a consumir.
 */
type TipoResultado = "tenant" | "modulo" | "permiso";

interface QueryResult {
  data:   unknown;
  error:  unknown;
  __tipo?: TipoResultado;
}

interface ChainDb {
  from:   ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq:     ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

function buildChain(): ChainDb {
  return {
    from:   vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single: vi.fn(),
  };
}

/**
 * Fila que devuelve la consulta consolidada de `accessSnapshot`: el tenant con
 * su usuario embebido. Combina lo que antes eran dos respuestas separadas.
 */
function consolidar(tenant?: QueryResult, permiso?: QueryResult): QueryResult {
  // Tenant inexistente: la consulta no devuelve fila y el guard corta con
  // TENANT_NOT_FOUND antes de mirar al usuario.
  if (tenant && tenant.data === null) {
    return { data: null, error: tenant.error };
  }

  // Sin resultado de tenant encolado, la cadena bajo prueba no monta el guard
  // de tenant: se asume un tenant existente y activo para no interferir.
  const activo = tenant ? (tenant.data as { activo: boolean }).activo : true;

  let usuarios: unknown[];
  if (!permiso) {
    // Cadena sin requirePermission: el usuario existe y está activo, pero sus
    // permisos no se declararon porque nadie los va a mirar.
    usuarios = [{ active: true, roles: { rol_permiso: [] } }];
  } else if (permiso.data === null) {
    // `permissionResult(null)` = usuario inexistente o inactivo: el embed no
    // trae fila de usuario.
    usuarios = [];
  } else {
    usuarios = [{
      active: true,
      roles:  (permiso.data as { roles: unknown }).roles,
    }];
  }

  return { data: { activo, usuarios }, error: null };
}


/**
 * Funde varios `permissionResult` en uno.
 *
 * Una cadena puede apilar dos guards de permiso (uno compartido por el router y
 * otro propio de la ruta) y los tests declaraban un resultado por guard, porque
 * cada uno consultaba por su cuenta. Con la consulta consolidada hay UN usuario
 * con UN juego de permisos, así que lo que corresponde es la unión: el usuario
 * tiene todo lo declarado, y cada guard verifica contra ese mismo juego.
 */
function unirPermisos(permisos: QueryResult[]): QueryResult | undefined {
  if (permisos.length === 0) return undefined;

  // Un `permissionResult(null)` (usuario inexistente o inactivo) manda: no hay
  // fila de usuario que unir.
  if (permisos.some((r) => r.data === null)) return permisos[0];

  const nombres = new Set<string>();
  for (const r of permisos) {
    const fila = r.data as { roles: { rol_permiso: Array<{ permisos: { name: string } }> } };
    for (const rp of fila.roles.rol_permiso) nombres.add(rp.permisos.name);
  }

  return {
    data: {
      rol_id: "rol-1",
      roles: { rol_permiso: [...nombres].map((name) => ({ permisos: { name } })) },
    },
    error:  null,
    __tipo: "permiso",
  };
}

/**
 * Encola, en orden, las respuestas que consumirá la cadena de middleware montada
 * delante del router.
 *
 * Los tests siguen pasando un resultado por guard —`tenantActiveResult`,
 * `moduleEnabledResult`, `permissionResult`— pero la cadena real hace menos
 * viajes que guards: el tenant y los permisos salen de UNA consulta consolidada
 * que corre primero, y `requireModule` conserva la suya después.
 */
export function mockDbSequence(
  mockGetDb: ReturnType<typeof vi.fn>,
  results: QueryResult[],
): ChainDb {
  const db = buildChain();

  const tenant   = results.find((r) => r.__tipo === "tenant");
  const permisos = results.filter((r) => r.__tipo === "permiso");
  const resto    = results.filter((r) => r.__tipo !== "tenant" && r.__tipo !== "permiso");

  const secuencia = (tenant || permisos.length > 0)
    ? [consolidar(tenant, unirPermisos(permisos)), ...resto]
    : resto;

  for (const r of secuencia) db.single.mockResolvedValueOnce(r);
  mockGetDb.mockReturnValue(db as never);
  return db;
}

/** Resultado para el guard requireActiveTenant (tenant activo). */
export function tenantActiveResult(activo = true): QueryResult {
  return { data: { activo }, error: null, __tipo: "tenant" };
}

/** Resultado para requireModule. */
export function moduleEnabledResult(enabled: boolean): QueryResult {
  return enabled
    ? { data: { habilitado: true }, error: null, __tipo: "modulo" }
    : { data: null, error: { message: "not found" }, __tipo: "modulo" };
}

/**
 * Resultado para requirePermission: `permissions: null` simula usuario
 * inexistente/inactivo; un array simula los permisos que trae el rol del
 * usuario vía `roles.rol_permiso[].permisos.name`.
 */
export function permissionResult(permissions: string[] | null): QueryResult {
  if (permissions === null) {
    return { data: null, error: { message: "not found" }, __tipo: "permiso" };
  }
  return {
    data: {
      rol_id: "rol-1",
      roles: { rol_permiso: permissions.map((name) => ({ permisos: { name } })) },
    },
    error:  null,
    __tipo: "permiso",
  };
}

/**
 * Encola respuestas TAL CUAL, sin consolidar.
 *
 * Para lo que consulta la base por fuera de la cadena de middleware y por lo
 * tanto conserva su propia forma de fila: hoy, `getUserPermissions`, que lo
 * llaman los Services (no ven el contexto de Hono y no pueden usar el snapshot).
 */
export function mockDbSequenceRaw(
  mockGetDb: ReturnType<typeof vi.fn>,
  results: QueryResult[],
): ChainDb {
  const db = buildChain();
  for (const r of results) db.single.mockResolvedValueOnce(r);
  mockGetDb.mockReturnValue(db as never);
  return db;
}
