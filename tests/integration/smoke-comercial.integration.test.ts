/**
 * Smoke tests de camino feliz para TODOS los endpoints comerciales.
 *
 * HTTP real contra base real (app in-process de Hono + Supabase de pruebas).
 * Asevera status 200/201, envelope `success: true` y forma de la respuesta
 * con datos válidos del propio tenant.
 */

// Polyfill WebSocket solo en entorno de tests
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { adminHeaders, borrarUsuarioAuth, catalogoDelTenant, crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Smoke tests comerciales omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

let serviceDb: SupabaseClient;
let tenantId = "";
let adminEmail = "";
let adminUserId = "";
let jwt = "";

// IDs del fixture base
let unidadMedidaId = "";
let unidadMedidaCompId = "";
let medioPagoId = "";
let clienteId = "";
let mascotaId = "";
let historialId = "";
let familiaId = "";
let productoId = "";
let productoDestinoId = "";
let derivadoId = "";
let conversionId = "";
let proveedorId = "";
let loteId = "";
let loteSecundarioId = "";
let cajaId = "";
let sesionCajaId = "";
let sesionParaCerrarId = "";
let compraId = "";
let compraItemId = "";
let compraParaConfirmarId = "";
let compraParaAnularId = "";
let ventaId = "";
let ventaItemId = "";
let ventaParaAnularId = "";
let recuentoId = "";
let recuentoParaEliminarId = "";

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
  const res = await app.request(`http://localhost/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const clone = res.clone();
  if (res.status >= 400) {
    const text = await clone.text();
    console.log("DEBUG_HTTP_FAIL:", (opts.method || "GET"), path, res.status, text);
  }
  return res;
}

beforeAll(async () => {
  if (skipIfNoCredentials()) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const sufijo = Date.now().toString().slice(-6);
  const cuit = `30-9876${sufijo}-1`;
  adminEmail = `smoke-admin-${sufijo}@test.com`;

  // Limpiar residuos previos si los hubiera
  const resUsers = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: adminHeaders(),
  });
  const { users } = (await resUsers.json()) as {
    users?: Array<{ id: string; email: string }>;
  };
  const huerfanos = (users ?? []).filter(
    (u) => (u.email ?? "").toLowerCase() === adminEmail.toLowerCase(),
  );
  for (const u of huerfanos) {
    const { data: f } = await serviceDb
      .from("usuarios")
      .select("tenant_id")
      .eq("id", u.id)
      .maybeSingle();
    if (f?.tenant_id) await limpiarTenant(serviceDb, f.tenant_id);
    else await borrarUsuarioAuth(u.id);
  }

  // 1. Crear tenant premium
  const { data: tData } = await serviceDb
    .from("tenants")
    .insert({
      nombre: `Clínica Smoke ${sufijo}`,
      cuit_rut: cuit,
      email_contacto: adminEmail,
      plan: "premium",
    })
    .select("id")
    .single();
  tenantId = tData!.id;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  // 2. Crear admin user
  const { data: roles } = await serviceDb
    .from("roles")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const rolAdminId = roles!.find((r) => r.name === "admin")!.id;

  adminUserId = await crearUsuarioAuth(adminEmail, { tenant_id: tenantId });
  await serviceDb.from("usuarios").insert({
    id: adminUserId,
    tenant_id: tenantId,
    username: `smoke_admin_${sufijo}`,
    email: adminEmail,
    full_name: "Admin Smoke",
    rol_id: rolAdminId,
    active: true,
  });

  jwt = await signIn(adminEmail, "TestPass123!");

  // 3. Catálogo clínico y entidades base
  const cat = await catalogoDelTenant(serviceDb, tenantId);

  const { data: uUnidad } = await serviceDb
    .from("unidades_medida")
    .select("id")
    .eq("codigo", "unidad")
    .single();
  unidadMedidaId = uUnidad!.id;

  const { data: uComp } = await serviceDb
    .from("unidades_medida")
    .select("id")
    .eq("codigo", "comprimido")
    .single();
  unidadMedidaCompId = uComp!.id;

  const { data: mPago } = await serviceDb
    .from("medios_pago")
    .select("id")
    .eq("codigo", "efectivo")
    .single();
  medioPagoId = mPago!.id;

  const { data: cData } = await serviceDb
    .from("clientes")
    .insert({
      tenant_id: tenantId,
      full_name: "Cliente Smoke",
      phone: "1122334455",
    })
    .select("id")
    .single();
  clienteId = cData!.id;

  const { data: mData } = await serviceDb
    .from("mascotas")
    .insert({
      tenant_id: tenantId,
      name: "Mascota Smoke",
      client_id: clienteId,
      especie_id: cat.especieId,
      sex: "Macho",
      tamano: "Mediano",
    })
    .select("id")
    .single();
  mascotaId = mData!.id;

  const { data: hData } = await serviceDb
    .from("historial_clinico")
    .insert({
      tenant_id: tenantId,
      pet_id: mascotaId,
      professional_id: adminUserId,
      date: "2026-03-01",
      event_type: "Consulta",
      description: "Consulta de prueba para consumo clínico",
      client_id_at_time: clienteId,
      client_name_at_time: "Cliente Smoke",
    })
    .select("id")
    .single();
  historialId = hData!.id;

  // 4. Catálogo comercial base
  const { data: fData } = await serviceDb
    .from("familias_producto")
    .insert({
      tenant_id: tenantId,
      nombre: `Familia Smoke ${sufijo}`,
      unidad_base_id: unidadMedidaId,
    })
    .select("id")
    .single();
  familiaId = fData!.id;

  const { data: pData } = await serviceDb
    .from("productos")
    .insert([
      {
        tenant_id: tenantId,
        codigo: `PROD-SMOKE-1-${sufijo}`,
        nombre: `Producto Smoke 1 ${sufijo}`,
        unidad_medida_id: unidadMedidaId,
        familia_id: familiaId,
        es_vendible: true,
        es_consumible_clinico: true,
        precio_venta: 500,
        costo_reposicion: 100,
      },
      {
        tenant_id: tenantId,
        codigo: `PROD-SMOKE-2-${sufijo}`,
        nombre: `Producto Smoke 2 ${sufijo}`,
        unidad_medida_id: unidadMedidaCompId,
        familia_id: familiaId,
        es_vendible: true,
        es_consumible_clinico: true,
        precio_venta: 60,
        costo_reposicion: 10,
      },
      {
        tenant_id: tenantId,
        codigo: `PROD-SMOKE-3-${sufijo}`,
        nombre: `Producto Smoke 3 ${sufijo}`,
        unidad_medida_id: unidadMedidaCompId,
        familia_id: familiaId,
        es_vendible: true,
        es_consumible_clinico: true,
        precio_venta: 120,
        costo_reposicion: 20,
      },
    ])
    .select("id");
  productoId = pData![0].id;
  productoDestinoId = pData![1].id;
  derivadoId = pData![2].id;

  const { data: convData } = await serviceDb
    .from("producto_conversiones")
    .insert({
      tenant_id: tenantId,
      producto_origen_id: productoId,
      producto_destino_id: derivadoId,
      factor_teorico: 10,
    })
    .select("id")
    .single();
  conversionId = convData!.id;

  const { data: provData } = await serviceDb
    .from("proveedores")
    .insert({
      tenant_id: tenantId,
      razon_social: `Proveedor Smoke ${sufijo}`,
      cuit: `30-55667788-9`,
    })
    .select("id")
    .single();
  proveedorId = provData!.id;

  // Lotes con existencias reales
  const { data: lData } = await serviceDb
    .from("lotes")
    .insert([
      {
        tenant_id: tenantId,
        producto_id: productoId,
        codigo_lote: `LOTE-SMK-1-${sufijo}`,
        fecha_vencimiento: "2027-12-31",
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        proveedor_id: proveedorId,
        usuario_id: adminUserId,
      },
      {
        tenant_id: tenantId,
        producto_id: productoId,
        codigo_lote: `LOTE-SMK-2-${sufijo}`,
        fecha_vencimiento: "2028-06-30",
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        proveedor_id: proveedorId,
        usuario_id: adminUserId,
      },
    ])
    .select("id");
  loteId = lData![0].id;
  loteSecundarioId = lData![1].id;

  // Asientos en movimientos_stock para que existencias_lote tenga stock real
  await serviceDb.from("movimientos_stock").insert([
    {
      tenant_id: tenantId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoId,
      lote_id: loteId,
      cantidad: 1000,
      costo_unitario: 100,
      costo_total: 100000,
      usuario_id: adminUserId,
    },
    {
      tenant_id: tenantId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoId,
      lote_id: loteSecundarioId,
      cantidad: 500,
      costo_unitario: 100,
      costo_total: 50000,
      usuario_id: adminUserId,
    },
  ]);

  // Cajas y sesiones
  const { data: cjData } = await serviceDb
    .from("cajas")
    .insert([
      { tenant_id: tenantId, nombre: `Caja Smoke 1 ${sufijo}` },
      { tenant_id: tenantId, nombre: `Caja Smoke 2 ${sufijo}` },
    ])
    .select("id");
  cajaId = cjData![0].id;
  const caja2Id = cjData![1].id;

  const { data: sesData1 } = await serviceDb
    .from("sesiones_caja")
    .insert({
      tenant_id: tenantId,
      caja_id: cajaId,
      apertura_usuario_id: adminUserId,
      saldo_inicial: 1000,
    })
    .select("id")
    .single();
  sesionCajaId = sesData1!.id;

  const { data: sesData2 } = await serviceDb
    .from("sesiones_caja")
    .insert({
      tenant_id: tenantId,
      caja_id: caja2Id,
      apertura_usuario_id: adminUserId,
      saldo_inicial: 500,
    })
    .select("id")
    .single();
  sesionParaCerrarId = sesData2!.id;

  // Compras: una en borrador para editar/items, una para confirmar, una para anular
  const { data: compData } = await serviceDb
    .from("compras")
    .insert([
      {
        tenant_id: tenantId,
        proveedor_id: proveedorId,
        fecha: "2026-03-01",
        estado: "borrador",
        usuario_id: adminUserId,
        comprobante_proveedor_tipo: "Factura A",
        comprobante_proveedor_numero: `0001-${sufijo}-1`,
      },
      {
        tenant_id: tenantId,
        proveedor_id: proveedorId,
        fecha: "2026-03-01",
        estado: "borrador",
        usuario_id: adminUserId,
        comprobante_proveedor_tipo: "Factura A",
        comprobante_proveedor_numero: `0001-${sufijo}-2`,
      },
      {
        tenant_id: tenantId,
        proveedor_id: proveedorId,
        fecha: "2026-03-01",
        estado: "borrador",
        usuario_id: adminUserId,
        comprobante_proveedor_tipo: "Factura A",
        comprobante_proveedor_numero: `0001-${sufijo}-3`,
      },
    ])
    .select("id");
  compraId = compData![0].id;
  compraParaConfirmarId = compData![1].id;
  compraParaAnularId = compData![2].id;

  const { data: itData } = await serviceDb
    .from("compras_items")
    .insert([
      {
        tenant_id: tenantId,
        compra_id: compraId,
        producto_id: productoId,
        cantidad: 10,
        costo_unitario_neto: 100,
        alicuota_iva: 21,
        importe_neto: 1000,
        importe_iva: 210,
        importe_total: 1210,
      },
      {
        tenant_id: tenantId,
        compra_id: compraParaConfirmarId,
        producto_id: productoId,
        cantidad: 5,
        costo_unitario_neto: 100,
        alicuota_iva: 21,
        importe_neto: 500,
        importe_iva: 105,
        importe_total: 605,
        fecha_vencimiento: "2027-12-31",
      },
      {
        tenant_id: tenantId,
        compra_id: compraParaAnularId,
        producto_id: productoId,
        cantidad: 5,
        costo_unitario_neto: 100,
        alicuota_iva: 21,
        importe_neto: 500,
        importe_iva: 105,
        importe_total: 605,
        fecha_vencimiento: "2027-12-31",
      },
    ])
    .select("id");
  compraItemId = itData![0].id;

  // Las ventas se registran dinámicamente vía API en los tests

  // Recuento se crea dinámicamente en el test 56

  await serviceDb.from("recuentos_detalle").insert({
    tenant_id: tenantId,
    recuento_id: recuentoId,
    lote_id: loteId,
    cantidad_sistema: 1000,
    cantidad_contada: 990,
  });
}, 30_000);

afterAll(async () => {
  if (!serviceDb || !tenantId) return;
  await limpiarTenant(serviceDb, tenantId);
});

describeIntegration("Smoke Tests — Módulo Comercial: Happy Path HTTP real", () => {
  // ─── 1. Productos (6) ───────────────────────────────────────────────────────
  it("01. POST /productos: crea un producto", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/productos", {
      method: "POST",
      jwt,
      body: {
        codigo: `SMK-NUEVO-${Date.now().toString().slice(-4)}`,
        nombre: "Producto Smoke Nuevo",
        unidadMedidaId,
        familiaId,
        alicuota_iva: 21,
        precioVenta: 150,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("02. GET /productos: lista productos paginados", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/productos?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("03. GET /productos/:id: obtiene producto por id", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/productos/${productoId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(productoId);
  });

  it("04. PUT /productos/:id: actualiza producto", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/productos/${productoId}`, {
      method: "PUT",
      jwt,
      body: { nombre: "Producto Smoke 1 Editado" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.nombre).toBe("Producto Smoke 1 Editado");
  });

  it("05. PATCH /productos/:id/estado: cambia estado de producto", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/productos/${productoId}/estado`, {
      method: "PATCH",
      jwt,
      body: { activo: true },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.activo).toBe(true);
  });

  it("06. POST /productos/:id/derivado: crea derivado y conversión atómica", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/productos/${productoId}/derivado`, {
      method: "POST",
      jwt,
      body: {
        codigo: `DERIV-ATM-${Date.now().toString().slice(-4)}`,
        nombre: "Derivado Atómico Smoke",
        unidadMedidaId: unidadMedidaCompId,
        factorTeorico: 20,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.producto?.id).toBeDefined();
  });

  // ─── 2. Familias de Producto (5) ────────────────────────────────────────────
  it("07. POST /familias-producto: crea familia", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/familias-producto", {
      method: "POST",
      jwt,
      body: {
        nombre: `Familia Smoke Nueva ${Date.now().toString().slice(-4)}`,
        unidadBaseId: unidadMedidaId,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("08. GET /familias-producto: lista familias paginadas", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/familias-producto?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("09. GET /familias-producto/:id: obtiene familia por id", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/familias-producto/${familiaId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(familiaId);
  });

  it("10. PUT /familias-producto/:id: actualiza familia", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/familias-producto/${familiaId}`, {
      method: "PUT",
      jwt,
      body: { nombre: "Familia Smoke Editada" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.nombre).toBe("Familia Smoke Editada");
  });

  it("11. PATCH /familias-producto/:id/estado: cambia estado de familia", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/familias-producto/${familiaId}/estado`, {
      method: "PATCH",
      jwt,
      body: { activo: true },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.activo).toBe(true);
  });

  // ─── 3. Conversiones (5) ────────────────────────────────────────────────────
  it("12. POST /producto-conversiones: crea conversión", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/producto-conversiones", {
      method: "POST",
      jwt,
      body: {
        productoOrigenId: productoId,
        productoDestinoId: productoDestinoId,
        factorTeorico: 5,
        mermaEsperadaPorcentaje: 0,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("13. GET /producto-conversiones: lista conversiones", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/producto-conversiones?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("14. GET /producto-conversiones/:id: obtiene conversión por id", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/producto-conversiones/${conversionId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(conversionId);
  });

  it("15. PUT /producto-conversiones/:id: actualiza conversión", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/producto-conversiones/${conversionId}`, {
      method: "PUT",
      jwt,
      body: { factorTeorico: 12 },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.factorTeorico).toBe(12);
  });

  it("16. PATCH /producto-conversiones/:id/estado: cambia estado de conversión", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/producto-conversiones/${conversionId}/estado`, {
      method: "PATCH",
      jwt,
      body: { activo: true },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.activo).toBe(true);
  });

  // ─── 4. Proveedores (5) ─────────────────────────────────────────────────────
  it("17. POST /proveedores: crea proveedor", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/proveedores", {
      method: "POST",
      jwt,
      body: {
        razonSocial: `Proveedor Nuevo ${Date.now().toString().slice(-4)}`,
        cuit: `30-99887766-${Date.now().toString().slice(-1)}`,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("18. GET /proveedores: lista proveedores", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/proveedores?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("19. GET /proveedores/:id: obtiene proveedor por id", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/proveedores/${proveedorId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(proveedorId);
  });

  it("20. PUT /proveedores/:id: actualiza proveedor", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/proveedores/${proveedorId}`, {
      method: "PUT",
      jwt,
      body: { razonSocial: "Proveedor Smoke Modificado" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.razonSocial).toBe("Proveedor Smoke Modificado");
  });

  it("21. PATCH /proveedores/:id/estado: cambia estado de proveedor", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/proveedores/${proveedorId}/estado`, {
      method: "PATCH",
      jwt,
      body: { activo: true },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.activo).toBe(true);
  });

  // ─── 5. Stock: Lotes, Movimientos y Existencias (10) ────────────────────────
  it("22. GET /lotes: lista lotes", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/lotes?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("23. GET /lotes/candidatos: candidatos FEFO para un producto y cantidad", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/lotes/candidatos?productoId=${productoId}&cantidad=5`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("24. GET /lotes/:id: obtiene lote por id", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/lotes/${loteId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(loteId);
  });

  it("25. GET /lotes/:id/kardex: historial kardex del lote", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/lotes/${loteId}/kardex?page=1&limit=10`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("26. GET /lotes/:id/trazabilidad: cadena de trazabilidad del lote", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/lotes/${loteId}/trazabilidad`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("27. POST /lotes/:id/bloquear: bloquea un lote con motivo", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/lotes/${loteSecundarioId}/bloquear`, {
      method: "POST",
      jwt,
      body: { motivo: "Bloqueo preventivo de lote por sospecha" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.estado).toBe("bloqueado");
  });

  it("28. POST /lotes/:id/desbloquear: desbloquea un lote con motivo", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/lotes/${loteSecundarioId}/desbloquear`, {
      method: "POST",
      jwt,
      body: { motivo: "Desbloqueo tras análisis de calidad conforme" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.estado).toBe("disponible");
  });

  it("29. GET /movimientos-stock: lista movimientos del libro mayor", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/movimientos-stock?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("30. GET /existencias: lista existencias por producto", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/existencias?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("31. GET /existencias/valorizacion: resumen de valorización de inventario", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/existencias/valorizacion", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totalValorizado).toBeDefined();
  });

  // ─── 6. Compras (9) ─────────────────────────────────────────────────────────
  it("32. POST /compras: crea compra en borrador", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/compras", {
      method: "POST",
      jwt,
      body: {
        proveedorId,
        fecha: "2026-03-01",
        comprobanteProveedorTipo: "Factura A",
        comprobanteProveedorNumero: "0001-99999999",
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("33. GET /compras: lista compras", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/compras?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("34. GET /compras/:id: obtiene compra por id", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/compras/${compraId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(compraId);
  });

  it("35. PUT /compras/:id: actualiza compra en borrador", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/compras/${compraId}`, {
      method: "PUT",
      jwt,
      body: { observaciones: "Compra observada en smoke" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.observaciones).toBe("Compra observada en smoke");
  });

  it("36. POST /compras/:id/items: agrega ítem a compra en borrador", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/compras/${compraId}/items`, {
      method: "POST",
      jwt,
      body: {
        productoId: productoDestinoId,
        cantidad: 15,
        costoUnitarioNeto: 10,
        alicuotaIva: 21,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("37. PUT /compras/:id/items/:itemId: actualiza ítem de compra", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/compras/${compraId}/items/${compraItemId}`, {
      method: "PUT",
      jwt,
      body: { cantidad: 20 },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.cantidad).toBe(20);
  });

  it("38. DELETE /compras/:id/items/:itemId: quita ítem de compra", async () => {
    if (skipIfNoCredentials()) return;
    const itRes = await callApp(`/compras/${compraId}/items`, {
      method: "POST",
      jwt,
      body: {
        productoId,
        cantidad: 1,
        costoUnitarioNeto: 100,
        alicuotaIva: 21,
      },
    });
    const itBody = (await itRes.json()) as { success: boolean; data: any };
    const idParaEliminar = itBody.data?.id;

    const res = await callApp(`/compras/${compraId}/items/${idParaEliminar}`, {
      method: "DELETE",
      jwt,
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("39. POST /compras/:id/confirmar: confirma compra e ingresa stock", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/compras/${compraParaConfirmarId}/confirmar`, {
      method: "POST",
      jwt,
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.compraId).toBeDefined();
  });

  it("40. POST /compras/:id/anular: anula compra confirmada", async () => {
    if (skipIfNoCredentials()) return;
    await callApp(`/compras/${compraParaAnularId}/confirmar`, { method: "POST", jwt });
    const res = await callApp(`/compras/${compraParaAnularId}/anular`, {
      method: "POST",
      jwt,
      body: { motivo: "Anulación de prueba en smoke test" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.compraId).toBeDefined();
  });

  // ─── 7. Caja (8) ────────────────────────────────────────────────────────────
  it("41. GET /caja/cajas: lista cajas físicas del tenant", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/caja/cajas", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("42. POST /caja/sesiones: abre una nueva sesión de caja", async () => {
    if (skipIfNoCredentials()) return;
    const { data: cjNueva } = await serviceDb
      .from("cajas")
      .insert({ tenant_id: tenantId, nombre: `Caja Extra ${Date.now().toString().slice(-4)}` })
      .select("id")
      .single();

    const res = await callApp("/caja/sesiones", {
      method: "POST",
      jwt,
      body: {
        cajaId: cjNueva!.id,
        saldoInicial: 200,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("43. GET /caja/sesiones: lista sesiones de caja", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/caja/sesiones?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("44. GET /caja/sesiones/actual: obtiene sesión abierta de la caja", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/caja/sesiones/actual?cajaId=${cajaId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.id).toBe(sesionCajaId);
  });

  it("45. GET /caja/sesiones/:id: obtiene sesión con detalle de movimientos", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/caja/sesiones/${sesionCajaId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(sesionCajaId);
  });

  it("46. GET /caja/sesiones/:id/resumen: resumen de arqueo de la sesión", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/caja/sesiones/${sesionCajaId}/resumen`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.saldoInicial).toBeDefined();
  });

  it("47. POST /caja/sesiones/:id/movimientos: registra movimiento manual", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/caja/sesiones/${sesionCajaId}/movimientos`, {
      method: "POST",
      jwt,
      body: {
        tipo: "ingreso_manual",
        medioPagoId,
        importe: 150,
        motivo: "Ingreso manual de prueba en smoke",
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  it("48. POST /caja/sesiones/:id/cerrar: cierra sesión con arqueo", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/caja/sesiones/${sesionParaCerrarId}/cerrar`, {
      method: "POST",
      jwt,
      body: {
        efectivoContado: 500,
        observaciones: "Cierre de sesión verificado en smoke",
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.saldoTeoricoEfectivo).toBeDefined();
  });

  // ─── 8. Ventas (6) ──────────────────────────────────────────────────────────
  it("49. POST /ventas: registra una venta completa", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/ventas", {
      method: "POST",
      jwt,
      body: {
        sesionCajaId,
        clienteId,
        items: [
          {
            tipoItem: "producto",
            productoId,
            loteId,
            cantidad: 1,
            precioUnitario: 500,
            alicuotaIva: 21,
          },
        ],
        pagos: [
          {
            medioPagoId,
            importe: 500,
          },
        ],
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.ventaId).toBeDefined();
    ventaId = body.data.ventaId;

    // Obtener ítem para la prueba de devoluciones
    const { data: vItems } = await serviceDb
      .from("ventas_items")
      .select("id")
      .eq("venta_id", ventaId);
    if (vItems && vItems.length > 0) {
      ventaItemId = vItems[0].id;
    }
  });

  it("50. GET /ventas: lista ventas paginadas", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/ventas?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("51. GET /ventas/:id: obtiene venta por id con ítems y pagos", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/ventas/${ventaId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(ventaId);
  });

  it("52. POST /ventas/:id/anular: anula venta completada", async () => {
    if (skipIfNoCredentials()) return;
    const vRes = await callApp("/ventas", {
      method: "POST",
      jwt,
      body: {
        sesionCajaId,
        clienteId,
        items: [
          {
            tipoItem: "producto",
            productoId,
            loteId,
            cantidad: 1,
            precioUnitario: 500,
            alicuotaIva: 21,
          },
        ],
        pagos: [
          {
            medioPagoId,
            importe: 500,
          },
        ],
      },
    });
    const vBody = (await vRes.json()) as { success: boolean; data: any };
    const idParaAnular = vBody.data?.ventaId;

    const res = await callApp(`/ventas/${idParaAnular}/anular`, {
      method: "POST",
      jwt,
      body: { motivo: "Anulación de venta en smoke test", sesionCajaId },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.estado).toBe("anulada");
  });

  it("53. GET /ventas/reportes/margen: reporte de margen por producto", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/ventas/reportes/margen", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("54. GET /ventas/reportes/items-vendidos: reporte de ítems vendidos", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/ventas/reportes/items-vendidos", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ─── 9. Ajustes, Recuentos y Devoluciones (8) ────────────────────────────────
  it("55. POST /ajustes: registra ajuste directo de stock", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/ajustes", {
      method: "POST",
      jwt,
      body: {
        loteId,
        tipo: "salida_ajuste",
        cantidad: 1,
        motivo: "Ajuste de stock por merma identificada en smoke",
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.operacionId).toBeDefined();
  });

  it("56. POST /recuentos: crea recuento de inventario en borrador", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/recuentos", {
      method: "POST",
      jwt,
      body: { observaciones: "Nuevo recuento creado en smoke" },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    recuentoId = body.data.id;
  });

  it("57. GET /recuentos: lista recuentos", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/recuentos?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("58. GET /recuentos/:id: obtiene recuento por id", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/recuentos/${recuentoId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(recuentoId);
  });

  it("59. PUT /recuentos/:id/detalles: guarda detalles de conteo físico", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/recuentos/${recuentoId}/detalles`, {
      method: "PUT",
      jwt,
      body: {
        items: [
          {
            loteId,
            cantidadContada: 995,
          },
        ],
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("60. POST /recuentos/:id/aplicar: aplica ajustes por diferencias del recuento", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/recuentos/${recuentoId}/aplicar`, {
      method: "POST",
      jwt,
      body: { confirmarDesvios: true },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.operacionId).toBeDefined();
  });

  it("61. DELETE /recuentos/:id: elimina recuento en borrador", async () => {
    if (skipIfNoCredentials()) return;
    // Creamos un recuento efímero para probar el delete (después de que el 60 aplicó el recuento anterior)
    const postRes = await callApp("/recuentos", {
      method: "POST",
      jwt,
      body: { observaciones: "Recuento efímero para eliminar" },
    });
    const postBody = (await postRes.json()) as { success: boolean; data: any };
    const idParaEliminar = postBody.data?.id;

    const res = await callApp(`/recuentos/${idParaEliminar}`, {
      method: "DELETE",
      jwt,
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("62. POST /devoluciones: registra devolución sobre venta", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/devoluciones", {
      method: "POST",
      jwt,
      body: {
        ventaId,
        items: [
          {
            ventaItemId,
            cantidad: 1,
            revendible: true,
          },
        ],
        motivo: "Devolución por cambio de producto en smoke test",
        reintegraEfectivo: false,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.operacionId).toBeDefined();
  });

  // ─── 10. Fraccionamiento (3) ────────────────────────────────────────────────
  it("63. GET /fraccionamiento/sugerir-vencimiento: calcula vencimiento para fraccionado", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(
      `/fraccionamiento/sugerir-vencimiento?loteOrigenId=${loteId}&productoDestinoId=${derivadoId}`,
      { jwt },
    );
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.vencimientoSugerido).toBeDefined();
  });

  it("64. POST /fraccionamiento: fracciona lote y genera lote destino", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/fraccionamiento", {
      method: "POST",
      jwt,
      body: {
        loteOrigenId: loteId,
        productoDestinoId: derivadoId,
        cantidadOrigen: 1,
        codigoLoteDestino: `FRAC-SMK-${Date.now().toString().slice(-4)}`,
        fechaVencimientoDestino: "2027-10-01",
        cantidadObtenida: 12,
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.loteDestinoId).toBeDefined();
  });

  it("65. GET /fraccionamiento/historial: lista historial de fraccionamientos", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/fraccionamiento/historial?page=1&limit=10", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ─── 11. Consumo Clínico (3) ────────────────────────────────────────────────
  it("66. POST /consumos: registra consumo de insumos clínicos", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/consumos", {
      method: "POST",
      jwt,
      body: {
        historialId,
        items: [
          {
            productoId,
            cantidad: 1,
            loteId,
          },
        ],
      },
    });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.operacion_id).toBeDefined();
  });

  it("67. GET /consumos/evento/:historialId: trazabilidad de consumo por evento clínico", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/consumos/evento/${historialId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("68. GET /consumos/disponibilidad: disponibilidad de producto para consumo", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp(`/consumos/disponibilidad?productoId=${productoId}`, { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ─── 12. Reportes Comerciales (9) ───────────────────────────────────────────
  it("69. GET /reportes/valorizacion-fecha: reporte de inventario a fecha", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/valorizacion-fecha", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totalLineas).toBeDefined();
  });

  it("70. GET /reportes/rotacion: reporte de rotación y capital inmovilizado", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/rotacion?diasSinMovimiento=30", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totalProductos).toBeDefined();
  });

  it("71. GET /reportes/fraccionamiento: reporte de costo y merma de fraccionamientos", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/fraccionamiento", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("72. GET /reportes/consumo-profesional: desglose de insumos por veterinario", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/consumo-profesional", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("73. GET /reportes/consumo-especie: desglose de insumos por especie", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/consumo-especie", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("74. GET /reportes/rentabilidad: análisis de margen bruto por venta", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/rentabilidad", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totalNeto).toBeDefined();
  });

  it("75. GET /reportes/ventas-usuario: transacciones y totales por cajero", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/ventas-usuario", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("76. GET /reportes/ventas-sesion: desglose por sesión de caja", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/ventas-sesion", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("77. GET /reportes/ventas-medio-pago: agregación por forma de cobro", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/reportes/ventas-medio-pago", { jwt });
    const body = (await res.json()) as { success: boolean; data: any };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.granTotal).toBeDefined();
  });
});
