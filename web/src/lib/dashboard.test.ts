/**
 * dashboard.ts (lib) — lógica pura del panel de inicio: qué tarjetas se ven,
 * qué accesos rápidos habilita la sesión y los datos de los gráficos.
 */
import { describe, it, expect } from "vitest";
import {
  ACCESOS_RAPIDOS,
  buildAccesosRapidos,
  etiquetaDiaCorto,
  metricasVisibles,
  resumenOcupacionTexto,
  turnosPorEstado,
} from "./dashboard.ts";
import type { ModuloContratado, ResumenDashboard, Turno } from "../types/index.ts";

const TODOS_LOS_MODULOS: ModuloContratado[] = [
  { modulo: "historial_clinico", habilitado: true, fechaAlta: "2026-01-01" },
  { modulo: "turnos",            habilitado: true, fechaAlta: "2026-01-01" },
  { modulo: "guarderia",         habilitado: true, fechaAlta: "2026-01-01" },
];

const TODOS_LOS_PERMISOS = [
  "manage_clients",
  "manage_pets",
  "manage_appointments",
  "manage_daycare",
  "view_medical_history",
  "manage_users",
  "view_audit",
];

function resumen(over: Partial<ResumenDashboard> = {}): ResumenDashboard {
  return {
    fecha:              "2026-07-25",
    clientes:           12,
    mascotasActivas:    30,
    turnosHoy:          4,
    estadiasHoy:        2,
    vacunasProximas30d: 7,
    ...over,
  };
}

function turno(status: Turno["status"], id: string): Turno {
  return {
    id,
    date: "2026-07-25",
    startTime: "09:00",
    endTime: "09:30",
    status,
    reason: "Control",
    notes: null,
    cancellationReason: null,
    cancelledAt: null,
    servicio: null,
    doctor: null,
    mascota: null,
    cliente: null,
    accionesDisponibles: [],
    vencido: false,
  };
}

describe("metricasVisibles", () => {
  it("devuelve una tarjeta por métrica numérica, en el orden del catálogo", () => {
    const metricas = metricasVisibles(resumen());

    expect(metricas.map((m) => m.key)).toEqual([
      "clientes",
      "mascotasActivas",
      "turnosHoy",
      "estadiasHoy",
      "vacunasProximas30d",
    ]);
    expect(metricas[0]?.valor).toBe(12);
    expect(metricas[0]?.href).toBe("/clientes");
  });

  it("oculta las métricas en null (sin permiso o módulo no licenciado)", () => {
    const metricas = metricasVisibles(
      resumen({ turnosHoy: null, estadiasHoy: null, vacunasProximas30d: null }),
    );

    expect(metricas.map((m) => m.key)).toEqual(["clientes", "mascotasActivas"]);
  });

  it("una métrica en 0 SÍ se muestra: cero es un dato, null es ausencia", () => {
    const metricas = metricasVisibles(resumen({ turnosHoy: 0 }));

    expect(metricas.find((m) => m.key === "turnosHoy")?.valor).toBe(0);
  });

  it("sin resumen (todavía cargando o error) no hay tarjetas", () => {
    expect(metricasVisibles(null)).toEqual([]);
  });
});

describe("buildAccesosRapidos", () => {
  it("con todos los permisos y módulos habilitados devuelve el catálogo completo", () => {
    const accesos = buildAccesosRapidos(TODOS_LOS_PERMISOS, TODOS_LOS_MODULOS);

    expect(accesos).toHaveLength(ACCESOS_RAPIDOS.length);
    expect(accesos.map((a) => a.key)).toContain("turno");
    expect(accesos.map((a) => a.key)).toContain("auditoria");
  });

  it("RN-S2: oculta los accesos cuyo permiso no tiene el rol", () => {
    const accesos = buildAccesosRapidos(["manage_pets"], TODOS_LOS_MODULOS);

    expect(accesos.map((a) => a.key)).toEqual(["mascotas"]);
  });

  it("RN-G2: oculta los accesos de un módulo no habilitado aunque tenga el permiso", () => {
    const modulos: ModuloContratado[] = TODOS_LOS_MODULOS.map((m) =>
      m.modulo === "turnos" ? { ...m, habilitado: false } : m,
    );

    const accesos = buildAccesosRapidos(TODOS_LOS_PERMISOS, modulos);

    expect(accesos.map((a) => a.key)).not.toContain("turno");
    expect(accesos.map((a) => a.key)).toContain("estadia");
  });

  it("sin módulos (o si falló su carga) quedan solo los accesos core", () => {
    const accesos = buildAccesosRapidos(TODOS_LOS_PERMISOS, []);

    expect(accesos.map((a) => a.key)).toEqual(["clientes", "mascotas", "usuarios", "auditoria"]);
  });

  it("agrega la consola de plataforma solo con sesión de super admin", () => {
    const conSA  = buildAccesosRapidos([], [], { superAdmin: true });
    const sinSA  = buildAccesosRapidos([], [], { superAdmin: false });

    expect(conSA.map((a) => a.key)).toEqual(["admin"]);
    expect(conSA[0]?.href).toBe("/admin");
    expect(sinSA).toEqual([]);
  });

  it("un rol sin permisos ni módulos no recibe accesos", () => {
    expect(buildAccesosRapidos([], TODOS_LOS_MODULOS)).toEqual([]);
  });
});

describe("turnosPorEstado", () => {
  it("cuenta por estado en el orden del ciclo de vida", () => {
    const datos = turnosPorEstado([
      turno("Confirmado", "1"),
      turno("Programado", "2"),
      turno("Confirmado", "3"),
    ]);

    expect(datos).toEqual([
      { estado: "Programado", cantidad: 1 },
      { estado: "Confirmado", cantidad: 2 },
    ]);
  });

  it("omite los estados sin turnos y devuelve vacío si no hay ninguno", () => {
    expect(turnosPorEstado([turno("Completado", "1")])).toEqual([
      { estado: "Completado", cantidad: 1 },
    ]);
    expect(turnosPorEstado([])).toEqual([]);
  });
});

describe("etiquetas y texto alternativo de los gráficos", () => {
  it("etiquetaDiaCorto formatea el día en UTC (sin corrimiento de zona)", () => {
    // 2026-07-25 es sábado.
    expect(etiquetaDiaCorto("2026-07-25").toLowerCase()).toContain("25");
  });

  it("resumenOcupacionTexto describe cada día como ocupados de cupo", () => {
    const texto = resumenOcupacionTexto([
      { date: "2026-07-25", ocupados: 3, cupo: 10 },
      { date: "2026-07-26", ocupados: 0, cupo: 10 },
    ]);

    expect(texto).toContain("3 de 10");
    expect(texto).toContain("0 de 10");
  });

  it("resumenOcupacionTexto sin días avisa que no hay datos", () => {
    expect(resumenOcupacionTexto([])).toBe("Sin datos de ocupación.");
  });
});
