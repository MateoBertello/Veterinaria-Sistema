import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { consumoRouter } from "../../supabase/functions/api/src/modules/consumo/consumo.controller";
import * as mw from "../../supabase/functions/api/src/shared/middleware";

const app = new Hono();
app.onError((err, c) => {
  console.error("APP ERROR:", err);
  return c.json({ error: { code: err.message || err.code || "UNKNOWN" } }, 500);
});
app.use("*", (c, next) => {
  // Mock context con roles extraídos de los headers
  const rol = c.req.header("X-Rol") || "admin";
  const modulos = c.req.header("X-Modulos") ? c.req.header("X-Modulos")!.split(",") : ["stock", "ventas"];
  
  c.set("ctx", {
    tenantId: "t-1",
    userId: "u-1",
    roles: [rol],
    db: {} as any,
    serviceDb: {} as any,
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    requestId: "req-1",
    modulos
  });
  return next();
});

// Mock middlewares para que usen nuestro mockCtx
vi.mock("../../supabase/functions/api/src/middleware/tenantContext.ts", () => ({ tenantContext: async (c: any, next: any) => next() }));
vi.mock("../../supabase/functions/api/src/middleware/requireActiveTenant.ts", () => ({ requireActiveTenant: async (c: any, next: any) => next() }));
vi.mock("../../supabase/functions/api/src/middleware/requireModule.ts", () => ({
  requireModule: (mod: string) => async (c: any, next: any) => {
    const ctx = c.get("ctx");
    if (!ctx.modulos.includes(mod)) return c.json({ error: { code: "MODULE_NOT_LICENSED" } }, 403);
    return next();
  }
}));
vi.mock("../../supabase/functions/api/src/middleware/requirePermission.ts", () => ({
  requirePermission: (perm: string) => async (c: any, next: any) => {
    const ctx = c.get("ctx");
    const hasPerm = (perm === "view_stock" && ["admin", "veterinario", "recepcionista"].includes(ctx.roles[0])) ||
                    (perm === "consume_stock" && ["admin", "veterinario"].includes(ctx.roles[0]));
    if (!hasPerm) return c.json({ error: { code: "PERMISSION_DENIED" } }, 403);
    return next();
  }
}));

// Ignore old mock code:
/*
  const actual = await importOriginal<any>();
  return {
    ...actual,
    requireModule: (mod: string) => async (c: any, next: any) => {
      const ctx = c.get("ctx");
      if (!ctx.modulos.includes(mod)) {
        return c.json({ error: { code: "MODULE_NOT_LICENSED" } }, 403);
      }
      return next();
    },
    requirePermission: (perm: string) => async (c: any, next: any) => {
      const ctx = c.get("ctx");
      // Asumimos permisos según rol
      const hasPerm = 
        (perm === "view_stock" && ["admin", "veterinario", "recepcionista"].includes(ctx.roles[0])) ||
        (perm === "consume_stock" && ["admin", "veterinario"].includes(ctx.roles[0]));
        
      if (!hasPerm) {
        return c.json({ error: { code: "PERMISSION_DENIED" } }, 403);
      }
      return next();
    },
    requireActiveTenant: async (c: any, next: any) => next(),
*/


// Mock Service
vi.mock("../../supabase/functions/api/src/modules/consumo/consumo.service", () => ({
  ConsumoService: {
    registrar: vi.fn().mockResolvedValue({ data: { operacion_id: "op-1", movimientos: 1, costo_total: 10, advertencias: [] } }),
    porEvento: vi.fn().mockResolvedValue({ data: [] }),
    disponibilidad: vi.fn().mockResolvedValue({ data: [] })
  }
}));

import { ConsumoService } from "../../supabase/functions/api/src/modules/consumo/consumo.service";

app.route("/consumos", consumoRouter);

describe("Consumo Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Matriz rol x endpoint", () => {
    const payload = {
      historialId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      items: [{ productoId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22", cantidad: 1 }]
    };

    it("POST /consumos - admin -> 201", async () => {
      const res = await app.request("/consumos", { method: "POST", headers: { "X-Rol": "admin", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      expect(res.status).toBe(201);
    });
    
    it("POST /consumos - veterinario -> 201", async () => {
      const res = await app.request("/consumos", { method: "POST", headers: { "X-Rol": "veterinario", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      expect(res.status).toBe(201);
    });
    
    it("POST /consumos - recepcionista -> 403", async () => {
      const res = await app.request("/consumos", { method: "POST", headers: { "X-Rol": "recepcionista", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("PERMISSION_DENIED");
    });

    it("POST /consumos - sin módulo stock -> 403", async () => {
      const res = await app.request("/consumos", { method: "POST", headers: { "X-Rol": "admin", "X-Modulos": "ventas", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("MODULE_NOT_LICENSED");
    });
    
    it("GET /consumos/evento/:id - admin -> 200", async () => {
      const res = await app.request("/consumos/evento/h-1", { method: "GET", headers: { "X-Rol": "admin" } });
      expect(res.status).toBe(200);
    });

    it("GET /consumos/evento/:id - veterinario -> 200", async () => {
      const res = await app.request("/consumos/evento/h-1", { method: "GET", headers: { "X-Rol": "veterinario" } });
      expect(res.status).toBe(200);
    });

    it("GET /consumos/evento/:id - recepcionista -> 200", async () => {
      const res = await app.request("/consumos/evento/h-1", { method: "GET", headers: { "X-Rol": "recepcionista" } });
      expect(res.status).toBe(200);
    });

    it("GET /consumos/evento/:id - sin módulo stock -> 403", async () => {
      const res = await app.request("/consumos/evento/h-1", { method: "GET", headers: { "X-Rol": "admin", "X-Modulos": "ventas" } });
      expect(res.status).toBe(403);
    });

    it("GET /consumos/disponibilidad - admin -> 200", async () => {
      const res = await app.request("/consumos/disponibilidad?productoId=p-1", { method: "GET", headers: { "X-Rol": "admin" } });
      expect(res.status).toBe(200);
    });
    
    it("GET /consumos/disponibilidad - veterinario -> 200", async () => {
      const res = await app.request("/consumos/disponibilidad?productoId=p-1", { method: "GET", headers: { "X-Rol": "veterinario" } });
      expect(res.status).toBe(200);
    });
    
    it("GET /consumos/disponibilidad - recepcionista -> 200", async () => {
      const res = await app.request("/consumos/disponibilidad?productoId=p-1", { method: "GET", headers: { "X-Rol": "recepcionista" } });
      expect(res.status).toBe(200);
    });
    
    it("GET /consumos/disponibilidad - sin módulo stock -> 403", async () => {
      const res = await app.request("/consumos/disponibilidad?productoId=p-1", { method: "GET", headers: { "X-Rol": "admin", "X-Modulos": "ventas" } });
      expect(res.status).toBe(403);
    });
  });

  it("RN-SC1: el tenantId del body se ignora", async () => {
    const payload = {
      tenantId: "t-2", // intento inyectar
      historialId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      items: [{ productoId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22", cantidad: 1 }]
    };
    await app.request("/consumos", { method: "POST", headers: { "X-Rol": "admin", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    
    // Service.registrar fue llamado pero NO pasamos tenantId en la llamada ya que lo saca de ctx
    expect(ConsumoService.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t-1" }), 
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", 
      expect.any(Array),
      undefined,
      undefined,
      undefined
    );
  });

  it("no existe ninguna ruta que edite o borre un consumo", async () => {
    const resPut = await app.request("/consumos/1", { method: "PUT" });
    expect(resPut.status).toBe(404);

    const resPatch = await app.request("/consumos/1", { method: "PATCH" });
    expect(resPatch.status).toBe(404);

    const resDelete = await app.request("/consumos/1", { method: "DELETE" });
    expect(resDelete.status).toBe(404);
  });

  it("§10.3: el módulo clínico no quedó modificado", () => {
    // Si tu arnés no puede correr git, escribí el chequeo como un test que verifica que historial.service.ts no contiene registrar_consumo_clinico
    const fs = require("fs");
    const path = require("path");
    
    const historialService = fs.readFileSync(path.join(__dirname, "../../supabase/functions/api/src/modules/historial/historial.service.ts"), "utf-8");
    expect(historialService).not.toContain("registrar_consumo_clinico");
    expect(historialService).not.toContain("movimientos_stock");
  });
});
