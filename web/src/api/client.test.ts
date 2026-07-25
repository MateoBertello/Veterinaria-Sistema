/**
 * client.ts — contrato del cliente HTTP frente a respuestas que NO son el
 * envelope estándar.
 *
 * Origen: el panel de inicio mostraba "error inesperado" contra una API
 * desplegada sin la ruta /dashboard. El 404 de Hono viene en texto plano, así
 * que `response.json()` tiraba un SyntaxError crudo —no un ApiError— y la
 * pantalla perdía el único dato útil: el status.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient, apiClientBlob, setUnauthorizedHandler } from "./client.ts";
import { ApiError } from "../types/index.ts";

const fetchMock = vi.fn();

/** Respuesta con cuerpo que NO es JSON (404 de ruta, HTML de un proxy, …). */
function textoPlano(status: number, texto: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new SyntaxError(`Unexpected token '${texto[0]}'`); },
    blob: async () => new Blob([texto]),
    headers: new Headers(),
  };
}

function envelope(data: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: async () => ({ success: true, data }),
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
  localStorage.setItem("sb-token", "jwt-de-prueba");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  localStorage.clear();
});

describe("apiClient — respuestas fuera del contrato", () => {
  it("404 en texto plano (ruta que la API desplegada no tiene) → ApiError con el status", async () => {
    fetchMock.mockResolvedValue(textoPlano(404, "404 Not Found"));

    const error = await apiClient("/dashboard/resumen").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", statusCode: 404 });
    expect((error as ApiError).message).toMatch(/no reconoce este endpoint/i);
  });

  it("5xx del gateway sin envelope → mensaje con el status, no un SyntaxError", async () => {
    fetchMock.mockResolvedValue(textoPlano(502, "<html>Bad Gateway</html>"));

    const error = await apiClient("/clientes").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", statusCode: 502 });
    expect((error as ApiError).message).toMatch(/HTTP 502/);
  });

  it("JSON válido que no es el envelope tampoco pasa por bueno", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ mensaje: "algo" }),
      headers: new Headers(),
    });

    await expect(apiClient("/clientes")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("un 401 sin envelope igual cierra la sesión (lo corta el gateway, no la API)", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(textoPlano(401, "Unauthorized"));

    await expect(apiClient("/clientes")).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).toHaveBeenCalled();
  });

  it("sin token, un 401 sin envelope NO dispara el auto-logout", async () => {
    localStorage.clear();
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(textoPlano(401, "Unauthorized"));

    await expect(apiClient("/auth/login")).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("apiClient — contrato normal (no se rompió)", () => {
  it("éxito: devuelve data", async () => {
    fetchMock.mockResolvedValue(envelope({ id: "c-1" }));

    await expect(apiClient<{ id: string }>("/clientes/c-1")).resolves.toEqual({ id: "c-1" });
  });

  it("error de negocio: preserva code, statusCode y message del envelope", async () => {
    fetchMock.mockResolvedValue(envelopeError("CLIENT_HAS_PETS", 409, "El cliente tiene mascotas"));

    await expect(apiClient("/clientes/c-1")).rejects.toMatchObject({
      code: "CLIENT_HAS_PETS",
      statusCode: 409,
      message: "El cliente tiene mascotas",
    });
  });

  it("fallo de red: NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiClient("/clientes")).rejects.toMatchObject({ code: "NETWORK_ERROR", statusCode: 0 });
  });
});

describe("apiClientBlob — respuestas fuera del contrato", () => {
  it("404 en texto plano → ApiError con el status (no SyntaxError)", async () => {
    fetchMock.mockResolvedValue(textoPlano(404, "404 Not Found"));

    await expect(apiClientBlob("/auditoria/export")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      statusCode: 404,
    });
  });

  it("error con envelope: preserva el código del backend", async () => {
    fetchMock.mockResolvedValue(envelopeError("FORBIDDEN", 403, "Sin permiso"));

    await expect(apiClientBlob("/auditoria/export")).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("éxito: devuelve blob, filename y headers", async () => {
    const headers = new Headers({
      "Content-Disposition": 'attachment; filename="auditoria.csv"',
      "X-Export-Truncated": "true",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["a,b"]),
      headers,
    });

    const { filename, headers: recibidos } = await apiClientBlob("/auditoria/export");

    expect(filename).toBe("auditoria.csv");
    expect(recibidos.get("X-Export-Truncated")).toBe("true");
  });
});
