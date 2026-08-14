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

interface QueryResult {
  data: unknown;
  error: unknown;
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
 * Encola, en orden, las respuestas de `single()` que consumirá la cadena de
 * middleware montada delante del router (requireActiveTenant, requireModule,
 * requirePermission consultan la DB en ese orden y cada uno llama `single()`
 * una vez). Usar junto con `tenantActiveResult`/`moduleEnabledResult`/`permissionResult`.
 */
export function mockDbSequence(
  mockGetDb: ReturnType<typeof vi.fn>,
  results: QueryResult[],
): ChainDb {
  const db = buildChain();
  for (const r of results) db.single.mockResolvedValueOnce(r);
  mockGetDb.mockReturnValue(db as never);
  return db;
}

/** Resultado de `single()` para el guard requireActiveTenant (tenant activo). */
export function tenantActiveResult(activo = true): QueryResult {
  return activo
    ? { data: { activo: true }, error: null }
    : { data: { activo: false }, error: null };
}

/** Resultado de `single()` para requireModule. */
export function moduleEnabledResult(enabled: boolean): QueryResult {
  return enabled
    ? { data: { habilitado: true }, error: null }
    : { data: null, error: { message: "not found" } };
}

/**
 * Resultado de `single()` para requirePermission: `permissions: null` simula
 * usuario inexistente/inactivo; un array simula los permisos que trae el rol
 * del usuario vía `roles.rol_permiso[].permisos.name`.
 */
export function permissionResult(permissions: string[] | null): QueryResult {
  if (permissions === null) return { data: null, error: { message: "not found" } };
  return {
    data: {
      rol_id: "rol-1",
      roles: { rol_permiso: permissions.map((name) => ({ permisos: { name } })) },
    },
    error: null,
  };
}
