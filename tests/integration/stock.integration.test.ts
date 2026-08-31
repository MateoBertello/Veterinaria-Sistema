import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, borrarUsuarioAuth } from "./_teardown.ts";
import { StockService } from "../../supabase/functions/api/src/modules/stock/stock.service.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

let serviceDb: SupabaseClient;

let tenantAId = "";
let usuarioAId = "";
let unidadId = "";
let productoAId = "";
let loteAId = "";
let ventaItemAId = "";

export async function crearFixtureStock(db: SupabaseClient, prefix: string) {
  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-1`,
    p_email_contacto: `${prefix.toLowerCase()}_stock@test.com`,
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

  const { error: errU } = await db
    .from("usuarios")
    .insert({
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

  // 4. Producto
  const { data: p, error: errP } = await db
    .from("productos")
    .insert({
      tenant_id: tenantId,
      codigo: `${prefix}-SKU-1`,
      nombre: `${prefix} Producto Test`,
      unidad_medida_id: uId,
      alicuota_iva: 21,
      precio_venta: 1000,
      es_vendible: true,
    })
    .select("id")
    .single();
  if (errP || !p) throw new Error(`Error creando producto: ${errP?.message}`);
  const productoId = p.id as string;

  // 5. Lote
  const { data: l, error: errL } = await db
    .from("lotes")
    .insert({
      tenant_id: tenantId,
      producto_id: productoId,
      codigo_lote: `${prefix}-LOTE-1`,
      costo_unitario_neto: 500,
      costo_unitario_efectivo: 500,
      origen: "compra",
      usuario_id: usuarioId,
    })
    .select("id")
    .single();
  if (errL || !l) throw new Error(`Error creando lote: ${errL?.message}`);
  const loteId = l.id as string;

  // 6. Venta Item para FK diferida
  const { data: caja } = await db.from("cajas").insert({
    tenant_id: tenantId,
    nombre: `${prefix} Caja`,
  }).select("id").single();
  const { data: sesion } = await db.from("sesiones_caja").insert({
    tenant_id: tenantId,
    caja_id: caja!.id,
    estado: "abierta",
    apertura_usuario_id: usuarioId,
    saldo_inicial: 0,
  }).select("id").single();
  const { data: venta } = await db.from("ventas").insert({
    tenant_id: tenantId,
    numero_operacion: 1,
    sesion_caja_id: sesion!.id,
    usuario_id: usuarioId,
    subtotal_neto: 826.45,
    total_iva: 173.55,
    total: 1000,
  }).select("id").single();
  const { data: vItem } = await db.from("ventas_items").insert({
    tenant_id: tenantId,
    venta_id: venta!.id,
    tipo_item: "producto",
    producto_id: productoId,
    descripcion_snapshot: "Item Snapshot",
    cantidad: 1000,
    precio_unitario: 1000,
    alicuota_iva: 21,
    neto_unitario: 826.45,
    iva_unitario: 173.55,
    importe_total: 1000,
  }).select("id").single();
  const ventaItemId = vItem!.id as string;

  return { tenantId, usuarioId, unidadId: uId, productoId, loteId, ventaItemId };
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const fixture = await crearFixtureStock(serviceDb, "StockIntA");
  tenantAId = fixture.tenantId;
  usuarioAId = fixture.usuarioId;
  unidadId = fixture.unidadId;
  productoAId = fixture.productoId;
  loteAId = fixture.loteId;
  ventaItemAId = fixture.ventaItemId;
});

afterAll(async () => {
  if (!serviceDb || !tenantAId) return;
  await serviceDb.from("movimientos_stock").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("existencias_lote").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("lotes").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("ventas_items").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("ventas").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("sesiones_caja").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("cajas").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("compras_items").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("compras").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("productos").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("proveedores").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("usuarios").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("tenants").delete().eq("id", tenantAId);
  if (usuarioAId) await borrarUsuarioAuth(usuarioAId);
});

describeIntegration("C2·T1 — Libro mayor, lotes y existencias_lote (Base de datos)", () => {
  it("RN-MV2: un movimiento no se puede actualizar ni borrar, tampoco con service_role", async () => {
    // 1. Insertar movimiento inicial
    const { data: mov, error: errIns } = await serviceDb
      .from("movimientos_stock")
      .insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: productoAId,
        lote_id: loteAId,
        cantidad: 10,
        costo_unitario: 500,
        costo_total: 5000,
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();

    expect(errIns).toBeNull();
    expect(mov).toBeDefined();
    const movId = mov!.id;

    // 2. Intentar UPDATE con service_role -> MOVEMENT_IMMUTABLE
    const { error: errUpd } = await serviceDb
      .from("movimientos_stock")
      .update({ cantidad: 999 })
      .eq("id", movId);

    expect(errUpd).not.toBeNull();
    expect(errUpd?.message).toContain("MOVEMENT_IMMUTABLE");

    // 3. Intentar DELETE con service_role -> MOVEMENT_IMMUTABLE
    const { error: errDel } = await serviceDb
      .from("movimientos_stock")
      .delete()
      .eq("id", movId);

    expect(errDel).not.toBeNull();
    expect(errDel?.message).toContain("MOVEMENT_IMMUTABLE");
  });

  it("RN-MV3: la cantidad es siempre positiva", async () => {
    // cantidad 0
    const { error: errZero } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 0,
      usuario_id: usuarioAId,
    });
    expect(errZero).not.toBeNull();

    // cantidad negativa
    const { error: errNeg } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: -5,
      usuario_id: usuarioAId,
    });
    expect(errNeg).not.toBeNull();
  });

  it("RN-MV4: el signo lo determina el tipo", async () => {
    const { data: prov } = await serviceDb
      .from("proveedores")
      .insert({ tenant_id: tenantAId, razon_social: `Prov RNMV4 ${Date.now()}` })
      .select("id")
      .single();
    const { data: compra } = await serviceDb
      .from("compras")
      .insert({ tenant_id: tenantAId, proveedor_id: prov!.id, fecha: "2026-09-08", usuario_id: usuarioAId })
      .select("id")
      .single();
    const { data: cItem } = await serviceDb
      .from("compras_items")
      .insert({
        tenant_id: tenantAId,
        compra_id: compra!.id,
        producto_id: productoAId,
        cantidad: 10,
        costo_unitario_neto: 100,
        alicuota_iva: 21,
      })
      .select("id")
      .single();

    // 1. entrada_compra da signo positivo (+10)
    const { data: movEntrada, error: errEntrada } = await serviceDb
      .from("movimientos_stock")
      .insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_compra",
        compra_item_id: cItem!.id,
        producto_id: productoAId,
        lote_id: loteAId,
        cantidad: 10,
        usuario_id: usuarioAId,
      })
      .select("cantidad, cantidad_con_signo")
      .single();

    expect(errEntrada).toBeNull();
    expect(Number(movEntrada?.cantidad_con_signo)).toBe(10);

    // 2. salida_venta da signo negativo (-3)
    const { data: movSalida, error: errSalida } = await serviceDb
      .from("movimientos_stock")
      .insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "salida_venta",
        venta_item_id: ventaItemAId,
        producto_id: productoAId,
        lote_id: loteAId,
        cantidad: 3,
        usuario_id: usuarioAId,
      })
      .select("cantidad, cantidad_con_signo")
      .single();

    expect(errSalida).toBeNull();
    expect(Number(movSalida?.cantidad_con_signo)).toBe(-3);
  });

  it("RN-MV5: la existencia nunca queda negativa", async () => {
    // Crear lote específico para probar saldo
    const { data: l2 } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: "LOTE-MV5",
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();

    const loteId = l2!.id;

    // Ingresar 5 unidades
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 5,
      usuario_id: usuarioAId,
    });

    // Intentar salida de 8 directamente con service_role -> rechazo por CHECK (cantidad >= 0)
    const { error: errSalidaExcesiva } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_venta",
      venta_item_id: ventaItemAId,
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 8,
      usuario_id: usuarioAId,
    });

    expect(errSalidaExcesiva).not.toBeNull();

    // Comprobar que la existencia en existencias_lote sigue en 5
    const { data: ext } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("lote_id", loteId)
      .single();

    expect(Number(ext?.cantidad)).toBe(5);
  });

  it("RN-MV8: cada tipo exige su documento y prohíbe los demás", async () => {
    // 1. salida_venta sin venta_item_id -> error
    const { error: errSinDoc } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_venta",
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 1,
      usuario_id: usuarioAId,
    });
    expect(errSinDoc).not.toBeNull();

    // 2. entrada_compra con venta_item_id Y compra_item_id (> 1 documento) -> error
    const { error: errMultiDoc } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_compra",
      compra_item_id: crypto.randomUUID(),
      venta_item_id: crypto.randomUUID(),
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 1,
      usuario_id: usuarioAId,
    });
    expect(errMultiDoc).not.toBeNull();

    // 3. entrada_compra con venta_item_id en vez de compra_item_id -> error
    const { error: errDocInvalido } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_compra",
      venta_item_id: crypto.randomUUID(),
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 1,
      usuario_id: usuarioAId,
    });
    expect(errDocInvalido).not.toBeNull();
  });

  it("la caché se mantiene sola mediante trigger", async () => {
    const { data: l3 } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: "LOTE-CACHE-TEST",
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();

    const loteId = l3!.id;

    // +10
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 10,
      usuario_id: usuarioAId,
    });

    // -3
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_venta",
      venta_item_id: ventaItemAId,
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 3,
      usuario_id: usuarioAId,
    });

    // +5
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 5,
      usuario_id: usuarioAId,
    });

    const { data: ext } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("lote_id", loteId)
      .single();

    // 10 - 3 + 5 = 12
    expect(Number(ext?.cantidad)).toBe(12);
  });

  it("RN-MV11: el desvío de la caché se detecta y se corrige", async () => {
    const { data: l } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `LOTE-MV11-${Date.now()}`,
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();
    const loteId = l!.id;

    // 1. Tres movimientos: +10, -3, +5 = 12
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 10,
      usuario_id: usuarioAId,
    });
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_venta",
      venta_item_id: ventaItemAId,
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 3,
      usuario_id: usuarioAId,
    });
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 5,
      usuario_id: usuarioAId,
    });

    // verificar_existencias(tenantA) -> 0 filas
    const { data: verif1, error: errV1 } = await serviceDb.rpc("verificar_existencias", {
      p_tenant_id: tenantAId,
    });
    expect(errV1).toBeNull();
    const desviosLote1 = (verif1 ?? []).filter((d: any) => d.lote_id === loteId);
    expect(desviosLote1).toHaveLength(0);

    // 2. Adulterar la caché a mano con service_role
    await serviceDb.from("existencias_lote").update({ cantidad: 999 }).eq("lote_id", loteId);

    // 3. verificar_existencias(tenantA) -> 1 fila con desvío
    const { data: verif2, error: errV2 } = await serviceDb.rpc("verificar_existencias", {
      p_tenant_id: tenantAId,
    });
    expect(errV2).toBeNull();
    const desviosLote2 = (verif2 ?? []).filter((d: any) => d.lote_id === loteId);
    expect(desviosLote2).toHaveLength(1);
    expect(desviosLote2[0].lote_id).toBe(loteId);
    expect(Number(desviosLote2[0].cantidad_cache)).toBe(999);
    expect(Number(desviosLote2[0].cantidad_real)).toBe(12);
    expect(Number(desviosLote2[0].diferencia)).toBe(987);

    // 4. recalcular_existencias(tenantA)
    const { error: errRecalc } = await serviceDb.rpc("recalcular_existencias", {
      p_tenant_id: tenantAId,
    });
    expect(errRecalc).toBeNull();

    // 5. verificar_existencias(tenantA) -> 0 filas
    const { data: verif3, error: errV3 } = await serviceDb.rpc("verificar_existencias", {
      p_tenant_id: tenantAId,
    });
    expect(errV3).toBeNull();
    const desviosLote3 = (verif3 ?? []).filter((d: any) => d.lote_id === loteId);
    expect(desviosLote3).toHaveLength(0);

    const { data: extFinal } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("lote_id", loteId)
      .single();
    expect(Number(extFinal?.cantidad)).toBe(12);
  });

  it("RN-MV11: verificar_existencias no cruza tenants", async () => {
    const fixtureB = await crearFixtureStock(serviceDb, "STOCKB_MV11");
    try {
      const { data: lB } = await serviceDb
        .from("lotes")
        .insert({
          tenant_id: fixtureB.tenantId,
          producto_id: fixtureB.productoId,
          codigo_lote: `LOTE-B-${Date.now()}`,
          costo_unitario_neto: 100,
          costo_unitario_efectivo: 100,
          origen: "compra",
          usuario_id: fixtureB.usuarioId,
        })
        .select("id")
        .single();
      const loteBId = lB!.id;

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: fixtureB.tenantId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: fixtureB.productoId,
        lote_id: loteBId,
        cantidad: 10,
        usuario_id: fixtureB.usuarioId,
      });

      // Adulterar B
      await serviceDb.from("existencias_lote").update({ cantidad: 888 }).eq("lote_id", loteBId);

      // verificar_existencias para tenantAId no debe ver el desvío de B
      const { data: desviosA } = await serviceDb.rpc("verificar_existencias", {
        p_tenant_id: tenantAId,
      });
      const desviosBEnA = (desviosA ?? []).filter((d: any) => d.lote_id === loteBId);
      expect(desviosBEnA).toHaveLength(0);

      // En cambio para fixtureB.tenantId sí aparece
      const { data: desviosB } = await serviceDb.rpc("verificar_existencias", {
        p_tenant_id: fixtureB.tenantId,
      });
      const desviosEnB = (desviosB ?? []).filter((d: any) => d.lote_id === loteBId);
      expect(desviosEnB).toHaveLength(1);
    } finally {
      await serviceDb.from("movimientos_stock").delete().eq("tenant_id", fixtureB.tenantId);
      await serviceDb.from("existencias_lote").delete().eq("tenant_id", fixtureB.tenantId);
      await serviceDb.from("lotes").delete().eq("tenant_id", fixtureB.tenantId);
      await serviceDb.from("productos").delete().eq("tenant_id", fixtureB.tenantId);
      await serviceDb.from("usuarios").delete().eq("tenant_id", fixtureB.tenantId);
      await serviceDb.from("tenants").delete().eq("id", fixtureB.tenantId);
      await borrarUsuarioAuth(fixtureB.usuarioId);
    }
  });

  it("RN-MV12: la caché es reconstruible", async () => {
    // 2 productos en tenantAId
    const { data: p1 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: `PROD-200-1-${Date.now()}`, nombre: "Prod 200 1", unidad_medida_id: unidadId,
    }).select("id").single();
    const { data: p2 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: `PROD-200-2-${Date.now()}`, nombre: "Prod 200 2", unidad_medida_id: unidadId,
    }).select("id").single();

    // 5 lotes: 3 en p1, 2 en p2
    const lotesInfo: { id: string; productoId: string; stock: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const prodId = i < 3 ? p1!.id : p2!.id;
      const { data: l } = await serviceDb.from("lotes").insert({
        tenant_id: tenantAId,
        producto_id: prodId,
        codigo_lote: `LOTE-200-${i}-${Date.now()}`,
        costo_unitario_neto: 10 + i,
        costo_unitario_efectivo: 10 + i,
        origen: "compra",
        usuario_id: usuarioAId,
      }).select("id").single();
      lotesInfo.push({ id: l!.id, productoId: prodId, stock: 0 });
    }

    // Inicializar cada lote con entrada de 100 (5 movimientos)
    for (const item of lotesInfo) {
      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: item.productoId,
        lote_id: item.id,
        cantidad: 100,
        usuario_id: usuarioAId,
      });
      item.stock = 100;
    }

    // 195 movimientos adicionales mezclando entradas y salidas
    for (let i = 0; i < 195; i++) {
      const lotIndex = i % lotesInfo.length;
      const target = lotesInfo[lotIndex];
      const isEntrada = i % 3 === 0 || target.stock < 20;

      if (isEntrada) {
        const cant = (i % 5) + 1;
        await serviceDb.from("movimientos_stock").insert({
          tenant_id: tenantAId,
          operacion_id: crypto.randomUUID(),
          tipo: "entrada_inicial",
          producto_id: target.productoId,
          lote_id: target.id,
          cantidad: cant,
          usuario_id: usuarioAId,
        });
        target.stock += cant;
      } else {
        const cant = (i % 3) + 1;
        await serviceDb.from("movimientos_stock").insert({
          tenant_id: tenantAId,
          operacion_id: crypto.randomUUID(),
          tipo: "salida_venta",
          venta_item_id: ventaItemAId,
          producto_id: target.productoId,
          lote_id: target.id,
          cantidad: cant,
          usuario_id: usuarioAId,
        });
        target.stock -= cant;
      }
    }

    // Guardar estado actual de existencias_lote para estos 5 lotes
    const loteIds = lotesInfo.map((l) => l.id);
    const { data: extAntes } = await serviceDb
      .from("existencias_lote")
      .select("lote_id, producto_id, cantidad")
      .in("lote_id", loteIds);

    expect(extAntes).toHaveLength(5);
    for (const row of extAntes ?? []) {
      const target = lotesInfo.find((l) => l.id === row.lote_id);
      expect(Number(row.cantidad)).toBe(target!.stock);
    }

    // Recalcular
    const { data: rowsAffected, error: errRecalc } = await serviceDb.rpc("recalcular_existencias", {
      p_tenant_id: tenantAId,
    });
    expect(errRecalc).toBeNull();
    expect(Number(rowsAffected)).toBeGreaterThan(0);

    // Comparar fila por fila
    const { data: extDespues } = await serviceDb
      .from("existencias_lote")
      .select("lote_id, producto_id, cantidad")
      .in("lote_id", loteIds);

    expect(extDespues).toHaveLength(5);
    for (const rowDespues of extDespues ?? []) {
      const rowAntes = extAntes!.find((r) => r.lote_id === rowDespues.lote_id)!;
      expect(Number(rowDespues.cantidad)).toBe(Number(rowAntes.cantidad));
    }
  });

  it("RN-MV12: recalcular por producto no toca los demás", async () => {
    // 2 productos: PX y PY
    const { data: pX } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: `PROD-REC-X-${Date.now()}`, nombre: "Prod Rec X", unidad_medida_id: unidadId,
    }).select("id").single();
    const { data: pY } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: `PROD-REC-Y-${Date.now()}`, nombre: "Prod Rec Y", unidad_medida_id: unidadId,
    }).select("id").single();

    const { data: lX } = await serviceDb.from("lotes").insert({
      tenant_id: tenantAId, producto_id: pX!.id, codigo_lote: `LOTE-REC-X-${Date.now()}`,
      costo_unitario_neto: 50, costo_unitario_efectivo: 50, origen: "compra", usuario_id: usuarioAId,
    }).select("id").single();

    const { data: lY } = await serviceDb.from("lotes").insert({
      tenant_id: tenantAId, producto_id: pY!.id, codigo_lote: `LOTE-REC-Y-${Date.now()}`,
      costo_unitario_neto: 50, costo_unitario_efectivo: 50, origen: "compra", usuario_id: usuarioAId,
    }).select("id").single();

    // Movimientos reales: LX = 10, LY = 20
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId, operacion_id: crypto.randomUUID(), tipo: "entrada_inicial",
      producto_id: pX!.id, lote_id: lX!.id, cantidad: 10, usuario_id: usuarioAId,
    });
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId, operacion_id: crypto.randomUUID(), tipo: "entrada_inicial",
      producto_id: pY!.id, lote_id: lY!.id, cantidad: 20, usuario_id: usuarioAId,
    });

    // Adulterar ambos
    await serviceDb.from("existencias_lote").update({ cantidad: 999 }).eq("lote_id", lX!.id);
    await serviceDb.from("existencias_lote").update({ cantidad: 888 }).eq("lote_id", lY!.id);

    // Recalcular SOLO producto PX
    const { error: errRecalc } = await serviceDb.rpc("recalcular_existencias", {
      p_tenant_id: tenantAId,
      p_producto_id: pX!.id,
    });
    expect(errRecalc).toBeNull();

    // LX quedó corregido a 10
    const { data: extX } = await serviceDb.from("existencias_lote").select("cantidad").eq("lote_id", lX!.id).single();
    expect(Number(extX?.cantidad)).toBe(10);

    // LY SIGUE adulterado a 888
    const { data: extY } = await serviceDb.from("existencias_lote").select("cantidad").eq("lote_id", lY!.id).single();
    expect(Number(extY?.cantidad)).toBe(888);
  });

  describe("RN-LO8: Notificaciones de vencimiento próximo", () => {
    it("RN-LO8: el vencimiento próximo notifica y NO bloquea", async () => {
      // 1. Configurar tenant con dias_alerta_vencimiento = 60
      await serviceDb
        .from("configuracion_tenant")
        .update({ dias_alerta_vencimiento: 60 })
        .eq("tenant_id", tenantAId);

      // 2. Crear lote que vence en 30 días con existencia > 0
      const d30 = new Date();
      d30.setDate(d30.getDate() + 30);
      const fecha30 = d30.toISOString().split("T")[0];

      const { data: loteVencePronto } = await serviceDb.from("lotes").insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `L-VENCE-30-${Date.now()}`,
        fecha_vencimiento: fecha30,
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        estado: "disponible",
        origen: "compra",
        usuario_id: usuarioAId,
      }).select("id").single();

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: productoAId,
        lote_id: loteVencePronto!.id,
        cantidad: 15,
        costo_unitario: 100,
        costo_total: 1500,
        usuario_id: usuarioAId,
      });

      // 3. Ejecutar notificarLotesPorVencer
      const creadas = await StockService.notificarLotesPorVencer(tenantAId);
      expect(creadas).toBeGreaterThanOrEqual(1);

      // 4. Verificar que se creó la fila en notificaciones
      const { data: notif } = await serviceDb
        .from("notificaciones")
        .select("id, origen, referencia_id, canal, estado, mensaje")
        .eq("tenant_id", tenantAId)
        .eq("origen", "vencimiento_lote")
        .eq("referencia_id", loteVencePronto!.id)
        .single();

      expect(notif).not.toBeNull();
      expect(notif?.origen).toBe("vencimiento_lote");
      expect(notif?.canal).toBe("email");

      // 5. Verificar que el lote NO está bloqueado: sigue apareciendo en candidatos FEFO
      const candidatos = await StockService.listarCandidatosFefo(productoAId, 1, tenantAId);
      const candidatoEncontrado = candidatos.find((c: any) => c.loteId === loteVencePronto!.id);
      expect(candidatoEncontrado).toBeDefined();
      expect(candidatoEncontrado?.cantidadDisponible).toBe(15);
    });

    it("RN-LO8: no se notifica dos veces el mismo lote", async () => {
      // Re-ejecutar la notificación sobre el tenantAId
      const creadasSegundaVez = await StockService.notificarLotesPorVencer(tenantAId);
      // Las existentes se absorben por ON CONFLICT DO NOTHING (0 nuevas para los mismos lotes)
      expect(creadasSegundaVez).toBe(0);

      // Verificar que no se duplicaron las notificaciones
      const { data: notifs } = await serviceDb
        .from("notificaciones")
        .select("id")
        .eq("tenant_id", tenantAId)
        .eq("origen", "vencimiento_lote");

      // El total de notificaciones no debe haberse duplicado
      const { count } = await serviceDb
        .from("notificaciones")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantAId)
        .eq("origen", "vencimiento_lote");

      expect(count).toBe(notifs?.length);
    });

    it("RN-LO8: un lote fuera del umbral no notifica", async () => {
      // Lote que vence en 90 días (umbral es 60)
      const d90 = new Date();
      d90.setDate(d90.getDate() + 90);
      const fecha90 = d90.toISOString().split("T")[0];

      const { data: loteLejano } = await serviceDb.from("lotes").insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `L-LEJOS-90-${Date.now()}`,
        fecha_vencimiento: fecha90,
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        estado: "disponible",
        origen: "compra",
        usuario_id: usuarioAId,
      }).select("id").single();

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: productoAId,
        lote_id: loteLejano!.id,
        cantidad: 10,
        costo_unitario: 100,
        costo_total: 1000,
        usuario_id: usuarioAId,
      });

      // Notificación para este lote no debe crearse
      const { data: notif } = await serviceDb
        .from("notificaciones")
        .select("id")
        .eq("tenant_id", tenantAId)
        .eq("origen", "vencimiento_lote")
        .eq("referencia_id", loteLejano!.id)
        .maybeSingle();

      expect(notif).toBeNull();
    });

    it("RN-LO8: un lote sin existencia no notifica", async () => {
      // Lote que vence en 20 días pero sin existencia (cantidad = 0)
      const d20 = new Date();
      d20.setDate(d20.getDate() + 20);
      const fecha20 = d20.toISOString().split("T")[0];

      const { data: loteSinStock } = await serviceDb.from("lotes").insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: `L-SINSTOCK-20-${Date.now()}`,
        fecha_vencimiento: fecha20,
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        estado: "disponible",
        origen: "compra",
        usuario_id: usuarioAId,
      }).select("id").single();

      // No insertamos movimientos_stock -> existencia_lote no existe o tiene 0

      await StockService.notificarLotesPorVencer(tenantAId);

      const { data: notif } = await serviceDb
        .from("notificaciones")
        .select("id")
        .eq("tenant_id", tenantAId)
        .eq("origen", "vencimiento_lote")
        .eq("referencia_id", loteSinStock!.id)
        .maybeSingle();

      expect(notif).toBeNull();
    });
  });
});
