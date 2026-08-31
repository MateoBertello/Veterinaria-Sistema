import { Hono, type Context, type MiddlewareHandler } from "hono";
import { HorarioService, type CallerContext } from "./horarios.service.ts";
import { CrearFranjaSchema, AlternarActivoSchema } from "./horarios.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

/**
 * Contexto del llamante — tenant_id y userId siempre del JWT.
 *
 * `canManageAll` (RN-HOR7) sale de los permisos que ya resolvió
 * `requirePermission("manage_schedules")` y dejó en el contexto: quien además
 * administra la clínica (`manage_users`) gestiona el horario de cualquiera; el
 * veterinario, solo el suyo.
 */
function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  const permisos = c.get("permisos") ?? new Set<string>();
  return {
    tenantId,
    callerUserId: userId,
    callerName:   CALLER_UNRESOLVED,
    callerRole:   CALLER_UNRESOLVED,
    canManageAll: permisos.has("manage_users"),
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Router anidado bajo /doctores — franjas de un profesional + resumen global.
// RN-HOR5: gestión restringida a Administrador (permiso manage_schedules).
// ────────────────────────────────────────────────────────────────────────────────
export const horariosDoctorRouter = new Hono();

// Ojo con el alcance: este router se monta en /doctores JUNTO con el de gestión
// de profesionales, así que un `use("/*")` acá le aplicaba manage_schedules a
// TODO /doctores —incluido el `GET /doctores` que sirve el otro router— y le
// devolvía 403 a la recepcionista al abrir "Agendar turno".
//
// Por eso el gate NO puede montarse por prefijo: va adosado a cada ruta, en la
// misma línea en que se la declara. Antes se enumeraban los paths en dos `use()`
// aparte, y esa lista podía quedar desfasada de las rutas reales: cualquier ruta
// nueva fuera de esos dos patrones quedaba sin autenticación alguna, ni siquiera
// tenantContext. Lo que impide que eso vuelva a pasar es el guard de
// `tests/unit/horarios.controller.test.ts`, que recorre las rutas registradas y
// exige que todas rechacen al anónimo con 401.
//
// El tipo es una tupla `readonly` de longitud fija a propósito: spread de un
// `MiddlewareHandler[]` común le hace perder a Hono la inferencia del path, y
// `c.req.param("id")` pasa a ser `string | undefined`.
const gateHorarios: readonly [MiddlewareHandler, MiddlewareHandler, MiddlewareHandler] = [
  tenantContext,
  requireActiveTenant,
  requirePermission("manage_schedules"),
];

// ── GET /doctores/horarios/resumen ──────────────────────────────────────────────
// Ruta estática: declarada antes de las rutas con :id para evitar capturas.
horariosDoctorRouter.get("/horarios/resumen", ...gateHorarios, async (c) => {
  const resumen = await HorarioService.resumen(callerCtx(c));
  return c.json(ok(resumen), 200);
});

// ── GET /doctores/:id/horarios ──────────────────────────────────────────────────
horariosDoctorRouter.get("/:id/horarios", ...gateHorarios, async (c) => {
  const franjas = await HorarioService.listarPorDoctor(c.req.param("id"), callerCtx(c));
  return c.json(ok(franjas), 200);
});

// ── POST /doctores/:id/horarios ─────────────────────────────────────────────────
horariosDoctorRouter.post("/:id/horarios", ...gateHorarios, async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearFranjaSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de franja inválidos",
      parsed.error.issues,
    );
  }

  const franja = await HorarioService.crearFranja(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(franja), 201);
});

// ────────────────────────────────────────────────────────────────────────────────
// Router plano bajo /horarios — activar/desactivar y eliminar franjas.
// ────────────────────────────────────────────────────────────────────────────────
export const horariosRouter = new Hono();

horariosRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requirePermission("manage_schedules"),
);

// ── PATCH /horarios/:horarioId ──────────────────────────────────────────────────
horariosRouter.patch("/:horarioId", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = AlternarActivoSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "El campo 'active' (boolean) es requerido",
      parsed.error.issues,
    );
  }

  const franja = await HorarioService.alternarActivo(
    c.req.param("horarioId"),
    parsed.data.active,
    callerCtx(c),
  );
  return c.json(ok(franja), 200);
});

// ── DELETE /horarios/:horarioId ─────────────────────────────────────────────────
horariosRouter.delete("/:horarioId", async (c) => {
  await HorarioService.eliminar(c.req.param("horarioId"), callerCtx(c));
  return c.json(ok({ deleted: true }), 200);
});
