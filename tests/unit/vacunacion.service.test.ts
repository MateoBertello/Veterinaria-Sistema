import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ANTES de importar el módulo bajo prueba ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit }  from "../../supabase/functions/api/src/shared/audit.ts";
import { VacunacionService } from "../../supabase/functions/api/src/modules/vacunacion/vacunacion.service.ts";
import { ErrorCode }         from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID   = "11111111-1111-4111-8111-111111111111";
const PET_ID      = "22222222-2222-4222-8222-222222222222";
const DOSIS_ID    = "33333333-3333-4333-8333-333333333333";
const TIPO_VAC_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID     = "55555555-5555-4555-8555-555555555555";
const PROF_ID     = "66666666-6666-4666-8666-666666666666";
const EVENT_ID    = "77777777-7777-4777-8777-777777777777";

/**
 * RN-HOR8: antes del RPC, `marcarDosisAplicada` resuelve el perfil profesional
 * (`doctores` por `user_id`) para no dejar firmar a un doctor dado de baja.
 * Esta entrada es esa consulta con el perfil disponible.
 */
const perfilDoctorDisponible = { data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", available: true }, error: null };

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: USER_ID,
  callerName:   "Vet Leo",
  callerRole:   "vet",
};

/** Fecha YYYY-MM-DD desplazada N días respecto a hoy (UTC). */
function ymd(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const ESPECIE_ID  = "88888888-8888-4888-8888-888888888888";
const OTRO_TIPO_ID = "99999999-9999-4999-8999-999999999999";

/**
 * Fila de mascota tal como la devuelve `MASCOTA_CON_VACUNAS_APLICABLES`: la
 * especie embebida, y colgando de ella las vacunas asociadas a esa especie
 * (RN-PV11). Es la forma que consume `programarDosis`, así que los fixtures la
 * replican en vez de simplificarla — si el Service dejara de leer el embed, los
 * tests tienen que notarlo.
 */
function tipoAplicable(over: Record<string, unknown> = {}) {
  return { id: TIPO_VAC_ID, nombre: "Antirrábica", meses_refuerzo_sugerido: 12, active: true, ...over };
}

function mascotaRow(
  estado = "Activa",
  tipos: Array<Record<string, unknown>> = [tipoAplicable()],
) {
  return {
    id:         PET_ID,
    estado,
    especie_id: ESPECIE_ID,
    especie: {
      id:   ESPECIE_ID,
      name: "Perro",
      aplicables: tipos.map((t) => ({ tipo: t })),
    },
  };
}

const mascotaActiva    = mascotaRow("Activa");
const mascotaFallecida = mascotaRow("Fallecida");
const tipoVacunaRow    = { id: TIPO_VAC_ID, nombre: "Antirrábica" };

function dosisRow(over: Record<string, unknown> = {}) {
  return {
    id:                   DOSIS_ID,
    tenant_id:            TENANT_ID,
    pet_id:               PET_ID,
    tipo_vacuna_id:       TIPO_VAC_ID,
    evento_origen_id:     null,
    evento_aplicacion_id: null,
    fecha_estimada:       ymd(10),
    estado:               "Pendiente",
    notas:                null,
    notified_at:          null,
    created_by:           USER_ID,
    created_at:           "2026-07-01T10:00:00Z",
    tipo:                 { nombre: "Antirrábica" },
    ...over,
  };
}

// ─── Mock builder ─────────────────────────────────────────────────────────────

type MockOpts = {
  singleResults?: Array<{ data: unknown; error: unknown }>;
  rangeResult?:   { data: unknown[]; error: unknown; count: number };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];
  const next = () => singleQueue.shift() ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of [
    "select", "insert", "update", "delete",
    "eq", "neq", "not", "is", "order", "limit", "filter",
  ]) {
    builder[m] = vi.fn(chain);
  }
  builder["single"]      = vi.fn().mockImplementation(async () => next());
  builder["maybeSingle"] = vi.fn().mockImplementation(async () => next());
  builder["range"]       = vi.fn().mockResolvedValue(
    opts.rangeResult ?? { data: [], error: null, count: 0 },
  );

  // .rpc(name, params) devuelve el builder; .single() consume de la misma cola.
  const rpc = vi.fn(chain);
  return { from: vi.fn(() => builder), rpc, builder };
}

beforeEach(() => vi.clearAllMocks());

// ─── listarPlanVacunacion ─────────────────────────────────────────────────────

describe("VacunacionService.listarPlanVacunacion", () => {
  it("devuelve timeline vacío cuando no hay dosis", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [], error: null, count: 0 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("RN-PV1: Pendiente + fecha futura → estadoVisual=Proxima", async () => {
    const row = dosisRow({ estado: "Pendiente", fecha_estimada: ymd(5) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Proxima");
  });

  it("RN-PV1: Pendiente + fecha pasada → estadoVisual=Vencida", async () => {
    const row = dosisRow({ estado: "Pendiente", fecha_estimada: ymd(-3) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Vencida");
  });

  it("RN-PV1: Aplicada → estadoVisual=Aplicada", async () => {
    const row = dosisRow({ estado: "Aplicada", fecha_estimada: ymd(-10) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Aplicada");
  });

  it("RN-PV1: Cancelada → estadoVisual=Cancelada", async () => {
    const row = dosisRow({ estado: "Cancelada", fecha_estimada: ymd(5) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Cancelada");
  });

  it("mascota inexistente → MASCOTA_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });
});

// ─── programarDosis ───────────────────────────────────────────────────────────

describe("VacunacionService.programarDosis", () => {
  const dtoValido = {
    tipoVacunaId:  TIPO_VAC_ID,
    fechaEstimada: ymd(10),
  };

  it("mascota inexistente → MASCOTA_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("RN-PV4: mascota Fallecida → PET_DECEASED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaFallecida, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  it("RN-PV2: fechaEstimada < today → PAST_DATE (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, { ...dtoValido, fechaEstimada: ymd(-1) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
  });

  it("RN-PV3: tipoVacunaId inexistente → VACCINE_TYPE_NOT_FOUND (422)", async () => {
    // La mascota no tiene ninguna vacuna aplicable y el id pedido tampoco está
    // en `tipos_vacuna`: el rechazo es "no está en el catálogo", no "no aplica".
    const db = buildMockDb({
      singleResults: [
        { data: mascotaRow("Activa", []), error: null },
        { data: null, error: null },           // tipos_vacuna: no existe
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_TYPE_NOT_FOUND, statusCode: 422 });
  });

  it("RN-PV11: vacuna que existe pero no aplica a la especie → VACCINE_NOT_APPLICABLE_TO_SPECIES (422)", async () => {
    // El perro solo tiene asociada OTRA vacuna; la pedida existe y está activa
    // en el catálogo de la clínica, pero es de otra especie.
    const db = buildMockDb({
      singleResults: [
        { data: mascotaRow("Activa", [tipoAplicable({ id: OTRO_TIPO_ID, nombre: "Quíntuple Canina" })]), error: null },
        { data: { nombre: "Triple Felina" }, error: null },  // tipos_vacuna: sí existe
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({
      code:       ErrorCode.VACCINE_NOT_APPLICABLE_TO_SPECIES,
      statusCode: 422,
    });
  });

  it("RN-PV11: el mensaje nombra la vacuna y la especie, para que se sepa qué asociar", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaRow("Activa", []), error: null },
        { data: { nombre: "Triple Felina" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ message: expect.stringContaining("Triple Felina") });
  });

  it("RN-PV11: una vacuna asociada pero DADA DE BAJA no se puede programar", async () => {
    // `active: false` la saca de las aplicables (RN-CAT9: sigue visible donde ya
    // está referenciada, pero no se elige en altas nuevas). Como sí está en el
    // catálogo, el rechazo lo da la desambiguación con el filtro `active=true`,
    // que tampoco la encuentra → VACCINE_TYPE_NOT_FOUND.
    const db = buildMockDb({
      singleResults: [
        { data: mascotaRow("Activa", [tipoAplicable({ active: false })]), error: null },
        { data: null, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_TYPE_NOT_FOUND, statusCode: 422 });
  });

  it("RN-PV11: el happy path resuelve la aplicabilidad SIN una segunda consulta", async () => {
    // El costo de la regla nueva es cero viajes extra: la lista de aplicables ya
    // vino con la mascota. Si alguien volviera a leer `tipos_vacuna` acá, la
    // cola de mocks se desalinearía y el INSERT recibiría el resultado
    // equivocado — por eso se cuenta `from("tipos_vacuna")` explícitamente.
    const db = buildMockDb({
      singleResults: [
        { data: mascotaActiva, error: null },
        { data: dosisRow({ fecha_estimada: ymd(10) }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.programarDosis(PET_ID, dtoValido, ctx);

    const tablas = db.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(tablas).not.toContain("tipos_vacuna");
    expect(tablas).toContain("mascotas");
  });

  it("RN-PV9: éxito → recordAudit llamado con action=CREATE, module=medical_records", async () => {
    const inserted = dosisRow({ fecha_estimada: ymd(10) });
    // Dos pasos, no tres: la mascota y su catálogo aplicable vienen en la MISMA
    // consulta, así que después del INSERT no hay lectura de `tipos_vacuna`.
    const db = buildMockDb({
      singleResults: [
        { data: mascotaActiva, error: null },
        { data: inserted, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.programarDosis(PET_ID, dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "CREATE", module: "medical_records" }),
    );
  });

  it("éxito → dosis con estadoVisual=Proxima y tipoVacunaNombre mapeado", async () => {
    const inserted = dosisRow({ fecha_estimada: ymd(10), tipo: { nombre: "Antirrábica" } });
    const db = buildMockDb({
      singleResults: [
        { data: mascotaActiva, error: null },
        { data: inserted, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const dosis = await VacunacionService.programarDosis(PET_ID, dtoValido, ctx);

    expect(dosis.estadoVisual).toBe("Proxima");
    expect(dosis.tipoVacunaNombre).toBe("Antirrábica");
    expect(dosis.estado).toBe("Pendiente");
  });
});

// ─── tiposVacunaAplicables ────────────────────────────────────────────────────

describe("VacunacionService.tiposVacunaAplicables (RN-PV11)", () => {
  it("devuelve solo las vacunas asociadas a la especie de la mascota", async () => {
    const db = buildMockDb({
      singleResults: [{
        data: mascotaRow("Activa", [
          tipoAplicable({ id: TIPO_VAC_ID,  nombre: "Antirrábica" }),
          tipoAplicable({ id: OTRO_TIPO_ID, nombre: "Quíntuple Canina", meses_refuerzo_sugerido: null }),
        ]),
        error: null,
      }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const items = await VacunacionService.tiposVacunaAplicables(PET_ID, TENANT_ID);

    expect(items).toEqual([
      { id: TIPO_VAC_ID,  nombre: "Antirrábica",      mesesRefuerzoSugerido: 12 },
      { id: OTRO_TIPO_ID, nombre: "Quíntuple Canina", mesesRefuerzoSugerido: null },
    ]);
  });

  it("RN-CAT9: una vacuna dada de baja no se ofrece aunque esté asociada", async () => {
    const db = buildMockDb({
      singleResults: [{
        data: mascotaRow("Activa", [
          tipoAplicable({ id: TIPO_VAC_ID,  nombre: "Antirrábica" }),
          tipoAplicable({ id: OTRO_TIPO_ID, nombre: "Vieja", active: false }),
        ]),
        error: null,
      }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const items = await VacunacionService.tiposVacunaAplicables(PET_ID, TENANT_ID);
    expect(items.map((t) => t.id)).toEqual([TIPO_VAC_ID]);
  });

  it("ordena por nombre: el combo no baila entre recargas", async () => {
    const db = buildMockDb({
      singleResults: [{
        data: mascotaRow("Activa", [
          tipoAplicable({ id: OTRO_TIPO_ID, nombre: "Zoonosis" }),
          tipoAplicable({ id: TIPO_VAC_ID,  nombre: "Antirrábica" }),
        ]),
        error: null,
      }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const items = await VacunacionService.tiposVacunaAplicables(PET_ID, TENANT_ID);
    expect(items.map((t) => t.nombre)).toEqual(["Antirrábica", "Zoonosis"]);
  });

  it("una especie sin vacunas asociadas devuelve lista vacía, no error", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaRow("Activa", []), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(VacunacionService.tiposVacunaAplicables(PET_ID, TENANT_ID)).resolves.toEqual([]);
  });

  it("mascota de otro tenant (o inexistente) → MASCOTA_NOT_FOUND (404)", async () => {
    const db = buildMockDb({ singleResults: [{ data: null, error: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.tiposVacunaAplicables(PET_ID, TENANT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("resuelve todo en UNA consulta a mascotas", async () => {
    const db = buildMockDb({ singleResults: [{ data: mascotaActiva, error: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.tiposVacunaAplicables(PET_ID, TENANT_ID);

    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("mascotas");
  });

  it("RN-CAT1: filtra por el tenant del JWT, no por el de la mascota pedida", async () => {
    const db = buildMockDb({ singleResults: [{ data: mascotaActiva, error: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.tiposVacunaAplicables(PET_ID, TENANT_ID);

    // Corre con service role: sin este .eq() no habría aislamiento ninguno.
    expect(db.builder["eq"]).toHaveBeenCalledWith("tenant_id", TENANT_ID);
  });
});

// ─── editarDosis ──────────────────────────────────────────────────────────────

describe("VacunacionService.editarDosis", () => {
  const dtoValido = { fechaEstimada: ymd(15) };

  it("dosis inexistente → VACCINE_PLAN_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_NOT_FOUND, statusCode: 404 });
  });

  it("RN-PV5: estado=Aplicada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Aplicada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV5: estado=Cancelada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Cancelada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV2: nueva fechaEstimada < today → PAST_DATE (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, { fechaEstimada: ymd(-2) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
  });

  it("RN-PV9: éxito → recordAudit llamado con action=UPDATE, module=medical_records", async () => {
    const updated = dosisRow({ fecha_estimada: ymd(15) });
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: updated,   error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "UPDATE", module: "medical_records" }),
    );
  });

  it("éxito → dosis actualizada con estadoVisual derivado", async () => {
    const updated = dosisRow({ fecha_estimada: ymd(15) });
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: updated,   error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const dosis = await VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx);
    expect(dosis.estadoVisual).toBe("Proxima");
    expect(dosis.id).toBe(DOSIS_ID);
  });
});

// ─── cancelarDosis ────────────────────────────────────────────────────────────

describe("VacunacionService.cancelarDosis", () => {
  it("dosis inexistente → VACCINE_PLAN_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_NOT_FOUND, statusCode: 404 });
  });

  it("RN-PV5: estado=Aplicada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Aplicada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV5: estado=Cancelada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Cancelada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV9: éxito → recordAudit llamado con action=UPDATE, module=medical_records", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: { id: DOSIS_ID, estado: "Cancelada" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "UPDATE", module: "medical_records" }),
    );
  });

  it("éxito → { id, estado: 'Cancelada' }", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: { id: DOSIS_ID, estado: "Cancelada" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx);
    expect(result).toEqual({ id: DOSIS_ID, estado: "Cancelada" });
  });
});

// ─── marcarDosisAplicada ──────────────────────────────────────────────────────
// La transacción plan+evento ocurre dentro del RPC marcar_dosis_aplicada (atómica,
// como la eutanasia). El Service sólo orquesta: valida fecha, invoca el RPC, mapea
// sus errores y relee la dosis para devolver el DTO. Las guardas RN-PV5/PET_DECEASED
// y la atomicidad/rollback se prueban en integración (SQL real).

describe("VacunacionService.marcarDosisAplicada", () => {
  const dtoValido = { professionalId: PROF_ID };

  // Cola: [resultado RPC, relectura de la dosis]
  function buildAplicarOkDb() {
    const aplicada = dosisRow({
      estado:               "Aplicada",
      evento_aplicacion_id: EVENT_ID,
      fecha_estimada:       ymd(-1),
      tipo:                 { nombre: "Antirrábica" },
    });
    return buildMockDb({
      singleResults: [
        perfilDoctorDisponible,                                            // RN-HOR8
        { data: { event_id: EVENT_ID, dosis_id: DOSIS_ID }, error: null }, // RPC
        { data: aplicada, error: null },                                    // read-back
      ],
    });
  }

  it("RN-PV5: dosis no Pendiente (RPC) → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: null, error: { message: "VACCINE_PLAN_ALREADY_APPLIED" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("dosis inexistente (RPC) → VACCINE_PLAN_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: null, error: { message: "VACCINE_PLAN_NOT_FOUND" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_NOT_FOUND, statusCode: 404 });
  });

  it("mascota Fallecida (RPC) → PET_DECEASED (422)", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: null, error: { message: "PET_DECEASED" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  it("profesional ajeno al tenant (RPC) → FORBIDDEN (403)", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: null, error: { message: "FORBIDDEN" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
  });

  it("RN-HOR8: profesional dado de baja → DOCTOR_INACTIVE sin invocar el RPC", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", available: false }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.DOCTOR_INACTIVE, statusCode: 422 });

    // El RPC crea un evento clínico 'Vacunación' a nombre del profesional: si
    // está de baja, la transacción no se abre.
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("date futura → VALIDATION_ERROR (422) sin invocar el RPC", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.marcarDosisAplicada(DOSIS_ID, { ...dtoValido, date: ymd(1) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("éxito → invoca el RPC con tenant del JWT, dosis, ejecutor, profesional y fecha (default hoy)", async () => {
    const db = buildAplicarOkDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx);

    expect(db.rpc).toHaveBeenCalledWith(
      "marcar_dosis_aplicada",
      expect.objectContaining({
        p_tenant_id:       TENANT_ID,
        p_dosis_id:        DOSIS_ID,
        p_user_id:         USER_ID,
        p_professional_id: PROF_ID,
        p_date:            ymd(0),
      }),
    );
  });

  it("éxito → DosisPublica con estado=Aplicada, estadoVisual=Aplicada y evento enlazado", async () => {
    const db = buildAplicarOkDb();
    mockGetServiceDb.mockReturnValue(db as never);

    const dosis = await VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx);

    expect(dosis.estado).toBe("Aplicada");
    expect(dosis.estadoVisual).toBe("Aplicada");
    expect(dosis.eventoAplicacionId).toBe(EVENT_ID);
    expect(dosis.tipoVacunaNombre).toBe("Antirrábica");
  });

  it("auditoría atómica en el RPC → el Service NO llama recordAudit", async () => {
    const db = buildAplicarOkDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.marcarDosisAplicada(DOSIS_ID, dtoValido, ctx);

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
