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
let clienteAId = "";
let productoAId = "";
let loteAId = "";

let tenantBId = "";
let usuarioBId = "";
let cajaBId = "";
let sesionBId = "";
let clienteBId = "";
let productoBId = "";
let loteBId = "";

let medioPagoEfectivoId = "";

export async function crearFixtureAjustes(db: SupabaseClient, prefix: string) {
  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant Ajustes`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-1`,
    p_email_contacto: `${prefix.toLowerCase()}_ajustes_${Date.now()}@test.com`,
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
  const usuarioId = await crearUsuarioAuth(`${prefix.toLowerCase()}_aj_${Date.now()}@test.com`, {
    tenant_id: tenantId,
  });

  const { error: errU } = await db.from("usuarios").insert({
    id: usuarioId,
    tenant_id: tenantId,
    username: `${prefix.toLowerCase()}_adm_${Date.now()}`,
    email: `${prefix.toLowerCase()}_aj_${Date.now()}@test.com`,
    full_name: `${prefix} Admin Ajustes`,
    rol_id: rolId,
    active: true,
  });
  if (errU) throw new Error(`Error creando usuario: ${errU?.message}`);

  // 4. Caja
  const { data: c, error: errC } = await db
    .from("cajas")
    .insert({
      tenant_id: tenantId,
      nombre: `${prefix} Caja Principal`,
    })
    .select("id")
    .single();
  if (errC || !c) throw new Error(`Error creando caja: ${errC?.message}`);
  const cajaId = c.id as string;

  // 5. Sesion abierta
  const { data: s, error: errS } = await db
    .from("sesiones_caja")
    .insert({
      tenant_id: tenantId,
      caja_id: cajaId,
      estado: "abierta",
      apertura_usuario_id: usuarioId,
      saldo_inicial: 5000,
    })
    .select("id")
    .single();
  if (errS || !s) throw new Error(`Error creando sesion: ${errS?.message}`);
  const sesionId = s.id as string;

  // 6. Cliente
  const { data: cli, error: errCli } = await db
    .from("clientes")
    .insert({
      tenant_id: tenantId,
      full_name: `${prefix} Juan Perez`,
      phone: "1122334455",
      condicion_fiscal: "consumidor_final",
    })
    .select("id")
    .single();
  if (errCli || !cli) throw new Error(`Error creando cliente: ${errCli?.message}`);
  const clienteId = cli.id as string;

  // 7. Unidad de medida
  const { data: um } = await db
    .from("unidades_medida")
    .select("id")
    .eq("codigo", "unidad")
    .single();
  const unidadMedidaId = um?.id as string;

  // 8. Producto
  const { data: p, error: errP } = await db
    .from("productos")
    .insert({
      tenant_id: tenantId,
      codigo: `PROD-${prefix}-${Date.now()}`,
      nombre: `${prefix} Producto Ajustes`,
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

  // 9. Lote
  const { data: l, error: errL } = await db
    .from("lotes")
    .insert({
      tenant_id: tenantId,
      producto_id: productoId,
      codigo_lote: `LOTE-${prefix}-${Date.now()}`,
      costo_unitario_neto: 400,
      costo_unitario_efectivo: 400,
      origen: "compra",
      usuario_id: usuarioId,
      estado: "disponible",
      fecha_vencimiento: "2030-12-31",
    })
    .select("id")
    .single();
  if (errL || !l) throw new Error(`Error creando lote: ${errL?.message}`);
  const loteId = l.id as string;

  // 10. Movimiento inicial
  const { error: errM } = await db.from("movimientos_stock").insert({
    tenant_id: tenantId,
    operacion_id: crypto.randomUUID(),
    tipo: "entrada_inicial",
    producto_id: productoId,
    lote_id: loteId,
    cantidad: 50,
    costo_unitario: 400,
    costo_total: 20000,
    motivo: "Stock inicial para tests",
    usuario_id: usuarioId,
  });
  if (errM) throw new Error(`Error creando movimiento inicial: ${errM?.message}`);

  return { tenantId, usuarioId, cajaId, sesionId, clienteId, productoId, loteId };
}

describeIntegration("C5·T1: Restricciones de base de datos para Recuentos", () => {
  beforeAll(async () => {
    serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: mp } = await serviceDb
      .from("medios_pago")
      .select("id")
      .eq("codigo", "efectivo")
      .single();
    medioPagoEfectivoId = mp!.id;

    const fixtureA = await crearFixtureAjustes(serviceDb, "AJ_A");
    tenantAId = fixtureA.tenantId;
    usuarioAId = fixtureA.usuarioId;
    cajaAId = fixtureA.cajaId;
    sesionAId = fixtureA.sesionId;
    clienteAId = fixtureA.clienteId;
    productoAId = fixtureA.productoId;
    loteAId = fixtureA.loteId;

    const fixtureB = await crearFixtureAjustes(serviceDb, "AJ_B");
    tenantBId = fixtureB.tenantId;
    usuarioBId = fixtureB.usuarioId;
    cajaBId = fixtureB.cajaId;
    sesionBId = fixtureB.sesionId;
    clienteBId = fixtureB.clienteId;
    productoBId = fixtureB.productoId;
    loteBId = fixtureB.loteId;
  });

  afterAll(async () => {
    if (usuarioAId) await borrarUsuarioAuth(usuarioAId);
    if (usuarioBId) await borrarUsuarioAuth(usuarioBId);
  });

  it("un recuento aplicado no puede quedar sin autor", async () => {
    const { data: rec, error: errRec } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();
    expect(errRec).toBeNull();
    const recuentoId = rec!.id;

    const { error: errUpdateIncompleto } = await serviceDb
      .from("recuentos")
      .update({
        estado: "aplicado",
        aplicado_at: new Date().toISOString(),
        aplicado_por_usuario_id: null,
      })
      .eq("id", recuentoId);
    expect(errUpdateIncompleto).not.toBeNull();
    expect(errUpdateIncompleto?.message).toMatch(/chk_recuento_aplicado_completo/);

    const { error: errUpdateSinFecha } = await serviceDb
      .from("recuentos")
      .update({
        estado: "aplicado",
        aplicado_at: null,
        aplicado_por_usuario_id: usuarioAId,
      })
      .eq("id", recuentoId);
    expect(errUpdateSinFecha).not.toBeNull();
    expect(errUpdateSinFecha?.message).toMatch(/chk_recuento_aplicado_completo/);

    const { error: errUpdateOk } = await serviceDb
      .from("recuentos")
      .update({
        estado: "aplicado",
        aplicado_at: new Date().toISOString(),
        aplicado_por_usuario_id: usuarioAId,
      })
      .eq("id", recuentoId);
    expect(errUpdateOk).toBeNull();
  });

  it("hay un solo recuento en borrador por tenant", async () => {
    const { data: rec1, error: err1 } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();
    expect(err1).toBeNull();

    const { error: err2 } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      });
    expect(err2).not.toBeNull();
    expect(err2?.message).toMatch(/uq_recuento_borrador/);

    const { error: errB } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantBId,
        usuario_id: usuarioBId,
        estado: "borrador",
      });
    expect(errB).toBeNull();

    const { error: errApply } = await serviceDb
      .from("recuentos")
      .update({
        estado: "aplicado",
        aplicado_at: new Date().toISOString(),
        aplicado_por_usuario_id: usuarioAId,
      })
      .eq("id", rec1!.id);
    expect(errApply).toBeNull();

    const { error: err3 } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      });
    expect(err3).toBeNull();
  });

  it("un lote no se cuenta dos veces en el mismo recuento", async () => {
    const { data: rec } = await serviceDb
      .from("recuentos")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("estado", "borrador")
      .single();
    const recuentoId = rec!.id;

    const { error: errDet1 } = await serviceDb
      .from("recuentos_detalle")
      .insert({
        tenant_id: tenantAId,
        recuento_id: recuentoId,
        lote_id: loteAId,
        cantidad_contada: 15,
        motivo: "Recuento físico lote A",
      });
    expect(errDet1).toBeNull();

    const { error: errDet2 } = await serviceDb
      .from("recuentos_detalle")
      .insert({
        tenant_id: tenantAId,
        recuento_id: recuentoId,
        lote_id: loteAId,
        cantidad_contada: 12,
        motivo: "Segundo conteo duplicado",
      });
    expect(errDet2).not.toBeNull();
    expect(errDet2?.message).toMatch(/uq_recuento_lote/);
  });

  it("la cantidad contada no es negativa", async () => {
    const { data: l } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `LOTE-CHK-${Date.now()}`,
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();
    const testLoteId = l!.id;

    const { data: rec } = await serviceDb
      .from("recuentos")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("estado", "borrador")
      .single();
    const recuentoId = rec!.id;

    const { error: errNegativo } = await serviceDb
      .from("recuentos_detalle")
      .insert({
        tenant_id: tenantAId,
        recuento_id: recuentoId,
        lote_id: testLoteId,
        cantidad_contada: -1,
      });
    expect(errNegativo).not.toBeNull();
    expect(errNegativo?.message).toMatch(/recuentos_detalle_cantidad_contada_check/);

    const { error: errCero } = await serviceDb
      .from("recuentos_detalle")
      .insert({
        tenant_id: tenantAId,
        recuento_id: recuentoId,
        lote_id: testLoteId,
        cantidad_contada: 0,
      });
    expect(errCero).toBeNull();
  });

  it("RN-SC2: un detalle de A no puede referenciar un lote de B", async () => {
    const { data: rec } = await serviceDb
      .from("recuentos")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("estado", "borrador")
      .single();
    const recuentoId = rec!.id;

    const { error } = await serviceDb
      .from("recuentos_detalle")
      .insert({
        tenant_id: tenantAId,
        recuento_id: recuentoId,
        lote_id: loteBId,
        cantidad_contada: 5,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/recuentos_detalle_lote_tenant_fkey|23503/);
  });

  it("borrar un recuento en borrador se lleva sus detalles", async () => {
    await serviceDb
      .from("recuentos")
      .delete()
      .eq("tenant_id", tenantAId)
      .eq("estado", "borrador");

    const { data: rec, error: errRec } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();
    expect(errRec).toBeNull();
    const recuentoId = rec!.id;

    const { data: det, error: errDet } = await serviceDb
      .from("recuentos_detalle")
      .insert({
        tenant_id: tenantAId,
        recuento_id: recuentoId,
        lote_id: loteAId,
        cantidad_contada: 10,
      })
      .select("id")
      .single();
    expect(errDet).toBeNull();
    const detalleId = det!.id;

    const { error: errDel } = await serviceDb
      .from("recuentos")
      .delete()
      .eq("id", recuentoId);
    expect(errDel).toBeNull();

    const { data: detDespues } = await serviceDb
      .from("recuentos_detalle")
      .select("id")
      .eq("id", detalleId);
    expect(detDespues ?? []).toHaveLength(0);

    const { data: recAplicado } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "aplicado",
        aplicado_at: new Date().toISOString(),
        aplicado_por_usuario_id: usuarioAId,
      })
      .select("id")
      .single();
    const recAplicadoId = recAplicado!.id;

    const { error: errMov } = await serviceDb
      .from("movimientos_stock")
      .insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "sobrante_recuento",
        producto_id: productoAId,
        lote_id: loteAId,
        cantidad: 2,
        costo_unitario: 500,
        costo_total: 1000,
        recuento_id: recAplicadoId,
        usuario_id: usuarioAId,
      });
    expect(errMov).toBeNull();

    const { error: errDelAplicado } = await serviceDb
      .from("recuentos")
      .delete()
      .eq("id", recAplicadoId);
    expect(errDelAplicado).not.toBeNull();
    expect(errDelAplicado?.message).toMatch(/movimientos_stock_recuento_tenant_fkey|23503/);
  });
});

describeIntegration("C5·T2: RPCs ajustar_existencia y registrar_devolucion", () => {
  it("RN-AJ1: el motivo es obligatorio y sustantivo", async () => {
    // 1. Sin motivo (null) -> REASON_REQUIRED
    const { error: errNull } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_tipo: "salida_ajuste",
      p_cantidad: 1,
      p_motivo: null as any,
    });
    expect(errNull?.message).toMatch(/REASON_REQUIRED/);

    // 2. Con 'error' (5 caracteres) -> REASON_REQUIRED
    const { error: errCorto } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_tipo: "salida_ajuste",
      p_cantidad: 1,
      p_motivo: "error",
    });
    expect(errCorto?.message).toMatch(/REASON_REQUIRED/);

    // 3. Con 10 espacios ('          ') -> REASON_REQUIRED (trim)
    const { error: errEspacios } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_tipo: "salida_ajuste",
      p_cantidad: 1,
      p_motivo: "          ",
    });
    expect(errEspacios?.message).toMatch(/REASON_REQUIRED/);

    // 4. Con 'Rotura en el traslado' (sustantivo) -> funciona
    const { data, error: errOk } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_tipo: "salida_ajuste",
      p_cantidad: 1,
      p_motivo: "Rotura en el traslado",
    });
    expect(errOk).toBeNull();
    expect(data).toBeDefined();
  });

  it("RN-AJ1: los tres RPC exigen motivo", async () => {
    // 1. bloquear_lote
    const { error: errBloqCorto } = await serviceDb.rpc("bloquear_lote", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_motivo: "corto",
    });
    expect(errBloqCorto?.message).toMatch(/REASON_REQUIRED/);

    const { error: errBloqOk } = await serviceDb.rpc("bloquear_lote", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_motivo: "Lote observado por control de calidad",
    });
    expect(errBloqOk).toBeNull();

    // 2. desbloquear_lote
    const { error: errDesbloqCorto } = await serviceDb.rpc("desbloquear_lote", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_motivo: "ok",
    });
    expect(errDesbloqCorto?.message).toMatch(/REASON_REQUIRED/);

    const { error: errDesbloqOk } = await serviceDb.rpc("desbloquear_lote", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_motivo: "Lote verificado y conforme para venta",
    });
    expect(errDesbloqOk).toBeNull();

    // 3. registrar_devolucion
    const { error: errDevCorto } = await serviceDb.rpc("registrar_devolucion", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_venta_id: crypto.randomUUID(),
      p_items: [{ ventaItemId: crypto.randomUUID(), cantidad: 1, revendible: true }],
      p_motivo: "falla",
    });
    expect(errDevCorto?.message).toMatch(/REASON_REQUIRED/);
  });

  it("RN-AJ2: un ajuste no se revierte, se compensa", async () => {
    // (a) Ajuste -5 y compensación +5
    const { data: extAntes } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("tenant_id", tenantAId)
      .eq("lote_id", loteAId)
      .single();
    const cantInicial = Number(extAntes!.cantidad);

    const { error: errSalida } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_tipo: "salida_ajuste",
      p_cantidad: 5,
      p_motivo: "Merma detectada en conteo rápido",
    });
    expect(errSalida).toBeNull();

    const { error: errEntrada } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteAId,
      p_tipo: "entrada_ajuste",
      p_cantidad: 5,
      p_motivo: "Compensación por error en conteo inicial",
    });
    expect(errEntrada).toBeNull();

    const { data: extDespues } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("tenant_id", tenantAId)
      .eq("lote_id", loteAId)
      .single();
    expect(Number(extDespues!.cantidad)).toBe(cantInicial);

    // Kárdex contiene ambos movimientos
    const { data: movs } = await serviceDb
      .from("movimientos_stock")
      .select("id, tipo, motivo")
      .eq("tenant_id", tenantAId)
      .eq("lote_id", loteAId)
      .in("tipo", ["salida_ajuste", "entrada_ajuste"]);
    const motivos = (movs ?? []).map((m: { motivo: string }) => m.motivo);
    expect(motivos).toContain("Merma detectada en conteo rápido");
    expect(motivos).toContain("Compensación por error en conteo inicial");
  });

  it("RN-AJ4: una devolución no excede lo vendido", async () => {
    // 1. Vender 5 unidades
    const { data: vData, error: errV } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_sesion_caja_id: sesionAId,
      p_cliente_id: clienteAId,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: productoAId,
          loteId: loteAId,
          cantidad: 5,
          precioUnitario: 1000,
          alicuotaIva: 21.00,
          descuentoPorcentaje: 0,
          motivoFefo: "Seleccion manual de lote para test dev",
        },
      ],
      p_pagos: [
        {
          medioPagoId: medioPagoEfectivoId,
          importe: 5000,
        },
      ],
    });
    expect(errV).toBeNull();
    const ventaId = (vData as Array<{ venta_id: string }>)[0].venta_id;

    // Obtener venta_item_id
    const { data: vItem } = await serviceDb
      .from("ventas_items")
      .select("id, cantidad")
      .eq("venta_id", ventaId)
      .eq("tenant_id", tenantAId)
      .single();
    const ventaItemId = vItem!.id;
    expect(Number(vItem!.cantidad)).toBe(5);

    // 2. Devolver 3 -> OK
    const { error: errDev1 } = await serviceDb.rpc("registrar_devolucion", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_venta_id: ventaId,
      p_items: [{ ventaItemId, cantidad: 3, revendible: true }],
      p_motivo: "Cliente devuelve 3 unidades sin abrir",
      p_reintegra_efectivo: true,
      p_sesion_caja_id: sesionAId,
    });
    expect(errDev1).toBeNull();

    // 3. Devolver 3 otra vez -> Falla (3 + 3 = 6 > 5)
    const { error: errDev2 } = await serviceDb.rpc("registrar_devolucion", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_venta_id: ventaId,
      p_items: [{ ventaItemId, cantidad: 3, revendible: true }],
      p_motivo: "Cliente intenta devolver otras 3 unidades",
      p_reintegra_efectivo: true,
      p_sesion_caja_id: sesionAId,
    });
    expect(errDev2).not.toBeNull();
    expect(errDev2?.message).toMatch(/RETURN_EXCEEDS_SOLD/);

    // 4. Devolver 2 -> OK (3 + 2 = 5 == 5)
    const { error: errDev3 } = await serviceDb.rpc("registrar_devolucion", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_venta_id: ventaId,
      p_items: [{ ventaItemId, cantidad: 2, revendible: true }],
      p_motivo: "Cliente devuelve las 2 restantes",
      p_reintegra_efectivo: true,
      p_sesion_caja_id: sesionAId,
    });
    expect(errDev3).toBeNull();

    // 5. Devolver 1 -> Falla (5 + 1 = 6 > 5)
    const { error: errDev4 } = await serviceDb.rpc("registrar_devolucion", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_venta_id: ventaId,
      p_items: [{ ventaItemId, cantidad: 1, revendible: true }],
      p_motivo: "Intento de devolver 1 unidad extra",
      p_reintegra_efectivo: true,
      p_sesion_caja_id: sesionAId,
    });
    expect(errDev4).not.toBeNull();
    expect(errDev4?.message).toMatch(/RETURN_EXCEEDS_SOLD/);
  });

  it("RN-AJ5: lo no revendible entra a un lote bloqueado", async () => {
    // 1. Vender 4 unidades
    const { data: vData, error: errV } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_sesion_caja_id: sesionAId,
      p_cliente_id: clienteAId,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: productoAId,
          loteId: loteAId,
          cantidad: 4,
          precioUnitario: 1000,
          alicuotaIva: 21.00,
          descuentoPorcentaje: 0,
          motivoFefo: "Seleccion manual de lote para test dev bloqueada",
        },
      ],
      p_pagos: [
        {
          medioPagoId: medioPagoEfectivoId,
          importe: 4000,
        },
      ],
    });
    expect(errV).toBeNull();
    const ventaId = (vData as Array<{ venta_id: string }>)[0].venta_id;

    const { data: vItem } = await serviceDb
      .from("ventas_items")
      .select("id")
      .eq("venta_id", ventaId)
      .eq("tenant_id", tenantAId)
      .single();
    const ventaItemId = vItem!.id;

    // 2. Devolver 2 unidades con revendible = false
    const motivoDev = "Envase abierto y producto dañado por cliente";
    const { error: errDev } = await serviceDb.rpc("registrar_devolucion", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_venta_id: ventaId,
      p_items: [{ ventaItemId, cantidad: 2, revendible: false }],
      p_motivo: motivoDev,
      p_reintegra_efectivo: true,
      p_sesion_caja_id: sesionAId,
    });
    expect(errDev).toBeNull();

    // 3. Verificar que se creó un lote nuevo con estado='bloqueado', motivo_bloqueo y lote_padre_id = loteAId
    const { data: loteBloq, error: errLB } = await serviceDb
      .from("lotes")
      .select("id, estado, motivo_bloqueo, origen, lote_padre_id")
      .eq("tenant_id", tenantAId)
      .eq("lote_padre_id", loteAId)
      .eq("origen", "devolucion")
      .single();
    expect(errLB).toBeNull();
    expect(loteBloq!.estado).toBe("bloqueado");
    expect(loteBloq!.motivo_bloqueo).toBe(motivoDev);
    expect(loteBloq!.lote_padre_id).toBe(loteAId);

    // 4. Verificar que ese lote NO aparece entre los candidatos FEFO (estado = 'disponible')
    const { data: fefoCandidates } = await serviceDb
      .from("lotes")
      .select("id, estado")
      .eq("tenant_id", tenantAId)
      .eq("producto_id", productoAId)
      .eq("estado", "disponible");
    const candidateIds = (fefoCandidates ?? []).map((l: { id: string }) => l.id);
    expect(candidateIds).not.toContain(loteBloq!.id);
  });

  it("RN-AJ7: la única salida de un lote vencido es la merma por vencimiento", async () => {
    // 1. Crear lote vencido con stock inicial 10
    const { data: lVenc } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `LOTE-VENC-${Date.now()}`,
        fecha_vencimiento: "2020-01-01", // vencido
        costo_unitario_neto: 300,
        costo_unitario_efectivo: 300,
        origen: "compra",
        usuario_id: usuarioAId,
        estado: "disponible",
      })
      .select("id")
      .single();
    const loteVencidoId = lVenc!.id;

    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteVencidoId,
      cantidad: 10,
      costo_unitario: 300,
      costo_total: 3000,
      motivo: "Carga lote vencido para test",
      usuario_id: usuarioAId,
    });

    // 2. salida_ajuste -> BATCH_EXPIRED
    const { error: errSalida } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteVencidoId,
      p_tipo: "salida_ajuste",
      p_cantidad: 2,
      p_motivo: "Intento de salida ajuste lote vencido",
    });
    expect(errSalida?.message).toMatch(/BATCH_EXPIRED/);

    // 3. merma_rotura -> BATCH_EXPIRED
    const { error: errRotura } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteVencidoId,
      p_tipo: "merma_rotura",
      p_cantidad: 2,
      p_motivo: "Intento de merma rotura lote vencido",
    });
    expect(errRotura?.message).toMatch(/BATCH_EXPIRED/);

    // 4. entrada_ajuste -> funciona (es entrada, no salida)
    const { error: errEntrada } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteVencidoId,
      p_tipo: "entrada_ajuste",
      p_cantidad: 2,
      p_motivo: "Entrada ajuste correctiva lote vencido",
    });
    expect(errEntrada).toBeNull();

    // 5. merma_vencimiento -> funciona (es la única salida permitida)
    const { error: errMermaVenc } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: loteVencidoId,
      p_tipo: "merma_vencimiento",
      p_cantidad: 5,
      p_motivo: "Baja formal de mercadería vencida",
    });
    expect(errMermaVenc).toBeNull();
  });

  it("RN-LO7: un lote bloqueado acepta ajuste pero no venta", async () => {
    // 1. Crear lote con stock 10
    const { data: lBloq } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `LOTE-BLOQ-TEST-${Date.now()}`,
        fecha_vencimiento: "2030-01-01",
        costo_unitario_neto: 200,
        costo_unitario_efectivo: 200,
        origen: "compra",
        usuario_id: usuarioAId,
        estado: "disponible",
      })
      .select("id")
      .single();
    const testLoteId = lBloq!.id;

    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: testLoteId,
      cantidad: 10,
      costo_unitario: 200,
      costo_total: 2000,
      motivo: "Stock inicial lote para bloqueo",
      usuario_id: usuarioAId,
    });

    // 2. Bloquear lote
    const { error: errBloq } = await serviceDb.rpc("bloquear_lote", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: testLoteId,
      p_motivo: "Lote en cuarentena por lote sospechoso",
    });
    expect(errBloq).toBeNull();

    // 3. Ajustar existencia sobre el lote bloqueado -> Funciona
    const { error: errAjuste } = await serviceDb.rpc("ajustar_existencia", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: testLoteId,
      p_tipo: "salida_ajuste",
      p_cantidad: 2,
      p_motivo: "Extraccion de muestra para laboratorio",
    });
    expect(errAjuste).toBeNull();

    // 4. Intentar vender del lote bloqueado -> Falla con BATCH_BLOCKED
    const { error: errVenta } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_sesion_caja_id: sesionAId,
      p_cliente_id: clienteAId,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: productoAId,
          loteId: testLoteId,
          cantidad: 1,
          precioUnitario: 1000,
          alicuotaIva: 21.00,
          descuentoPorcentaje: 0,
          motivoFefo: "Intento forzar lote bloqueado",
        },
      ],
      p_pagos: [
        {
          medioPagoId: medioPagoEfectivoId,
          importe: 1000,
        },
      ],
    });
    expect(errVenta?.message).toMatch(/BATCH_BLOCKED/);
  });

  it("desbloquear conserva el motivo del bloqueo", async () => {
    // 1. Crear y bloquear lote
    const { data: l } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `LOTE-UNBLOCK-${Date.now()}`,
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        usuario_id: usuarioAId,
        estado: "disponible",
      })
      .select("id")
      .single();
    const testLoteId = l!.id;

    const motivoBloqueo = "Retenido preventivamente por sospecha";
    await serviceDb.rpc("bloquear_lote", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: testLoteId,
      p_motivo: motivoBloqueo,
    });

    // 2. Desbloquear
    await serviceDb.rpc("desbloquear_lote", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_lote_id: testLoteId,
      p_motivo: "Aprobado por control tras verificacion",
    });

    // 3. Verificar que estado es 'disponible' y motivo_bloqueo se conservó
    const { data: loteFinal } = await serviceDb
      .from("lotes")
      .select("estado, motivo_bloqueo")
      .eq("id", testLoteId)
      .single();

    expect(loteFinal!.estado).toBe("disponible");
    expect(loteFinal!.motivo_bloqueo).toBe(motivoBloqueo);
  });
});

describeIntegration("C5·T3: RPC aplicar_recuento", () => {
  let recLoteId = "";
  let recProdId = "";
  let recuentoStaleId = "";

  it("RN-AJ3: el recuento congela la cantidad de sistema AL APLICAR", async () => {
    // (1) Lote con existencia 10
    const { data: prod } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: `PROD-REC-STALE-${Date.now()}`,
        nombre: "Producto Test Recuento Stale",
        unidad_medida_id: (await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single()).data!.id,
        precio_venta: 1000,
        alicuota_iva: 21.00,
        activo: true,
        es_vendible: true,
      })
      .select("id")
      .single();
    recProdId = prod!.id;

    const { data: lote } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: recProdId,
        codigo_lote: `LOTE-REC-STALE-${Date.now()}`,
        costo_unitario_neto: 200,
        costo_unitario_efectivo: 200,
        origen: "compra",
        usuario_id: usuarioAId,
        estado: "disponible",
      })
      .select("id")
      .single();
    recLoteId = lote!.id;

    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: recProdId,
      lote_id: recLoteId,
      cantidad: 10,
      costo_unitario: 200,
      costo_total: 2000,
      motivo: "Stock inicial 10 para recuento",
      usuario_id: usuarioAId,
    });

    // (2) Abrir recuento y cargar detalle con cantidad_contada = 10 y cantidad_sistema = 10
    await serviceDb.from("recuentos").delete().eq("tenant_id", tenantAId).eq("estado", "borrador");

    const { data: rec } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
        observaciones: "Recuento físico prueba RN-AJ3",
      })
      .select("id")
      .single();
    recuentoStaleId = rec!.id;

    await serviceDb.from("recuentos_detalle").insert({
      tenant_id: tenantAId,
      recuento_id: recuentoStaleId,
      lote_id: recLoteId,
      cantidad_contada: 10,
      cantidad_sistema: 10,
      motivo: "Conteo físico inicial",
    });

    // (3) Vender 3 del lote -> existencia pasa a 7
    const { error: errVenta } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_sesion_caja_id: sesionAId,
      p_cliente_id: clienteAId,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: recProdId,
          loteId: recLoteId,
          cantidad: 3,
          precioUnitario: 1000,
          alicuotaIva: 21.00,
          descuentoPorcentaje: 0,
          motivoFefo: "Venta durante recuento para probar RN-AJ3",
        },
      ],
      p_pagos: [{ medioPagoId: medioPagoEfectivoId, importe: 3000 }],
    });
    expect(errVenta).toBeNull();

    const { data: extPostVenta } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("tenant_id", tenantAId)
      .eq("lote_id", recLoteId)
      .single();
    expect(Number(extPostVenta!.cantidad)).toBe(7);

    // (4) aplicar_recuento sin p_confirmar_desvios -> falla con COUNT_STALE y contiene loteId
    const { error: errStale } = await serviceDb.rpc("aplicar_recuento", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_recuento_id: recuentoStaleId,
      p_confirmar_desvios: false,
    });
    expect(errStale?.message).toMatch(/COUNT_STALE/);
    expect(errStale?.message).toContain(recLoteId);
    expect(errStale?.message).toContain('"cantidadVistaPorElUsuario": 10');
    expect(errStale?.message).toContain('"cantidadActual": 7');

    // (5) aplicar_recuento con p_confirmar_desvios = true -> funciona
    const { data: aplData, error: errAplOk } = await serviceDb.rpc("aplicar_recuento", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_recuento_id: recuentoStaleId,
      p_confirmar_desvios: true,
    });
    expect(errAplOk).toBeNull();
    expect((aplData as any)[0].ajustes_generados).toBe(1);

    // El ajuste generado es +3 (sobrante_recuento de 3 = 10 contados - 7 actuales)
    const { data: movAj } = await serviceDb
      .from("movimientos_stock")
      .select("tipo, cantidad, motivo")
      .eq("tenant_id", tenantAId)
      .eq("recuento_id", recuentoStaleId)
      .single();
    expect(movAj!.tipo).toBe("sobrante_recuento");
    expect(Number(movAj!.cantidad)).toBe(3);

    // (6) La existencia final es 10 (la contada físicamente)
    const { data: extFinal } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("tenant_id", tenantAId)
      .eq("lote_id", recLoteId)
      .single();
    expect(Number(extFinal!.cantidad)).toBe(10);
  });

  it("RN-AJ3: sin desvíos no pide confirmación", async () => {
    // 1. Crear recuento en borrador
    await serviceDb.from("recuentos").delete().eq("tenant_id", tenantAId).eq("estado", "borrador");

    const { data: rec } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();
    const recId = rec!.id;

    // 2. Detalle con existencia actual (10) y cantidad_contada = 8
    await serviceDb.from("recuentos_detalle").insert({
      tenant_id: tenantAId,
      recuento_id: recId,
      lote_id: recLoteId,
      cantidad_sistema: 10,
      cantidad_contada: 8,
      motivo: "Faltante comprobado en conteo",
    });

    // 3. Aplicar sin confirmar desvíos -> Funciona directo porque cantidad_sistema (10) == existencia_actual (10)
    const { data: aplData, error: errApl } = await serviceDb.rpc("aplicar_recuento", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_recuento_id: recId,
      p_confirmar_desvios: false,
    });
    expect(errApl).toBeNull();
    expect((aplData as any)[0].ajustes_generados).toBe(1);

    const { data: extFinal } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("tenant_id", tenantAId)
      .eq("lote_id", recLoteId)
      .single();
    expect(Number(extFinal!.cantidad)).toBe(8);
  });

  it("RN-AJ3: el ajuste NO borra la venta", async () => {
    const { data: movs } = await serviceDb
      .from("movimientos_stock")
      .select("tipo, cantidad")
      .eq("tenant_id", tenantAId)
      .eq("lote_id", recLoteId);

    const tipos = (movs ?? []).map((m: { tipo: string }) => m.tipo);
    expect(tipos).toContain("salida_venta");
    expect(tipos).toContain("sobrante_recuento");

    const ventaMov = (movs ?? []).find((m: { tipo: string }) => m.tipo === "salida_venta");
    expect(Number(ventaMov!.cantidad)).toBe(3);
  });

  it("RN-AJ6: aplicar un recuento es irreversible", async () => {
    const { error: errDobleApl } = await serviceDb.rpc("aplicar_recuento", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_recuento_id: recuentoStaleId,
      p_confirmar_desvios: true,
    });
    expect(errDobleApl?.message).toMatch(/COUNT_ALREADY_APPLIED/);
  });

  it("RN-AJ6: un recuento sin detalle no se aplica", async () => {
    await serviceDb.from("recuentos").delete().eq("tenant_id", tenantAId).eq("estado", "borrador");

    const { data: recVacio } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();

    const { error: errVacio } = await serviceDb.rpc("aplicar_recuento", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_recuento_id: recVacio!.id,
    });
    expect(errVacio?.message).toMatch(/COUNT_WITHOUT_DETAIL/);
  });

  it("los ajustes del recuento comparten operacion_id", async () => {
    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = u!.id;

    const { data: prod } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: `PROD-REC-MULTI-${Date.now()}`,
        nombre: "Prod Recuento Multi",
        unidad_medida_id: unidadId,
        precio_venta: 500,
      })
      .select("id")
      .single();
    const multiProdId = prod!.id;

    const loteIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const { data: l } = await serviceDb
        .from("lotes")
        .insert({
          tenant_id: tenantAId,
          producto_id: multiProdId,
          codigo_lote: `LOTE-MULTI-${i}-${Date.now()}`,
          costo_unitario_neto: 100,
          costo_unitario_efectivo: 100,
          origen: "compra",
          usuario_id: usuarioAId,
        })
        .select("id")
        .single();
      loteIds.push(l!.id);

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: multiProdId,
        lote_id: l!.id,
        cantidad: 10,
        costo_unitario: 100,
        costo_total: 1000,
        motivo: "Carga inicial lote multi",
        usuario_id: usuarioAId,
      });
    }

    await serviceDb.from("recuentos").delete().eq("tenant_id", tenantAId).eq("estado", "borrador");

    const { data: rec } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();
    const recId = rec!.id;

    await serviceDb.from("recuentos_detalle").insert([
      { tenant_id: tenantAId, recuento_id: recId, lote_id: loteIds[0], cantidad_contada: 12 },
      { tenant_id: tenantAId, recuento_id: recId, lote_id: loteIds[1], cantidad_contada: 8 },
      { tenant_id: tenantAId, recuento_id: recId, lote_id: loteIds[2], cantidad_contada: 15 },
    ]);

    const { data: aplData, error: errApl } = await serviceDb.rpc("aplicar_recuento", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_recuento_id: recId,
      p_confirmar_desvios: true,
    });
    expect(errApl).toBeNull();
    expect((aplData as any)[0].ajustes_generados).toBe(3);
    const opId = (aplData as any)[0].operacion_id;

    const { data: movs } = await serviceDb
      .from("movimientos_stock")
      .select("id, operacion_id, recuento_id, cantidad")
      .eq("tenant_id", tenantAId)
      .eq("recuento_id", recId);

    expect(movs ?? []).toHaveLength(3);
    expect((movs ?? []).every((m: { operacion_id: string }) => m.operacion_id === opId)).toBe(true);
  });

  it("un lote sin diferencia no genera asiento", async () => {
    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = u!.id;

    const { data: prod } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: `PROD-REC-EXACTO-${Date.now()}`,
        nombre: "Prod Recuento Exacto",
        unidad_medida_id: unidadId,
        precio_venta: 500,
      })
      .select("id")
      .single();
    const prodId = prod!.id;

    const loteIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const { data: l } = await serviceDb
        .from("lotes")
        .insert({
          tenant_id: tenantAId,
          producto_id: prodId,
          codigo_lote: `LOTE-EXACT-${i}-${Date.now()}`,
          costo_unitario_neto: 100,
          costo_unitario_efectivo: 100,
          origen: "compra",
          usuario_id: usuarioAId,
        })
        .select("id")
        .single();
      loteIds.push(l!.id);

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: prodId,
        lote_id: l!.id,
        cantidad: 10,
        costo_unitario: 100,
        costo_total: 1000,
        motivo: "Carga inicial lote exacto",
        usuario_id: usuarioAId,
      });
    }

    await serviceDb.from("recuentos").delete().eq("tenant_id", tenantAId).eq("estado", "borrador");

    const { data: rec } = await serviceDb
      .from("recuentos")
      .insert({
        tenant_id: tenantAId,
        usuario_id: usuarioAId,
        estado: "borrador",
      })
      .select("id")
      .single();
    const recId = rec!.id;

    await serviceDb.from("recuentos_detalle").insert([
      { tenant_id: tenantAId, recuento_id: recId, lote_id: loteIds[0], cantidad_contada: 10 },
      { tenant_id: tenantAId, recuento_id: recId, lote_id: loteIds[1], cantidad_contada: 8 },
      { tenant_id: tenantAId, recuento_id: recId, lote_id: loteIds[2], cantidad_contada: 12 },
    ]);

    const { data: aplData, error: errApl } = await serviceDb.rpc("aplicar_recuento", {
      p_tenant_id: tenantAId,
      p_usuario_id: usuarioAId,
      p_recuento_id: recId,
      p_confirmar_desvios: true,
    });
    expect(errApl).toBeNull();
    expect((aplData as any)[0].ajustes_generados).toBe(2);

    const { data: movs } = await serviceDb
      .from("movimientos_stock")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("recuento_id", recId);

    expect(movs ?? []).toHaveLength(2);
  });
});

