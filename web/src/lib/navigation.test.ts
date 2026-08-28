import { describe, it, expect } from "vitest";
import { buildNavItems, groupNavItems } from "./navigation.ts";
import type { ModuloContratado } from "../types/index.ts";

function modulo(over: Partial<ModuloContratado>): ModuloContratado {
  return { modulo: "historial_clinico", habilitado: false, fechaAlta: null, ...over };
}

describe("buildNavItems", () => {
  it("RN-G1: sin módulos ni permisos, devuelve solo los ítems base (Core siempre presente)", () => {
    const items = buildNavItems([]);
    expect(items.map((i) => i.key)).toEqual(["inicio", "clientes", "mascotas"]);
  });

  it("RN-G2: agrega solo los módulos vendibles habilitados", () => {
    const items = buildNavItems([
      modulo({ modulo: "historial_clinico", habilitado: true }),
      modulo({ modulo: "turnos", habilitado: false }),
    ]);
    expect(items.map((i) => i.key)).toEqual(["inicio", "clientes", "mascotas", "historial_clinico"]);
  });

  it("sin permisos, no muestra Servicios ni Configuración", () => {
    const items = buildNavItems([], []);
    expect(items.some((i) => i.key === "servicios")).toBe(false);
    expect(items.some((i) => i.key === "configuracion")).toBe(false);
  });

  it("con manage_services, muestra Servicios pero no Configuración", () => {
    const items = buildNavItems([], ["manage_services"]);
    expect(items.some((i) => i.key === "servicios")).toBe(true);
    expect(items.some((i) => i.key === "configuracion")).toBe(false);
  });

  it("con ambos permisos, muestra Servicios y Configuración", () => {
    const items = buildNavItems([], ["manage_services", "manage_tenant_settings"]);
    const keys = items.map((i) => i.key);
    expect(keys).toContain("servicios");
    expect(keys).toContain("configuracion");
  });

  it("con manage_users, muestra Doctores pero no Horarios", () => {
    const items = buildNavItems([], ["manage_users"]);
    expect(items.some((i) => i.key === "doctores")).toBe(true);
    expect(items.some((i) => i.key === "horarios")).toBe(false);
  });

  it("con manage_users, muestra Usuarios (/usuarios)", () => {
    const items = buildNavItems([], ["manage_users"]);
    const usuarios = items.find((i) => i.key === "usuarios");
    expect(usuarios?.href).toBe("/usuarios");
  });

  it("sin manage_users, oculta Usuarios", () => {
    const items = buildNavItems([], ["manage_services"]);
    expect(items.some((i) => i.key === "usuarios")).toBe(false);
  });

  it("con view_audit, muestra Auditoría (/auditoria)", () => {
    const items = buildNavItems([], ["view_audit"]);
    const auditoria = items.find((i) => i.key === "auditoria");
    expect(auditoria?.href).toBe("/auditoria");
  });

  it("sin view_audit, oculta Auditoría", () => {
    const items = buildNavItems([], ["manage_users"]);
    expect(items.some((i) => i.key === "auditoria")).toBe(false);
  });

  it("con manage_schedules, muestra Horarios pero no Doctores", () => {
    const items = buildNavItems([], ["manage_schedules"]);
    expect(items.some((i) => i.key === "horarios")).toBe(true);
    expect(items.some((i) => i.key === "doctores")).toBe(false);
  });
});

describe("groupNavItems", () => {
  const TODOS_LOS_PERMISOS = [
    "manage_services", "manage_users", "manage_schedules",
    "manage_tenant_settings", "view_audit",
  ];

  function grupos(modulos: ModuloContratado[], permissions: string[] = []) {
    return groupNavItems(buildNavItems(modulos, permissions));
  }

  it("agrupa por naturaleza: principal, clínica, módulos, operación, administración", () => {
    const g = grupos(
      [
        modulo({ modulo: "historial_clinico", habilitado: true }),
        modulo({ modulo: "turnos", habilitado: true }),
        modulo({ modulo: "guarderia", habilitado: true }),
      ],
      TODOS_LOS_PERMISOS,
    );

    expect(g.map((x) => x.key)).toEqual([
      "principal", "clinica", "modulos", "operacion", "administracion",
    ]);
    expect(g.map((x) => x.items.map((i) => i.key))).toEqual([
      ["inicio"],
      ["clientes", "mascotas"],
      ["historial_clinico", "turnos", "guarderia"],
      ["servicios", "doctores", "horarios"],
      ["configuracion", "usuarios", "auditoria"],
    ]);
  });

  it("marca como vendible SOLO al grupo de módulos (los tres del negocio)", () => {
    const g = grupos(
      [modulo({ modulo: "turnos", habilitado: true })],
      TODOS_LOS_PERMISOS,
    );

    const vendibles = g.filter((x) => x.vendible);
    expect(vendibles.map((x) => x.key)).toEqual(["modulos"]);
    expect(vendibles[0].items.every((i) => i.modulo !== undefined)).toBe(true);
  });

  it("el grupo principal no lleva encabezado; los demás sí", () => {
    const g = grupos([], TODOS_LOS_PERMISOS);
    expect(g.find((x) => x.key === "principal")?.label).toBeNull();
    expect(g.filter((x) => x.key !== "principal").every((x) => x.label !== null)).toBe(true);
  });

  it("RN-G2: sin módulos contratados, la sección de módulos no existe (no queda encabezado huérfano)", () => {
    const g = grupos([modulo({ modulo: "turnos", habilitado: false })], TODOS_LOS_PERMISOS);
    expect(g.some((x) => x.key === "modulos")).toBe(false);
  });

  it("sin permisos de administración, esa sección no existe", () => {
    const g = grupos([], ["manage_services"]);
    expect(g.some((x) => x.key === "administracion")).toBe(false);
    expect(g.find((x) => x.key === "operacion")?.items.map((i) => i.key)).toEqual(["servicios"]);
  });

  it("separa Operación de Administración dentro de los ítems por permiso", () => {
    const g = grupos([], ["manage_schedules", "view_audit"]);
    expect(g.find((x) => x.key === "operacion")?.items.map((i) => i.key)).toEqual(["horarios"]);
    expect(g.find((x) => x.key === "administracion")?.items.map((i) => i.key)).toEqual(["auditoria"]);
  });

  it("no filtra nada por su cuenta: devuelve exactamente los ítems que recibió", () => {
    const items = buildNavItems(
      [modulo({ modulo: "guarderia", habilitado: true })],
      TODOS_LOS_PERMISOS,
    );
    const planos = groupNavItems(items).flatMap((x) => x.items);

    expect(planos).toHaveLength(items.length);
    expect(new Set(planos.map((i) => i.key))).toEqual(new Set(items.map((i) => i.key)));
  });

  it("sin ítems, no devuelve grupos", () => {
    expect(groupNavItems([])).toEqual([]);
  });
});
