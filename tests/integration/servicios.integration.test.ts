/**
 * Smoke tests de camino feliz para Servicios con Precios y Ventas (B0).
 *
 * Prueba contra base real (app in-process de Hono + Supabase de pruebas).
 */

globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { adminHeaders, borrarUsuarioAuthPorEmail, crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Smoke tests de servicios omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

let serviceDb: SupabaseClient;
let tenantId = "";
let adminEmail = "";
let jwt = "";
let sesionCajaId = "";
let medioPagoId = "";

async function signIn(email: string, pass: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password: pass }),
  });
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? "";
}

async function callApp(
  path: string,
  opts: { method?: string; jwt?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  return app.request(`http://localhost/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describeIntegration("B0: Precios y Alícuotas de Servicios en la API", () => {
  let servicioId = "";

  beforeAll(async () => {
    if (skipIfNoCredentials()) return;
    serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const sufijo = Date.now().toString().slice(-6);
    const cuit = `30-97${sufijo}-1`;
    adminEmail = `b0-admin-${sufijo}@test.com`;

    // 1. Crear tenant premium vía crear_tenant
    const { data: tData, error: tErr } = await serviceDb.rpc("crear_tenant", {
      p_nombre: `Clínica B0 ${sufijo}`,
      p_cuit_rut: cuit,
      p_email_contacto: adminEmail,
      p_plan: "premium",
    });
    if (tErr) throw new Error(`crear_tenant falló: ${tErr.message}`);
    const row = Array.isArray(tData) ? tData[0] : tData;
    tenantId = row.id;

    // 2. Crear admin user
    const { data: roles } = await serviceDb
      .from("roles")
      .select("id, name")
      .eq("tenant_id", tenantId);
    const rolAdminId = roles!.find((r) => r.name === "admin")!.id;

    const adminUserId = await crearUsuarioAuth(adminEmail, { tenant_id: tenantId });
    await serviceDb.from("usuarios").insert({
      id: adminUserId,
      tenant_id: tenantId,
      username: `b0_admin_${sufijo}`,
      email: adminEmail,
      full_name: "Admin B0",
      rol_id: rolAdminId,
      active: true,
    });

    jwt = await signIn(adminEmail, "TestPass123!");

    // 3. Crear caja y abrir sesión
    const { data: cData } = await serviceDb
      .from("cajas")
      .insert({ tenant_id: tenantId, nombre: "Caja Principal" })
      .select("id")
      .single();
    const cajaId = cData!.id;

    const { data: sData } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantId,
        caja_id: cajaId,
        estado: "abierta",
        apertura_usuario_id: adminUserId,
        saldo_inicial: 5000,
      })
      .select("id")
      .single();
    sesionCajaId = sData!.id;

    // 4. Medio de pago
    const { data: mp } = await serviceDb
      .from("medios_pago")
      .select("id")
      .eq("codigo", "efectivo")
      .single();
    medioPagoId = mp!.id;
  });

  afterAll(async () => {
    if (!serviceDb || !tenantId) return;
    await limpiarTenant(serviceDb, tenantId);
    await borrarUsuarioAuthPorEmail(adminEmail);
  });

  it("ciclo completo: POST con precio → GET → PUT → listado con precio", async () => {
    if (skipIfNoCredentials()) return;

    // 1. POST /servicios con precio y alicuotaIva
    const resPost = await callApp("/servicios", {
      method: "POST",
      jwt,
      body: {
        nombre: "Consulta General B0",
        tipo: "clinica",
        duracionMinutos: 30,
        requiereProfesional: true,
        precio: 1500,
        alicuotaIva: 21,
      },
    });
    expect(resPost.status).toBe(201);
    const bodyPost = (await resPost.json()) as { success: boolean; data: any };
    expect(bodyPost.success).toBe(true);
    expect(bodyPost.data.precio).toBe(1500);
    expect(typeof bodyPost.data.precio).toBe("number");
    expect(bodyPost.data.alicuotaIva).toBe(21);
    expect(typeof bodyPost.data.alicuotaIva).toBe("number");
    servicioId = bodyPost.data.id;

    // 2. GET /servicios/:id
    const resGet = await callApp(`/servicios/${servicioId}`, { jwt });
    expect(resGet.status).toBe(200);
    const bodyGet = (await resGet.json()) as { success: boolean; data: any };
    expect(bodyGet.data.precio).toBe(1500);
    expect(typeof bodyGet.data.precio).toBe("number");
    expect(bodyGet.data.alicuotaIva).toBe(21);

    // 3. PUT /servicios/:id { precio: 1800 }
    const resPut = await callApp(`/servicios/${servicioId}`, {
      method: "PUT",
      jwt,
      body: { precio: 1800 },
    });
    expect(resPut.status).toBe(200);
    const bodyPut = (await resPut.json()) as { success: boolean; data: any };
    expect(bodyPut.data.precio).toBe(1800);
    expect(typeof bodyPut.data.precio).toBe("number");
    expect(bodyPut.data.duracionMinutos).toBe(30); // sin cambiar

    // 4. GET /servicios?limit=100
    const resList = await callApp("/servicios?limit=100", { jwt });
    expect(resList.status).toBe(200);
    const bodyList = (await resList.json()) as { success: boolean; data: any[] };
    const svcEnLista = bodyList.data.find((s) => s.id === servicioId);
    expect(svcEnLista).toBeDefined();
    expect(svcEnLista.precio).toBe(1800);
    expect(typeof svcEnLista.precio).toBe("number");
  });

  it("POST /ventas con ítem servicio sin precioUnitario toma el precio y alícuota del servicio (cierra D-03)", async () => {
    if (skipIfNoCredentials()) return;
    expect(servicioId).toBeTruthy();

    const resVenta = await callApp("/ventas", {
      method: "POST",
      jwt,
      body: {
        sesionCajaId,
        items: [
          {
            tipoItem: "servicio",
            servicioId,
            cantidad: 1,
            // Sin precioUnitario: la RPC debe tomar 1800 del servicio y su alícuota 21
          },
        ],
        pagos: [
          {
            medioPagoId,
            importe: 1800,
          },
        ],
      },
    });

    expect(resVenta.status).toBe(201);
    const bodyVenta = (await resVenta.json()) as { success: boolean; data: any };
    expect(bodyVenta.success).toBe(true);
    expect(bodyVenta.data.ventaId).toBeDefined();

    // Verificar en la DB que el ítem de venta guardó la alícuota y precio del servicio
    const { data: items, error: itemsErr } = await serviceDb
      .from("ventas_items")
      .select("precio_unitario, alicuota_iva, neto_unitario, iva_unitario, importe_total")
      .eq("venta_id", bodyVenta.data.ventaId);

    if (itemsErr) throw new Error(`Error consultando ventas_items: ${itemsErr.message}`);
    expect(items).toHaveLength(1);
    const item = items![0];
    expect(Number(item.precio_unitario)).toBe(1800);
    expect(Number(item.alicuota_iva)).toBe(21);
    expect(Number(item.importe_total)).toBe(1800);
  });
});
