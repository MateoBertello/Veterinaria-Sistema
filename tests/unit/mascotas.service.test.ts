import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks declarados ANTES de importar el módulo bajo prueba ─────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { MascotasService } from "../../supabase/functions/api/src/modules/mascotas/mascotas.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID      = "11111111-1111-4111-8111-111111111111";
const CALLER_USER_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID      = "33333333-3333-4333-8333-333333333333";
const ESPECIE_ID     = "44444444-4444-4444-8444-444444444444";
const RAZA_ID        = "55555555-5555-4555-8555-555555555555";
const PET_ID         = "66666666-6666-4666-8666-666666666666";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: CALLER_USER_ID,
  callerName:   "Recepción Uno",
  callerRole:   "recepcionista",
};

const dtoValido = {
  name:          "Firulais",
  clientId:      CLIENT_ID,
  especieId:     ESPECIE_ID,
  razaId:        RAZA_ID,
  sex:           "Macho" as const,
  tamano:        "Mediano" as const,
  alimentoDieta: "Croquetas premium",
  birthDate:     "2020-05-01",
  color:         "Marrón",
  observations:  "Tranquilo",
};

/** Fila tal como la devuelve la DB (snake_case + embeds). */
const dbRow = (over: Record<string, unknown> = {}) => ({
  id:             PET_ID,
  tenant_id:      TENANT_ID,
  name:           "Firulais",
  client_id:      CLIENT_ID,
  especie_id:     ESPECIE_ID,
  raza_id:        RAZA_ID,
  sex:            "Macho",
  tamano:         "Mediano",
  alimento_dieta: "Croquetas premium",
  birth_date:     "2020-05-01",
  color:          "Marrón",
  observations:   "Tranquilo",
  estado:         "Activa",
  deceased_date:  null,
  deleted:        false,
  created_at:     "2026-06-19T12:00:00Z",
  cliente:        { full_name: "María García" },
  especie:        { name: "Perro" },
  raza:           { name: "Labrador" },
  ...over,
});

// ─── Mock de DB con cola de resultados (mismo patrón que clientes.service.test) ─

type MockOpts = {
  singleResults?: Array<{ data: unknown; error: unknown }>;
  rangeResult?:   { data: unknown[]; error: unknown; count: number };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];
  const next = () => singleQueue.shift() ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "insert", "update", "delete", "eq", "neq", "or", "ilike", "order", "limit"]) {
    builder[m] = vi.fn(chain);
  }
  builder["single"]      = vi.fn().mockImplementation(async () => next());
  builder["maybeSingle"] = vi.fn().mockImplementation(async () => next());
  builder["range"]       = vi.fn().mockResolvedValue(
    opts.rangeResult ?? { data: [], error: null, count: 0 },
  );

  // rpc() devuelve el mismo builder encadenable; .single()/.maybeSingle()
  // toman de la misma cola singleResults (igual que un SELECT).
  const db = { from: vi.fn(() => builder), rpc: vi.fn(() => builder), builder };
  return db;
}

beforeEach(() => vi.clearAllMocks());

// ─── RN-MA1: campos obligatorios ──────────────────────────────────────────────

describe("RN-MA1: Campos obligatorios", () => {
  for (const campo of ["name", "clientId", "especieId", "sex", "tamano"] as const) {
    it(`RN-MA1: falta ${campo} → VALIDATION_ERROR`, async () => {
      const db = buildMockDb();
      mockGetServiceDb.mockReturnValue(db as never);

      const { [campo]: _omit, ...incompleto } = dtoValido;

      await expect(
        MascotasService.crear(incompleto as typeof dtoValido, ctx),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
      expect(db.builder["insert"]).not.toHaveBeenCalled();
    });
  }
});

// ─── RN-MA8: tamaño tipado ─────────────────────────────────────────────────────

describe("RN-MA8: Tamaño por ENUM", () => {
  it("RN-MA8: tamano fuera del ENUM → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear({ ...dtoValido, tamano: "Enorme" as never }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});

// ─── RN-MA2: coherencia raza/especie ───────────────────────────────────────────

describe("RN-MA2: Coherencia raza/especie", () => {
  it("RN-MA2: razaId que no pertenece a la especie → VALIDATION_ERROR", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null }, // cliente del tenant existe
        { data: null, error: null },              // raza no pertenece a la especie
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });
});

// ─── RN-MA9: dieta máx. 500 + fallback ─────────────────────────────────────────

describe("RN-MA9: Alimento/dieta", () => {
  it("RN-MA9: alimentoDieta de más de 500 chars → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear({ ...dtoValido, alimentoDieta: "x".repeat(501) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('RN-MA9: dieta vacía → persiste el fallback "Sin indicaciones de dieta"', async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null },                       // cliente
        { data: { id: RAZA_ID }, error: null },                         // raza coherente
        { data: dbRow({ alimento_dieta: "Sin indicaciones de dieta" }), error: null }, // insert+select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { alimentoDieta: _omit, ...sinDieta } = dtoValido;
    await MascotasService.crear(sinDieta as typeof dtoValido, ctx);

    const payload = (db.builder["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.alimento_dieta).toBe("Sin indicaciones de dieta");
  });
});

// ─── RN-MA10: estado por ENUM ──────────────────────────────────────────────────

describe("RN-MA10: Estado por ENUM", () => {
  it("RN-MA10: alta queda con estado 'Activa' y sin flag booleano deceased", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null },
        { data: { id: RAZA_ID }, error: null },
        { data: dbRow(), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const mascota = await MascotasService.crear(dtoValido, ctx);
    expect(mascota.estado).toBe("Activa");

    const payload = (db.builder["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("deceased");
  });
});

// ─── Cross-tenant: cliente de otro tenant ──────────────────────────────────────

describe("FK cross-tenant", () => {
  it("crear contra un cliente inexistente en el tenant → FORBIDDEN (no inserta)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }], // cliente no encontrado en el tenant
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });
});

// ─── RN-MA4: fecha de nacimiento inmutable ─────────────────────────────────────

describe("RN-MA4: Fecha de nacimiento inmutable", () => {
  it("RN-MA4: editar nunca incluye birth_date en el payload de update", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },                          // carga de la mascota actual
        { data: dbRow({ tamano: "Grande" }), error: null },      // update + select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    // birthDate viene en el body pero el schema lo descarta (RN-MA4).
    await MascotasService.editar(PET_ID, { tamano: "Grande", birthDate: "1999-01-01" } as never, ctx);

    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("birth_date");
    expect(payload).toMatchObject({ tamano: "Grande" });
  });

  // RN-MA3: el peso NO es un atributo de Mascota (vive en el Historial Clínico).
  // EditarMascotaSchema no declara peso/weight: aunque venga en el body, Zod lo
  // descarta silenciosamente y nunca llega al update ni a la respuesta pública.
  it("RN-MA3: editar nunca incluye peso/weight en el payload de update ni en la respuesta", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },
        { data: dbRow({ tamano: "Grande" }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const mascota = await MascotasService.editar(
      PET_ID,
      { tamano: "Grande", peso: 15, weight: 15 } as never,
      ctx,
    );

    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("peso");
    expect(payload).not.toHaveProperty("weight");
    expect(mascota).not.toHaveProperty("peso");
    expect(mascota).not.toHaveProperty("weight");
    // El único dato de peso expuesto es el derivado del Historial (RN-MA3).
    expect(mascota.ultimoPeso).toBeNull();
  });

  // RN-MA5: la edad se calcula en tiempo real (frontend) a partir de birthDate;
  // el backend nunca persiste ni devuelve un campo edad/age.
  it("RN-MA5: el DTO de mascota solo incluye birthDate, nunca un campo edad/age persistido", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },
        { data: dbRow({ tamano: "Grande" }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const mascota = await MascotasService.editar(
      PET_ID,
      { tamano: "Grande", edad: 5, age: 5 } as never,
      ctx,
    );

    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("edad");
    expect(payload).not.toHaveProperty("age");
    expect(mascota).not.toHaveProperty("edad");
    expect(mascota).not.toHaveProperty("age");
    expect(mascota).toHaveProperty("birthDate");
  });

  // RN-EC12: irreversibilidad de 'Fallecida'. EditarMascotaSchema no declara
  // 'estado' (se omite de CrearMascotaSchema junto con clientId/birthDate), por
  // lo que no existe ninguna vía en editar() para revertir el estado, ni siquiera
  // enviándolo explícitamente en el body.
  it("RN-EC12: editar no expone ninguna vía para revertir estado='Fallecida' a 'Activa'", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow({ estado: "Fallecida", deceased_date: "2026-01-01" }), error: null },
        { data: dbRow({ estado: "Fallecida", deceased_date: "2026-01-01", tamano: "Grande" }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.editar(PET_ID, { tamano: "Grande", estado: "Activa" } as never, ctx);

    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("estado");
  });
});

// ─── RN-MA7: auditoría módulo pets ─────────────────────────────────────────────

describe("RN-MA7: Auditoría de alta y edición (módulo pets)", () => {
  // RN-UX4 (regla transversal): dtoValido no tiene ningún campo para "pedir"
  // auditoría — el sólo hecho de que recordAudit se haya llamado, sin que el
  // llamante lo solicite explícitamente, demuestra que la auditoría es implícita.
  it("RN-MA7/RN-UX4: crear registra auditoría CREATE en módulo pets sin que el usuario lo solicite explícitamente", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null },
        { data: { id: RAZA_ID }, error: null },
        { data: dbRow(), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    expect("recordAudit" in dtoValido).toBe(false);
    expect("audit" in dtoValido).toBe(false);

    await MascotasService.crear(dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("CREATE");
    expect(audit.module).toBe("pets");
    expect(audit.tenantId).toBe(TENANT_ID);
    expect(audit.entityId).toBe(PET_ID);
  });

  it("RN-MA7: editar registra auditoría UPDATE con oldValues y newValues", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },
        { data: dbRow({ name: "Firu" }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.editar(PET_ID, { name: "Firu" }, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("UPDATE");
    expect(audit.module).toBe("pets");
    expect(audit.oldValues).toBeDefined();
    expect(audit.newValues).toBeDefined();
  });
});

// ─── RN-MA6: baja lógica ───────────────────────────────────────────────────────

describe("RN-MA6: Baja lógica", () => {
  it("RN-MA6: eliminar marca deleted=true y audita DELETE en pets", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },            // carga de la mascota
        { data: { id: PET_ID }, error: null },     // update (baja lógica)
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.eliminar(PET_ID, ctx);

    expect(db.builder["update"]).toHaveBeenCalledOnce();
    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toMatchObject({ deleted: true });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit.mock.calls[0][1].action).toBe("DELETE");
    expect(mockRecordAudit.mock.calls[0][1].module).toBe("pets");
  });
});

// ─── Listado: excluye eliminados y embebe el dueño ─────────────────────────────

describe("Listado de mascotas", () => {
  it("listar excluye deleted=true y resuelve el dueño con embed (sin N+1)", async () => {
    const db = buildMockDb({
      rangeResult: { data: [dbRow()], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items, total } = await MascotasService.listar(TENANT_ID, { page: 1, limit: 20 });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].ownerName).toBe("María García");
    expect(db.builder["eq"]).toHaveBeenCalledWith("deleted", false);

    // El dueño se resuelve en la misma consulta (embed), no por fila.
    const selectArg = (db.builder["select"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selectArg).toContain("cliente:clientes");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cambiar Dueño de Mascota (RN-CD1..CD5)
// ═══════════════════════════════════════════════════════════════════════════════

const NEW_CLIENT_ID = "77777777-7777-4777-8777-777777777777";

const cambioDuenoDto = {
  newClientId: NEW_CLIENT_ID,
  reason:      "Adopción",
  notes:       "Transferencia acordada por escrito",
};

/** Fila que devuelve el RPC cambiar_dueno_mascota (snake_case). */
const rpcRow = (over: Record<string, unknown> = {}) => ({
  pet_id:               PET_ID,
  previous_client_id:   CLIENT_ID,
  previous_client_name: "Carlos Fernández",
  new_client_id:        NEW_CLIENT_ID,
  new_client_name:      "Ana Martínez",
  change_date:          "2026-06-19T12:00:00Z",
  ...over,
});

describe("RN-CD1: Cliente distinto (SAME_OWNER)", () => {
  it("RN-CD1: nuevo dueño = dueño actual → SAME_OWNER", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: { message: "SAME_OWNER" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.cambiarDueno(PET_ID, cambioDuenoDto, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.SAME_OWNER, statusCode: 422 });
  });
});

describe("RN-CD2: Trazabilidad del cambio", () => {
  it("RN-CD2: invoca el RPC transaccional con tenant/pet/nuevo dueño/motivo/notas/responsable", async () => {
    const db = buildMockDb({
      singleResults: [{ data: rpcRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const res = await MascotasService.cambiarDueno(PET_ID, cambioDuenoDto, ctx);

    expect(db.rpc).toHaveBeenCalledWith(
      "cambiar_dueno_mascota",
      expect.objectContaining({
        p_tenant_id:     TENANT_ID,
        p_pet_id:        PET_ID,
        p_new_client_id: NEW_CLIENT_ID,
        p_recorded_by:   CALLER_USER_ID,
        p_reason:        "Adopción",
        p_notes:         "Transferencia acordada por escrito",
      }),
    );
    expect(res).toMatchObject({
      petId:              PET_ID,
      previousClientName: "Carlos Fernández",
      newClientName:      "Ana Martínez",
    });
  });
});

describe("RN-CD3: Preservación de la propiedad histórica", () => {
  it("RN-CD3: cambiar dueño nunca escribe en historial_clinico", async () => {
    const db = buildMockDb({
      singleResults: [{ data: rpcRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.cambiarDueno(PET_ID, cambioDuenoDto, ctx);

    // La preservación clínica es automática (snapshots inmutables): el Service
    // no toca historial_clinico al transferir.
    const tablasTocadas = (db.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(tablasTocadas).not.toContain("historial_clinico");
  });
});

describe("RN-CD4: Sólo mascota activa", () => {
  it("RN-CD4: transferir una mascota fallecida → PET_DECEASED", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: { message: "PET_DECEASED" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.cambiarDueno(PET_ID, cambioDuenoDto, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  it("RN-CD4: mascota inexistente en el tenant → MASCOTA_NOT_FOUND", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: { message: "MASCOTA_NOT_FOUND" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.cambiarDueno(PET_ID, cambioDuenoDto, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });
});

describe("RN-CD5: Auditoría del cambio (módulo pets)", () => {
  it("RN-CD5: registra UPDATE en pets con dueño previo y nuevo", async () => {
    const db = buildMockDb({
      singleResults: [{ data: rpcRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.cambiarDueno(PET_ID, cambioDuenoDto, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("UPDATE");
    expect(audit.module).toBe("pets");
    expect(audit.entityId).toBe(PET_ID);
    expect(audit.oldValues).toMatchObject({ client_id: CLIENT_ID });
    expect(audit.newValues).toMatchObject({ client_id: NEW_CLIENT_ID });
  });
});

describe("Cambiar dueño: aislamiento de tenant", () => {
  it("usa siempre ctx.tenantId en el RPC (nunca un tenant del body)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: rpcRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.cambiarDueno(
      PET_ID,
      { ...cambioDuenoDto, tenantId: "99999999-9999-4999-8999-999999999999" } as never,
      ctx,
    );

    const params = (db.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_tenant_id).toBe(TENANT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Marcar Mascota como Fallecida — manual (RN-MF1..MF5)
// ═══════════════════════════════════════════════════════════════════════════════

const fallecidaDto = {
  deceasedReason: "Insuficiencia renal",
  deceasedDate:   "2026-06-10",
  deceasedNotes:  "Tratamiento paliativo previo",
};

describe("RN-MF1: Motivo obligatorio", () => {
  it("RN-MF1: deceasedReason vacío → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.marcarFallecida(PET_ID, { deceasedReason: "  " } as never, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });
});

describe("RN-MF2: Bloqueo clínico (PET_DECEASED)", () => {
  it("RN-MF2: assertMascotaActiva sobre una mascota fallecida → PET_DECEASED", async () => {
    const db = buildMockDb({
      singleResults: [{ data: { id: PET_ID, estado: "Fallecida", deleted: false }, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.assertMascotaActiva(db as never, PET_ID, TENANT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  it("RN-MF2: assertMascotaActiva sobre mascota inexistente → MASCOTA_NOT_FOUND", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.assertMascotaActiva(db as never, PET_ID, TENANT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("RN-MF2: re-marcar como fallecida una ya fallecida → PET_DECEASED", async () => {
    const db = buildMockDb({
      singleResults: [{ data: { id: PET_ID, estado: "Fallecida", deleted: false }, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.marcarFallecida(PET_ID, fallecidaDto, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED });
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });
});

describe("Marcar fallecida: persistencia", () => {
  it("persiste estado='Fallecida' con deceased_date y deceased_reason", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: PET_ID, estado: "Activa", deleted: false }, error: null }, // assertMascotaActiva
        { data: dbRow({ estado: "Fallecida", deceased_date: "2026-06-10", deceased_reason: "Insuficiencia renal" }), error: null }, // update+select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const mascota = await MascotasService.marcarFallecida(PET_ID, fallecidaDto, ctx);

    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toMatchObject({
      estado:          "Fallecida",
      deceased_date:   "2026-06-10",
      deceased_reason: "Insuficiencia renal",
    });
    expect(mascota.estado).toBe("Fallecida");
  });

  it("sin deceasedDate usa la fecha de hoy", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: PET_ID, estado: "Activa", deleted: false }, error: null },
        { data: dbRow({ estado: "Fallecida", deceased_date: "2026-06-19" }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { deceasedDate: _omit, ...sinFecha } = fallecidaDto;
    await MascotasService.marcarFallecida(PET_ID, sinFecha as typeof fallecidaDto, ctx);

    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.deceased_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("RN-MF5: Auditoría del fallecimiento (módulo pets)", () => {
  it("RN-MF5: registra UPDATE en pets con marca de fallecimiento", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: PET_ID, estado: "Activa", deleted: false }, error: null },
        { data: dbRow({ estado: "Fallecida" }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.marcarFallecida(PET_ID, fallecidaDto, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("UPDATE");
    expect(audit.module).toBe("pets");
    expect(audit.entityId).toBe(PET_ID);
    expect(audit.newValues).toMatchObject({ estado: "Fallecida" });
  });
});

// ─── Listar cambios de dueño (trazabilidad consultable, sin N+1) ───────────────

describe("Listar cambios de dueño", () => {
  it("resuelve dueño anterior y nuevo con embed en una sola consulta", async () => {
    const cambioRow = {
      id:                 "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pet_id:             PET_ID,
      previous_client_id: CLIENT_ID,
      new_client_id:      NEW_CLIENT_ID,
      change_date:        "2026-06-19T12:00:00Z",
      reason:             "Adopción",
      notes:              null,
      previous:           { full_name: "Carlos Fernández" },
      new:                { full_name: "Ana Martínez" },
    };
    const db = buildMockDb({
      singleResults: [{ data: { id: PET_ID }, error: null }], // mascota del tenant
      rangeResult:   { data: [cambioRow], error: null, count: 1 },
    });
    // listarCambiosDueno no pagina con range; usamos order() que resuelve a array.
    db.builder["order"] = vi.fn().mockResolvedValue({ data: [cambioRow], error: null });
    mockGetServiceDb.mockReturnValue(db as never);

    const cambios = await MascotasService.listarCambiosDueno(PET_ID, TENANT_ID);

    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({
      previousClientName: "Carlos Fernández",
      newClientName:      "Ana Martínez",
      reason:             "Adopción",
    });

    const selectArg = (db.builder["select"] as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
    expect(selectArg).toContain("clientes!previous_client_id");
    expect(selectArg).toContain("clientes!new_client_id");
  });
});
