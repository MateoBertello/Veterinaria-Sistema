import { Hono, type Context } from "hono";
import { HistorialService, type CallerContext } from "./historial.service.ts";
import {
  ListarHistorialQuerySchema,
  CrearEventoClinicoSchema,
  RegistrarEutanasiaSchema,
  ExportHistorialQuerySchema,
} from "./historial.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";

// Middleware compartido para todos los endpoints de historial
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("historial_clinico"),
  requirePermission("view_medical_history"),
];

// Permiso de gestión adicional para las escrituras (RN-EC7).
const manageMedicalHistory = requirePermission("manage_medical_history");

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: "unknown", callerRole: "unknown" };
}

// ─── /historial/:id ───────────────────────────────────────────────────────────
// Montado en /api/v1/historial

export const historialRouter = new Hono();
historialRouter.use("/*", ...sharedMiddleware);

historialRouter.get("/:id", async (c) => {
  const { tenantId } = getTenantContext(c);
  const evento = await HistorialService.obtenerEventoPorId(c.req.param("id"), tenantId);
  return c.json(ok(evento), 200);
});

// POST /historial/:id/adjuntos  (multipart/form-data, campo "file") — RN-EC4
historialRouter.post("/:id/adjuntos", manageMedicalHistory, async (c) => {
  const recordId = c.req.param("id")!;

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Se esperaba multipart/form-data con el campo 'file'");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Falta el archivo en el campo 'file'");
  }

  const adjunto = await HistorialService.adjuntarArchivo(recordId, file, callerCtx(c));
  return c.json(ok(adjunto), 201);
});

// ─── /mascotas/:petId/historial  y  /mascotas/:petId/resumen-clinico ─────────
// Montado de forma aditiva en /api/v1/mascotas (igual que horariosDoctorRouter)

export const historialMascotaRouter = new Hono();
historialMascotaRouter.use("/*", ...sharedMiddleware);

// GET /mascotas/:petId/historial/export?format=pdf|xlsx — Exportar (RN-EX1..EX5)
// Registrada antes de /:petId/historial para que Hono no intente resolver
// el segmento 'export' como query de la ruta de listado.
historialMascotaRouter.get("/:petId/historial/export", async (c) => {
  const petId  = c.req.param("petId")!;
  const parsed = ExportHistorialQuerySchema.safeParse({ format: c.req.query("format") });
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Formato inválido. Use ?format=pdf o ?format=xlsx", parsed.error.issues);
  }
  const result = await HistorialService.exportarHistorial(petId, parsed.data.format, callerCtx(c));
  return new Response(result.buffer.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":        result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
});

// GET /mascotas/:petId/historial?page=&limit=
historialMascotaRouter.get("/:petId/historial", async (c) => {
  const { tenantId } = getTenantContext(c);
  const petId = c.req.param("petId");

  const parsed = ListarHistorialQuerySchema.safeParse({
    page:  c.req.query("page"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Parámetros de paginación inválidos", parsed.error.issues);
  }

  const { page, limit } = parsed.data;
  const { items, total } = await HistorialService.listarHistorial(petId, tenantId, { page, limit });
  return c.json(ok(items, { page, limit, total }), 200);
});

// GET /mascotas/:petId/resumen-clinico
historialMascotaRouter.get("/:petId/resumen-clinico", async (c) => {
  const { tenantId } = getTenantContext(c);
  const resumen = await HistorialService.resumenClinico(c.req.param("petId"), tenantId);
  return c.json(ok(resumen), 200);
});

// POST /mascotas/:petId/historial — Registrar Evento Clínico (RN-EC1, RN-EC7)
historialMascotaRouter.post("/:petId/historial", manageMedicalHistory, async (c) => {
  const petId = c.req.param("petId")!;

  const parsed = CrearEventoClinicoSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos del evento clínico inválidos", parsed.error.issues);
  }

  const evento = await HistorialService.crearRegistro(petId, parsed.data, callerCtx(c));
  return c.json(ok(evento), 201);
});

// POST /mascotas/:petId/eutanasia — Registrar Eutanasia (RN-EC10..EC12, RN-PV4).
// Ruta DEDICADA: la única operación irreversible (CLAUDE.md regla 8) no se dispara
// por el endpoint genérico de evento clínico (que sigue rechazando 'Eutanasia').
historialMascotaRouter.post("/:petId/eutanasia", manageMedicalHistory, async (c) => {
  const petId = c.req.param("petId")!;

  const parsed = RegistrarEutanasiaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de eutanasia inválidos", parsed.error.issues);
  }

  const resultado = await HistorialService.registrarEutanasia(petId, parsed.data, callerCtx(c));
  return c.json(ok(resultado), 201);
});

// ─── /adjuntos/:adjuntoId  (descarga por signed URL) ─────────────────────────
// Montado en /api/v1/adjuntos

export const adjuntosRouter = new Hono();
adjuntosRouter.use("/*", ...sharedMiddleware);

// GET /adjuntos/:adjuntoId → { url, fileName, fileType, fileSize }
adjuntosRouter.get("/:adjuntoId", async (c) => {
  const firmado = await HistorialService.generarSignedUrlAdjunto(c.req.param("adjuntoId"), callerCtx(c));
  return c.json(ok(firmado), 200);
});
