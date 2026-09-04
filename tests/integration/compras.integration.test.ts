import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

let serviceDb: SupabaseClient;

let tenantAId = "";
let usuarioAId = "";
let unidadId = "";
let proveedorAId = "";
let productoAId = "";

export async function crearFixtureCompras(db: SupabaseClient, prefix: string) {
  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-1`,
    p_email_contacto: `${prefix.toLowerCase()}_compras@test.com`,
    p_plan: "basico",
  });
  if (errT || !t) throw new Error(`Error creando tenant: ${errT?.message}`);
  const tenantId = (typeof t === "string" ? t : (t as { id: string }).id);

  // 2. Rol admin
  const { data: r } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "admin")
    .single();
  const rolId = r!.id as string;

  // 3. Usuario Auth + DB
  const usuarioId = await crearUsuarioAuth(`${prefix.toLowerCase()}_${Date.now()}@test.com`, {
    tenant_id: tenantId,
  });

  const { error: errU } = await db.from("usuarios").insert({
    id: usuarioId,
    tenant_id: tenantId,
    username: `${prefix.toLowerCase()}_admin_${Date.now()}`,
    email: `${prefix.toLowerCase()}_${Date.now()}@test.com`,
    full_name: `${prefix} Admin`,
    rol_id: rolId,
    active: true,
  });
  if (errU) throw new Error(`Error creando usuario: ${errU?.message}`);

  // 4. Unidad medida
  const { data: un } = await db
    .from("unidades_medida")
    .select("id")
    .eq("codigo", "unidad")
    .single();
  const uId = un?.id as string;

  // 5. Proveedor
  const { data: prov, error: errProv } = await db
    .from("proveedores")
    .insert({
      tenant_id: tenantId,
      razon_social: `${prefix} Distribuidora`,
      activo: true,
    })
    .select("id")
    .single();
  if (errProv) throw new Error(`Error creando proveedor: ${errProv?.message}`);
  const provId = prov!.id as string;

  // 6. Producto base con lote y vencimiento
  const { data: prod, error: errProd } = await db
    .from("productos")
    .insert({
      tenant_id: tenantId,
      codigo: `PROD-${prefix}-${Date.now()}`,
      nombre: `${prefix} Producto Base`,
      unidad_medida_id: uId,
      controla_lote: true,
      controla_vencimiento: true,
      activo: true,
    })
    .select("id")
    .single();
  if (errProd) throw new Error(`Error creando producto: ${errProd?.message}`);
  const pId = prod!.id as string;

  return {
    tenantId,
    usuarioId,
    unidadId: uId,
    proveedorId: provId,
    productoId: pId,
  };
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const fixture = await crearFixtureCompras(serviceDb, "COMPRASA");
  tenantAId = fixture.tenantId;
  usuarioAId = fixture.usuarioId;
  unidadId = fixture.unidadId;
  proveedorAId = fixture.proveedorId;
  productoAId = fixture.productoId;
});

afterAll(async () => {
  if (!serviceDb) return;
    // Antes: borrado a mano tabla por tabla, ignorando todos los errores. Dos
    // fallas garantizadas — `movimientos_stock` lo rechaza siempre el trigger de
    // inmutabilidad, y el DELETE de `tenants` también, por la misma cascada — y
    // ninguna se veía. `limpiarTenant` usa la vía legítima (`dar_de_baja_tenant`)
    // y revienta si el tenant sobrevive.
  await limpiarTenant(serviceDb, tenantAId);
});

describeIntegration("C2·T3 — Compras y confirmar_compra RPC", () => {
  it("RN-CM1: el borrador no mueve existencias", async () => {
    // 1. Crear compra en borrador con 2 ítems
    const { data: compra } = await serviceDb
      .from("compras")
      .insert({
        tenant_id: tenantAId,
        proveedor_id: proveedorAId,
        fecha: "2026-09-08",
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();
    const compraId = compra!.id;

    await serviceDb.from("compras_items").insert([
      {
        tenant_id: tenantAId,
        compra_id: compraId,
        producto_id: productoAId,
        cantidad: 10,
        costo_unitario_neto: 100,
        alicuota_iva: 21,
        codigo_lote: `LOTE-CM1-1-${Date.now()}`,
        fecha_vencimiento: "2027-12-31",
        importe_neto: 1000,
        importe_iva: 210,
        importe_total: 1210,
      },
      {
        tenant_id: tenantAId,
        compra_id: compraId,
        producto_id: productoAId,
        cantidad: 5,
        costo_unitario_neto: 120,
        alicuota_iva: 21,
        codigo_lote: `LOTE-CM1-2-${Date.now()}`,
        fecha_vencimiento: "2027-12-31",
        importe_neto: 600,
        importe_iva: 126,
        importe_total: 726,
      },
    ]);

    // Verificar que en borrador NO hay lotes ni movimientos creados para esta compra
    const { data: lotesAntes } = await serviceDb
      .from("lotes")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("proveedor_id", proveedorAId);
    expect(lotesAntes ?? []).toHaveLength(0);

    // 2. Confirmar compra
    const { data: resRpc, error: errRpc } = await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_compra_id: compraId,
    });
    expect(errRpc).toBeNull();
    expect(resRpc).toHaveLength(1);
    expect(resRpc[0].lotes_creados).toBe(2);

    // Estado confirmada
    const { data: compraConf } = await serviceDb
      .from("compras")
      .select("estado, total")
      .eq("id", compraId)
      .single();
    expect(compraConf?.estado).toBe("confirmada");
    expect(Number(compraConf?.total)).toBe(1936);

    // Lotes creados
    const { data: lotesDespues } = await serviceDb
      .from("lotes")
      .select("id, costo_unitario_efectivo")
      .eq("tenant_id", tenantAId)
      .eq("proveedor_id", proveedorAId);
    expect(lotesDespues ?? []).toHaveLength(2);
  });

  it("RN-CM4: el comprobante del proveedor no se carga dos veces", async () => {
    const numFactura = `A-0001-${Math.floor(10000000 + Math.random() * 90000000)}`;

    const { error: err1 } = await serviceDb.from("compras").insert({
      tenant_id: tenantAId,
      proveedor_id: proveedorAId,
      fecha: "2026-09-08",
      comprobante_proveedor_numero: numFactura,
      usuario_id: usuarioAId,
    });
    expect(err1).toBeNull();

    // Misma factura, mismo proveedor -> viola UNIQUE uq_compras_comprobante (23505)
    const { error: err2 } = await serviceDb.from("compras").insert({
      tenant_id: tenantAId,
      proveedor_id: proveedorAId,
      fecha: "2026-09-08",
      comprobante_proveedor_numero: numFactura,
      usuario_id: usuarioAId,
    });
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23505");

    // Dos compras con NULL se permiten
    const { error: errNull1 } = await serviceDb.from("compras").insert({
      tenant_id: tenantAId,
      proveedor_id: proveedorAId,
      fecha: "2026-09-08",
      comprobante_proveedor_numero: null,
      usuario_id: usuarioAId,
    });
    expect(errNull1).toBeNull();

    const { error: errNull2 } = await serviceDb.from("compras").insert({
      tenant_id: tenantAId,
      proveedor_id: proveedorAId,
      fecha: "2026-09-08",
      comprobante_proveedor_numero: null,
      usuario_id: usuarioAId,
    });
    expect(errNull2).toBeNull();
  });

  it("RN-CM5: la compra actualiza el costo de reposición sin tocar los movimientos", async () => {
    const { data: prod } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: `PROD-CM5-${Date.now()}`,
        nombre: "Prod CM5 Costo",
        unidad_medida_id: unidadId,
        controla_lote: true,
        controla_vencimiento: true,
      })
      .select("id")
      .single();
    const pId = prod!.id;

    // Compra 1 a costo neto 100 (efectivo con 21% = 121)
    const { data: c1 } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();
    const { data: it1 } = await serviceDb
      .from("compras_items")
      .insert({
        tenant_id: tenantAId, compra_id: c1!.id, producto_id: pId, cantidad: 10,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-CM5-1-${Date.now()}`,
        fecha_vencimiento: "2027-12-31", importe_neto: 1000, importe_iva: 210, importe_total: 1210,
      })
      .select("id").single();

    await serviceDb.rpc("confirmar_compra", { p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c1!.id });

    const { data: pCheck1 } = await serviceDb.from("productos").select("costo_reposicion").eq("id", pId).single();
    expect(Number(pCheck1?.costo_reposicion)).toBe(121);

    const { data: mov1 } = await serviceDb
      .from("movimientos_stock")
      .select("costo_unitario")
      .eq("compra_item_id", it1!.id)
      .single();
    expect(Number(mov1?.costo_unitario)).toBe(121);

    // Compra 2 a costo neto 130 (efectivo con 21% = 157.3)
    const { data: c2 } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();
    await serviceDb
      .from("compras_items")
      .insert({
        tenant_id: tenantAId, compra_id: c2!.id, producto_id: pId, cantidad: 5,
        costo_unitario_neto: 130, alicuota_iva: 21, codigo_lote: `L-CM5-2-${Date.now()}`,
        fecha_vencimiento: "2027-12-31", importe_neto: 650, importe_iva: 136.5, importe_total: 786.5,
      });

    await serviceDb.rpc("confirmar_compra", { p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c2!.id });

    // El producto ahora tiene costo_reposicion = 157.3
    const { data: pCheck2 } = await serviceDb.from("productos").select("costo_reposicion").eq("id", pId).single();
    expect(Number(pCheck2?.costo_reposicion)).toBe(157.3);

    // El movimiento original 1 SIGUE con costo_unitario = 121
    const { data: mov1After } = await serviceDb
      .from("movimientos_stock")
      .select("costo_unitario")
      .eq("compra_item_id", it1!.id)
      .single();
    expect(Number(mov1After?.costo_unitario)).toBe(121);
  });

  it("RN-LO1: dos ingresos del mismo código de lote a distinto costo generan dos lotes", async () => {
    const { data: prod } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId, codigo: `PROD-LO1-${Date.now()}`, nombre: "Prod LO1", unidad_medida_id: unidadId,
        controla_lote: true, controla_vencimiento: true,
      })
      .select("id").single();

    const loteCodigo = `L-993-${Date.now()}`;

    // Compra 1: L-993 a $100
    const { data: c1 } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();
    await serviceDb.from("compras_items").insert({
      tenant_id: tenantAId, compra_id: c1!.id, producto_id: prod!.id, cantidad: 10,
      costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: loteCodigo, fecha_vencimiento: "2027-12-31",
      importe_neto: 1000, importe_iva: 210, importe_total: 1210,
    });
    await serviceDb.rpc("confirmar_compra", { p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c1!.id });

    // Compra 2: L-993 a $130
    const { data: c2 } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();
    await serviceDb.from("compras_items").insert({
      tenant_id: tenantAId, compra_id: c2!.id, producto_id: prod!.id, cantidad: 10,
      costo_unitario_neto: 130, alicuota_iva: 21, codigo_lote: loteCodigo, fecha_vencimiento: "2027-12-31",
      importe_neto: 1300, importe_iva: 273, importe_total: 1573,
    });
    await serviceDb.rpc("confirmar_compra", { p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c2!.id });

    // Se produjeron dos filas distintas en lotes
    const { data: lotes } = await serviceDb
      .from("lotes")
      .select("id, costo_unitario_neto, costo_unitario_efectivo")
      .eq("tenant_id", tenantAId)
      .eq("producto_id", prod!.id)
      .eq("codigo_lote", loteCodigo);

    expect(lotes).toHaveLength(2);
    const costosNetos = (lotes ?? []).map((l) => Number(l.costo_unitario_neto)).sort();
    expect(costosNetos).toEqual([100, 130]);
  });

  it("RN-LO2: sin fecha de vencimiento no se confirma", async () => {
    const { data: prod } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId, codigo: `PROD-LO2-${Date.now()}`, nombre: "Prod LO2 Venc", unidad_medida_id: unidadId,
        controla_lote: true, controla_vencimiento: true,
      })
      .select("id").single();

    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    // Item sin fecha_vencimiento
    await serviceDb.from("compras_items").insert({
      tenant_id: tenantAId, compra_id: c!.id, producto_id: prod!.id, cantidad: 10,
      costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: "LOTE-NOVENC", fecha_vencimiento: null,
      importe_neto: 1000, importe_iva: 210, importe_total: 1210,
    });

    const { error: errRpc } = await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });
    expect(errRpc).not.toBeNull();
    expect(errRpc?.message).toMatch(/EXPIRY_REQUIRED/);
  });

  it("RN-LO3: el producto sin control de lote genera un lote genérico", async () => {
    const { data: prod } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId, codigo: `PROD-LO3-${Date.now()}`, nombre: "Prod LO3 Sin Lote", unidad_medida_id: unidadId,
        controla_lote: false, controla_vencimiento: false,
      })
      .select("id").single();

    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    await serviceDb.from("compras_items").insert({
      tenant_id: tenantAId, compra_id: c!.id, producto_id: prod!.id, cantidad: 10,
      costo_unitario_neto: 50, alicuota_iva: 21, codigo_lote: null, fecha_vencimiento: null,
      importe_neto: 500, importe_iva: 105, importe_total: 605,
    });

    const { error: errRpc } = await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });
    expect(errRpc).toBeNull();

    // El lote creado tiene codigo_lote y fecha_vencimiento en NULL
    const { data: lote } = await serviceDb
      .from("lotes")
      .select("id, codigo_lote, fecha_vencimiento")
      .eq("tenant_id", tenantAId)
      .eq("producto_id", prod!.id)
      .single();
    expect(lote).not.toBeNull();
    expect(lote?.codigo_lote).toBeNull();
    expect(lote?.fecha_vencimiento).toBeNull();

    // El movimiento tiene lote_id no nulo
    const { data: mov } = await serviceDb
      .from("movimientos_stock")
      .select("id, lote_id")
      .eq("tenant_id", tenantAId)
      .eq("producto_id", prod!.id)
      .single();
    expect(mov?.lote_id).toBe(lote!.id);
  });

  it("RN-MV7: la operación es atómica", async () => {
    const { data: pActivo } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId, codigo: `PROD-ATOM-ACT-${Date.now()}`, nombre: "Prod Activo",
        unidad_medida_id: unidadId, controla_lote: true, controla_vencimiento: false, activo: true,
      })
      .select("id").single();

    const { data: pInactivo } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId, codigo: `PROD-ATOM-INACT-${Date.now()}`, nombre: "Prod Inactivo",
        unidad_medida_id: unidadId, controla_lote: true, controla_vencimiento: false, activo: false,
      })
      .select("id").single();

    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    const { data: items } = await serviceDb.from("compras_items").insert([
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: pActivo!.id, cantidad: 10,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: "L-ATOM-1", importe_neto: 1000, importe_iva: 210, importe_total: 1210,
      },
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: pActivo!.id, cantidad: 20,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: "L-ATOM-2", importe_neto: 2000, importe_iva: 420, importe_total: 2420,
      },
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: pInactivo!.id, cantidad: 30,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: "L-ATOM-3", importe_neto: 3000, importe_iva: 630, importe_total: 3630,
      },
    ]).select("id");

    const itemIds = (items ?? []).map((i) => i.id);

    // Intentar confirmar -> falla por PRODUCT_INACTIVE
    const { error: errRpc } = await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });
    expect(errRpc).not.toBeNull();
    expect(errRpc?.message).toMatch(/PRODUCT_INACTIVE/);

    // Verificar que NO quedó ningún lote ni movimiento creado para ninguno de los ítems
    const { data: lotesCreados } = await serviceDb
      .from("lotes")
      .select("id")
      .in("compra_item_id", itemIds);
    expect(lotesCreados ?? []).toHaveLength(0);

    const { data: movsCreados } = await serviceDb
      .from("movimientos_stock")
      .select("id")
      .in("compra_item_id", itemIds);
    expect(movsCreados ?? []).toHaveLength(0);
  });

  it("RN-MV7: los movimientos de una compra comparten operacion_id", async () => {
    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    const { data: items } = await serviceDb.from("compras_items").insert([
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 2,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-OP-1-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 200, importe_iva: 42, importe_total: 242,
      },
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 3,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-OP-2-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 300, importe_iva: 63, importe_total: 363,
      },
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 4,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-OP-3-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 400, importe_iva: 84, importe_total: 484,
      },
    ]).select("id");

    const itemIds = (items ?? []).map((i) => i.id);

    const { error: errRpc } = await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });
    expect(errRpc).toBeNull();

    const { data: movs } = await serviceDb
      .from("movimientos_stock")
      .select("operacion_id")
      .in("compra_item_id", itemIds);

    expect(movs).toHaveLength(3);
    const opIds = new Set((movs ?? []).map((m) => m.operacion_id));
    expect(opIds.size).toBe(1);
  });

  it("RN-PRV2: un proveedor inactivo no recibe compras", async () => {
    const { data: provInactivo } = await serviceDb
      .from("proveedores")
      .insert({
        tenant_id: tenantAId, razon_social: `Prov Inactivo ${Date.now()}`, activo: false,
      })
      .select("id").single();

    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: provInactivo!.id, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    await serviceDb.from("compras_items").insert({
      tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 10,
      costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: "L-PRV2", fecha_vencimiento: "2027-12-31",
      importe_neto: 1000, importe_iva: 210, importe_total: 1210,
    });

    const { error: errRpc } = await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });
    expect(errRpc).not.toBeNull();
    expect(errRpc?.message).toMatch(/SUPPLIER_INACTIVE/);
  });

  it("RN-PRV3: un proveedor con compras no se borra", async () => {
    const { data: prov } = await serviceDb
      .from("proveedores")
      .insert({
        tenant_id: tenantAId, razon_social: `Prov PRV3 ${Date.now()}`, activo: true,
      })
      .select("id").single();

    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: prov!.id, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    // Intentar borrar proveedor con compra asociada -> falla por FK compuesta (23503)
    const { error: errDel } = await serviceDb.from("proveedores").delete().eq("id", prov!.id);
    expect(errDel).not.toBeNull();
    expect(errDel?.code).toBe("23503");
  });

  it("RN-CM3: anular sin salidas genera contra-asientos", async () => {
    // 1. Crear y confirmar compra de 2 ítems
    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    const { data: items } = await serviceDb.from("compras_items").insert([
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 10,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-ANUL-1-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 1000, importe_iva: 210, importe_total: 1210,
      },
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 20,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-ANUL-2-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 2000, importe_iva: 420, importe_total: 2420,
      },
    ]).select("id");

    const itemIds = (items ?? []).map((i) => i.id);

    await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });

    // 2. Anular compra
    const motivo = "Factura anulada por devolución completa al proveedor";
    const { data: resAnular, error: errAnular } = await serviceDb.rpc("anular_compra", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_compra_id: c!.id,
      p_motivo: motivo,
    });
    expect(errAnular).toBeNull();
    expect(resAnular).toHaveLength(1);
    expect(resAnular[0].movimientos_generados).toBe(2);

    // Estado anulada y observaciones guardadas
    const { data: cAnulada } = await serviceDb
      .from("compras")
      .select("estado, observaciones")
      .eq("id", c!.id)
      .single();
    expect(cAnulada?.estado).toBe("anulada");
    expect(cAnulada?.observaciones).toBe(motivo);

    // Lotes de la compra tienen existencia en 0
    const { data: lotes } = await serviceDb
      .from("lotes")
      .select("id")
      .in("compra_item_id", itemIds);

    for (const l of lotes ?? []) {
      const { data: ex } = await serviceDb
        .from("existencias_lote")
        .select("cantidad")
        .eq("lote_id", l.id)
        .single();
      expect(Number(ex?.cantidad)).toBe(0);
    }
  });

  it("RN-CM3: anular con salidas falla", async () => {
    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    const { data: it } = await serviceDb
      .from("compras_items")
      .insert({
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 10,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-EXIT-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 1000, importe_iva: 210, importe_total: 1210,
      })
      .select("id").single();

    await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });

    const { data: lote } = await serviceDb
      .from("lotes")
      .select("id")
      .eq("compra_item_id", it!.id)
      .single();

    // Generar una salida previa (por ejemplo salida_ajuste con motivo)
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_ajuste",
      producto_id: productoAId,
      lote_id: lote!.id,
      cantidad: 2,
      costo_unitario: 121,
      costo_total: 242,
      motivo: "Ajuste de prueba con salida",
      usuario_id: usuarioAId,
    });

    // Intentar anular la compra -> debe fallar con PURCHASE_HAS_EXITS
    const { error: errAnular } = await serviceDb.rpc("anular_compra", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_compra_id: c!.id,
      p_motivo: "Intento anular compra que ya tuvo salida",
    });
    expect(errAnular).not.toBeNull();
    expect(errAnular?.message).toMatch(/PURCHASE_HAS_EXITS/);

    // La compra sigue confirmada
    const { data: cCheck } = await serviceDb
      .from("compras")
      .select("estado")
      .eq("id", c!.id)
      .single();
    expect(cCheck?.estado).toBe("confirmada");
  });

  it("RN-CM3: anular sin motivo falla", async () => {
    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    await serviceDb.from("compras_items").insert({
      tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 10,
      costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-NOMOT-${Date.now()}`, fecha_vencimiento: "2027-12-31",
      importe_neto: 1000, importe_iva: 210, importe_total: 1210,
    });

    await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });

    // Sin motivo (null)
    const { error: errNull } = await serviceDb.rpc("anular_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id, p_motivo: null as any,
    });
    expect(errNull).not.toBeNull();
    expect(errNull?.message).toMatch(/REASON_REQUIRED/);

    // Con motivo corto (<10 chars)
    const { error: errCorto } = await serviceDb.rpc("anular_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id, p_motivo: "error",
    });
    expect(errCorto).not.toBeNull();
    expect(errCorto?.message).toMatch(/REASON_REQUIRED/);
  });

  it("RN-MV9: nada se borra, se compensa", async () => {
    const { data: c } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: proveedorAId, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id").single();

    const { data: items } = await serviceDb.from("compras_items").insert([
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 5,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-MV9-1-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 500, importe_iva: 105, importe_total: 605,
      },
      {
        tenant_id: tenantAId, compra_id: c!.id, producto_id: productoAId, cantidad: 8,
        costo_unitario_neto: 100, alicuota_iva: 21, codigo_lote: `L-MV9-2-${Date.now()}`, fecha_vencimiento: "2027-12-31",
        importe_neto: 800, importe_iva: 168, importe_total: 968,
      },
    ]).select("id");

    const itemIds = (items ?? []).map((i) => i.id);

    await serviceDb.rpc("confirmar_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
    });

    await serviceDb.rpc("anular_compra", {
      p_tenant_id: tenantAId, p_usuario_id: usuarioAId, p_compra_id: c!.id,
      p_motivo: "Compensación completa por error de carga en sistema",
    });

    const { data: lotes } = await serviceDb
      .from("lotes")
      .select("id")
      .in("compra_item_id", itemIds);

    const loteIds = (lotes ?? []).map((l) => l.id);

    // En vez de 0 movimientos, hay 4 (2 entradas y 2 salidas de ajuste)
    const { data: movs } = await serviceDb
      .from("movimientos_stock")
      .select("id, tipo")
      .in("lote_id", loteIds);

    expect(movs).toHaveLength(4);
    const tipos = (movs ?? []).map((m) => m.tipo);
    expect(tipos.filter((t) => t === "entrada_compra")).toHaveLength(2);
    expect(tipos.filter((t) => t === "salida_ajuste")).toHaveLength(2);
  });
});
