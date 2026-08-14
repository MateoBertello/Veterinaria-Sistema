import { Hono } from "hono";
import { ok } from "../../shared/envelope.ts";
import { requireCronSecret } from "../../middleware/requireCronSecret.ts";
import { NotificacionService } from "./notificaciones.service.ts";

/**
 * Entrada HTTP del barrido periódico (RN-NT5). La invoca pg_cron vía pg_net (la función
 * SQL `disparar_notificaciones()`), NO un usuario: por eso queda fuera de `tenantContext`
 * y se protege solo con el secreto compartido (`requireCronSecret`).
 *
 * `POST /internal/notificaciones/procesar` corre AMBOS barridos sin `tenantId` (todos los
 * tenants activos con el módulo licenciado — el filtro vive en el service) y devuelve el
 * resumen combinado. La idempotencia (no spamear) la garantiza el UNIQUE de
 * `notificaciones`: re-disparos consecutivos resultan en `skipped`.
 */
export const cronNotificacionesRouter = new Hono();

cronNotificacionesRouter.use("/*", requireCronSecret);

cronNotificacionesRouter.post("/procesar", async (c) => {
  const [turnos, vacunas] = await Promise.all([
    NotificacionService.procesarRecordatoriosTurnos({}),
    NotificacionService.procesarAvisosVacunacion({}),
  ]);
  return c.json(ok({ turnos, vacunas }), 200);
});
