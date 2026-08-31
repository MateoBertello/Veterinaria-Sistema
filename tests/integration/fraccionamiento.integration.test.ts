import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, borrarUsuarioAuth, limpiarTenant } from "./_teardown.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

let serviceDb: SupabaseClient;

let tenantAId = "";
let usuarioAId = "";
let proveedorAId = "";

let unidadBolsaId = "";
let unidadKgId = "";
let unidadCajaId = "";
let unidadBlisterId = "";
let unidadComprimidoId = "";

let productoBolsaId = "";
let productoSueltoId = "";
let productoCajaId = "";
let productoBlisterId = "";
let productoCompId = "";
let productoInactivoId = "";

let conversionBolsaASueltoId = "";
let conversionCajaABlisterId = "";
let conversionBlisterACompId = "";

let loteBolsaAId = "";

export async function crearFixtureFraccionamiento(db: SupabaseClient, prefix: string) {
  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant Fraccionamiento`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-1`,
    p_email_contacto: `${prefix.toLowerCase()}_fracc_${Date.now()}@test.com`,
    p_plan: "premium",
  });
  if (errT || !t) throw new Error(`Error creando tenant: ${errT?.message}`);
  const tenantId = typeof t === "string" ? t : (t as { id: string }).id;

  // Configuración de tolerancia (10%)
  await db
    .from("configuracion_tenant")
    .update({ tolerancia_rendimiento_porcentaje: 10.00 })
    .eq("tenant_id", tenantId);

  // 2. Rol admin
  const { data: r } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "admin")
    .single();
  const rolId = r!.id as string;

  // 3. Usuario Auth + DB
  const usuarioId = await crearUsuarioAuth(`${prefix.toLowerCase()}_fracc_${Date.now()}@test.com`, {
    tenant_id: tenantId,
  });

  const { error: errU } = await db.from("usuarios").insert({
    id: usuarioId,
    tenant_id: tenantId,
    username: `${prefix.toLowerCase()}_admin_${Date.now()}`,
    email: `${prefix.toLowerCase()}_fracc_${Date.now()}@test.com`,
    full_name: `${prefix} Admin`,
    rol_id: rolId,
    active: true,
  });
  if (errU) throw new Error(`Error creando usuario: ${errU?.message}`);

  // 4. Proveedor
  const { data: prov, error: errP } = await db
    .from("proveedores")
    .insert({
      tenant_id: tenantId,
      razon_social: `${prefix} Distribuidora Mayorista SA`,
      cuit: `30-${Math.floor(10000000 + Math.random() * 90000000)}-8`,
    })
    .select("id")
    .single();
  if (errP || !prov) throw new Error(`Error creando proveedor: ${errP?.message}`);

  return { tenantId, usuarioId, proveedorId: prov.id };
}

describeIntegration("C6: Fraccionamiento - Integración (Libro Mayor y RPCs)", () => {
  beforeAll(async () => {
    serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fixA = await crearFixtureFraccionamiento(serviceDb, "C6A");
    tenantAId = fixA.tenantId;
    usuarioAId = fixA.usuarioId;
    proveedorAId = fixA.proveedorId;

    // Unidades de medida
    const { data: unidades } = await serviceDb
      .from("unidades_medida")
      .select("id, codigo");
    for (const u of unidades ?? []) {
      if (u.codigo === "bolsa") unidadBolsaId = u.id;
      if (u.codigo === "kg") unidadKgId = u.id;
      if (u.codigo === "caja") unidadCajaId = u.id;
      if (u.codigo === "blister") unidadBlisterId = u.id;
      if (u.codigo === "comprimido") unidadComprimidoId = u.id;
    }

    // Familia de alimentos
    const { data: fam, error: errFam } = await serviceDb
      .from("familias_producto")
      .insert({
        tenant_id: tenantAId,
        nombre: "Alimentos Balanceados Caninos",
        unidad_base_id: unidadKgId,
      })
      .select("id")
      .single();
    if (errFam) throw new Error(`Error creando familia: ${errFam.message}`);
    const familiaAlimentosId = fam.id;

    // Familia de medicamentos
    const { data: famMed } = await serviceDb
      .from("familias_producto")
      .insert({
        tenant_id: tenantAId,
        nombre: "Antibióticos y Antiparasitarios",
        unidad_base_id: unidadComprimidoId,
      })
      .select("id")
      .single();
    const familiaMedId = famMed!.id;

    // Productos
    // 1. Bolsa 15 kg
    const { data: pBolsa } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "ALIM-15KG",
        nombre: "Alimento Premium Adulto 15 kg",
        familia_id: familiaAlimentosId,
        unidad_medida_id: unidadBolsaId,
        precio_venta: 60000,
        costo_reposicion: 45000,
        controla_lote: true,
        controla_vencimiento: true,
      })
      .select("id")
      .single();
    productoBolsaId = pBolsa!.id;

    // 2. Suelto por kg
    const { data: pSuelto } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "ALIM-KG",
        nombre: "Alimento Premium Adulto Suelto por kg",
        familia_id: familiaAlimentosId,
        unidad_medida_id: unidadKgId,
        precio_venta: 5000,
        costo_reposicion: 3000,
        vida_util_post_apertura_dias: 30,
        controla_lote: true,
        controla_vencimiento: true,
      })
      .select("id")
      .single();
    productoSueltoId = pSuelto!.id;

    // 3. Caja 100 comp
    const { data: pCaja } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "MED-CAJA",
        nombre: "Amoxicilina 500mg Caja x100",
        familia_id: familiaMedId,
        unidad_medida_id: unidadCajaId,
        precio_venta: 25000,
        costo_reposicion: 15000,
      })
      .select("id")
      .single();
    productoCajaId = pCaja!.id;

    // 4. Blíster 10 comp
    const { data: pBlister } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "MED-BLISTER",
        nombre: "Amoxicilina 500mg Blíster x10",
        familia_id: familiaMedId,
        unidad_medida_id: unidadBlisterId,
        precio_venta: 3000,
      })
      .select("id")
      .single();
    productoBlisterId = pBlister!.id;

    // 5. Comprimido individual
    const { data: pComp } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "MED-COMP",
        nombre: "Amoxicilina 500mg Comprimido",
        familia_id: familiaMedId,
        unidad_medida_id: unidadComprimidoId,
        precio_venta: 350,
      })
      .select("id")
      .single();
    productoCompId = pComp!.id;

    // 6. Producto Inactivo
    const { data: pInact } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "PROD-INACTIVO",
        nombre: "Producto Descontinuado",
        unidad_medida_id: unidadKgId,
        activo: false,
      })
      .select("id")
      .single();
    productoInactivoId = pInact!.id;

    // Conversiones
    // Bolsa -> Suelto (factor 15)
    const { data: c1 } = await serviceDb
      .from("producto_conversiones")
      .insert({
        tenant_id: tenantAId,
        producto_origen_id: productoBolsaId,
        producto_destino_id: productoSueltoId,
        factor_teorico: 15.0000,
        activo: true,
      })
      .select("id")
      .single();
    conversionBolsaASueltoId = c1!.id;

    // Caja -> Blister (factor 10)
    const { data: c2 } = await serviceDb
      .from("producto_conversiones")
      .insert({
        tenant_id: tenantAId,
        producto_origen_id: productoCajaId,
        producto_destino_id: productoBlisterId,
        factor_teorico: 10.0000,
        activo: true,
      })
      .select("id")
      .single();
    conversionCajaABlisterId = c2!.id;

    // Blister -> Comp (factor 10)
    const { data: c3 } = await serviceDb
      .from("producto_conversiones")
      .insert({
        tenant_id: tenantAId,
        producto_origen_id: productoBlisterId,
        producto_destino_id: productoCompId,
        factor_teorico: 10.0000,
        activo: true,
      })
      .select("id")
      .single();
    conversionBlisterACompId = c3!.id;

    // Sembrar stock para Bolsa 15kg (Lote padre)
    const { data: lPadre } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoBolsaId,
        codigo_lote: "LOTE-BOLSA-001",
        fecha_vencimiento: "2027-03-01",
        costo_unitario_neto: 45000,
        costo_unitario_efectivo: 45000,
        origen: "compra",
        proveedor_id: proveedorAId,
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();
    loteBolsaAId = lPadre!.id;

    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoBolsaId,
      lote_id: loteBolsaAId,
      cantidad: 10,
      costo_unitario: 45000,
      costo_total: 450000,
      usuario_id: usuarioAId,
    });
  });

  afterAll(async () => {
    if (tenantAId) await limpiarTenant(serviceDb, tenantAId);
    if (usuarioAId) await borrarUsuarioAuth(usuarioAId);
  });

  describe("C6·T1: RPC fraccionar_lote y Aceptación de Fraccionamiento", () => {
    it("RN-FR1: sin conversión definida no se fracciona", async () => {
      // 1. Sin relación entre productoCajaId y productoSueltoId
      const { error: errSinConv } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoCompId, // no hay conversión bolsa -> comprimido
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 15,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(errSinConv?.message).toMatch(/CONVERSION_NOT_DEFINED/);

      // 2. Con la conversión desactivada
      await serviceDb
        .from("producto_conversiones")
        .update({ activo: false })
        .eq("id", conversionBolsaASueltoId);

      const { error: errDesact } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 15,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(errDesact?.message).toMatch(/CONVERSION_NOT_DEFINED/);

      // Restaurar activo
      await serviceDb
        .from("producto_conversiones")
        .update({ activo: true })
        .eq("id", conversionBolsaASueltoId);
    });

    it("RN-FR3: la operación es atómica", async () => {
      const { count: lotesAntes } = await serviceDb
        .from("lotes")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantAId);
      const { count: movsAntes } = await serviceDb
        .from("movimientos_stock")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantAId);

      // Forzar fallo de vencimiento posterior al padre (RN-FR10)
      const { error: errFallo } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 15,
        p_fecha_vencimiento_destino: "2030-01-01", // Padre vence en 2027-03-01
        p_codigo_lote_destino: "LOTE-HIJO-FALLIDO",
        p_motivo: null,
      });
      expect(errFallo?.message).toMatch(/EXPIRY_AFTER_PARENT/);

      const { count: lotesDespues } = await serviceDb
        .from("lotes")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantAId);
      const { count: movsDespues } = await serviceDb
        .from("movimientos_stock")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantAId);

      expect(lotesDespues).toBe(lotesAntes);
      expect(movsDespues).toBe(movsAntes);
    });

    it("RN-FR3: los tres movimientos comparten operacion_id", async () => {
      const { data: res, error: err } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 14.5, // Rendimiento con merma de 0.5 kg
        p_fecha_vencimiento_destino: "2027-02-01",
        p_codigo_lote_destino: "LOTE-FRACC-OP-TEST",
        p_motivo: "Fraccionamiento con leve merma de prueba",
      });
      expect(err).toBeNull();
      expect(res).toBeDefined();
      const opId = (res as Array<{ operacion_id: string }>)[0].operacion_id;

      const { data: movs } = await serviceDb
        .from("movimientos_stock")
        .select("tipo, operacion_id, cantidad, costo_unitario, costo_total")
        .eq("operacion_id", opId);

      expect(movs).toHaveLength(3);
      const tipos = movs!.map((m) => m.tipo);
      expect(tipos).toContain("salida_conversion");
      expect(tipos).toContain("entrada_conversion");
      expect(tipos).toContain("merma_fraccionamiento");
      for (const m of movs!) {
        expect(m.operacion_id).toBe(opId);
      }
    });

    it("RN-FR5: la cantidad obtenida no supera la teórica", async () => {
      // 1. Declarar 15.5 kg obtenidos con factor 15 -> INVALID_YIELD
      const { error: errMayor } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 15.5,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(errMayor?.message).toMatch(/INVALID_YIELD/);

      // 2. Declarar 0 kg -> INVALID_YIELD
      const { error: errCero } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 0,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(errCero?.message).toMatch(/INVALID_YIELD/);

      // 3. Declarar exactamente 15 kg -> Funciona
      const { error: errExacto } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 15,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(errExacto).toBeNull();
    });

    it("RN-FR6: menos que el teórico es merma, no error", async () => {
      // Tolerancia es 10%. Factor es 15.
      // Desvío del 20%: obtener 12 kg (desvío = (15 - 12) / 15 * 100 = 20% > 10%)
      // 1. Sin motivo -> REASON_REQUIRED
      const { error: errSinMotivo } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 12,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(errSinMotivo?.message).toMatch(/REASON_REQUIRED/);

      // Con motivo corto -> REASON_REQUIRED
      const { error: errMotivoCorto } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 12,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: "corto",
      });
      expect(errMotivoCorto?.message).toMatch(/REASON_REQUIRED/);

      // Con motivo descriptivo -> Funciona
      const { data: resOk, error: errConMotivo } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 12,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: "LOTE-MERMA-20PCT",
        p_motivo: "Derrame accidental en embudo durante fraccionamiento",
      });
      expect(errConMotivo).toBeNull();
      expect(resOk).toBeDefined();
    });

    it("RN-FR8: la merma de fraccionamiento tiene costo cero", async () => {
      // Medir valor total del inventario antes de fraccionar
      const { data: existenciasAntes } = await serviceDb
        .from("existencias_lote")
        .select("cantidad, lote_id, lotes!existencias_lote_tenant_fkey(costo_unitario_efectivo)")
        .eq("tenant_id", tenantAId);

      let valorTotalAntes = 0;
      for (const e of existenciasAntes ?? []) {
        const costo = Number((e.lotes as any)?.costo_unitario_efectivo ?? 0);
        valorTotalAntes += Number(e.cantidad) * costo;
      }

      // Fraccionar 1 bolsa ($45.000) obteniendo 14.2 kg (merma 0.8 kg)
      const { data: res, error: err } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 14.2,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: "LOTE-RN-FR8-TEST",
        p_motivo: "Fraccionamiento con merma normal de pesado",
      });
      expect(err).toBeNull();
      const opId = (res as Array<{ operacion_id: string }>)[0].operacion_id;

      // 1. Verificar movimientos de la operación: la suma firmada de costo_total es 0.00
      const { data: movs } = await serviceDb
        .from("movimientos_stock")
        .select("tipo, cantidad, costo_unitario, costo_total, cantidad_con_signo")
        .eq("operacion_id", opId);

      const mermaMov = movs!.find((m) => m.tipo === "merma_fraccionamiento");
      expect(mermaMov).toBeDefined();
      expect(Number(mermaMov!.costo_unitario)).toBe(0);
      expect(Number(mermaMov!.costo_total)).toBe(0);
      expect(Number(mermaMov!.cantidad)).toBe(0.8);

      let sumaCostosOperacion = 0;
      for (const m of movs!) {
        const signo = m.tipo === "salida_conversion" || m.tipo === "merma_fraccionamiento" ? -1 : 1;
        // La salida resta valor y la entrada suma valor
        if (m.tipo === "salida_conversion") sumaCostosOperacion -= Number(m.costo_total);
        if (m.tipo === "entrada_conversion") sumaCostosOperacion += Number(m.costo_total);
        if (m.tipo === "merma_fraccionamiento") sumaCostosOperacion -= Number(m.costo_total);
      }
      expect(Math.abs(sumaCostosOperacion)).toBeLessThan(0.01);

      // 2. Medir valor total del inventario después de fraccionar: es idéntico
      const { data: existenciasDespues } = await serviceDb
        .from("existencias_lote")
        .select("cantidad, lote_id, lotes!existencias_lote_tenant_fkey(costo_unitario_efectivo)")
        .eq("tenant_id", tenantAId);

      let valorTotalDespues = 0;
      for (const e of existenciasDespues ?? []) {
        const costo = Number((e.lotes as any)?.costo_unitario_efectivo ?? 0);
        valorTotalDespues += Number(e.cantidad) * costo;
      }

      expect(Math.abs(valorTotalDespues - valorTotalAntes)).toBeLessThan(0.01);
    });

    it("RN-FR10: el hijo no vence después que el padre", async () => {
      const { error: err } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 14.2,
        p_fecha_vencimiento_destino: "2027-06-01", // Padre vence 2027-03-01
        p_codigo_lote_destino: "LOTE-VENC-POSTERIOR",
        p_motivo: null,
      });
      expect(err?.message).toMatch(/EXPIRY_AFTER_PARENT/);
    });

    it("RN-FR13: los decimales se validan por producto", async () => {
      // 1. Origen 'caja' no admite decimales -> fraccionar 0.5 cajas falla
      // Crear lote de caja
      const { data: lCaja } = await serviceDb
        .from("lotes")
        .insert({
          tenant_id: tenantAId,
          producto_id: productoCajaId,
          codigo_lote: "LOTE-CAJA-001",
          costo_unitario_neto: 15000,
          costo_unitario_efectivo: 15000,
          origen: "compra",
          usuario_id: usuarioAId,
        })
        .select("id")
        .single();
      const loteCajaId = lCaja!.id;

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: productoCajaId,
        lote_id: loteCajaId,
        cantidad: 5,
        costo_unitario: 15000,
        costo_total: 75000,
        usuario_id: usuarioAId,
      });

      const { error: errDecimalOrigen } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteCajaId,
        p_producto_destino_id: productoBlisterId,
        p_cantidad_origen: 0.5, // 0.5 cajas es inválido
        p_cantidad_obtenida: 5,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(errDecimalOrigen?.message).toMatch(/UNIT_NO_DECIMALS/);

      // 2. Destino 'blister' no admite decimales -> obtener 9.5 blísters falla
      const { error: errDecimalDestino } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteCajaId,
        p_producto_destino_id: productoBlisterId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 9.5, // 9.5 blísters es inválido
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: "Merma en blíster",
      });
      expect(errDecimalDestino?.message).toMatch(/UNIT_NO_DECIMALS/);

      // 3. Origen bolsa (1 entero) -> destino kg (14.2 kg con decimales válidos) -> Funciona
      const { error: errValido } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 14.2,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: "LOTE-DECIMAL-OK",
        p_motivo: "Fraccionamiento correcto",
      });
      expect(errValido).toBeNull();
    });

    it("RN-LO4: un lote vencido no se fracciona", async () => {
      // Crear un lote de bolsa ya vencido
      const { data: lVenc } = await serviceDb
        .from("lotes")
        .insert({
          tenant_id: tenantAId,
          producto_id: productoBolsaId,
          codigo_lote: "LOTE-VENCIDO-001",
          fecha_vencimiento: "2020-01-01",
          costo_unitario_neto: 45000,
          costo_unitario_efectivo: 45000,
          origen: "compra",
          usuario_id: usuarioAId,
        })
        .select("id")
        .single();
      const loteVencId = lVenc!.id;

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: productoBolsaId,
        lote_id: loteVencId,
        cantidad: 2,
        costo_unitario: 45000,
        costo_total: 90000,
        usuario_id: usuarioAId,
      });

      const { error: err } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteVencId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 15,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: null,
        p_motivo: null,
      });
      expect(err?.message).toMatch(/BATCH_EXPIRED/);
    });

    it("el caso real del dueño: bolsa de 15 kg -> kilos sueltos", async () => {
      // Bolsa de $45.000 con factor 15, obtener 14,2 kg
      const { data: exPadreAntes } = await serviceDb
        .from("existencias_lote")
        .select("cantidad")
        .eq("lote_id", loteBolsaAId)
        .single();
      const cantPadreAntes = Number(exPadreAntes!.cantidad);

      const { data: res, error: err } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBolsaAId,
        p_producto_destino_id: productoSueltoId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 14.2,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: "LOTE-DUENO-14KG2",
        p_motivo: "Apertura y fraccionamiento para venta por kg",
      });
      expect(err).toBeNull();
      expect(res).toHaveLength(1);

      const fraccRes = (res as any)[0];
      const loteHijoId = fraccRes.lote_destino_id;
      const opId = fraccRes.operacion_id;

      // 1. Verificar lote hijo
      const { data: loteHijo } = await serviceDb
        .from("lotes")
        .select("*")
        .eq("id", loteHijoId)
        .single();

      expect(loteHijo).toBeDefined();
      expect(loteHijo!.lote_padre_id).toBe(loteBolsaAId);
      expect(loteHijo!.origen).toBe("conversion");
      expect(Number(loteHijo!.costo_unitario_efectivo)).toBe(3169.0141);

      // 2. Verificar existencia del padre
      const { data: exPadreDespues } = await serviceDb
        .from("existencias_lote")
        .select("cantidad")
        .eq("lote_id", loteBolsaAId)
        .single();
      expect(Number(exPadreDespues!.cantidad)).toBe(cantPadreAntes - 1);

      // 3. Verificar existencia del hijo
      const { data: exHijo } = await serviceDb
        .from("existencias_lote")
        .select("cantidad")
        .eq("lote_id", loteHijoId)
        .single();
      expect(Number(exHijo!.cantidad)).toBe(14.2);

      // 4. Verificar merma de 0.8 con costo 0
      const { data: movMerma } = await serviceDb
        .from("movimientos_stock")
        .select("*")
        .eq("operacion_id", opId)
        .eq("tipo", "merma_fraccionamiento")
        .single();
      expect(movMerma).toBeDefined();
      expect(Number(movMerma!.cantidad)).toBe(0.8);
      expect(Number(movMerma!.costo_unitario)).toBe(0);
      expect(Number(movMerma!.costo_total)).toBe(0);
    });

    it("RN-FR4: cadena de trazabilidad recursiva (caja -> blíster -> comprimido)", async () => {
      // 0. Crear lote para productoCajaId
      const { data: lCaja } = await serviceDb
        .from("lotes")
        .insert({
          tenant_id: tenantAId,
          producto_id: productoCajaId,
          codigo_lote: "LOTE-CAJA-TRAZ-001",
          fecha_vencimiento: "2027-12-31",
          costo_unitario_neto: 15000,
          costo_unitario_efectivo: 15000,
          origen: "compra",
          proveedor_id: proveedorAId,
          usuario_id: usuarioAId,
        })
        .select("id")
        .single();
      const loteCajaId = lCaja!.id;

      await serviceDb.from("movimientos_stock").insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: productoCajaId,
        lote_id: loteCajaId,
        cantidad: 5,
        costo_unitario: 15000,
        costo_total: 75000,
        usuario_id: usuarioAId,
      });

      // 1. Fraccionar 1 caja a 10 blísters
      const { data: resBlister, error: errBlister } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteCajaId,
        p_producto_destino_id: productoBlisterId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 10,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: "LOTE-BLISTER-TRAZ-1",
        p_motivo: "Fraccionar caja a blisters",
      });
      expect(errBlister).toBeNull();
      const loteBlisterId = (resBlister as any)[0].lote_destino_id;

      // 2. Fraccionar 1 blíster a 10 comprimidos
      const { data: resComp, error: errComp } = await serviceDb.rpc("fraccionar_lote", {
        p_tenant_id: tenantAId,
        p_usuario_id: usuarioAId,
        p_lote_origen_id: loteBlisterId,
        p_producto_destino_id: productoCompId,
        p_cantidad_origen: 1,
        p_cantidad_obtenida: 10,
        p_fecha_vencimiento_destino: null,
        p_codigo_lote_destino: "LOTE-COMP-TRAZ-1",
        p_motivo: "Fraccionar blister a comprimidos",
      });
      expect(errComp).toBeNull();
      const loteCompId = (resComp as any)[0].lote_destino_id;

      // 3. Consultar trazabilidad desde el nivel medio (blíster)
      const { data: trazabilidad, error: errTraz } = await serviceDb.rpc("cadena_trazabilidad_lote", {
        p_tenant_id: tenantAId,
        p_lote_id: loteBlisterId,
      });

      expect(errTraz).toBeNull();
      expect(trazabilidad).toHaveLength(3);

      // Fila ancestro (nivel -1, caja)
      const ancestro = (trazabilidad as any[]).find((t) => t.nivel === -1);
      expect(ancestro).toBeDefined();
      expect(ancestro.lote_id).toBe(loteCajaId);
      expect(ancestro.direccion).toBe("ancestro");
      expect(ancestro.producto_nombre).toBe("Amoxicilina 500mg Caja x100");

      // Fila origen (nivel 0, blíster)
      const origen = (trazabilidad as any[]).find((t) => t.nivel === 0);
      expect(origen).toBeDefined();
      expect(origen.lote_id).toBe(loteBlisterId);
      expect(origen.direccion).toBe("origen");
      expect(origen.producto_nombre).toBe("Amoxicilina 500mg Blíster x10");

      // Fila derivado (nivel +1, comprimido)
      const derivado = (trazabilidad as any[]).find((t) => t.nivel === 1);
      expect(derivado).toBeDefined();
      expect(derivado.lote_id).toBe(loteCompId);
      expect(derivado.direccion).toBe("derivado");
      expect(derivado.producto_nombre).toBe("Amoxicilina 500mg Comprimido");
    });

    it("C6·T3: v_costo_fraccionamiento y v_stock_familia_unidad_base", async () => {
      // 1. Consultar v_costo_fraccionamiento
      const { data: costos, error: errCostos } = await serviceDb
        .from("v_costo_fraccionamiento")
        .select("*")
        .eq("tenant_id", tenantAId);

      expect(errCostos).toBeNull();
      expect(costos!.length).toBeGreaterThan(0);

      for (const op of costos!) {
        if (Number(op.merma) > 0) {
          expect(Number(op.cantidad_teorica)).toBeGreaterThan(Number(op.cantidad_obtenida));
          expect(Number(op.sobrecosto)).toBeGreaterThan(0);
        }
      }

      // 2. Consultar v_stock_familia_unidad_base
      const { data: stockFamilia, error: errStockFam } = await serviceDb
        .from("v_stock_familia_unidad_base")
        .select("*")
        .eq("tenant_id", tenantAId);

      expect(errStockFam).toBeNull();
      expect(stockFamilia!.length).toBeGreaterThan(0);
      for (const sf of stockFamilia!) {
        expect(Number(sf.cantidad_en_unidad_base)).toBeGreaterThan(0);
      }
    });
  });
});


