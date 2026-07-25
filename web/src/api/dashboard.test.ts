/**
 * dashboard.ts — cliente del resumen de métricas (mock de fetch).
 * Verifica la URL, el Bearer, el desempaquetado del envelope y que los `null`
 * del backend (métrica no visible) lleguen intactos, sin convertirse en 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { obtenerResumenDashboard } from "./dashboard.ts";
import { ApiError } from "../types/index.ts";

const fetchMock = vi.fn();

const RESUMEN = {
  fecha:              "2026-07-25",
  clientes:           12,
  mascotasActivas:    30,
  turnosHoy:          4,
  estadiasHoy:        2,
  vacunasProximas30d: 7,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sb-token", "jwt-de-prueba");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("obtenerResumenDashboard", () => {
  it("pide /dashboard/resumen con el Bearer y devuelve la data del envelope", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: RESUMEN }),
    });

    const resumen = await obtenerResumenDashboard();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/dashboard/resumen");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer jwt-de-prueba");
    expect(resumen).toEqual(RESUMEN);
  });

  it("conserva los null de las métricas no visibles (no los convierte en 0)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { ...RESUMEN, turnosHoy: null, estadiasHoy: null, vacunasProximas30d: null },
      }),
    });

    const resumen = await obtenerResumenDashboard();

    expect(resumen.turnosHoy).toBeNull();
    expect(resumen.estadiasHoy).toBeNull();
    expect(resumen.clientes).toBe(12);
  });

  it("una métrica en 0 llega como 0 (es un dato, no ausencia)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { ...RESUMEN, turnosHoy: 0 } }),
    });

    expect((await obtenerResumenDashboard()).turnosHoy).toBe(0);
  });

  it("un error del envelope se propaga como ApiError con su code", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: { code: "TENANT_SUSPENDED", message: "La clínica está suspendida.", statusCode: 403, details: [] },
      }),
    });

    await expect(obtenerResumenDashboard()).rejects.toMatchObject({
      code: "TENANT_SUSPENDED",
      statusCode: 403,
    });
    await expect(obtenerResumenDashboard()).rejects.toBeInstanceOf(ApiError);
  });
});
