import { vi } from "vitest";

/** JWT falso (sin firmar) para tests de middleware/controller. */
export function makeJwt(payload: object): string {
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "HS256" })}.${encode(payload)}.sig`;
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
