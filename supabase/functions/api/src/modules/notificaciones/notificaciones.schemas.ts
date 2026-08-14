import { z } from "zod";

/**
 * Configuración de recordatorios de turnos (Documento Maestro v1.0 §4).
 * Persiste en `configuracion_tenant.parametros_extra.notificacionesTurnos`
 * (Addendum §341: "horas de antelación de recordatorio de turnos").
 *
 * - `hoursBeforeAppointment`: ventana de antelación (RN-NT1). Por defecto 24 h;
 *   se limita a 1–168 h (hasta 7 días) para acotar el barrido.
 */
export const ConfigNotificacionTurnosSchema = z.object({
  enabled:                z.boolean(),
  hoursBeforeAppointment: z.number().int().min(1).max(168),
  sendEmail:              z.boolean(),
  sendWhatsApp:           z.boolean(),
  sendSMS:                z.boolean(),
});

export type ConfigNotificacionTurnosDto = z.infer<typeof ConfigNotificacionTurnosSchema>;

/** Defaults cuando el tenant todavía no guardó configuración (RN-NT1: 24 h). */
export const CONFIG_NOTIF_TURNOS_DEFAULT: ConfigNotificacionTurnosDto = {
  enabled:                false,
  hoursBeforeAppointment: 24,
  sendEmail:              true,
  sendWhatsApp:           false,
  sendSMS:                false,
};

/** Clave bajo la que vive la config dentro de `parametros_extra`. */
export const PARAM_KEY_NOTIF_TURNOS = "notificacionesTurnos";

/** Resumen del procesamiento (Documento Maestro v1.0 §4, DTO de resultado). */
export interface ResultadoProcesamiento {
  processed: number;
  sent:      number;
  failed:    number;
  skipped:   number;
}
