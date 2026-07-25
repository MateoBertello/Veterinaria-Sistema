/**
 * usuarios.ts — cliente API contra el envelope estándar (mock de fetch).
 * Verifica URL/método/body de cada endpoint, el desempaquetado de data+meta y el
 * mapeo snake→camel del catálogo de roles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listarUsuarios, crearUsuario, editarUsuario, listarRoles } from "./usuarios.ts";
import type { CrearUsuarioInput } from "../types/index.ts";

const fetchMock = vi.fn();

function envelope(data: unknown, meta?: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => (meta ? { success: true, data, meta } : { success: true, data }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sb-token", "jwt-de-prueba");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("listarUsuarios", () => {
  it("pide /usuarios con page/limit y Bearer, y desempaqueta items + meta", async () => {
    fetchMock.mockResolvedValue(
      envelope(
        [{ id: "u1", username: "ana", email: "a@x.com", fullName: "Ana", phone: null, active: true, rolId: "r1", rolName: "Administrador", createdAt: "2026-01-01" }],
        { page: 2, limit: 20, total: 25 },
      ),
    );

    const { items, meta } = await listarUsuarios({ page: 2, limit: 20 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/usuarios?page=2&limit=20");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer jwt-de-prueba");
    expect(items).toHaveLength(1);
    expect(items[0]?.username).toBe("ana");
    expect(meta).toEqual({ page: 2, limit: 20, total: 25 });
  });

  it("sin parámetros pide /usuarios sin query string", async () => {
    fetchMock.mockResolvedValue(envelope([], { page: 1, limit: 20, total: 0 }));

    await listarUsuarios();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/usuarios");
  });
});

describe("crearUsuario", () => {
  it("hace POST con el body JSON y devuelve el usuario creado", async () => {
    const input: CrearUsuarioInput = {
      username: "nuevo",
      password: "12345678",
      fullName: "Nuevo Usuario",
      email: "n@x.com",
      roleId: "11111111-1111-1111-1111-111111111111",
    };
    fetchMock.mockResolvedValue(envelope({ id: "u9", username: "nuevo", rolName: "Recepcionista" }));

    const creado = await crearUsuario(input);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/usuarios");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(creado.id).toBe("u9");
  });
});

describe("editarUsuario", () => {
  it("hace PUT a /usuarios/:id con el body parcial", async () => {
    fetchMock.mockResolvedValue(envelope({ id: "u1", active: false }));

    await editarUsuario("u1", { active: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/usuarios/u1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ active: false });
  });
});

describe("listarRoles", () => {
  it("mapea snake→camel (display_name → displayName) del catálogo", async () => {
    fetchMock.mockResolvedValue(
      envelope([
        { id: "r1", name: "admin", display_name: "Administrador", description: "Acceso total" },
        { id: "r2", name: "veterinario", display_name: "Veterinario", description: null },
      ]),
    );

    const roles = await listarRoles();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/usuarios/roles");
    expect(roles[0]).toEqual({ id: "r1", name: "admin", displayName: "Administrador", description: "Acceso total" });
    expect(roles[1]?.displayName).toBe("Veterinario");
    expect(roles[1]?.description).toBeNull();
  });
});
