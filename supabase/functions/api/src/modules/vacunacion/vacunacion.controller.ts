import { Hono, type Context } from "hono";
import { z } from "zod";
import { VacunacionService, type CallerContext } from "./vacunacion.service.ts";
import { NotificacionService } from "../notificaciones/notificaciones.service.ts";
import {
  ProgramarDosisSchema,
  EditarDosisSchema,
  CancelarDosisSchema,
  MarcarAplicadaSchema,
  ListarDosisQuerySchema,
} from "./vacunacion.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("historial_clinico"),
  requirePermission("view_medical_history"),
];

const manageMedicalHistory = requirePermission("manage_medical_history");

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ─── /mascotas/:petId/plan-vacunacion — montado de forma aditiva en /mascotas ─

export const planVacunacionMascotaRouter = new Hono();
planVacunacionMascotaRouter.use("/*", ...sharedMiddleware);

// GET /mascotas/:petId/plan-vacunacion?page=&limit=
planVacunacionMascotaRouter.get("/:petId/plan-vacunacion", async (c) => {
  const petId = c.req.param("petId");
  const petParsed = z.string().uuid().safeParse(petId);
  if (!petParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de mascota inválido");
  }

  const queryParsed = ListarDosisQuerySchema.safeParse({
    page:  c.req.query("page"),
    limit: c.req.query("limit"),
  });
  if (!queryParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Parámetros de paginación inválidos", queryParsed.error.issues);
  }

  const { page, limit } = queryParsed.data;
  const { tenantId } = getTenantContext(c);
  const { items, total } = await VacunacionService.listarPlanVacunacion(petParsed.data, tenantId, { page, limit });
  return c.json(ok(items, { page, limit, total }), 200);
});

/**
 * GET /mascotas/:petId/tipos-vacuna-aplicables — las vacunas que corresponden a
 * ESA mascota (RN-PV11).
 *
 * Va acá y no en el módulo de catálogos porque la respuesta no es el catálogo:
 * es el resultado de aplicarle una regla clínica a una mascota concreta. Cuelga
 * del router que ya exige módulo `historial_clinico` + `view_medical_history`,
 * que es el mismo gate del resto del plan de vacunación.
 *
 * No pagina: es la lista de un combo, acotada por especie.
 */
planVacunacionMascotaRouter.get("/:petId/tipos-vacuna-aplicables", async (c) => {
  const petParsed = z.string().uuid().safeParse(c.req.param("petId"));
  if (!petParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de mascota inválido");
  }

  const { tenantId } = getTenantContext(c);
  const items = await VacunacionService.tiposVacunaAplicables(petParsed.data, tenantId);
  return c.json(ok(items), 200);
});

// POST /mascotas/:petId/plan-vacunacion — Programar dosis (RN-PV2, PV3, PV4, PV8, PV9, PV11)
planVacunacionMascotaRouter.post("/:petId/plan-vacunacion", manageMedicalHistory, async (c) => {
  const petId = c.req.param("petId");
  const petParsed = z.string().uuid().safeParse(petId);
  if (!petParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de mascota inválido");
  }

  const parsed = ProgramarDosisSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de la dosis inválidos", parsed.error.issues);
  }

  const dosis = await VacunacionService.programarDosis(petParsed.data, parsed.data, callerCtx(c));
  return c.json(ok(dosis), 201);
});

// ─── /plan-vacunacion/:id — montado en /plan-vacunacion ──────────────────────

export const planVacunacionRouter = new Hono();
planVacunacionRouter.use("/*", ...sharedMiddleware);

// PUT /plan-vacunacion/:id — Editar dosis Pendiente (RN-PV2, PV5, PV8, PV9)
planVacunacionRouter.put("/:id", manageMedicalHistory, async (c) => {
  const id = c.req.param("id");
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de dosis inválido");
  }

  const parsed = EditarDosisSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de edición inválidos", parsed.error.issues);
  }

  const dosis = await VacunacionService.editarDosis(idParsed.data, parsed.data, callerCtx(c));
  return c.json(ok(dosis), 200);
});

// PATCH /plan-vacunacion/:id/cancelar — Cancelar dosis Pendiente (RN-PV5, PV8, PV9)
planVacunacionRouter.patch("/:id/cancelar", manageMedicalHistory, async (c) => {
  const id = c.req.param("id");
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de dosis inválido");
  }

  const parsed = CancelarDosisSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de cancelación inválidos", parsed.error.issues);
  }

  const result = await VacunacionService.cancelarDosis(idParsed.data, parsed.data.notas, callerCtx(c));
  return c.json(ok(result), 200);
});

// PATCH /plan-vacunacion/:id/aplicar — Marcar dosis Aplicada (transacción plan+evento; RN-PV5, PV8, PV9)
planVacunacionRouter.patch("/:id/aplicar", manageMedicalHistory, async (c) => {
  const id = c.req.param("id");
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de dosis inválido");
  }

  const parsed = MarcarAplicadaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de aplicación inválidos", parsed.error.issues);
  }

  const dosis = await VacunacionService.marcarDosisAplicada(idParsed.data, parsed.data, callerCtx(c));
  return c.json(ok(dosis), 200);
});

// ─── /notificaciones/vacunas — disparo de avisos de vacunación (RN-PV6/PV7) ──
// Módulo vendible 'historial_clinico' + permiso manage_medical_history (RN-PV8).

export const avisosVacunacionRouter = new Hono();

avisosVacunacionRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requireModule("historial_clinico"),
  requirePermission("manage_medical_history"),
);

// POST /notificaciones/vacunas/procesar — disparo manual "Verificar".
// Procesa SOLO el tenant del JWT; el cron periódico (E9) barrerá todos los activos.
avisosVacunacionRouter.post("/procesar", async (c) => {
  const { tenantId } = getTenantContext(c);
  const resumen = await NotificacionService.procesarAvisosVacunacion({ tenantId });
  return c.json(ok(resumen), 200);
});
