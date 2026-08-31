import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

// RN-EC13: crearRegistro delega en VacunacionService.programarDosis para
// validar/crear la próxima dosis; se mockea entero (no se re-testean acá las
// guardas RN-PV2/PV3/PV4/PV11, ya cubiertas en vacunacion.service.test.ts).
vi.mock("../../supabase/functions/api/src/modules/vacunacion/vacunacion.service.ts", () => ({
  VacunacionService: { programarDosis: vi.fn() },
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { HistorialService } from "../../supabase/functions/api/src/modules/historial/historial.service.ts";
import { VacunacionService } from "../../supabase/functions/api/src/modules/vacunacion/vacunacion.service.ts";
import { DomainError, ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb   = vi.mocked(getServiceDb);
const mockRecordAudit    = vi.mocked(recordAudit);
const mockProgramarDosis = vi.mocked(VacunacionService.programarDosis);

const TENANT_ID  = "11111111-1111-4111-8111-111111111111";
const PET_ID     = "22222222-2222-4222-8222-222222222222";
const EVENT_ID   = "33333333-3333-4333-8333-333333333333";
const CLIENT_A   = "44444444-4444-4444-8444-444444444444";
const CLIENT_B   = "55555555-5555-4555-8555-555555555555";
const PROF_ID    = "66666666-6666-4666-8666-666666666666";
const TIPO_VACUNA_ID = "77777777-7777-4777-8777-777777777777";

/**
 * RN-HOR8: antes de firmar un registro nuevo, el Service resuelve el perfil
 * profesional (`doctores` por `user_id`) para comprobar que no está dado de
 * baja. Esta entrada es esa consulta con el perfil disponible — el camino feliz
 * de todos los tests que llegan a escribir.
 */
const perfilDoctorDisponible = { data: { id: "88888888-8888-4888-8888-888888888888", available: true }, error: null };

// ─── Mock builder ─────────────────────────────────────────────────────────────

type MockOpts = {
  singleResults?:    Array<{ data: unknown; error: unknown }>;
  rangeResult?:      { data: unknown[]; error: unknown; count: number };
  uploadResult?:     { data: unknown; error: unknown };
  signedUrlResult?:  { data: unknown; error: unknown };
  // Resultado de una query awaited directamente (sin .single()/.maybeSingle()/
  // .range()), p. ej. `await db.from(...).select(...).eq(...)`. La query es
  // "thenable"; el runtime resuelve vía builder.then.
  listResult?:       { data: unknown[]; error: unknown };
  signedUrlsResult?: { data: unknown; error: unknown };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];
  const next = () => singleQueue.shift() ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of [
    "select", "insert", "update", "delete",
    "eq", "neq", "or", "ilike", "not", "is", "filter",
    "order", "limit",
  ]) {
    builder[m] = vi.fn(chain);
  }
  builder["single"]      = vi.fn().mockImplementation(async () => next());
  builder["maybeSingle"] = vi.fn().mockImplementation(async () => next());
  builder["range"]       = vi.fn().mockResolvedValue(
    opts.rangeResult ?? { data: [], error: null, count: 0 },
  );
  builder["then"] = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(opts.listResult ?? { data: [], error: null }).then(resolve, reject);

  // Supabase Storage stub
  const storageUpload        = vi.fn().mockResolvedValue(opts.uploadResult ?? { data: { path: "x" }, error: null });
  const storageCreateSigned  = vi.fn().mockResolvedValue(
    opts.signedUrlResult ?? { data: { signedUrl: "https://signed.example/x" }, error: null },
  );
  const storageCreateSignedUrls = vi.fn().mockResolvedValue(
    opts.signedUrlsResult ?? { data: [], error: null },
  );
  const storageRemove        = vi.fn().mockResolvedValue({ data: [], error: null });
  const storageFrom          = vi.fn(() => ({
    upload:            storageUpload,
    createSignedUrl:   storageCreateSigned,
    createSignedUrls:  storageCreateSignedUrls,
    remove:            storageRemove,
  }));

  const db = {
    from: vi.fn(() => builder),
    rpc:  vi.fn(() => builder),
    storage: { from: storageFrom },
    builder,
    storageUpload,
    storageCreateSigned,
    storageCreateSignedUrls,
    storageRemove,
    storageFrom,
  };
  return db;
}

beforeEach(() => vi.clearAllMocks());

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mascotaExistente = { id: PET_ID };

const mascotaResumen = {
  id: PET_ID,
  name: "Firulais",
  estado: "Activa",
  cliente:  { full_name: "Juan Pérez" },
  especie:  { name: "Perro" },
  raza:     { name: "Labrador" },
};

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    date: "2026-06-01",
    event_type: "Consulta",
    weight_kg: 4.5,
    temperature_c: 38.2,
    diagnosis: "Control sin hallazgos",
    description: "Revisión anual",
    client_name_at_time: "Juan Pérez",
    client_id_at_time: CLIENT_A,
    mascota:    { client_id: CLIENT_A },
    profesional: { full_name: "Dra. García" },
    adjuntos:   [{ count: 0 }],
    ...over,
  };
}

function eventDetailRow(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    pet_id: PET_ID,
    date: "2026-06-01",
    event_type: "Consulta",
    weight_kg: 4.5,
    temperature_c: 38.2,
    description: "Revisión anual",
    diagnosis: "Control sin hallazgos",
    treatment: null,
    medication: null,
    notes: null,
    client_name_at_time: "Juan Pérez",
    created_at: "2026-06-01T10:00:00Z",
    profesional: { full_name: "Dra. García" },
    adjuntos: [],
    ...over,
  };
}

// ─── listarHistorial ──────────────────────────────────────────────────────────

describe("listarHistorial", () => {
  it("RN-HC1: listarHistorial devuelve eventos en orden descendente", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaExistente, error: null }],
      rangeResult: { data: [eventRow()], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await HistorialService.listarHistorial(PET_ID, TENANT_ID, { page: 1, limit: 20 });

    expect(db.builder["order"]).toHaveBeenCalledWith("date", { ascending: false });
  });

  it("RN-HC3: clientNameAtTime marca isPreviousOwner si dueño actual difiere", async () => {
    const row = eventRow({ client_id_at_time: CLIENT_A, mascota: { client_id: CLIENT_B } });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaExistente, error: null }],
      rangeResult: { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await HistorialService.listarHistorial(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].isPreviousOwner).toBe(true);
    expect(items[0].clientNameAtTime).toBe("Juan Pérez");
  });

  it("RN-HC3: isPreviousOwner es false cuando dueño es el mismo", async () => {
    const row = eventRow({ client_id_at_time: CLIENT_A, mascota: { client_id: CLIENT_A } });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaExistente, error: null }],
      rangeResult: { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await HistorialService.listarHistorial(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].isPreviousOwner).toBe(false);
  });

  it("RN-HC4: mascota no encontrada en el tenant lanza MASCOTA_NOT_FOUND", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.listarHistorial(PET_ID, TENANT_ID, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("RN-HC5: paginacion calcula range correcto para page=2 limit=10", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaExistente, error: null }],
      rangeResult: { data: [], error: null, count: 0 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await HistorialService.listarHistorial(PET_ID, TENANT_ID, { page: 2, limit: 10 });

    expect(db.builder["range"]).toHaveBeenCalledWith(10, 19);
  });

  it("listarHistorial: hasAttachments es true cuando adjuntos count > 0", async () => {
    const row = eventRow({ adjuntos: [{ count: 3 }] });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaExistente, error: null }],
      rangeResult: { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await HistorialService.listarHistorial(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].hasAttachments).toBe(true);
  });

  it("listarHistorial: hasAttachments es false cuando adjuntos count es 0", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaExistente, error: null }],
      rangeResult: { data: [eventRow()], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await HistorialService.listarHistorial(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].hasAttachments).toBe(false);
  });
});

// ─── obtenerEventoPorId ───────────────────────────────────────────────────────

describe("obtenerEventoPorId", () => {
  it("obtenerEventoPorId: evento no encontrado lanza HISTORIAL_NOT_FOUND", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.obtenerEventoPorId(EVENT_ID, TENANT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.HISTORIAL_NOT_FOUND, statusCode: 404 });
  });

  it("obtenerEventoPorId: devuelve detalle mapeado correctamente", async () => {
    const db = buildMockDb({
      singleResults: [{ data: eventDetailRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const detalle = await HistorialService.obtenerEventoPorId(EVENT_ID, TENANT_ID);
    expect(detalle.id).toBe(EVENT_ID);
    expect(detalle.petId).toBe(PET_ID);
    expect(detalle.professionalName).toBe("Dra. García");
    expect(detalle.adjuntos).toEqual([]);
  });
});

// ─── resumenClinico ───────────────────────────────────────────────────────────

describe("resumenClinico", () => {
  it("RN-HC2/RN-EC2: resumenClinico deriva ultimo peso del evento mas reciente con peso", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaResumen, error: null },
        { data: { weight_kg: 4.5 }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const resumen = await HistorialService.resumenClinico(PET_ID, TENANT_ID);
    expect(resumen.ultimoPeso).toBe(4.5);
  });

  it("RN-HC2: ultimoPeso es null cuando no hay eventos con peso registrado", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaResumen, error: null },
        { data: null, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const resumen = await HistorialService.resumenClinico(PET_ID, TENANT_ID);
    expect(resumen.ultimoPeso).toBeNull();
  });

  it("resumenClinico: mascota no encontrada lanza MASCOTA_NOT_FOUND", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.resumenClinico(PET_ID, TENANT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("resumenClinico: devuelve datos de mascota mapeados correctamente", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaResumen, error: null },
        { data: { weight_kg: 30.1 }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const resumen = await HistorialService.resumenClinico(PET_ID, TENANT_ID);
    expect(resumen.name).toBe("Firulais");
    expect(resumen.estado).toBe("Activa");
    expect(resumen.ownerName).toBe("Juan Pérez");
    expect(resumen.especieName).toBe("Perro");
    expect(resumen.razaName).toBe("Labrador");
    expect(resumen.ultimoPeso).toBe(30.1);
  });
});

// ─── crearRegistro ──────────────────────────────────────────────────────────────

const CTX = {
  tenantId:     TENANT_ID,
  callerUserId: PROF_ID,
  callerName:   "Dra. García",
  callerRole:   "veterinario",
};

function dtoBase(over: Record<string, unknown> = {}) {
  return {
    date:           "2026-06-04",
    eventType:      "Consulta",
    professionalId: PROF_ID,
    description:    "Control anual, buen estado general",
    ...over,
  };
}

const mascotaViva = {
  id:        PET_ID,
  name:      "Firulais",
  estado:    "Activa",
  client_id: CLIENT_A,
  cliente:   { full_name: "Juan Pérez", email: "juan@example.com" },
};

describe("crearRegistro", () => {
  it("RN-EC1: falta un campo obligatorio (description) → VALIDATION_ERROR", async () => {
    mockGetServiceDb.mockReturnValue(buildMockDb() as never);
    await expect(
      HistorialService.crearRegistro(PET_ID, dtoBase({ description: "" }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-EC3: mascota fallecida → PET_DECEASED", async () => {
    const db = buildMockDb({
      singleResults: [{ data: { ...mascotaViva, estado: "Fallecida" }, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.crearRegistro(PET_ID, dtoBase() as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  it("crearRegistro: mascota inexistente en el tenant → MASCOTA_NOT_FOUND", async () => {
    const db = buildMockDb({ singleResults: [{ data: null, error: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.crearRegistro(PET_ID, dtoBase() as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("DT-2: professionalId que no es usuario del tenant → FORBIDDEN (403)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: null, error: null },   // usuarios: el profesional no existe en este tenant
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.crearRegistro(PET_ID, dtoBase() as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });

    // La validación corta ANTES del insert: nada se persiste.
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-HOR8: profesional con perfil de doctor dado de baja → DOCTOR_INACTIVE (no persiste)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },                    // usuario del tenant, OK
        { data: { id: "88888888-8888-4888-8888-888888888888", available: false }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.crearRegistro(PET_ID, dtoBase() as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.DOCTOR_INACTIVE, statusCode: 422 });

    // Corta antes del insert: el historial ya firmado por ese profesional no se
    // toca, pero tampoco se le agregan registros nuevos.
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-HOR8: un usuario del tenant sin perfil de doctor sigue pudiendo firmar (alcance acotado)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        { data: null, error: null },                               // sin fila en `doctores`
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Consulta" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const evento = await HistorialService.crearRegistro(PET_ID, dtoBase() as never, CTX);
    expect(evento.id).toBe(EVENT_ID);
  });

  it("RN-EC5: persiste clientIdAtTime/clientNameAtTime del dueño vigente", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Consulta" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const evento = await HistorialService.crearRegistro(PET_ID, dtoBase() as never, CTX);

    expect(db.builder["insert"]).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id_at_time:   CLIENT_A,
        client_name_at_time: "Juan Pérez",
        tenant_id:           TENANT_ID,
        pet_id:              PET_ID,
      }),
    );
    expect(evento.clientNameAtTime).toBe("Juan Pérez");
    expect(evento.attachmentsCount).toBe(0);
  });

  it("RN-EC8/RN-UX4: crearRegistro registra auditoría CREATE en módulo medical_records", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Consulta" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await HistorialService.crearRegistro(PET_ID, dtoBase() as never, CTX);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.action).toBe("CREATE");
    expect(auditArg.module).toBe("medical_records");
    expect(auditArg.entityId).toBe(EVENT_ID);
  });

  it("RN-EC6: peso fuera de rango (>200) → VALIDATION_ERROR", async () => {
    mockGetServiceDb.mockReturnValue(buildMockDb() as never);
    await expect(
      HistorialService.crearRegistro(PET_ID, dtoBase({ weightKg: 300 }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("Eutanasia diferida: eventType='Eutanasia' → VALIDATION_ERROR (fuera de alcance)", async () => {
    mockGetServiceDb.mockReturnValue(buildMockDb() as never);
    await expect(
      HistorialService.crearRegistro(PET_ID, dtoBase({ eventType: "Eutanasia" }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-EC9: emailSent true si se solicita, hay email y el canal entrega OK", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Consulta" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canalEmail = { enviar: vi.fn().mockResolvedValue(undefined) };

    const evento = await HistorialService.crearRegistro(
      PET_ID, dtoBase({ sendEmailToClient: true }) as never, CTX, { canalEmail } as never,
    );

    expect(canalEmail.enviar).toHaveBeenCalledTimes(1);
    expect(canalEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ destino: "juan@example.com" }),
    );
    expect(evento.emailSent).toBe(true);
  });

  it("RN-EC9: emailSent false si se solicita pero el cliente no tiene email (no se envía)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { ...mascotaViva, cliente: { full_name: "Juan Pérez", email: null } }, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Consulta" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canalEmail = { enviar: vi.fn().mockResolvedValue(undefined) };

    const evento = await HistorialService.crearRegistro(
      PET_ID, dtoBase({ sendEmailToClient: true }) as never, CTX, { canalEmail } as never,
    );

    expect(canalEmail.enviar).not.toHaveBeenCalled();
    expect(evento.emailSent).toBe(false);
  });

  it("RN-EC9: best-effort — si el canal falla, el evento se registra igual y emailSent=false", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Consulta" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canalEmail = { enviar: vi.fn().mockRejectedValue(new Error("Resend 503")) };

    const evento = await HistorialService.crearRegistro(
      PET_ID, dtoBase({ sendEmailToClient: true }) as never, CTX, { canalEmail } as never,
    );

    expect(canalEmail.enviar).toHaveBeenCalledTimes(1);
    expect(evento.id).toBe(EVENT_ID);   // el evento clínico quedó registrado
    expect(evento.emailSent).toBe(false);
  });

  it("RN-EC9: sin sendEmailToClient no se intenta envío", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Consulta" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canalEmail = { enviar: vi.fn().mockResolvedValue(undefined) };

    const evento = await HistorialService.crearRegistro(
      PET_ID, dtoBase({ sendEmailToClient: false }) as never, CTX, { canalEmail } as never,
    );

    expect(canalEmail.enviar).not.toHaveBeenCalled();
    expect(evento.emailSent).toBe(false);
  });
});

// ─── crearRegistro — RN-EC13 (proximaDosis: el puente al catálogo de vacunas) ──
// Antes de este puente, `eventType: 'Vacunación'` con solo `description` de
// texto libre era un segundo camino para asentar "se vacunó" que NUNCA pasaba
// por RN-PV3/RN-PV11 (catálogo / especie aplicable). Sigue siendo válido
// registrar así una Vacunación sin dosis asociada (ver docs/Addendum v1.1 y
// docs/PLAN_ETAPAS.md: 'proximaDosis' es explícitamente OPCIONAL) — lo que
// cambia es que, si el usuario SÍ pide programar la próxima dosis, esa dosis
// pasa por las mismas guardas que el resto del Plan de Vacunación.

describe("crearRegistro — RN-EC13 (proximaDosis)", () => {
  it("RN-EC13: proximaDosis con eventType distinto de 'Vacunación' → VALIDATION_ERROR", async () => {
    mockGetServiceDb.mockReturnValue(buildMockDb() as never);

    await expect(
      HistorialService.crearRegistro(
        PET_ID,
        dtoBase({
          eventType:    "Consulta",
          proximaDosis: { tipoVacunaId: TIPO_VACUNA_ID, fechaEstimada: "2026-08-01" },
        }) as never,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });

    expect(mockProgramarDosis).not.toHaveBeenCalled();
  });

  it("RN-EC13: 'Vacunación' SIN proximaDosis sigue siendo un registro libre válido (no se toca el catálogo)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Vacunación" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const evento = await HistorialService.crearRegistro(
      PET_ID, dtoBase({ eventType: "Vacunación" }) as never, CTX,
    );

    expect(mockProgramarDosis).not.toHaveBeenCalled();
    expect(evento.planVacunacionId).toBeNull();
  });

  it("RN-EC13: proximaDosis que no aplica a la especie → VACCINE_NOT_APPLICABLE_TO_SPECIES, y NO se crea el evento", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    mockProgramarDosis.mockRejectedValue(
      new DomainError(ErrorCode.VACCINE_NOT_APPLICABLE_TO_SPECIES, 422, "La vacuna no aplica a la especie de la mascota"),
    );

    await expect(
      HistorialService.crearRegistro(
        PET_ID,
        dtoBase({
          eventType:    "Vacunación",
          proximaDosis: { tipoVacunaId: TIPO_VACUNA_ID, fechaEstimada: "2026-08-01" },
        }) as never,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_NOT_APPLICABLE_TO_SPECIES, statusCode: 422 });

    // La validación corta ANTES del insert del evento clínico: nada se persiste.
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-EC13: proximaDosis válida programa la dosis (RN-PV2/PV3/PV11 vía VacunacionService) y enlaza evento_origen_id", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaViva, error: null },
        { data: { id: PROF_ID }, error: null },
        perfilDoctorDisponible,
        { data: { id: EVENT_ID, date: "2026-06-04", event_type: "Vacunación" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    mockProgramarDosis.mockResolvedValue({
      id:                 "dosis-1",
      petId:              PET_ID,
      tipoVacunaId:       TIPO_VACUNA_ID,
      tipoVacunaNombre:   "Antirrábica",
      eventoOrigenId:     null,
      eventoAplicacionId: null,
      fechaEstimada:      "2026-08-01",
      estado:             "Pendiente",
      estadoVisual:       "Proxima",
      notas:              null,
      createdAt:          "2026-06-04T00:00:00.000Z",
    } as never);

    const evento = await HistorialService.crearRegistro(
      PET_ID,
      dtoBase({
        eventType:    "Vacunación",
        proximaDosis: { tipoVacunaId: TIPO_VACUNA_ID, fechaEstimada: "2026-08-01" },
      }) as never,
      CTX,
    );

    // Se valida/crea la dosis ANTES de tener el id del evento (todavía no hay
    // eventoOrigenId disponible en ese momento).
    expect(mockProgramarDosis).toHaveBeenCalledWith(
      PET_ID,
      { tipoVacunaId: TIPO_VACUNA_ID, fechaEstimada: "2026-08-01" },
      CTX,
    );
    // Y el evento recién creado se enlaza a la dosis con un UPDATE puntual.
    expect(db.builder["update"]).toHaveBeenCalledWith({ evento_origen_id: EVENT_ID });
    expect(evento.planVacunacionId).toBe("dosis-1");
  });
});

// ─── adjuntarArchivo ──────────────────────────────────────────────────────────

describe("adjuntarArchivo", () => {
  it("RN-EC4: tipo de archivo no permitido → INVALID_FILE_TYPE", async () => {
    mockGetServiceDb.mockReturnValue(buildMockDb() as never);
    const file = new File(["hola"], "nota.txt", { type: "text/plain" });

    await expect(
      HistorialService.adjuntarArchivo(EVENT_ID, file, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_FILE_TYPE, statusCode: 422 });
  });

  it("RN-EC4: archivo > 10 MB → FILE_TOO_LARGE", async () => {
    mockGetServiceDb.mockReturnValue(buildMockDb() as never);
    const tooBig = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });

    await expect(
      HistorialService.adjuntarArchivo(EVENT_ID, tooBig, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_TOO_LARGE, statusCode: 422 });
  });

  it("adjuntarArchivo: registro de otro tenant → HISTORIAL_NOT_FOUND", async () => {
    const db = buildMockDb({ singleResults: [{ data: null, error: null }] });
    mockGetServiceDb.mockReturnValue(db as never);
    const file = new File(["x"], "rx.pdf", { type: "application/pdf" });

    await expect(
      HistorialService.adjuntarArchivo(EVENT_ID, file, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.HISTORIAL_NOT_FOUND, statusCode: 404 });
  });

  it("adjuntarArchivo: sube con path por tenant y devuelve metadata", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: EVENT_ID }, error: null },
        { data: { id: "adj-1", file_name: "rx.pdf", file_type: "application/pdf", file_size: 4 }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const file = new File(["data"], "rx.pdf", { type: "application/pdf" });

    const meta = await HistorialService.adjuntarArchivo(EVENT_ID, file, CTX);

    expect(db.storageFrom).toHaveBeenCalledWith("adjuntos-clinicos");
    const uploadedPath = db.storageUpload.mock.calls[0][0] as string;
    expect(uploadedPath.startsWith(`${TENANT_ID}/${EVENT_ID}/`)).toBe(true);
    expect(uploadedPath.endsWith(".pdf")).toBe(true);
    expect(meta).toEqual({ id: "adj-1", fileName: "rx.pdf", fileType: "application/pdf", fileSize: 4 });
  });
});

// ─── generarSignedUrlAdjunto ──────────────────────────────────────────────────

describe("generarSignedUrlAdjunto", () => {
  it("generarSignedUrlAdjunto: adjunto de otro tenant → HISTORIAL_NOT_FOUND", async () => {
    const db = buildMockDb({ singleResults: [{ data: null, error: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.generarSignedUrlAdjunto("adj-1", CTX),
    ).rejects.toMatchObject({ code: ErrorCode.HISTORIAL_NOT_FOUND, statusCode: 404 });
  });

  it("generarSignedUrlAdjunto: devuelve la signed URL del bucket privado", async () => {
    const db = buildMockDb({
      singleResults: [{
        data: { storage_path: `${TENANT_ID}/${EVENT_ID}/abc.pdf`, file_name: "rx.pdf", file_type: "application/pdf", file_size: 4 },
        error: null,
      }],
      signedUrlResult: { data: { signedUrl: "https://signed.example/abc.pdf" }, error: null },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const firmado = await HistorialService.generarSignedUrlAdjunto("adj-1", CTX);

    expect(db.storageFrom).toHaveBeenCalledWith("adjuntos-clinicos");
    expect(firmado.url).toBe("https://signed.example/abc.pdf");
    expect(firmado.fileName).toBe("rx.pdf");
  });
});

// ─── generarSignedUrlsAdjuntosEvento (vista previa inline, un lote por evento) ──

describe("generarSignedUrlsAdjuntosEvento", () => {
  it("evento sin adjuntos → arreglo vacío, sin llamar a Storage", async () => {
    const db = buildMockDb({ listResult: { data: [], error: null } });
    mockGetServiceDb.mockReturnValue(db as never);

    const firmados = await HistorialService.generarSignedUrlsAdjuntosEvento(EVENT_ID, CTX);

    expect(firmados).toEqual([]);
    expect(db.storageCreateSignedUrls).not.toHaveBeenCalled();
  });

  it("un evento con 2 adjuntos firma las 2 rutas en UNA sola llamada por lote a Storage", async () => {
    const db = buildMockDb({
      listResult: {
        data: [
          { id: "adj-1", storage_path: `${TENANT_ID}/${EVENT_ID}/a.jpg`, file_name: "a.jpg", file_type: "image/jpeg", file_size: 10 },
          { id: "adj-2", storage_path: `${TENANT_ID}/${EVENT_ID}/b.png`, file_name: "b.png", file_type: "image/png", file_size: 20 },
        ],
        error: null,
      },
      signedUrlsResult: {
        data: [
          { path: `${TENANT_ID}/${EVENT_ID}/a.jpg`, signedUrl: "https://signed.example/a.jpg", error: null },
          { path: `${TENANT_ID}/${EVENT_ID}/b.png`, signedUrl: "https://signed.example/b.png", error: null },
        ],
        error: null,
      },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const firmados = await HistorialService.generarSignedUrlsAdjuntosEvento(EVENT_ID, CTX);

    expect(db.storageCreateSignedUrls).toHaveBeenCalledTimes(1);
    expect(firmados).toEqual([
      { id: "adj-1", url: "https://signed.example/a.jpg", fileName: "a.jpg", fileType: "image/jpeg", fileSize: 10 },
      { id: "adj-2", url: "https://signed.example/b.png", fileName: "b.png", fileType: "image/png", fileSize: 20 },
    ]);
  });

  it("si un adjunto puntual falla al firmar, se omite del lote sin romper los demás (best-effort)", async () => {
    const db = buildMockDb({
      listResult: {
        data: [
          { id: "adj-1", storage_path: `${TENANT_ID}/${EVENT_ID}/a.jpg`, file_name: "a.jpg", file_type: "image/jpeg", file_size: 10 },
          { id: "adj-2", storage_path: `${TENANT_ID}/${EVENT_ID}/b.png`, file_name: "b.png", file_type: "image/png", file_size: 20 },
        ],
        error: null,
      },
      signedUrlsResult: {
        data: [
          { path: `${TENANT_ID}/${EVENT_ID}/a.jpg`, signedUrl: null, error: "Object not found" },
          { path: `${TENANT_ID}/${EVENT_ID}/b.png`, signedUrl: "https://signed.example/b.png", error: null },
        ],
        error: null,
      },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const firmados = await HistorialService.generarSignedUrlsAdjuntosEvento(EVENT_ID, CTX);

    expect(firmados).toEqual([
      { id: "adj-2", url: "https://signed.example/b.png", fileName: "b.png", fileType: "image/png", fileSize: 20 },
    ]);
  });

  it("filtra por tenant_id: la lista de adjuntos de otro tenant no se firma (aislamiento explícito)", async () => {
    const db = buildMockDb({ listResult: { data: [], error: null } });
    mockGetServiceDb.mockReturnValue(db as never);

    await HistorialService.generarSignedUrlsAdjuntosEvento(EVENT_ID, CTX);

    expect(db.builder.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(db.builder.eq).toHaveBeenCalledWith("deleted", false);
  });
});

// ─── registrarEutanasia (RN-EC10, RN-EC11, RN-EC12, RN-PV4) ─────────────────────
// La ÚNICA operación irreversible del sistema (CLAUDE.md regla 8). Estos tests
// verifican el contrato del Service; la atomicidad real (rollback en la DB) y el
// aislamiento RLS se cubren en integración (bloqueante).

function eutanasiaDto(over: Record<string, unknown> = {}) {
  return {
    date:           "2026-06-09",
    professionalId: PROF_ID,
    description:    "Eutanasia humanitaria por enfermedad terminal",
    ...over,
  };
}

// Fila snake_case tal como la devuelve el RPC registrar_eutanasia.
function eutanasiaRpcRow(over: Record<string, unknown> = {}) {
  return {
    event_id:            EVENT_ID,
    pet_id:              PET_ID,
    date:                "2026-06-09",
    event_type:          "Eutanasia",
    professional_name:   "Dra. García",
    client_name_at_time: "Juan Pérez",
    mascota_name:        "Firulais",
    mascota_estado:      "Fallecida",
    deceased_date:       "2026-06-09",
    deceased_reason:     "Eutanasia",
    cancelled_doses:     0,
    ...over,
  };
}

describe("registrarEutanasia", () => {
  it("RN-EC10: euthanasiaConfirmed ausente → EUTHANASIA_CONFIRMATION_REQUIRED (no inicia transacción)", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.registrarEutanasia(PET_ID, eutanasiaDto() as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.EUTHANASIA_CONFIRMATION_REQUIRED, statusCode: 422 });

    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("RN-EC10: euthanasiaConfirmed false → EUTHANASIA_CONFIRMATION_REQUIRED (no inicia transacción)", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.registrarEutanasia(PET_ID, eutanasiaDto({ euthanasiaConfirmed: false }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.EUTHANASIA_CONFIRMATION_REQUIRED, statusCode: 422 });

    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("registrarEutanasia: falta description → VALIDATION_ERROR (no inicia transacción)", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.registrarEutanasia(PET_ID, eutanasiaDto({ description: "", euthanasiaConfirmed: true }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });

    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("RN-EC11 (ROLLBACK): si el RPC falla, no persiste nada ni audita — una transacción o nada", async () => {
    // El RPC lanza PET_DECEASED (p. ej. mascota ya fallecida). El Service NO debe
    // hacer escrituras por partes: delega TODO en el único rpc('registrar_eutanasia').
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: null, error: { message: "PET_DECEASED" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.registrarEutanasia(PET_ID, eutanasiaDto({ euthanasiaConfirmed: true }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });

    // Toda la operación se delega a una sola llamada RPC (la transacción atómica).
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("registrar_eutanasia", expect.anything());
    // El Service nunca escribe directamente: no hay insert/update sueltos que
    // pudieran dejar la mascota "media muerta".
    expect(db.builder["insert"]).not.toHaveBeenCalled();
    expect(db.builder["update"]).not.toHaveBeenCalled();
    // El asiento de auditoría va dentro del RPC (rollbackea con la transacción);
    // el Service no audita por separado.
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("RN-EC11: éxito ejecuta una única transacción y mapea { evento, mascota }", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: eutanasiaRpcRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HistorialService.registrarEutanasia(
      PET_ID, eutanasiaDto({ euthanasiaConfirmed: true }) as never, CTX,
    );

    expect(db.rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = (db.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fnName).toBe("registrar_eutanasia");
    // p_tenant_id SIEMPRE del JWT (regla 1); p_confirmed:true; mascota y profesional.
    expect(params).toMatchObject({
      p_confirmed:       true,
      p_tenant_id:       TENANT_ID,
      p_pet_id:          PET_ID,
      p_professional_id: PROF_ID,
      p_user_id:         CTX.callerUserId,   // ejecutor (para la auditoría atómica)
      p_date:            "2026-06-09",
    });

    expect(result.evento.eventType).toBe("Eutanasia");
    expect(result.evento.clientNameAtTime).toBe("Juan Pérez");
    expect(result.mascota.estado).toBe("Fallecida");
    expect(result.mascota.deceasedReason).toBe("Eutanasia");
    expect(result.mascota.deceasedDate).toBe("2026-06-09");
  });

  it("RN-S3: el asiento de auditoría es ATÓMICO (lo hace el RPC); el Service NO audita por separado", async () => {
    // La auditoría de la eutanasia va DENTRO de la transacción del RPC (rollbackea
    // junto con todo). El Service por tanto no debe llamar a recordAudit; sí pasa
    // p_user_id para que el asiento registre al usuario que ejecuta.
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: eutanasiaRpcRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await HistorialService.registrarEutanasia(PET_ID, eutanasiaDto({ euthanasiaConfirmed: true }) as never, CTX);

    expect(mockRecordAudit).not.toHaveBeenCalled();
    const [, params] = (db.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params).toMatchObject({ p_user_id: CTX.callerUserId });
  });

  it("RN-PV4: cancelledDoses refleja las dosis pendientes canceladas por el RPC", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: eutanasiaRpcRow({ cancelled_doses: 3 }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HistorialService.registrarEutanasia(
      PET_ID, eutanasiaDto({ euthanasiaConfirmed: true }) as never, CTX,
    );

    expect(result.cancelledDoses).toBe(3);
  });

  it("RN-HOR8: profesional dado de baja → DOCTOR_INACTIVE sin abrir la transacción irreversible", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: "88888888-8888-4888-8888-888888888888", available: false }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.registrarEutanasia(PET_ID, eutanasiaDto({ euthanasiaConfirmed: true }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.DOCTOR_INACTIVE, statusCode: 422 });

    // Mismo criterio que RN-EC10: la operación irreversible ni se inicia.
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("registrarEutanasia: RPC MASCOTA_NOT_FOUND → 404", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: null, error: { message: "MASCOTA_NOT_FOUND" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.registrarEutanasia(PET_ID, eutanasiaDto({ euthanasiaConfirmed: true }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("registrarEutanasia: RPC FORBIDDEN (profesional de otro tenant) → 403", async () => {
    const db = buildMockDb({
      singleResults: [perfilDoctorDisponible, { data: null, error: { message: "FORBIDDEN" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.registrarEutanasia(PET_ID, eutanasiaDto({ euthanasiaConfirmed: true }) as never, CTX),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
  });
});
