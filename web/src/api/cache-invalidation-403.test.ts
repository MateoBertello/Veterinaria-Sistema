/**
 * cache-invalidation-403.test.ts
 *
 * RN / Contrato:
 * Al recibir 403 FORBIDDEN (permiso revocado, tenant suspendido), la caché de
 * catálogos comerciales (medios_pago, unidades_medida, servicios) y familias
 * se descarta inmediatamente para que el usuario no siga viendo opciones
 * revocadas en memoria.
 *
 * MUTACIÓN OBLIGATORIA:
 * Si la caché sobrevive a un 403, este test FALLA (en rojo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient, setForbiddenHandler } from "./client.ts";
import {
  listarMediosPago,
  invalidarCacheCatalogosComercial,
} from "./catalogos-comercial.ts";
import {
  listarFamilias,
  invalidarCacheFamilias,
} from "./comercial/productos.ts";
import {
  listarEspecies,
  invalidarCacheCatalogos,
} from "./catalogos.ts";

const fetchMock = vi.fn();

function envelopeOk(data: unknown, meta?: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => (meta !== undefined ? { success: true, data, meta } : { success: true, data }),
    headers: new Headers(),
  };
}

function envelopeError(code: string, statusCode: number, message: string) {
  return {
    ok: false,
    status: statusCode,
    json: async () => ({ success: false, error: { code, statusCode, message, details: [] } }),
    headers: new Headers(),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sb-token", "jwt-tenant-valido");
  invalidarCacheCatalogos();
  invalidarCacheCatalogosComercial();
  invalidarCacheFamilias();

  // Registramos el handler tal como lo hace AuthProvider
  setForbiddenHandler(() => {
    invalidarCacheCatalogos();
    invalidarCacheCatalogosComercial();
    invalidarCacheFamilias();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setForbiddenHandler(null);
  invalidarCacheCatalogos();
  invalidarCacheCatalogosComercial();
  invalidarCacheFamilias();
  localStorage.clear();
});

describe("Invalidación de caché ante 403 FORBIDDEN (Contrato de descarte inmediato)", () => {
  it("un 403 invalida cacheCatalogosComercial: la lectura posterior hace nuevo fetch", async () => {
    // 1. Carga inicial: va a la red y se cachea
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: "mp-1", nombre: "Efectivo" }],
    });

    const primerCarga = await listarMediosPago();
    expect(primerCarga).toEqual([{ id: "mp-1", nombre: "Efectivo" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2. Segunda llamada: debe estar cacheada (no hace fetch)
    const segundaCarga = await listarMediosPago();
    expect(segundaCarga).toEqual([{ id: "mp-1", nombre: "Efectivo" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 3. Ocurre una operación que recibe 403 FORBIDDEN (p. ej. permiso revocado)
    fetchMock.mockResolvedValueOnce(envelopeError("FORBIDDEN", 403, "Permiso revocado"));
    await expect(apiClient("/ventas")).rejects.toMatchObject({ statusCode: 403 });

    // 4. Tercera llamada: la caché NO debe sobrevivir al 403
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: "mp-1", nombre: "Efectivo" }, { id: "mp-2", nombre: "Tarjeta" }],
    });

    const terceraCarga = await listarMediosPago();
    expect(terceraCarga).toHaveLength(2);
    // CRÍTICO PARA MUTACIÓN: si la caché sobrevivió al 403, fetchMock solo se llamó 2 veces (1 inicial + 1 de /ventas).
    // Con la invalidación correcta ante 403, fetchMock se llamó 3 veces (1 inicial + 1 de /ventas + 1 re-fetch).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("un 403 invalida cacheFamilias: la lectura posterior hace nuevo fetch", async () => {
    // 1. Carga inicial de familias
    fetchMock.mockResolvedValueOnce(
      envelopeOk([{ id: "fam-1", nombre: "Farmacia" }], { total: 1, page: 1, limit: 100, totalPages: 1 }),
    );

    const f1 = await listarFamilias({ limit: 100 });
    expect(f1.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2. Segunda lectura: servida desde caché
    const f2 = await listarFamilias({ limit: 100 });
    expect(f2.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 3. Un endpoint devuelve 403 FORBIDDEN
    fetchMock.mockResolvedValueOnce(envelopeError("FORBIDDEN", 403, "Módulo no contratado"));
    await expect(apiClient("/productos")).rejects.toMatchObject({ statusCode: 403 });

    // 4. Tercera lectura de familias: debe hacer nuevo fetch porque la caché fue descartada
    fetchMock.mockResolvedValueOnce(
      envelopeOk([{ id: "fam-1", nombre: "Farmacia" }, { id: "fam-2", nombre: "Cirugía" }], {
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    );

    const f3 = await listarFamilias({ limit: 100 });
    expect(f3.items).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("un 403 invalida también cacheCatalogos clínicos", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: "esp-1", name: "Canino" }],
    });

    await listarEspecies();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await listarEspecies();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 403 en cliente
    fetchMock.mockResolvedValueOnce(envelopeError("FORBIDDEN", 403, "Acceso denegado"));
    await expect(apiClient("/clientes")).rejects.toMatchObject({ statusCode: 403 });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: "esp-1", name: "Canino" }],
    });

    await listarEspecies();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
