import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ANTES de importar el módulo bajo prueba ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
  CALLER_UNRESOLVED: "unknown",
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit }  from "../../supabase/functions/api/src/shared/audit.ts";
import {
  EspeciesService,
  RazasService,
  TiposVacunaService,
} from "../../supabase/functions/api/src/modules/catalogos/catalogos.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID  = "11111111-1111-4111-8111-111111111111";
const ESPECIE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAZA_ID    = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TIPO_ID    = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTRO_ID    = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName:   "Admin Leo",
  callerRole:   "admin",
};

const filaEspecie = (over: Record<string, unknown> = {}) => ({
  id: ESPECIE_ID, tenant_id: TENANT_ID, name: "Perro",
  description: "Canino doméstico", active: true, ...over,
});

const filaRaza = (over: Record<string, unknown> = {}) => ({
  id: RAZA_ID, tenant_id: TENANT_ID, especie_id: ESPECIE_ID, name: "Mestizo",
  description: null, active: true, especie: { name: "Perro" }, ...over,
});

/**
 * Fila de tipo de vacuna tal como la devuelve `TIPO_VACUNA_COLS`: las especies
 * aplicables llegan embebidas a través de `especie_tipo_vacuna` (RN-CAT10), con
 * la forma anidada `{ especie: { id, name } }` que produce el embed real.
 */
const filaTipo = (over: Record<string, unknown> = {}) => ({
  id: TIPO_ID, tenant_id: TENANT_ID, nombre: "Antirrábica",
  meses_refuerzo_sugerido: 12, active: true,
  asociaciones: [{ especie: { id: ESPECIE_ID, name: "Perro" } }],
  ...over,
});

/** Forma del embed para armar fixtures con otras especies asociadas. */
const asociada = (id: string, name: string) => ({ especie: { id, name } });

/**
 * Mock de DB con colas por método terminal. El Service encadena varias consultas
 * por operación, así que cada cola se consume en el orden en que el Service las
 * dispara:
 *
 *   singleResults → `.single()` / `.maybeSingle()`  (cargar fila, chequear duplicado)
 *   limitResults  → `.limit(n)`                     (chequeo de uso: ¿hay alguna fila?)
 *   rangeResult   → `.range(from, to)`              (listado paginado)
 */
type MockOpts = {
  singleResults?: Array<{ data: unknown; error?: unknown }>;
  limitResults?:  Array<{ data: unknown[]; error?: unknown }>;
  rangeResult?:   { data: unknown[]; error: unknown; count: number };
  /**
   * Resultados de las consultas que se esperan SIN método terminal — las que se
   * hacen `await` sobre la cadena misma. Las estrenó RN-CAT10: resolver N
   * especies con `.in(...)` y sincronizar la tabla de asociación devuelven
   * conjuntos, no una fila, así que no pasan por `.single()` ni por `.limit()`.
   */
  awaitResults?:  Array<{ data: unknown; error?: unknown }>;
};

function buildMockDb(opts: MockOpts = {}) {
  const singles = [...(opts.singleResults ?? [])];
  const limits  = [...(opts.limitResults ?? [])];

  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const encadena = (nombre: string) => {
    builder[nombre] = vi.fn().mockReturnValue(builder);
  };

  for (const m of ["from", "select", "insert", "update", "eq", "neq", "ilike", "order", "is", "in"]) {
    encadena(m);
  }

  const proximoSingle = () =>
    Promise.resolve(singles.shift() ?? { data: null, error: null });

  builder["single"]      = vi.fn(proximoSingle);
  builder["maybeSingle"] = vi.fn(proximoSingle);
  builder["limit"]       = vi.fn(() =>
    Promise.resolve(limits.shift() ?? { data: [], error: null }),
  );
  builder["range"]       = vi.fn(() =>
    Promise.resolve(opts.rangeResult ?? { data: [], error: null, count: 0 }),
  );

  // `delete` existe en el mock a propósito: RN-CAT4 afirma que el Service NUNCA
  // lo llama sobre las tres tablas del catálogo, y para poder afirmarlo el espía
  // tiene que estar disponible. (Sí se usa sobre `especie_tipo_vacuna`, que es
  // la tabla de asociación: ahí borrar una fila es desasociar, no dar de baja un
  // ítem del catálogo — ver RN-CAT10.)
  builder["delete"] = vi.fn().mockReturnValue(builder);

  const db = { builder, ...builder } as unknown as Record<string, ReturnType<typeof vi.fn>> & {
    builder: Record<string, ReturnType<typeof vi.fn>>;
  };

  // La cadena se vuelve "awaitable" DESPUÉS de armar `db`, para que el `then` no
  // se copie al objeto de nivel superior con el spread: si `db` fuera thenable,
  // cualquier `await` sobre el cliente devolvería basura en vez del cliente.
  const awaits = [...(opts.awaitResults ?? [])];
  builder["then"] = vi.fn((resolve: (v: unknown) => unknown) =>
    Promise.resolve(awaits.shift() ?? { data: [], error: null }).then(resolve),
  );

  return db;
}

/** Pares (columna, valor) con los que se llamó `.eq(...)`. */
function eqArgs(db: { builder: Record<string, ReturnType<typeof vi.fn>> }): Array<[string, unknown]> {
  return db.builder["eq"]!.mock.calls as Array<[string, unknown]>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT1 — Alcance por tenant: todo se filtra por el tenant del JWT.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT1: alcance por tenant", () => {
  it("RN-CAT1: el listado de especies filtra por el tenant del JWT", async () => {
    const db = buildMockDb({ rangeResult: { data: [filaEspecie()], error: null, count: 1 } });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.buscarPaginado({ page: 1, limit: 20, search: undefined, active: undefined }, TENANT_ID);

    expect(eqArgs(db)).toContainEqual(["tenant_id", TENANT_ID]);
  });

  it("RN-CAT1: editar una especie que no es del tenant → CATALOG_NOT_FOUND", async () => {
    const db = buildMockDb({ singleResults: [{ data: null }] }); // no aparece en SU catálogo
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      EspeciesService.actualizar(OTRO_ID, { name: "Ajena" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_NOT_FOUND, statusCode: 404 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });

  it("RN-CAT1: cambiar el estado de un tipo de vacuna de otro tenant → CATALOG_NOT_FOUND", async () => {
    const db = buildMockDb({ singleResults: [{ data: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.cambiarEstado(OTRO_ID, false, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_NOT_FOUND, statusCode: 404 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT2 — Unicidad por tenant, case-insensitive.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT2: unicidad por tenant", () => {
  it("RN-CAT2: crear una especie con un nombre ya usado en el tenant → CATALOG_DUPLICATE", async () => {
    const db = buildMockDb({ singleResults: [{ data: { id: ESPECIE_ID } }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      EspeciesService.crear({ name: "Perro", description: null }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_DUPLICATE, statusCode: 409 });
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-CAT2: la colisión de nombre se busca con ilike (case-insensitive) y dentro del tenant", async () => {
    const db = buildMockDb({ singleResults: [{ data: { id: ESPECIE_ID } }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      EspeciesService.crear({ name: "PERRO", description: null }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_DUPLICATE });

    expect(db.builder["ilike"]).toHaveBeenCalledWith("name", "PERRO");
    expect(eqArgs(db)).toContainEqual(["tenant_id", TENANT_ID]);
  });

  it("RN-CAT2: crear una raza con (especie, nombre) repetido → CATALOG_DUPLICATE", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaEspecie() },       // la especie existe y es del tenant
        { data: { id: RAZA_ID } },     // ya hay una raza con ese nombre en esa especie
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      RazasService.crear({ especieId: ESPECIE_ID, name: "Mestizo", description: null }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_DUPLICATE, statusCode: 409 });
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-CAT2: el mismo nombre de raza en OTRA especie no colisiona", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaEspecie({ id: OTRO_ID }) }, // otra especie del mismo tenant
        { data: null },                          // sin colisión dentro de esa especie
        { data: filaRaza({ especie_id: OTRO_ID }) },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const raza = await RazasService.crear(
      { especieId: OTRO_ID, name: "Mestizo", description: null },
      ctx,
    );

    expect(raza.name).toBe("Mestizo");
    expect(db.builder["insert"]).toHaveBeenCalledOnce();
  });

  it("RN-CAT2: crear un tipo de vacuna con nombre repetido → CATALOG_DUPLICATE", async () => {
    const db = buildMockDb({ singleResults: [{ data: { id: TIPO_ID } }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.crear({ nombre: "Antirrábica", especieIds: [ESPECIE_ID], mesesRefuerzoSugerido: 12 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_DUPLICATE, statusCode: 409 });
  });

  it("RN-CAT2: editar sin tocar el nombre no dispara el chequeo de duplicado", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaEspecie() },                              // fila actual
        { data: filaEspecie({ description: "Otra cosa" }) },  // update
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.actualizar(ESPECIE_ID, { description: "Otra cosa" }, ctx);

    // Sin cambio de nombre no hay búsqueda por nombre: el `ilike` no se usa.
    expect(db.builder["ilike"]).not.toHaveBeenCalled();
  });

  it("RN-CAT2: renombrar a un nombre libre procede", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaEspecie() },                       // fila actual
        { data: null },                                // no hay colisión
        { data: filaEspecie({ name: "Perro grande" }) }, // update
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const esp = await EspeciesService.actualizar(ESPECIE_ID, { name: "Perro grande" }, ctx);
    expect(esp.name).toBe("Perro grande");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT3 — La especie de una raza es del mismo tenant.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT3: la especie de una raza es del mismo tenant", () => {
  it("RN-CAT3: crear una raza con una especie de otro tenant → VALIDATION_ERROR (no inserta)", async () => {
    const db = buildMockDb({ singleResults: [{ data: null }] }); // la especie no está en SU catálogo
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      RazasService.crear({ especieId: OTRO_ID, name: "Intrusa", description: null }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-CAT3: reasignar una raza a una especie de otro tenant → VALIDATION_ERROR (no actualiza)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaRaza() }, // la raza es del tenant
        { data: null },       // la especie destino NO
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      RazasService.actualizar(RAZA_ID, { especieId: OTRO_ID }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });

  it("RN-CAT3: la especie se resuelve filtrando por tenant_id, no solo por id", async () => {
    const db = buildMockDb({ singleResults: [{ data: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      // Ojo con el nombre: si no pasa el `min(2)` de Zod, el rechazo llega antes
      // de tocar la base y el test daría verde sin haber ejercido el filtro.
      RazasService.crear({ especieId: OTRO_ID, name: "Beagle", description: null }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    expect(eqArgs(db)).toContainEqual(["tenant_id", TENANT_ID]);
    expect(eqArgs(db)).toContainEqual(["id", OTRO_ID]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT4 — Baja lógica, nunca DELETE.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT4: baja lógica, nunca DELETE", () => {
  it("RN-CAT4: ninguno de los tres services expone una operación de borrado", () => {
    for (const service of [EspeciesService, RazasService, TiposVacunaService]) {
      const metodos = Object.keys(service);
      expect(metodos).not.toContain("eliminar");
      expect(metodos).not.toContain("borrar");
      expect(metodos).not.toContain("delete");
    }
  });

  it("RN-CAT4: dar de baja una especie hace UPDATE active=false, nunca DELETE", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaEspecie() },                     // fila actual
        { data: filaEspecie({ active: false }) },    // update
      ],
      limitResults: [{ data: [] }],                  // sin mascotas que la usen
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.cambiarEstado(ESPECIE_ID, false, ctx);

    expect(db.builder["delete"]).not.toHaveBeenCalled();
    expect(db.builder["update"]).toHaveBeenCalledWith({ active: false });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT5 — No se desactiva un ítem EN USO.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT5: no se desactiva un ítem en uso", () => {
  it("RN-CAT5: desactivar una especie usada por una mascota → CATALOG_IN_USE (no actualiza)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaEspecie() }],
      limitResults:  [{ data: [{ id: "mascota-1" }] }], // hay al menos una mascota
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      EspeciesService.cambiarEstado(ESPECIE_ID, false, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_IN_USE, statusCode: 409 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });

  it("RN-CAT5: desactivar una raza usada por una mascota → CATALOG_IN_USE", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaRaza() }],
      limitResults:  [{ data: [{ id: "mascota-1" }] }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      RazasService.cambiarEstado(RAZA_ID, false, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_IN_USE, statusCode: 409 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });

  it("RN-CAT5: desactivar un tipo de vacuna con dosis programadas → CATALOG_IN_USE", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaTipo() }],
      limitResults:  [{ data: [{ id: "dosis-1" }] }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.cambiarEstado(TIPO_ID, false, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_IN_USE, statusCode: 409 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });

  it("RN-CAT5: desactivar una especie sin uso procede", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaEspecie() }, { data: filaEspecie({ active: false }) }],
      limitResults:  [{ data: [] }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const esp = await EspeciesService.cambiarEstado(ESPECIE_ID, false, ctx);
    expect(esp.active).toBe(false);
  });

  it("RN-CAT5: el chequeo de uso filtra por tenant_id (una mascota de otra clínica no bloquea)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaEspecie() }, { data: filaEspecie({ active: false }) }],
      limitResults:  [{ data: [] }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.cambiarEstado(ESPECIE_ID, false, ctx);

    expect(db.builder["from"]).toHaveBeenCalledWith("mascotas");
    expect(eqArgs(db)).toContainEqual(["tenant_id", TENANT_ID]);
    expect(eqArgs(db)).toContainEqual(["especie_id", ESPECIE_ID]);
  });

  it("RN-CAT5: reactivar una especie NO consulta el uso (solo la baja está protegida)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaEspecie({ active: false }) },
        { data: filaEspecie({ active: true }) },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.cambiarEstado(ESPECIE_ID, true, ctx);

    expect(db.builder["from"]).not.toHaveBeenCalledWith("mascotas");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT6 — Desactivar una especie no toca sus razas.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT6: desactivar una especie no escribe sobre sus razas", () => {
  it("RN-CAT6: la baja de una especie no hace UPDATE ni DELETE sobre razas", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaEspecie() }, { data: filaEspecie({ active: false }) }],
      limitResults:  [{ data: [] }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.cambiarEstado(ESPECIE_ID, false, ctx);

    // Las razas quedan inseleccionables por la lectura (que exige especie
    // activa), no por una cascada de escritura: sus filas no se tocan. Es lo
    // que evita que reactivar la especie pierda las razas que tenía.
    expect(db.builder["from"]).not.toHaveBeenCalledWith("razas");
    expect(db.builder["delete"]).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT7 — Reactivar una raza exige que su especie esté activa.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT7: reactivar una raza exige especie activa", () => {
  it("RN-CAT7: reactivar una raza cuya especie está inactiva → CATALOG_IN_USE", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaRaza({ active: false }) },       // la raza
        { data: filaEspecie({ active: false }) },    // su especie, dada de baja
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      RazasService.cambiarEstado(RAZA_ID, true, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_IN_USE, statusCode: 409 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });

  it("RN-CAT7: reactivar una raza con la especie activa procede", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaRaza({ active: false }) },
        { data: filaEspecie({ active: true }) },
        { data: filaRaza({ active: true }) },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const raza = await RazasService.cambiarEstado(RAZA_ID, true, ctx);
    expect(raza.active).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT8 — Auditoría implícita en el módulo `catalogs`.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT8: auditoría implícita", () => {
  it("RN-CAT8: crear una especie audita CREATE en el módulo catalogs", async () => {
    const db = buildMockDb({ singleResults: [{ data: null }, { data: filaEspecie() }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.crear({ name: "Hurón", description: null }, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0]![1];
    expect(audit.action).toBe("CREATE");
    expect(audit.module).toBe("catalogs");
    expect(audit.tenantId).toBe(TENANT_ID);
    expect(audit.entityId).toBe(ESPECIE_ID);
  });

  it("RN-CAT8: editar un tipo de vacuna audita UPDATE con oldValues y newValues", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaTipo() },
        { data: null },
        { data: filaTipo({ meses_refuerzo_sugerido: 6 }) },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TiposVacunaService.actualizar(TIPO_ID, { nombre: "Antirrábica anual", mesesRefuerzoSugerido: 6 }, ctx);

    const audit = mockRecordAudit.mock.calls[0]![1];
    expect(audit.action).toBe("UPDATE");
    expect(audit.module).toBe("catalogs");
    expect(audit.oldValues).toBeDefined();
    expect(audit.newValues).toBeDefined();
  });

  it("RN-CAT8: la baja lógica de una raza queda auditada", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaRaza() }, { data: filaRaza({ active: false }) }],
      limitResults:  [{ data: [] }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await RazasService.cambiarEstado(RAZA_ID, false, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0]![1];
    expect(audit.module).toBe("catalogs");
    expect(audit.newValues).toMatchObject({ active: false });
  });

  it("RN-CAT8: una escritura rechazada no deja asiento de auditoría", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaEspecie() }],
      limitResults:  [{ data: [{ id: "mascota-1" }] }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(EspeciesService.cambiarEstado(ESPECIE_ID, false, ctx)).rejects.toThrow();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT9 — Un ítem inactivo sigue visible donde ya está referenciado.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT9: el listado de gestión muestra activos e inactivos", () => {
  it("RN-CAT9: sin filtro `active` el listado no restringe por estado", async () => {
    const db = buildMockDb({
      rangeResult: { data: [filaEspecie(), filaEspecie({ id: OTRO_ID, active: false })], error: null, count: 2 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await EspeciesService.buscarPaginado(
      { page: 1, limit: 20, search: undefined, active: undefined },
      TENANT_ID,
    );

    expect(items.map((i) => i.active)).toEqual([true, false]);
    expect(eqArgs(db)).not.toContainEqual(["active", true]);
    expect(eqArgs(db)).not.toContainEqual(["active", false]);
  });

  it("RN-CAT9: con `active=false` el listado filtra solo los dados de baja", async () => {
    const db = buildMockDb({ rangeResult: { data: [filaEspecie({ active: false })], error: null, count: 1 } });
    mockGetServiceDb.mockReturnValue(db as never);

    await EspeciesService.buscarPaginado(
      { page: 1, limit: 20, search: undefined, active: false },
      TENANT_ID,
    );

    expect(eqArgs(db)).toContainEqual(["active", false]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Rendimiento: el listado de razas trae la especie embebida (CLAUDE.md, N+1).
// ══════════════════════════════════════════════════════════════════════════════

describe("Listado de razas sin N+1", () => {
  it("resuelve el nombre de la especie con un embed, no con una consulta por fila", async () => {
    const db = buildMockDb({
      rangeResult: {
        data:  [filaRaza(), filaRaza({ id: OTRO_ID, name: "Caniche" })],
        error: null,
        count: 2,
      },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await RazasService.buscarPaginado(
      { page: 1, limit: 20, search: undefined, active: undefined, especieId: undefined },
      TENANT_ID,
    );

    expect(items).toHaveLength(2);
    expect(items[0]!.especieName).toBe("Perro");
    expect(items[1]!.especieName).toBe("Perro");

    // Una sola consulta: `from` se llamó una vez (razas) y el nombre de la
    // especie vino en el `select`, no en una segunda vuelta a la base.
    expect(db.builder["from"]).toHaveBeenCalledTimes(1);
    expect(db.builder["from"]).toHaveBeenCalledWith("razas");
    expect(db.builder["select"].mock.calls[0]![0]).toContain("especie:especies");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT10 — Un tipo de vacuna declara a qué especies aplica (N:M).
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT10: especies aplicables de un tipo de vacuna", () => {
  const OTRA_ESPECIE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  it("RN-CAT10: crear sin especies → VALIDATION_ERROR (no se crea una vacuna inutilizable)", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.crear({ nombre: "Antirrábica", especieIds: [], mesesRefuerzoSugerido: 12 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-CAT10: crear con una especie de OTRO tenant → VALIDATION_ERROR, y no inserta nada", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null }],       // nombre libre
      awaitResults:  [{ data: [] }],         // la especie pedida no es de este tenant
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.crear({ nombre: "Nueva", especieIds: [OTRO_ID], mesesRefuerzoSugerido: null }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });

    // La validación va ANTES del INSERT: no queda una vacuna huérfana.
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-CAT10: resuelve las N especies en UNA consulta, no una por id", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null }, { data: filaTipo() }],
      awaitResults:  [
        { data: [{ id: ESPECIE_ID, name: "Perro" }, { id: OTRA_ESPECIE, name: "Gato" }] },
        { data: [] },   // asociaciones actuales (ninguna: es un alta)
        { data: null },  // insert de las asociaciones
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TiposVacunaService.crear(
      { nombre: "Antirrábica", especieIds: [ESPECIE_ID, OTRA_ESPECIE], mesesRefuerzoSugerido: 12 },
      ctx,
    );

    // Un solo `.in("id", [...])` con las dos, en vez de dos `.eq("id", ...)`.
    expect(db.builder["in"]).toHaveBeenCalledWith("id", [ESPECIE_ID, OTRA_ESPECIE]);
  });

  it("RN-CAT10: el alta devuelve las especies asociadas, ordenadas por nombre", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null }, { data: filaTipo({ asociaciones: [] }) }],
      awaitResults:  [
        { data: [{ id: ESPECIE_ID, name: "Perro" }, { id: OTRA_ESPECIE, name: "Gato" }] },
        { data: [] },
        { data: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const tipo = await TiposVacunaService.crear(
      { nombre: "Antirrábica", especieIds: [ESPECIE_ID, OTRA_ESPECIE], mesesRefuerzoSugerido: 12 },
      ctx,
    );

    expect(tipo.especies.map((e) => e.name)).toEqual(["Gato", "Perro"]);
  });

  it("RN-CAT10: si falla el alta de asociaciones, la vacuna recién creada se deshace", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null }, { data: filaTipo() }],
      awaitResults:  [
        { data: [{ id: ESPECIE_ID, name: "Perro" }] },  // especies válidas
        { data: [] },                                    // asociaciones actuales
        { data: null, error: { message: "boom" } },      // INSERT de asociaciones falla
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.crear({ nombre: "Antirrábica", especieIds: [ESPECIE_ID], mesesRefuerzoSugerido: 12 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });

    // Compensación: sin esto quedaría una vacuna sin especies, es decir, una que
    // no se puede programar a ninguna mascota y que nadie sabe por qué.
    expect(db.builder["delete"]).toHaveBeenCalled();
  });

  it("RN-CAT10: reemplaza el conjunto — desasocia lo que ya no está y agrega lo nuevo", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaTipo() }],           // fila actual (asociada a Perro)
      awaitResults:  [
        { data: [{ id: OTRA_ESPECIE, name: "Gato" }] }, // especies pedidas: solo Gato
        { data: [{ especie_id: ESPECIE_ID }] },         // asociaciones actuales: Perro
        { data: null },                                 // DELETE de Perro
        { data: null },                                 // INSERT de Gato
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const tipo = await TiposVacunaService.asociarEspecies(TIPO_ID, { especieIds: [OTRA_ESPECIE] }, ctx);

    expect(db.builder["in"]).toHaveBeenCalledWith("especie_id", [ESPECIE_ID]);  // se desasocia Perro
    expect(db.builder["insert"]).toHaveBeenCalledWith([
      { tenant_id: TENANT_ID, tipo_vacuna_id: TIPO_ID, especie_id: OTRA_ESPECIE },
    ]);
    expect(tipo.especies).toEqual([{ id: OTRA_ESPECIE, name: "Gato" }]);
  });

  it("RN-CAT10: reasociar el MISMO conjunto no borra ni inserta nada", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaTipo() }],
      awaitResults:  [
        { data: [{ id: ESPECIE_ID, name: "Perro" }] },
        { data: [{ especie_id: ESPECIE_ID }] },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TiposVacunaService.asociarEspecies(TIPO_ID, { especieIds: [ESPECIE_ID] }, ctx);

    expect(db.builder["delete"]).not.toHaveBeenCalled();
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-CAT1: asociar sobre un tipo de vacuna de otro tenant → CATALOG_NOT_FOUND", async () => {
    const db = buildMockDb({ singleResults: [{ data: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.asociarEspecies(OTRO_ID, { especieIds: [ESPECIE_ID] }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CATALOG_NOT_FOUND, statusCode: 404 });
  });

  it("RN-CAT10: la escritura de asociaciones lleva SIEMPRE el tenant del JWT", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaTipo({ asociaciones: [] }) }],
      awaitResults:  [
        { data: [{ id: ESPECIE_ID, name: "Perro" }] },
        { data: [] },
        { data: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TiposVacunaService.asociarEspecies(TIPO_ID, { especieIds: [ESPECIE_ID] }, ctx);

    // Corre con service role: el tenant del payload es el único aislamiento.
    expect(db.builder["insert"]).toHaveBeenCalledWith([
      expect.objectContaining({ tenant_id: TENANT_ID }),
    ]);
  });

  it("RN-CAT8: reasociar queda auditado con las especies de antes y las de ahora", async () => {
    const db = buildMockDb({
      singleResults: [{ data: filaTipo() }],
      awaitResults:  [
        { data: [{ id: OTRA_ESPECIE, name: "Gato" }] },
        { data: [{ especie_id: ESPECIE_ID }] },
        { data: null },
        { data: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TiposVacunaService.asociarEspecies(TIPO_ID, { especieIds: [OTRA_ESPECIE] }, ctx);

    const audit = mockRecordAudit.mock.calls[0]![1];
    expect(audit.action).toBe("UPDATE");
    expect(audit.module).toBe("catalogs");
    expect(audit.oldValues).toMatchObject({ especie_ids: [ESPECIE_ID] });
    expect(audit.newValues).toMatchObject({ especie_ids: [OTRA_ESPECIE] });
  });

  it("RN-CAT10: editar solo el nombre NO toca las asociaciones", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: filaTipo() },                              // fila actual
        { data: null },                                    // nombre libre
        { data: filaTipo({ nombre: "Antirrábica anual" }) }, // update
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const tipo = await TiposVacunaService.actualizar(TIPO_ID, { nombre: "Antirrábica anual" }, ctx);

    // Omitir `especieIds` significa "no las toques", no "borralas todas".
    expect(db.builder["delete"]).not.toHaveBeenCalled();
    expect(db.builder["insert"]).not.toHaveBeenCalled();
    expect(tipo.especies).toEqual([{ id: ESPECIE_ID, name: "Perro" }]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RN-CAT11 — Cambiar las especies no toca las dosis ya registradas.
// ══════════════════════════════════════════════════════════════════════════════

describe("RN-CAT11: reasociar no invalida el historial clínico", () => {
  it("RN-CAT11: desasociar una especie NO consulta plan_vacunacion ni bloquea", async () => {
    // A diferencia de RN-CAT5 (dar de baja algo en uso), acá no hay nada que
    // bloquear: la aplicabilidad se valida al PROGRAMAR (RN-PV11), y una dosis ya
    // aplicada es historia clínica que no se recalcula.
    const db = buildMockDb({
      singleResults: [{ data: filaTipo() }],
      awaitResults:  [
        { data: [{ id: ESPECIE_ID, name: "Perro" }] },
        { data: [{ especie_id: ESPECIE_ID }, { especie_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }] },
        { data: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TiposVacunaService.asociarEspecies(TIPO_ID, { especieIds: [ESPECIE_ID] }, ctx),
    ).resolves.toBeDefined();

    const tablas = db.builder["from"]!.mock.calls.map((c: unknown[]) => c[0]);
    expect(tablas).not.toContain("plan_vacunacion");
  });
});
