import { describe, it, expect } from "vitest";
import { buildNavItems } from "./navigation.ts";
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
