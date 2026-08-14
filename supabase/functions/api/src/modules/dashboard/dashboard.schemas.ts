import type { ModuloVendible } from "../../middleware/requireModule.ts";

/**
 * Contrato de GET /api/v1/dashboard/resumen.
 *
 * Cada métrica es `number` si el usuario puede verla, o `null` si NO puede
 * (le falta el permiso, o el módulo vendible no está licenciado para el tenant).
 * `null` significa "no visible para vos", no "cero": el front oculta la tarjeta.
 * El endpoint nunca responde 403 en bloque — ver dashboard.controller.ts.
 */
export interface ResumenDashboard {
  /** Día de referencia (YYYY-MM-DD) usado por las métricas "de hoy". */
  fecha:               string;
  /** Clientes no eliminados del tenant (RN-CL8: la baja es lógica). */
  clientes:            number | null;
  /** Mascotas con estado 'Activa' y no eliminadas. */
  mascotasActivas:     number | null;
  /** Turnos agendados para hoy, excluidos los cancelados. */
  turnosHoy:           number | null;
  /** Estadías que ocupan hoy (Reservada o EnCurso, rango inclusivo). */
  estadiasHoy:         number | null;
  /** Dosis 'Pendiente' con fecha estimada entre hoy y hoy+30 días. */
  vacunasProximas30d:  number | null;
}

/** Métricas del resumen (claves de ResumenDashboard sin `fecha`). */
export type MetricaDashboard = Exclude<keyof ResumenDashboard, "fecha">;

/** Ventana (días) de la métrica `vacunasProximas30d`. */
export const VENTANA_VACUNAS_DIAS = 30;

/**
 * Matriz de visibilidad por métrica (RN-S2 + regla 4 de licenciamiento).
 *
 * Es la MISMA exigencia que aplican los middlewares del endpoint "dueño" de cada
 * dato: un usuario no puede leer por el dashboard un agregado que no podría
 * obtener del listado correspondiente.
 */
export const VISIBILIDAD_METRICAS: Record<
  MetricaDashboard,
  { permiso: string; modulo?: ModuloVendible }
> = {
  clientes:           { permiso: "manage_clients" },
  mascotasActivas:    { permiso: "manage_pets" },
  turnosHoy:          { permiso: "manage_appointments",  modulo: "turnos" },
  estadiasHoy:        { permiso: "manage_daycare",       modulo: "guarderia" },
  vacunasProximas30d: { permiso: "view_medical_history", modulo: "historial_clinico" },
};

export const METRICAS: MetricaDashboard[] = Object.keys(
  VISIBILIDAD_METRICAS,
) as MetricaDashboard[];
