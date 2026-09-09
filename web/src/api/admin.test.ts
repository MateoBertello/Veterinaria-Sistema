/**
 * admin.ts — cliente de la consola Super Admin contra el envelope estándar
 * (mock de fetch). Verifica URL/método/body de cada endpoint, el armado de la
 * query de filtros y la propagación de los errores de plataforma.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cambiarEstadoTenant,
  crearTenant,
  editarTenant,
  listarModulosTenant,
  listarTenants,
  obtenerTenant,
  setModuloTenant,
} from "./admin.ts";
import { ApiError, type CrearTenantInput } from "../types/index.ts";

const fetchMock = vi.fn();

function envelope(data: unknown, meta?: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => (meta ? { success: true, data, meta } : { success: true, data }),
  };
}

function envelopeError(code: string, statusCode: number, message: string) {
  return {
    ok: false,
    status: statusCode,
    json: async () => ({ success: false, error: { code, statusCode, message, details: [] } }),
  };
}

const TENANT = {
  id: "t-1",
  nombre: "Veterinaria San Roque",
  cuitRut: "30-71234567-8",
  emailContacto: "contacto@sanroque.vet",
  plan: "profesional",
  activo: true,
  adminInvitado: true,
  createdAt: "2026-06-09T12:00:00Z",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // La consola viaja con el token de PLATAFORMA, no con el de la clínica.
  localStorage.setItem("sb-platform-token", "jwt-super-admin");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("listarTenants", () => {
  it("pide /admin/tenants con page/limit + filtros y desempaqueta items + meta", async () => {
    fetchMock.mockResolvedValue(envelope([TENANT], { page: 2, limit: 20, total: 25 }));

    const { items, meta } = await listarTenants({
      page: 2,
      limit: 20,
      q: "roque",
      plan: "profesional",
      estado: "activo",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/tenants?page=2&limit=20&q=roque&plan=profesional&estado=activo");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer jwt-super-admin");
    expect(items).toHaveLength(1);
    expect(items[0]?.nombre).toBe("Veterinaria San Roque");
    expect(meta).toEqual({ page: 2, limit: 20, total: 25 });
  });

  it("usa el token de plataforma aunque haya una sesión de tenant abierta", async () => {
    // Las dos sesiones conviven en el mismo browser. Si /admin/* saliera con el
    // token de la clínica, el backend respondería 403 (no acredita super_admin)
    // y la consola sería inusable para quien además tenga sesión de tenant.
    localStorage.setItem("sb-token", "jwt-de-la-clinica");
    fetchMock.mockResolvedValue(envelope([], { page: 1, limit: 20, total: 0 }));

    await listarTenants();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer jwt-super-admin");
  });

  it("sin parámetros pide /admin/tenants sin query string", async () => {
    fetchMock.mockResolvedValue(envelope([], { page: 1, limit: 20, total: 0 }));

    await listarTenants();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/admin/tenants");
  });

  it("un no-super-admin recibe 403 FORBIDDEN como ApiError", async () => {
    fetchMock.mockResolvedValue(
      envelopeError("FORBIDDEN", 403, "Se requiere rol de Super Admin de plataforma"),
    );

    await expect(listarTenants()).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });
});

describe("obtenerTenant", () => {
  it("pide el detalle por id", async () => {
    fetchMock.mockResolvedValue(envelope(TENANT));

    const tenant = await obtenerTenant("t-1");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/admin/tenants/t-1");
    expect(tenant.cuitRut).toBe("30-71234567-8");
  });
});

describe("crearTenant", () => {
  it("hace POST con el body del CrearTenantSchema", async () => {
    const input: CrearTenantInput = {
      nombre: "Veterinaria Nueva",
      cuitRut: "30-99999999-9",
      emailContacto: "hola@nueva.vet",
      plan: "basico",
    };
    fetchMock.mockResolvedValue(envelope({ ...TENANT, ...input, id: "t-9" }));

    const creado = await crearTenant(input);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/tenants");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(creado.id).toBe("t-9");
  });

  it("CUIT/RUT duplicado → 409 TENANT_DUPLICATE_TAXID (RN-SA1)", async () => {
    fetchMock.mockResolvedValue(
      envelopeError("TENANT_DUPLICATE_TAXID", 409, "Ya existe una clínica con ese CUIT/RUT"),
    );

    await expect(
      crearTenant({ nombre: "Dup", cuitRut: "30-71234567-8", emailContacto: "d@x.vet", plan: "basico" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("editarTenant", () => {
  it("hace PUT a /admin/tenants/:id con el body parcial", async () => {
    fetchMock.mockResolvedValue(envelope({ ...TENANT, plan: "premium" }));

    await editarTenant("t-1", { plan: "premium" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/tenants/t-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ plan: "premium" });
  });
});

describe("cambiarEstadoTenant", () => {
  it("hace PATCH a /estado con { activo }", async () => {
    fetchMock.mockResolvedValue(envelope({ ...TENANT, activo: false }));

    const tenant = await cambiarEstadoTenant("t-1", false);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/tenants/t-1/estado");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ activo: false });
    expect(tenant.activo).toBe(false);
  });
});

describe("módulos del tenant", () => {
  it("listarModulosTenant pide el estado de los módulos vendibles", async () => {
    fetchMock.mockResolvedValue(
      envelope([
        { modulo: "historial_clinico", habilitado: true, fechaAlta: "2026-06-09" },
        { modulo: "turnos", habilitado: false, fechaAlta: null },
      ]),
    );

    const modulos = await listarModulosTenant("t-1");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/admin/tenants/t-1/modulos");
    expect(modulos).toHaveLength(2);
    expect(modulos[1]).toEqual({ modulo: "turnos", habilitado: false, fechaAlta: null });
  });

  it("setModuloTenant hace PUT al módulo con { habilitado }", async () => {
    fetchMock.mockResolvedValue(envelope({ modulo: "guarderia", habilitado: true, fechaAlta: "2026-07-25" }));

    const modulo = await setModuloTenant("t-1", "guarderia", true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/tenants/t-1/modulos/guarderia");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ habilitado: true });
    expect(modulo.habilitado).toBe(true);
  });

  it("módulo desconocido → 422 MODULE_UNKNOWN", async () => {
    fetchMock.mockResolvedValue(envelopeError("MODULE_UNKNOWN", 422, "Módulo desconocido"));

    await expect(
      setModuloTenant("t-1", "inexistente" as never, true),
    ).rejects.toMatchObject({ code: "MODULE_UNKNOWN", statusCode: 422 });
  });
});
