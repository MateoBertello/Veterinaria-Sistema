import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { getDb } from "../../shared/db.ts";
import { getUserPermissions } from "../../middleware/requirePermission.ts";
import { ModuloService } from "../modulos/modulos.service.ts";
import {
  METRICAS,
  VENTANA_VACUNAS_DIAS,
  VISIBILIDAD_METRICAS,
  type MetricaDashboard,
  type ResumenDashboard,
} from "./dashboard.schemas.ts";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  /** Header Authorization del request: la lectura va con el JWT del usuario (RLS activo). */
  authHeader:   string;
}

// ─── Helpers de fecha ────────────────────────────────────────────────────────
// Misma convención que el resto del backend (turnos, guardería, vacunación):
// la fecha de negocio es el día ISO en UTC.

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sumarDiasISO(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ─── Conteo agregado ─────────────────────────────────────────────────────────

/** Resultado de un COUNT de PostgREST (sin filas: `head: true`). */
interface CountResult {
  count: number | null;
  error: { message: string } | null;
}

/**
 * Subconjunto tipado del query builder de PostgREST que usan los filtros de
 * conteo. Se declara acá para no depender del tipo interno de postgrest-js
 * (que no está en el import map de la Edge Function).
 */
interface CountQuery extends PromiseLike<CountResult> {
  eq(column: string, value: unknown): CountQuery;
  neq(column: string, value: unknown): CountQuery;
  in(column: string, values: readonly unknown[]): CountQuery;
  gte(column: string, value: unknown): CountQuery;
  lte(column: string, value: unknown): CountQuery;
}

type Filtro = (q: CountQuery) => CountQuery;

/**
 * COUNT(*) agregado de una tabla del tenant.
 *
 * `head: true` ⇒ PostgreSQL cuenta y PostgREST responde sin cuerpo: no viaja ni
 * una fila. El filtro por `tenant_id` es explícito además de la RLS (defensa en
 * profundidad y uso del índice `(tenant_id, …)`).
 */
async function contar(
  db: SupabaseClient,
  tabla: string,
  tenantId: string,
  filtrar: Filtro,
): Promise<number> {
  const base = db
    .from(tabla)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId) as unknown as CountQuery;

  const { count, error } = await filtrar(base);

  if (error) {
    throw new DomainError(
      ErrorCode.INTERNAL_ERROR,
      500,
      `Error al calcular métricas de ${tabla}: ${error.message}`,
    );
  }

  return count ?? 0;
}

// ─── DashboardService ────────────────────────────────────────────────────────

export const DashboardService = {
  /**
   * Resumen agregado del tenant para el dashboard.
   *
   * Coste fijo, independiente del volumen de datos: 1 consulta de permisos +
   * 1 de módulos contratados (solo si hace falta) + 1 COUNT por métrica visible,
   * todas en paralelo. NO se listan filas para contarlas en memoria (prohibido
   * el patrón N+1).
   *
   * Cada métrica se sirve solo si el usuario tiene el permiso del endpoint dueño
   * del dato (RN-S2) y, para módulos vendibles, si el tenant los tiene licenciados
   * (regla 4). Lo que no puede ver vuelve como `null`.
   */
  async resumen(ctx: CallerContext): Promise<ResumenDashboard> {
    const permisos = await getUserPermissions(ctx.callerUserId, ctx.authHeader);

    const conPermiso = METRICAS.filter((m) =>
      permisos.has(VISIBILIDAD_METRICAS[m].permiso),
    );

    // Los módulos se consultan UNA vez (no una por métrica) y solo si alguna
    // métrica permitida depende de un módulo vendible.
    const necesitaModulos = conPermiso.some((m) => VISIBILIDAD_METRICAS[m].modulo);
    const habilitados = necesitaModulos
      ? new Set(
          (await ModuloService.habilitadosDelTenant(ctx.tenantId, ctx.authHeader))
            .filter((m) => m.habilitado)
            .map((m) => m.modulo),
        )
      : new Set<string>();

    const visibles = conPermiso.filter((m) => {
      const modulo = VISIBILIDAD_METRICAS[m].modulo;
      return !modulo || habilitados.has(modulo);
    });

    const fecha = hoyISO();
    const db    = getDb(ctx.authHeader);

    const valores = await Promise.all(
      visibles.map(async (metrica) => [
        metrica,
        await contarMetrica(db, metrica, ctx.tenantId, fecha),
      ] as const),
    );

    const resumen: ResumenDashboard = {
      fecha,
      clientes:           null,
      mascotasActivas:    null,
      turnosHoy:          null,
      estadiasHoy:        null,
      vacunasProximas30d: null,
    };

    for (const [metrica, valor] of valores) {
      resumen[metrica] = valor;
    }

    return resumen;
  },
};

/** Consulta agregada de cada métrica. Una sola query por métrica. */
function contarMetrica(
  db: SupabaseClient,
  metrica: MetricaDashboard,
  tenantId: string,
  hoy: string,
): Promise<number> {
  switch (metrica) {
    // RN-CL8: la baja de clientes es lógica; los eliminados no cuentan.
    case "clientes":
      return contar(db, "clientes", tenantId, (q) => q.eq("deleted", false));

    // Solo mascotas vivas: excluye 'Fallecida' (RN-MF/RN-EC) y eliminadas.
    case "mascotasActivas":
      return contar(db, "mascotas", tenantId, (q) =>
        q.eq("deleted", false).eq("estado", "Activa"),
      );

    // Turnos del día excluyendo cancelados: incluye 'Completado' a propósito,
    // para que la tarjeta no se vacíe a medida que avanza la jornada.
    case "turnosHoy":
      return contar(db, "turnos", tenantId, (q) =>
        q.eq("date", hoy).neq("status", "Cancelado"),
      );

    // Ocupación de hoy: mismo criterio que GET /estadias/cupo (rango inclusivo,
    // estadías vigentes).
    case "estadiasHoy":
      return contar(db, "estadias", tenantId, (q) =>
        q
          .in("status", ["Reservada", "EnCurso"])
          .lte("check_in_date", hoy)
          .gte("check_out_date", hoy),
      );

    // Dosis pendientes en los próximos 30 días (no incluye vencidas: eso es
    // trabajo atrasado, no agenda próxima).
    case "vacunasProximas30d":
      return contar(db, "plan_vacunacion", tenantId, (q) =>
        q
          .eq("estado", "Pendiente")
          .gte("fecha_estimada", hoy)
          .lte("fecha_estimada", sumarDiasISO(hoy, VENTANA_VACUNAS_DIAS)),
      );
  }
}
