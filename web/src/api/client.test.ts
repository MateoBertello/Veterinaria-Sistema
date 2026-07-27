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

// ─────────────────────────────────────────────────────────────────────────────
// Renovación automática de sesión ante 401
// ─────────────────────────────────────────────────────────────────────────────
// El access token dura una hora: sin renovación, vencía en medio de cualquier
// pantalla y tiraba al usuario a /login perdiendo lo que estuviera cargando.

describe("client.ts — refresh automático ante 401", () => {
  beforeEach(() => {
    localStorage.setItem("sb-refresh-token", "refresh-viejo");
  });

  it("renueva la sesión y reintenta el request una sola vez", async () => {
    const alExpirar = vi.fn();
    setUnauthorizedHandler(alExpirar);

    fetchMock
      .mockResolvedValueOnce(envelopeError("UNAUTHORIZED", 401, "Token vencido"))
      .mockResolvedValueOnce(envelope({ token: "jwt-nuevo", refreshToken: "refresh-nuevo" }))
      .mockResolvedValueOnce(envelope([{ id: "c1" }]));

    await expect(apiClient("/clientes")).resolves.toEqual([{ id: "c1" }]);

    expect(fetchMock.mock.calls[1]?.[0]).toContain("/auth/refresh");
    // El par rotado queda guardado: GoTrue invalida el refresh token usado.
    expect(localStorage.getItem("sb-token")).toBe("jwt-nuevo");
    expect(localStorage.getItem("sb-refresh-token")).toBe("refresh-nuevo");
    // La sesión no se cerró.
    expect(alExpirar).not.toHaveBeenCalled();
  });

  it("si el refresh falla, cierra la sesión y propaga el 401", async () => {
    const alExpirar = vi.fn();
    setUnauthorizedHandler(alExpirar);

    fetchMock
      .mockResolvedValueOnce(envelopeError("UNAUTHORIZED", 401, "Token vencido"))
      .mockResolvedValueOnce(envelopeError("UNAUTHORIZED", 401, "Refresh inválido"));

    await expect(apiClient("/clientes")).rejects.toBeInstanceOf(ApiError);
    expect(alExpirar).toHaveBeenCalledTimes(1);
  });

  it("no intenta renovar el 401 del propio login (son credenciales mal)", async () => {
    fetchMock.mockResolvedValueOnce(envelopeError("UNAUTHORIZED", 401, "Credenciales inválidas"));

    await expect(
      apiClient("/auth/login", { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("varios 401 en paralelo disparan UN solo refresh", async () => {
    // Al volver a una pestaña dormida vencen varios requests a la vez; si cada
    // uno renovara por su cuenta, se pisarían el refresh token rotado.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return Promise.resolve(envelope({ token: "jwt-nuevo", refreshToken: "refresh-nuevo" }));
      }
      if (localStorage.getItem("sb-token") === "jwt-nuevo") {
        return Promise.resolve(envelope([]));
      }
      return Promise.resolve(envelopeError("UNAUTHORIZED", 401, "Token vencido"));
    });

    await Promise.all([apiClient("/clientes"), apiClient("/mascotas"), apiClient("/turnos")]);

    const refrescos = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refrescos).toHaveLength(1);
  });

  it("sin refresh token guardado, cierra la sesión directamente", async () => {
    localStorage.removeItem("sb-refresh-token");
    const alExpirar = vi.fn();
    setUnauthorizedHandler(alExpirar);

    fetchMock.mockResolvedValueOnce(envelopeError("UNAUTHORIZED", 401, "Token vencido"));

    await expect(apiClient("/clientes")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(alExpirar).toHaveBeenCalledTimes(1);
  });
});
