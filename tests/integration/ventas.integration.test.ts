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

describeIntegration("C4·T2: RPC registrar_venta", () => {
  let tAId = "";
  let uAId = "";
  let cAId = "";
  let sAId = "";
  let pAId = "";
  let svAId = "";
  let mpEfectivoId = "";
  let mpTransferenciaId = "";

  beforeAll(async () => {
    const fixture = await crearFixtureVentas(serviceDb, "VT_T2");
    tAId = fixture.tenantId;
    uAId = fixture.usuarioId;
    cAId = fixture.cajaId;
    sAId = fixture.sesionId;
    pAId = fixture.productoId;
    svAId = fixture.servicioId;

    const { data: mpE } = await serviceDb
      .from("medios_pago")
      .select("id")
      .eq("codigo", "efectivo")
      .single();
    mpEfectivoId = mpE!.id;

    const { data: mpT } = await serviceDb
      .from("medios_pago")
      .select("id")
      .eq("codigo", "transferencia")
      .single();
    mpTransferenciaId = mpT!.id;
  });

  afterAll(async () => {
    if (!serviceDb || !tAId) return;
    if (uAId) await borrarUsuarioAuth(uAId);
    await serviceDb.from("notificaciones").delete().eq("tenant_id", tAId);
    await serviceDb.from("ventas_pagos").delete().eq("tenant_id", tAId);
    await serviceDb.from("movimientos_stock").delete().eq("tenant_id", tAId);
    await serviceDb.from("existencias_lote").delete().eq("tenant_id", tAId);
    await serviceDb.from("lotes").delete().eq("tenant_id", tAId);
    await serviceDb.from("ventas_items").delete().eq("tenant_id", tAId);
    await serviceDb.from("movimientos_caja").delete().eq("tenant_id", tAId);
    await serviceDb.from("ventas").delete().eq("tenant_id", tAId);
    await serviceDb.from("sesiones_caja").delete().eq("tenant_id", tAId);
    await serviceDb.from("cajas").delete().eq("tenant_id", tAId);
    await serviceDb.from("servicios").delete().eq("tenant_id", tAId);
    await serviceDb.from("productos").delete().eq("tenant_id", tAId);
    await serviceDb.from("contadores_tenant").delete().eq("tenant_id", tAId);
    await serviceDb.from("registros_auditoria").delete().eq("tenant_id", tAId);
    await serviceDb.from("tenants").delete().eq("id", tAId);
  });

  async function sembrarStock(
    tenantId: string,
    productoId: string,
    cantidad: number,
    options?: {
      fechaVencimiento?: string | null;
      codigoLote?: string;
      bloqueado?: boolean;
      costo?: number;
    }
  ) {
    const { data: l, error: errL } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantId,
        producto_id: productoId,
        codigo_lote: options?.codigoLote ?? `LOTE-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        fecha_vencimiento: options?.fechaVencimiento ?? "2028-12-31",
        estado: options?.bloqueado ? "bloqueado" : "disponible",
        motivo_bloqueo: options?.bloqueado ? "Bloqueado para test" : null,
        costo_unitario_neto: options?.costo ?? 500,
        costo_unitario_efectivo: options?.costo ?? 500,
        origen: "inicial",
        usuario_id: uAId,
      })
      .select("id")
      .single();
    if (errL || !l) throw new Error(`Error sembrando lote: ${errL?.message}`);
    const loteId = l.id as string;

    const { error: errM } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoId,
      lote_id: loteId,
      cantidad: cantidad,
      costo_unitario: options?.costo ?? 500,
      costo_total: (options?.costo ?? 500) * cantidad,
      usuario_id: uAId,
    });
    if (errM) throw new Error(`Error insertando stock inicial: ${errM?.message}`);

    return loteId;
  }

  it("RN-VT8: sin sesión de caja abierta, la venta falla", async () => {
    // 1. Sesión inexistente
    const { error: errInexistente } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: crypto.randomUUID(),
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "servicio",
          servicioId: svAId,
          cantidad: 1,
          precioUnitario: 2500,
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 2500 }],
    });
    expect(errInexistente?.message).toContain("CASH_SESSION_REQUIRED");

    // 2. Sesión cerrada
    const { data: sCerrada, error: errInsCerrada } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tAId,
        caja_id: cAId,
        estado: "cerrada",
        apertura_usuario_id: uAId,
        saldo_inicial: 0,
        cierre_usuario_id: uAId,
        cierre_at: new Date().toISOString(),
        saldo_teorico_efectivo: 0,
        efectivo_contado: 0,
        diferencia: 0,
      })
      .select("id")
      .single();
    if (errInsCerrada || !sCerrada) throw new Error(`Error creando sesion cerrada: ${errInsCerrada?.message}`);

    const { error: errCerrada } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sCerrada!.id,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "servicio",
          servicioId: svAId,
          cantidad: 1,
          precioUnitario: 2500,
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 2500 }],
    });
    expect(errCerrada?.message).toContain("CASH_SESSION_REQUIRED");
  });

  it("RN-VT6: la línea congela descripción, precio y alícuota", async () => {
    // 1. Crear producto específico
    const { data: um } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const { data: prodSnap } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tAId,
        codigo: `SNAP-${Date.now()}`,
        nombre: "Producto Original Snap",
        unidad_medida_id: um!.id,
        precio_venta: 1000,
        alicuota_iva: 21.00,
        activo: true,
        es_vendible: true,
      })
      .select("id")
      .single();
    const prodId = prodSnap!.id;

    await sembrarStock(tAId, prodId, 10);

    // 2. Vender
    const { data: vData, error: errVenta } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: prodId,
          cantidad: 2,
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 2000 }],
    });
    expect(errVenta).toBeNull();
    const ventaId = vData[0].venta_id;

    // 3. Modificar el producto en el catálogo: renombrar y cambiar alícuota y precio
    await serviceDb
      .from("productos")
      .update({
        nombre: "Producto Renombrado Tras Venta",
        precio_venta: 2500,
        alicuota_iva: 10.50,
      })
      .eq("id", prodId);

    // 4. Releer ventas_items y comprobar congelamiento
    const { data: items } = await serviceDb
      .from("ventas_items")
      .select("descripcion_snapshot, precio_unitario, alicuota_iva, neto_unitario, iva_unitario, importe_total")
      .eq("venta_id", ventaId);

    expect(items).toHaveLength(1);
    expect(items![0].descripcion_snapshot).toBe("Producto Original Snap");
    expect(Number(items![0].precio_unitario)).toBe(1000.00);
    expect(Number(items![0].alicuota_iva)).toBe(21.00);
    expect(Number(items![0].neto_unitario)).toBe(826.45);
    expect(Number(items![0].iva_unitario)).toBe(173.55);
    expect(Number(items![0].importe_total)).toBe(2000.00);
  });

  it("RN-LO6: el override de FEFO exige motivo", async () => {
    const { data: um } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const { data: p } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tAId,
        codigo: `FEFO-${Date.now()}`,
        nombre: "Producto FEFO Test",
        unidad_medida_id: um!.id,
        precio_venta: 500,
        alicuota_iva: 21.00,
        activo: true,
        es_vendible: true,
      })
      .select("id")
      .single();
    const prodId = p!.id;

    // Lote 1: vence antes (2027-01-01)
    const l1 = await sembrarStock(tAId, prodId, 10, {
      fechaVencimiento: "2027-01-01",
      codigoLote: `L1-${Date.now()}`,
      costo: 200,
    });
    // Lote 2: vence después (2027-06-01)
    const l2 = await sembrarStock(tAId, prodId, 10, {
      fechaVencimiento: "2027-06-01",
      codigoLote: `L2-${Date.now()}`,
      costo: 250,
    });

    // 1. Forzar Lote 2 SIN motivo -> FEFO_OVERRIDE_WITHOUT_REASON
    const { error: errSinMotivo } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: prodId,
          cantidad: 1,
          loteId: l2,
          motivoFefo: "corto", // < 10 caracteres
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 500 }],
    });
    expect(errSinMotivo?.message).toContain("FEFO_OVERRIDE_WITHOUT_REASON");

    // 2. Forzar Lote 2 CON motivo válido -> OK
    const motivoValido = "Cliente solicita lote con vencimiento más lejano";
    const { data: vOverride, error: errOverride } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: prodId,
          cantidad: 1,
          loteId: l2,
          motivoFefo: motivoValido,
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 500 }],
    });
    expect(errOverride).toBeNull();

    // Verificar que el movimiento en movimientos_stock tiene fefo_respetado = false y el motivo
    const { data: itemOver } = await serviceDb
      .from("ventas_items")
      .select("id, costo_unitario_efectivo")
      .eq("venta_id", vOverride[0].venta_id)
      .single();
    expect(Number(itemOver!.costo_unitario_efectivo)).toBe(250.0000);

    const { data: movOver } = await serviceDb
      .from("movimientos_stock")
      .select("fefo_respetado, motivo, lote_id")
      .eq("venta_item_id", itemOver!.id)
      .single();
    expect(movOver!.fefo_respetado).toBe(false);
    expect(movOver!.motivo).toBe(motivoValido);
    expect(movOver!.lote_id).toBe(l2);

    // 3. Venta automática (sin forzar lote) -> toma L1 (el que vence antes) con fefo_respetado = true
    const { data: vAuto, error: errAuto } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: prodId,
          cantidad: 2,
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 1000 }],
    });
    expect(errAuto).toBeNull();

    const { data: itemAuto } = await serviceDb
      .from("ventas_items")
      .select("id, costo_unitario_efectivo")
      .eq("venta_id", vAuto[0].venta_id)
      .single();
    expect(Number(itemAuto!.costo_unitario_efectivo)).toBe(200.0000);

    const { data: movAuto } = await serviceDb
      .from("movimientos_stock")
      .select("fefo_respetado, lote_id")
      .eq("venta_item_id", itemAuto!.id)
      .single();
    expect(movAuto!.fefo_respetado).toBe(true);
    expect(movAuto!.lote_id).toBe(l1);
  });

  it("RN-LO4: un lote vencido no se vende, ni siendo admin", async () => {
    const { data: um } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const { data: p } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tAId,
        codigo: `VENC-${Date.now()}`,
        nombre: "Producto Vencido Test",
        unidad_medida_id: um!.id,
        precio_venta: 500,
        alicuota_iva: 21.00,
        activo: true,
        es_vendible: true,
      })
      .select("id")
      .single();
    const prodId = p!.id;

    // Lote vencido en el pasado
    const lVenc = await sembrarStock(tAId, prodId, 10, {
      fechaVencimiento: "2020-01-01",
      codigoLote: `VENC-${Date.now()}`,
    });

    // 1. Intento por FEFO automático -> INSUFFICIENT_STOCK (lote vencido descartado)
    const { error: errAuto } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: prodId, cantidad: 1 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 500 }],
    });
    expect(errAuto?.message).toContain("INSUFFICIENT_STOCK");

    // 2. Intento forzando el lote vencido -> BATCH_EXPIRED
    const { error: errForzado } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "producto",
          productoId: prodId,
          cantidad: 1,
          loteId: lVenc,
          motivoFefo: "Motivo suficientemente largo para test",
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 500 }],
    });
    expect(errForzado?.message).toContain("BATCH_EXPIRED");
  });

  it("RN-PR9 y RN-PR10 contra una venta real", async () => {
    const { data: um } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();

    // RN-PR9: Producto sin precio
    const { data: pSinPrecio } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tAId,
        codigo: `SINPRECIO-${Date.now()}`,
        nombre: "Producto Sin Precio",
        unidad_medida_id: um!.id,
        precio_venta: null,
        alicuota_iva: 21.00,
        activo: true,
        es_vendible: true,
      })
      .select("id")
      .single();
    await sembrarStock(tAId, pSinPrecio!.id, 10);

    const { error: errSinPrecio } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: pSinPrecio!.id, cantidad: 1 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 500 }],
    });
    expect(errSinPrecio?.message).toContain("PRODUCT_WITHOUT_PRICE");

    // RN-PR10: Producto no vendible (es_vendible = false)
    const { data: pNoVendible } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tAId,
        codigo: `NOVEND-${Date.now()}`,
        nombre: "Producto No Vendible",
        unidad_medida_id: um!.id,
        precio_venta: 800,
        alicuota_iva: 21.00,
        activo: true,
        es_vendible: false,
      })
      .select("id")
      .single();
    await sembrarStock(tAId, pNoVendible!.id, 10);

    const { error: errNoVendible } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: pNoVendible!.id, cantidad: 1 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 800 }],
    });
    expect(errNoVendible?.message).toContain("PRODUCT_NOT_SELLABLE");
  });

  it("la venta genera un movimiento de caja por CADA pago", async () => {
    // Venta de $1.000 con pago mixto: $600 efectivo + $400 transferencia
    const { data: vData, error: errVenta } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "servicio",
          servicioId: svAId,
          cantidad: 1,
          precioUnitario: 1000,
        },
      ],
      p_pagos: [
        { medioPagoId: mpEfectivoId, importe: 600 },
        { medioPagoId: mpTransferenciaId, importe: 400, referencia: "TRF-987654321" },
      ],
    });
    expect(errVenta).toBeNull();
    const ventaId = vData[0].venta_id;

    // Verificar en movimientos_caja
    const { data: movs } = await serviceDb
      .from("movimientos_caja")
      .select("id, medio_pago_id, importe, tipo, sesion_caja_id, venta_id")
      .eq("venta_id", ventaId)
      .order("importe", { ascending: false });

    expect(movs).toHaveLength(2);
    expect(movs![0].tipo).toBe("ingreso_venta");
    expect(movs![0].medio_pago_id).toBe(mpEfectivoId);
    expect(Number(movs![0].importe)).toBe(600.00);

    expect(movs![1].tipo).toBe("ingreso_venta");
    expect(movs![1].medio_pago_id).toBe(mpTransferenciaId);
    expect(Number(movs![1].importe)).toBe(400.00);
  });

  it("la alerta de stock mínimo es por flanco", async () => {
    const { data: um } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const { data: pFlanco } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tAId,
        codigo: `FLANCO-${Date.now()}`,
        nombre: "Producto Alerta Flanco",
        unidad_medida_id: um!.id,
        precio_venta: 100,
        alicuota_iva: 21.00,
        stock_minimo: 10,
        activo: true,
        es_vendible: true,
      })
      .select("id")
      .single();
    const prodId = pFlanco!.id;

    // Sembrar stock inicial: 12 unidades (> 10)
    await sembrarStock(tAId, prodId, 12);

    // No debe haber notificación aún
    const { data: notif0 } = await serviceDb
      .from("notificaciones")
      .select("id")
      .eq("tenant_id", tAId)
      .eq("origen", "stock_minimo")
      .eq("referencia_id", prodId);
    expect(notif0).toHaveLength(0);

    // Paso 1: Vender 5 unidades -> stock baja a 7 (< 10) -> se CREA notificación
    const { error: errV1 } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: prodId, cantidad: 5 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 500 }],
    });
    expect(errV1).toBeNull();

    const { data: notif1 } = await serviceDb
      .from("notificaciones")
      .select("id, mensaje")
      .eq("tenant_id", tAId)
      .eq("origen", "stock_minimo")
      .eq("referencia_id", prodId);
    expect(notif1).toHaveLength(1);
    expect(notif1![0].mensaje).toContain("7.000 unidades");

    // Paso 2: Vender 1 unidad más -> stock baja a 6 (< 10) -> SIGUE habiendo exactamente 1 notificación
    const { error: errV2 } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: prodId, cantidad: 1 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 100 }],
    });
    expect(errV2).toBeNull();

    const { data: notif2 } = await serviceDb
      .from("notificaciones")
      .select("id")
      .eq("tenant_id", tAId)
      .eq("origen", "stock_minimo")
      .eq("referencia_id", prodId);
    expect(notif2).toHaveLength(1);

    // Paso 3: Reabastecer stock (sembrar 10 unidades -> stock sube a 16 >= 10)
    await sembrarStock(tAId, prodId, 10);
    // Disparar venta de 1 unidad de servicio que reevalúa o venta de otro ítem para verificar que la notificación se borra
    // O venta de 1 unidad del mismo producto (16 - 1 = 15 >= 10) -> notificacion se BORRA
    const { error: errV3 } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: prodId, cantidad: 1 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 100 }],
    });
    expect(errV3).toBeNull();

    const { data: notif3 } = await serviceDb
      .from("notificaciones")
      .select("id")
      .eq("tenant_id", tAId)
      .eq("origen", "stock_minimo")
      .eq("referencia_id", prodId);
    expect(notif3).toHaveLength(0); // Borrada!

    // Paso 4: Vender 8 unidades -> stock baja de 15 a 7 (< 10) -> VUELVE a aparecer
    const { error: errV4 } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: prodId, cantidad: 8 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 800 }],
    });
    expect(errV4).toBeNull();

    const { data: notif4 } = await serviceDb
      .from("notificaciones")
      .select("id, mensaje")
      .eq("tenant_id", tAId)
      .eq("origen", "stock_minimo")
      .eq("referencia_id", prodId);
    expect(notif4).toHaveLength(1);
    expect(notif4![0].mensaje).toContain("7.000 unidades");
  });
});

describeIntegration("C4·T3: RPC anular_venta", () => {
  let tAId = "";
  let uAId = "";
  let cAId = "";
  let sAId = "";
  let pAId = "";
  let svAId = "";
  let mpEfectivoId = "";

  beforeAll(async () => {
    const fixture = await crearFixtureVentas(serviceDb, "VT_T3");
    tAId = fixture.tenantId;
    uAId = fixture.usuarioId;
    cAId = fixture.cajaId;
    sAId = fixture.sesionId;
    pAId = fixture.productoId;
    svAId = fixture.servicioId;

    const { data: mpE } = await serviceDb
      .from("medios_pago")
      .select("id")
      .eq("codigo", "efectivo")
      .single();
    mpEfectivoId = mpE!.id;
  });

  afterAll(async () => {
    if (!serviceDb || !tAId) return;
    if (uAId) await borrarUsuarioAuth(uAId);
    await serviceDb.from("notificaciones").delete().eq("tenant_id", tAId);
    await serviceDb.from("ventas_pagos").delete().eq("tenant_id", tAId);
    await serviceDb.from("movimientos_stock").delete().eq("tenant_id", tAId);
    await serviceDb.from("existencias_lote").delete().eq("tenant_id", tAId);
    await serviceDb.from("lotes").delete().eq("tenant_id", tAId);
    await serviceDb.from("ventas_items").delete().eq("tenant_id", tAId);
    await serviceDb.from("movimientos_caja").delete().eq("tenant_id", tAId);
    await serviceDb.from("ventas").delete().eq("tenant_id", tAId);
    await serviceDb.from("sesiones_caja").delete().eq("tenant_id", tAId);
    await serviceDb.from("cajas").delete().eq("tenant_id", tAId);
    await serviceDb.from("servicios").delete().eq("tenant_id", tAId);
    await serviceDb.from("productos").delete().eq("tenant_id", tAId);
    await serviceDb.from("contadores_tenant").delete().eq("tenant_id", tAId);
    await serviceDb.from("registros_auditoria").delete().eq("tenant_id", tAId);
    await serviceDb.from("tenants").delete().eq("id", tAId);
  });

  async function sembrarStock(
    tenantId: string,
    productoId: string,
    cantidad: number,
    options?: {
      fechaVencimiento?: string | null;
      codigoLote?: string;
      bloqueado?: boolean;
      costo?: number;
    }
  ) {
    const { data: l, error: errL } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantId,
        producto_id: productoId,
        codigo_lote: options?.codigoLote ?? `LOTE-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        fecha_vencimiento: options?.fechaVencimiento ?? "2028-12-31",
        estado: options?.bloqueado ? "bloqueado" : "disponible",
        motivo_bloqueo: options?.bloqueado ? "Bloqueado para test" : null,
        costo_unitario_neto: options?.costo ?? 500,
        costo_unitario_efectivo: options?.costo ?? 500,
        origen: "inicial",
        usuario_id: uAId,
      })
      .select("id")
      .single();
    if (errL || !l) throw new Error(`Error sembrando lote: ${errL?.message}`);
    const loteId = l.id as string;

    const { error: errM } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoId,
      lote_id: loteId,
      cantidad: cantidad,
      costo_unitario: options?.costo ?? 500,
      costo_total: (options?.costo ?? 500) * cantidad,
      usuario_id: uAId,
    });
    if (errM) throw new Error(`Error insertando stock inicial: ${errM?.message}`);

    return loteId;
  }

  it("RN-VT4: anular una venta restituye existencias y dinero sin borrar registros", async () => {
    const { data: um } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const { data: p } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tAId,
        codigo: `ANUL-${Date.now()}`,
        nombre: "Producto Anulacion Test",
        unidad_medida_id: um!.id,
        precio_venta: 1000,
        alicuota_iva: 21.00,
        activo: true,
        es_vendible: true,
      })
      .select("id")
      .single();
    const prodId = p!.id;

    // Crear 2 lotes: Lote 1 con 2 unidades (vence antes), Lote 2 con 5 unidades (vence después)
    const l1 = await sembrarStock(tAId, prodId, 2, { fechaVencimiento: "2027-01-01", costo: 400 });
    const l2 = await sembrarStock(tAId, prodId, 5, { fechaVencimiento: "2027-06-01", costo: 450 });

    // Vender 3 unidades (tomará 2 de L1 y 1 de L2)
    const { data: vData, error: errVenta } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId,
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [{ tipoItem: "producto", productoId: prodId, cantidad: 3 }],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 3000 }],
    });
    expect(errVenta).toBeNull();
    const ventaId = vData[0].venta_id;

    // Verificar existencias antes de anular: L1 = 0, L2 = 4
    const { data: extPostVenta } = await serviceDb
      .from("existencias_lote")
      .select("lote_id, cantidad")
      .in("lote_id", [l1, l2]);
    expect(Number(extPostVenta?.find((e) => e.lote_id === l1)?.cantidad)).toBe(0);
    expect(Number(extPostVenta?.find((e) => e.lote_id === l2)?.cantidad)).toBe(4);

    // Anular con motivo corto -> rechazo
    const { error: errMotivoCorto } = await serviceDb.rpc("anular_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_venta_id: ventaId,
      p_sesion_caja_id: sAId,
      p_motivo: "error", // < 10 chars
    });
    expect(errMotivoCorto?.message).toContain("ANULATION_REASON_REQUIRED");

    // Anular con motivo válido
    const motivoAnulacion = "Devolución por producto defectuoso solicitada por cliente";
    const { data: anulData, error: errAnul } = await serviceDb.rpc("anular_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_venta_id: ventaId,
      p_sesion_caja_id: sAId,
      p_motivo: motivoAnulacion,
    });
    expect(errAnul).toBeNull();
    expect(anulData[0].estado).toBe("anulada");

    // 1. Verificar estado de la venta
    const { data: vRow } = await serviceDb
      .from("ventas")
      .select("estado, anulada_at, motivo_anulacion, anulada_por_usuario_id")
      .eq("id", ventaId)
      .single();
    expect(vRow!.estado).toBe("anulada");
    expect(vRow!.motivo_anulacion).toBe(motivoAnulacion);
    expect(vRow!.anulada_por_usuario_id).toBe(uAId);
    expect(vRow!.anulada_at).not.toBeNull();

    // 2. Verificar existencias restauradas: L1 = 2, L2 = 5
    const { data: extPostAnul } = await serviceDb
      .from("existencias_lote")
      .select("lote_id, cantidad")
      .in("lote_id", [l1, l2]);
    expect(Number(extPostAnul?.find((e) => e.lote_id === l1)?.cantidad)).toBe(2);
    expect(Number(extPostAnul?.find((e) => e.lote_id === l2)?.cantidad)).toBe(5);

    // 3. Verificar movimientos de stock compensatorios (entrada_devolucion)
    const { data: movsStock } = await serviceDb
      .from("movimientos_stock")
      .select("tipo, lote_id, cantidad, costo_unitario, motivo")
      .eq("tenant_id", tAId)
      .order("created_at", { ascending: false });

    const devL1 = movsStock?.find((m) => m.tipo === "entrada_devolucion" && m.lote_id === l1);
    const devL2 = movsStock?.find((m) => m.tipo === "entrada_devolucion" && m.lote_id === l2);
    expect(devL1).toBeDefined();
    expect(Number(devL1!.cantidad)).toBe(2);
    expect(Number(devL1!.costo_unitario)).toBe(400);
    expect(devL1!.motivo).toBe(motivoAnulacion);

    expect(devL2).toBeDefined();
    expect(Number(devL2!.cantidad)).toBe(1);
    expect(Number(devL2!.costo_unitario)).toBe(450);
    expect(devL2!.motivo).toBe(motivoAnulacion);

    // 4. Verificar movimiento de caja compensatorio (egreso_devolucion)
    const { data: movsCaja } = await serviceDb
      .from("movimientos_caja")
      .select("tipo, importe, motivo, venta_id, sesion_caja_id")
      .eq("venta_id", ventaId)
      .eq("tipo", "egreso_devolucion");
    expect(movsCaja).toHaveLength(1);
    expect(Number(movsCaja![0].importe)).toBe(3000);
    expect(movsCaja![0].motivo).toBe(motivoAnulacion);
    expect(movsCaja![0].sesion_caja_id).toBe(sAId);

    // 5. Reintentar anulación -> SALE_ALREADY_ANNULLED
    const { error: errReanular } = await serviceDb.rpc("anular_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_venta_id: ventaId,
      p_sesion_caja_id: sAId,
      p_motivo: "Segundo intento de anulación",
    });
    expect(errReanular?.message).toContain("SALE_ALREADY_ANNULLED");
  });

  it("RN-VT5: la anulación de una venta vieja impacta en la sesión actual, no en la cerrada", async () => {
    // 1. Crear Venta V1 en Sesión 1
    const { data: vData1, error: errV1 } = await serviceDb.rpc("registrar_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_sesion_caja_id: sAId, // Sesión 1
      p_cliente_id: null,
      p_condicion_pago: "contado",
      p_items: [
        {
          tipoItem: "servicio",
          servicioId: svAId,
          cantidad: 1,
          precioUnitario: 2500,
        },
      ],
      p_pagos: [{ medioPagoId: mpEfectivoId, importe: 2500 }],
    });
    expect(errV1).toBeNull();
    const ventaId1 = vData1[0].venta_id;

    // 2. Cerrar Sesión 1
    const { error: errCierre1 } = await serviceDb
      .from("sesiones_caja")
      .update({
        estado: "cerrada",
        cierre_usuario_id: uAId,
        cierre_at: new Date().toISOString(),
        saldo_teorico_efectivo: 3500,
        efectivo_contado: 3500,
        diferencia: 0,
      })
      .eq("id", sAId);
    expect(errCierre1).toBeNull();

    // 3. Abrir Sesión 2 en la misma caja
    const { data: s2, error: errS2 } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tAId,
        caja_id: cAId,
        estado: "abierta",
        apertura_usuario_id: uAId,
        saldo_inicial: 1000,
      })
      .select("id")
      .single();
    expect(errS2).toBeNull();
    const sesion2Id = s2!.id;

    // 4. Anular V1 pasando la sesión 2 abierta
    const { data: anulData, error: errAnul } = await serviceDb.rpc("anular_venta", {
      p_tenant_id: tAId,
      p_usuario_id: uAId,
      p_venta_id: ventaId1,
      p_sesion_caja_id: sesion2Id, // Sesión 2 (actual)
      p_motivo: "Cliente devuelve servicio por reprogramacion total",
    });
    expect(errAnul).toBeNull();

    // 5. Comprobar que el egreso_devolucion pertenece a la sesión 2
    const { data: movEgreso } = await serviceDb
      .from("movimientos_caja")
      .select("id, sesion_caja_id, tipo, importe")
      .eq("venta_id", ventaId1)
      .eq("tipo", "egreso_devolucion")
      .single();
    expect(movEgreso!.sesion_caja_id).toBe(sesion2Id);
    expect(movEgreso!.sesion_caja_id).not.toBe(sAId);

    // 6. Comprobar que en la sesión 1 cerrada NO hay movimientos de tipo egreso_devolucion para esta venta
    const { data: movsS1 } = await serviceDb
      .from("movimientos_caja")
      .select("id, tipo")
      .eq("sesion_caja_id", sAId)
      .eq("venta_id", ventaId1)
      .eq("tipo", "egreso_devolucion");
    expect(movsS1).toHaveLength(0);
  });

  it("RN-MV9: la anulación genera movimientos nuevos y no borra los originales", async () => {
    // Verificar que en movimientos_stock siguen existiendo los movimientos de salida_venta originales
    const { data: salidas } = await serviceDb
      .from("movimientos_stock")
      .select("id, tipo")
      .eq("tenant_id", tAId)
      .eq("tipo", "salida_venta");
    expect(salidas!.length).toBeGreaterThan(0);

    const { data: devoluciones } = await serviceDb
      .from("movimientos_stock")
      .select("id, tipo")
      .eq("tenant_id", tAId)
      .eq("tipo", "entrada_devolucion");
    expect(devoluciones!.length).toBeGreaterThan(0);
  });
});



