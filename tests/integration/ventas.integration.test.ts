import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, borrarUsuarioAuth } from "./_teardown.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

let serviceDb: SupabaseClient;

let tenantAId = "";
let usuarioAId = "";
let cajaAId = "";
let sesionAId = "";
let productoAId = "";
let servicioAId = "";

let tenantBId = "";
let usuarioBId = "";
let cajaBId = "";
let sesionBId = "";
let servicioBId = "";

let medioPagoEfectivoId = "";

export async function crearFixtureVentas(db: SupabaseClient, prefix: string) {
  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant Ventas`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-1`,
    p_email_contacto: `${prefix.toLowerCase()}_ventas_${Date.now()}@test.com`,
    p_plan: "premium",
  });
  if (errT || !t) throw new Error(`Error creando tenant: ${errT?.message}`);
  const tenantId = typeof t === "string" ? t : (t as { id: string }).id;

  // 2. Rol admin
  const { data: r } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "admin")
    .single();
  const rolId = r!.id as string;

  // 3. Usuario Auth + DB
  const usuarioId = await crearUsuarioAuth(`${prefix.toLowerCase()}_vnt_${Date.now()}@test.com`, {
    tenant_id: tenantId,
  });

  const { error: errU } = await db.from("usuarios").insert({
    id: usuarioId,
    tenant_id: tenantId,
    username: `${prefix.toLowerCase()}_adm_${Date.now()}`,
    email: `${prefix.toLowerCase()}_vnt_${Date.now()}@test.com`,
    full_name: `${prefix} Admin Ventas`,
    rol_id: rolId,
    active: true,
  });
  if (errU) throw new Error(`Error creando usuario: ${errU?.message}`);

  // 4. Caja
  const { data: c, error: errC } = await db
    .from("cajas")
    .insert({
      tenant_id: tenantId,
      nombre: `${prefix} Caja Mostrador`,
    })
    .select("id")
    .single();
  if (errC || !c) throw new Error(`Error creando caja: ${errC?.message}`);
  const cajaId = c.id as string;

  // 5. Sesión abierta
  const { data: s, error: errS } = await db
    .from("sesiones_caja")
    .insert({
      tenant_id: tenantId,
      caja_id: cajaId,
      estado: "abierta",
      apertura_usuario_id: usuarioId,
      saldo_inicial: 1000,
    })
    .select("id")
    .single();
  if (errS || !s) throw new Error(`Error creando sesion: ${errS?.message}`);
  const sesionId = s.id as string;

  // 6. Unidad de medida para productos
  const { data: um } = await db
    .from("unidades_medida")
    .select("id")
    .eq("codigo", "unidad")
    .single();
  const unidadMedidaId = um?.id as string;

  // 7. Producto
  const { data: p, error: errP } = await db
    .from("productos")
    .insert({
      tenant_id: tenantId,
      codigo: `PROD-${prefix}-${Date.now()}`,
      nombre: `${prefix} Producto Prueba`,
      unidad_medida_id: unidadMedidaId,
      precio_venta: 1000,
      alicuota_iva: 21.00,
      activo: true,
      es_vendible: true,
    })
    .select("id")
    .single();
  if (errP || !p) throw new Error(`Error creando producto: ${errP?.message}`);
  const productoId = p.id as string;

  // 8. Servicio
  const { data: svc, error: errSvc } = await db
    .from("servicios")
    .insert({
      tenant_id: tenantId,
      nombre: `${prefix} Servicio Consulta`,
      precio: 2500,
      alicuota_iva: 21.00,
      duracion_minutos: 30,
      tipo: "clinica",
      activo: true,
    })
    .select("id")
    .single();
  if (errSvc || !svc) throw new Error(`Error creando servicio: ${errSvc?.message}`);
  const servicioId = svc.id as string;

  return { tenantId, usuarioId, cajaId, sesionId, productoId, servicioId };
}

describeIntegration("C4·T1: Restricciones de base de datos para Ventas", () => {
  beforeAll(async () => {
    serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fixtureA = await crearFixtureVentas(serviceDb, "VT_A");
    tenantAId = fixtureA.tenantId;
    usuarioAId = fixtureA.usuarioId;
    cajaAId = fixtureA.cajaId;
    sesionAId = fixtureA.sesionId;
    productoAId = fixtureA.productoId;
    servicioAId = fixtureA.servicioId;

    const fixtureB = await crearFixtureVentas(serviceDb, "VT_B");
    tenantBId = fixtureB.tenantId;
    usuarioBId = fixtureB.usuarioId;
    cajaBId = fixtureB.cajaId;
    sesionBId = fixtureB.sesionId;
    servicioBId = fixtureB.servicioId;

    const { data: mp } = await serviceDb
      .from("medios_pago")
      .select("id")
      .eq("codigo", "efectivo")
      .single();
    medioPagoEfectivoId = mp?.id as string;
  });

  afterAll(async () => {
    if (!serviceDb) return;
    if (usuarioAId) await borrarUsuarioAuth(usuarioAId);
    if (usuarioBId) await borrarUsuarioAuth(usuarioBId);
    if (tenantAId) {
      await serviceDb.from("ventas_pagos").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("movimientos_stock").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("ventas_items").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("movimientos_caja").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("ventas").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("sesiones_caja").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("cajas").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("servicios").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("productos").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("contadores_tenant").delete().eq("tenant_id", tenantAId);
      await serviceDb.from("tenants").delete().eq("id", tenantAId);
    }
    if (tenantBId) {
      await serviceDb.from("ventas_pagos").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("movimientos_stock").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("ventas_items").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("movimientos_caja").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("ventas").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("sesiones_caja").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("cajas").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("servicios").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("productos").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("contadores_tenant").delete().eq("tenant_id", tenantBId);
      await serviceDb.from("tenants").delete().eq("id", tenantBId);
    }
  });

  it("RN-VT3: una línea es de producto o de servicio, nunca las dos", async () => {
    // 1. Crear venta base
    const { data: v, error: errV } = await serviceDb
      .from("ventas")
      .insert({
        tenant_id: tenantAId,
        numero_operacion: 101,
        sesion_caja_id: sesionAId,
        usuario_id: usuarioAId,
        subtotal_neto: 826.45,
        total_iva: 173.55,
        total: 1000,
      })
      .select("id")
      .single();

    expect(errV).toBeNull();
    const ventaId = v!.id as string;

    // Caso A: tipo_item = 'producto' con ambos producto_id y servicio_id -> viola CHECK chk_ventas_items_tipo
    const { error: errAmbos } = await serviceDb.from("ventas_items").insert({
      tenant_id: tenantAId,
      venta_id: ventaId,
      tipo_item: "producto",
      producto_id: productoAId,
      servicio_id: servicioAId,
      descripcion_snapshot: "Item inválido ambos",
      cantidad: 1,
      precio_unitario: 1000,
      alicuota_iva: 21.00,
      neto_unitario: 826.45,
      iva_unitario: 173.55,
      importe_total: 1000,
    });
    expect(errAmbos).not.toBeNull();
    expect(errAmbos?.code).toBe("23514"); // check_violation

    // Caso B: tipo_item = 'producto' con ninguno (ambos null) -> viola CHECK
    const { error: errNinguno } = await serviceDb.from("ventas_items").insert({
      tenant_id: tenantAId,
      venta_id: ventaId,
      tipo_item: "producto",
      producto_id: null,
      servicio_id: null,
      descripcion_snapshot: "Item inválido ninguno",
      cantidad: 1,
      precio_unitario: 1000,
      alicuota_iva: 21.00,
      neto_unitario: 826.45,
      iva_unitario: 173.55,
      importe_total: 1000,
    });
    expect(errNinguno).not.toBeNull();
    expect(errNinguno?.code).toBe("23514");

    // Caso C: tipo_item = 'servicio' con producto_id puesto y servicio_id null -> viola CHECK
    const { error: errInvertido } = await serviceDb.from("ventas_items").insert({
      tenant_id: tenantAId,
      venta_id: ventaId,
      tipo_item: "servicio",
      producto_id: productoAId,
      servicio_id: null,
      descripcion_snapshot: "Item invertido",
      cantidad: 1,
      precio_unitario: 2500,
      alicuota_iva: 21.00,
      neto_unitario: 2066.12,
      iva_unitario: 433.88,
      importe_total: 2500,
    });
    expect(errInvertido).not.toBeNull();
    expect(errInvertido?.code).toBe("23514");

    // Caso D: tipo_item = 'producto' válido (producto_id puesto, servicio_id null) -> OK
    const { error: errProdOk } = await serviceDb.from("ventas_items").insert({
      tenant_id: tenantAId,
      venta_id: ventaId,
      tipo_item: "producto",
      producto_id: productoAId,
      servicio_id: null,
      descripcion_snapshot: "Producto Válido",
      cantidad: 1,
      precio_unitario: 1000,
      alicuota_iva: 21.00,
      neto_unitario: 826.45,
      iva_unitario: 173.55,
      importe_total: 1000,
    });
    expect(errProdOk).toBeNull();

    // Caso E: tipo_item = 'servicio' válido (servicio_id puesto, producto_id null) -> OK
    const { error: errSvcOk } = await serviceDb.from("ventas_items").insert({
      tenant_id: tenantAId,
      venta_id: ventaId,
      tipo_item: "servicio",
      producto_id: null,
      servicio_id: servicioAId,
      descripcion_snapshot: "Servicio Válido",
      cantidad: 1,
      precio_unitario: 2500,
      alicuota_iva: 21.00,
      neto_unitario: 2066.12,
      iva_unitario: 433.88,
      importe_total: 2500,
    });
    expect(errSvcOk).toBeNull();
  });

  it("una venta registrada no se puede dejar a medio anular", async () => {
    const { data: v, error: errV } = await serviceDb
      .from("ventas")
      .insert({
        tenant_id: tenantAId,
        numero_operacion: 102,
        sesion_caja_id: sesionAId,
        usuario_id: usuarioAId,
        subtotal_neto: 826.45,
        total_iva: 173.55,
        total: 1000,
        estado: "registrada",
      })
      .select("id")
      .single();
    expect(errV).toBeNull();
    const ventaId = v!.id as string;

    // Intento de anulación parcial (sin motivo_anulacion) -> viola chk_ventas_anulacion_completa
    const { error: errParcial } = await serviceDb
      .from("ventas")
      .update({
        estado: "anulada",
        anulada_at: new Date().toISOString(),
        anulada_por_usuario_id: usuarioAId,
        motivo_anulacion: null,
      })
      .eq("id", ventaId);
    expect(errParcial).not.toBeNull();
    expect(errParcial?.code).toBe("23514");

    // Anulación completa con los 3 campos -> OK
    const { error: errCompleta } = await serviceDb
      .from("ventas")
      .update({
        estado: "anulada",
        anulada_at: new Date().toISOString(),
        anulada_por_usuario_id: usuarioAId,
        motivo_anulacion: "Error de cobro duplicado",
      })
      .eq("id", ventaId);
    expect(errCompleta).toBeNull();
  });

  it("el número de operación es único por tenant", async () => {
    // 1. Insertar numero_operacion = 200 en tenant A -> OK
    const { error: err1 } = await serviceDb.from("ventas").insert({
      tenant_id: tenantAId,
      numero_operacion: 200,
      sesion_caja_id: sesionAId,
      usuario_id: usuarioAId,
      subtotal_neto: 826.45,
      total_iva: 173.55,
      total: 1000,
    });
    expect(err1).toBeNull();

    // 2. Mismo numero_operacion = 200 en tenant A -> viola uq_ventas_tenant_numero
    const { error: errDuplicado } = await serviceDb.from("ventas").insert({
      tenant_id: tenantAId,
      numero_operacion: 200,
      sesion_caja_id: sesionAId,
      usuario_id: usuarioAId,
      subtotal_neto: 826.45,
      total_iva: 173.55,
      total: 1000,
    });
    expect(errDuplicado).not.toBeNull();
    expect(errDuplicado?.code).toBe("23505"); // unique_violation

    // 3. Mismo numero_operacion = 200 en tenant B -> OK (aislado por tenant)
    const { error: errTenantB } = await serviceDb.from("ventas").insert({
      tenant_id: tenantBId,
      numero_operacion: 200,
      sesion_caja_id: sesionBId,
      usuario_id: usuarioBId,
      subtotal_neto: 826.45,
      total_iva: 173.55,
      total: 1000,
    });
    expect(errTenantB).toBeNull();
  });

  it("RN-SC2: una venta de A no puede colgar de una sesión de caja de B", async () => {
    // FK compuesta ventas_sesion_caja_tenant_fkey: (sesion_caja_id, tenant_id)
    const { error: errCrossSesion } = await serviceDb.from("ventas").insert({
      tenant_id: tenantAId,
      numero_operacion: 301,
      sesion_caja_id: sesionBId, // Sesión perteneciente a Tenant B
      usuario_id: usuarioAId,
      subtotal_neto: 826.45,
      total_iva: 173.55,
      total: 1000,
    });

    expect(errCrossSesion).not.toBeNull();
    expect(errCrossSesion?.code).toBe("23503"); // foreign_key_violation
  });

  it("RN-SC2: una línea de A no puede referenciar un servicio de B", async () => {
    // Crear venta válida en A
    const { data: v } = await serviceDb
      .from("ventas")
      .insert({
        tenant_id: tenantAId,
        numero_operacion: 302,
        sesion_caja_id: sesionAId,
        usuario_id: usuarioAId,
        subtotal_neto: 2066.12,
        total_iva: 433.88,
        total: 2500,
      })
      .select("id")
      .single();
    const ventaId = v!.id as string;

    // FK compuesta ventas_items_servicio_tenant_fkey: (servicio_id, tenant_id)
    const { error: errCrossServicio } = await serviceDb.from("ventas_items").insert({
      tenant_id: tenantAId,
      venta_id: ventaId,
      tipo_item: "servicio",
      producto_id: null,
      servicio_id: servicioBId, // Servicio perteneciente a Tenant B
      descripcion_snapshot: "Cross tenant servicio",
      cantidad: 1,
      precio_unitario: 2500,
      alicuota_iva: 21.00,
      neto_unitario: 2066.12,
      iva_unitario: 433.88,
      importe_total: 2500,
    });

    expect(errCrossServicio).not.toBeNull();
    expect(errCrossServicio?.code).toBe("23503");
  });
});
