import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { montarPerezoso } from "../../supabase/functions/api/src/shared/lazyRoute.ts";
import { DomainError, ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

function appBase() {
  return new Hono().basePath("/api/v1");
}

describe("montarPerezoso — carga diferida de controllers", () => {
  it("no evalúa el módulo hasta que llega un request a su prefijo", async () => {
    const cargar = vi.fn(async () => {
      const r = new Hono();
      r.get("/", (c) => c.json({ ok: true }));
      return [r];
    });

    const app = appBase();
    montarPerezoso(app, "/turnos", cargar);

    // Montar no debe costar nada: ese es el punto de todo el cambio.
    expect(cargar).not.toHaveBeenCalled();

    await app.fetch(new Request("http://localhost/api/v1/turnos"));
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it("un request a otro prefijo no evalúa el módulo", async () => {
    const cargar = vi.fn(async () => [new Hono()]);
    const app = appBase();
    montarPerezoso(app, "/turnos", cargar);
    montarPerezoso(app, "/clientes", async () => {
      const r = new Hono();
      r.get("/", (c) => c.json({ ok: true }));
      return [r];
    });

    await app.fetch(new Request("http://localhost/api/v1/clientes"));
    expect(cargar).not.toHaveBeenCalled();
  });

  it("evalúa el módulo una sola vez aunque lleguen varios requests", async () => {
    const cargar = vi.fn(async () => {
      const r = new Hono();
      r.get("/", (c) => c.json({ ok: true }));
      return [r];
    });
    const app = appBase();
    montarPerezoso(app, "/turnos", cargar);

    await app.fetch(new Request("http://localhost/api/v1/turnos"));
    await app.fetch(new Request("http://localhost/api/v1/turnos"));
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  // ── Lo que la delegación no puede romper ───────────────────────────────────

  it("entrega el cuerpo de un POST intacto al router delegado", async () => {
    const app = appBase();
    montarPerezoso(app, "/turnos", async () => {
      const r = new Hono();
      r.post("/", async (c) => c.json({ recibido: await c.req.json() }));
      return [r];
    });

    const res = await app.fetch(new Request("http://localhost/api/v1/turnos", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ mascotaId: "m-1", motivo: "control" }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recibido: { mascotaId: "m-1", motivo: "control" } });
  });

  it("conserva los parámetros de ruta y el query string", async () => {
    const app = appBase();
    montarPerezoso(app, "/turnos", async () => {
      const r = new Hono();
      r.get("/:id", (c) => c.json({ id: c.req.param("id"), q: c.req.query("desde") }));
      return [r];
    });

    const res = await app.fetch(new Request("http://localhost/api/v1/turnos/t-9?desde=2026-01-01"));
    expect(await res.json()).toEqual({ id: "t-9", q: "2026-01-01" });
  });

  it("monta varios routers aditivos en el mismo prefijo, en orden", async () => {
    const app = appBase();
    montarPerezoso(app, "/mascotas", async () => {
      const abm = new Hono();
      abm.get("/:id", (c) => c.json({ router: "abm", id: c.req.param("id") }));
      const historial = new Hono();
      historial.get("/:id/historial", (c) => c.json({ router: "historial" }));
      return [abm, historial];
    });

    expect(await (await app.fetch(new Request("http://localhost/api/v1/mascotas/m-1"))).json())
      .toEqual({ router: "abm", id: "m-1" });
    expect(await (await app.fetch(new Request("http://localhost/api/v1/mascotas/m-1/historial"))).json())
      .toEqual({ router: "historial" });
  });

  /**
   * Precedencia histórica: /turnos/notificaciones se monta antes que /turnos, y
   * con `app.route()` una ruta que no existía en el primero seguía buscándose en
   * el segundo porque todo terminaba aplanado en un router. La delegación tiene
   * que devolver el control explícitamente para conservarlo.
   */
  it("cae al prefijo siguiente cuando el primero no tiene la ruta", async () => {
    const app = appBase();
    montarPerezoso(app, "/turnos/notificaciones", async () => {
      const r = new Hono();
      r.get("/pendientes", (c) => c.json({ router: "notificaciones" }));
      return [r];
    });
    montarPerezoso(app, "/turnos", async () => {
      const r = new Hono();
      r.get("/:id", (c) => c.json({ router: "turnos", id: c.req.param("id") }));
      return [r];
    });

    expect(await (await app.fetch(new Request("http://localhost/api/v1/turnos/notificaciones/pendientes"))).json())
      .toEqual({ router: "notificaciones" });
    // No existe en notificaciones: tiene que resolverlo el router de turnos.
    expect(await (await app.fetch(new Request("http://localhost/api/v1/turnos/notificaciones"))).json())
      .toEqual({ router: "turnos", id: "notificaciones" });
  });

  /**
   * El caso que hace peligrosa la caída en cascada: un 404 de NEGOCIO (la mascota
   * no existe) es una respuesta final con envelope, y no puede confundirse con
   * "este prefijo no tiene la ruta". Si se confundieran, el cliente recibiría el
   * 404 pelado del router raíz en vez del envelope de error.
   */
  it("un 404 de negocio es final y no cae al prefijo siguiente", async () => {
    const app = appBase();
    let siguienteConsultado = false;

    montarPerezoso(app, "/mascotas", async () => {
      const r = new Hono();
      r.get("/:id", () => {
        throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada");
      });
      return [r];
    });
    app.all("/mascotas/*", (c) => {
      siguienteConsultado = true;
      return c.text("Not Found", 404);
    });

    const res = await app.fetch(new Request("http://localhost/api/v1/mascotas/no-existe"));

    expect(res.status).toBe(404);
    expect(siguienteConsultado).toBe(false);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");
  });
});
