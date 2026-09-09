/**
 * Tests de integración — Catálogo Comercial y Proveedores (C1·T3).
 */

// Polyfill WebSocket solo en entorno de tests
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { limpiarTenant } from "./_teardown.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de catálogo comercial omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

let serviceDb: SupabaseClient;
let tenantAId = "";
let tenantBId = "";
let unidadUnidadId = "";
let unidadKgId = "";
let unidadCompId = "";
const createdTenantIds: string[] = [];

async function crearTenant(nombre: string, plan: "profesional" | "premium" = "profesional"): Promise<string> {
  const cuit = `30-${Date.now().toString().slice(-7)}-${createdTenantIds.length + 1}`;
  const { data } = await serviceDb
    .from("tenants")
    .insert({ nombre, cuit_rut: cuit, email_contacto: `${cuit}@cat-test.com`, plan })
    .select("id")
    .single();
  const id = (data?.id as string) ?? "";
  if (id) {
    createdTenantIds.push(id);
    await serviceDb.rpc("on_tenant_created", { p_tenant_id: id });
  }
  return id;
}

beforeAll(async () => {
  if (skipIfNoCredentials()) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  tenantAId = await crearTenant("Clínica Catálogo A", "profesional");
  tenantBId = await crearTenant("Clínica Catálogo B", "profesional");

  // Obtener IDs de unidades globales
  const { data: uUnidad } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
  const { data: uKg } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "kg").single();
  const { data: uComp } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "comprimido").single();

  unidadUnidadId = uUnidad?.id ?? "";
  unidadKgId = uKg?.id ?? "";
  unidadCompId = uComp?.id ?? "";
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of createdTenantIds) {
    await limpiarTenant(serviceDb, tid);
  }
});

describeIntegration("C1·T3: Restricciones de integridad del catálogo comercial en la base", () => {
  it("RN-PR1: dos productos del mismo tenant no comparten código; dos tenants sí", async () => {
    if (skipIfNoCredentials()) return;

    // 1. Insertar producto en tenant A
    const { error: err1 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: "SKU-TEST-1",
      nombre: "Producto 1 en A",
      unidad_medida_id: unidadUnidadId,
    });
    expect(err1).toBeNull();

    // 2. Insertar mismo código en tenant A → falla
    const { error: err2 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: "SKU-TEST-1",
      nombre: "Producto Duplicado en A",
      unidad_medida_id: unidadUnidadId,
    });
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23505"); // unique_violation

    // 3. Insertar mismo código en tenant B → funciona
    const { error: err3 } = await serviceDb.from("productos").insert({
      tenant_id: tenantBId,
      codigo: "SKU-TEST-1",
      nombre: "Producto 1 en B",
      unidad_medida_id: unidadUnidadId,
    });
    expect(err3).toBeNull();
  });

  it("RN-PR4: la alícuota está en el conjunto admitido", async () => {
    if (skipIfNoCredentials()) return;

    // Alícuota inválida (15.00) → viola CHECK
    const { error: errInvalido } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: "SKU-IVA-BAD",
      nombre: "Producto IVA 15",
      unidad_medida_id: unidadUnidadId,
      alicuota_iva: 15.00,
    });
    expect(errInvalido).not.toBeNull();
    expect(errInvalido?.code).toBe("23514"); // check_violation

    // Alícuotas válidas: 0, 10.50, 21, 27
    const validas = [0, 10.50, 21.00, 27.00];
    for (let i = 0; i < validas.length; i++) {
      const iva = validas[i];
      const { error } = await serviceDb.from("productos").insert({
        tenant_id: tenantAId,
        codigo: `SKU-IVA-OK-${i}`,
        nombre: `Producto IVA ${iva}`,
        unidad_medida_id: unidadUnidadId,
        alicuota_iva: iva,
      });
      expect(error).toBeNull();
    }
  });

  it("RN-PR6: la cantidad respeta los decimales de su unidad", async () => {
    if (skipIfNoCredentials()) return;

    // 1.5 comprimidos → false
    const { data: res1 } = await serviceDb.rpc("cantidad_valida_para_unidad", {
      p_cantidad: 1.5,
      p_unidad_id: unidadCompId,
    });
    expect(res1).toBe(false);

    // 1.5 kg → true
    const { data: res2 } = await serviceDb.rpc("cantidad_valida_para_unidad", {
      p_cantidad: 1.5,
      p_unidad_id: unidadKgId,
    });
    expect(res2).toBe(true);

    // 1.2345 kg (4 decimales, escala max 3) → false
    const { data: res3 } = await serviceDb.rpc("cantidad_valida_para_unidad", {
      p_cantidad: 1.2345,
      p_unidad_id: unidadKgId,
    });
    expect(res3).toBe(false);

    // 1 comprimido → true
    const { data: res4 } = await serviceDb.rpc("cantidad_valida_para_unidad", {
      p_cantidad: 1,
      p_unidad_id: unidadCompId,
    });
    expect(res4).toBe(true);
  });

  it("RN-PR7: escala coherente con admite_decimales", async () => {
    if (skipIfNoCredentials()) return;

    // escala_decimal = 4 → viola chk_unidades_escala_rango
    const { error: err1 } = await serviceDb.from("unidades_medida").insert({
      codigo: "custom_unit_4",
      nombre: "Custom 4",
      abreviatura: "c4",
      admite_decimales: true,
      escala_decimal: 4,
    });
    expect(err1).not.toBeNull();
    expect(err1?.code).toBe("23514");

    // admite_decimales = false con escala_decimal = 2 → viola chk_unidades_escala_decimales
    const { error: err2 } = await serviceDb.from("unidades_medida").insert({
      codigo: "custom_unit_no_dec",
      nombre: "Custom No Dec",
      abreviatura: "cnd",
      admite_decimales: false,
      escala_decimal: 2,
    });
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23514");
  });

  it("RN-PR8: una familia no existe sin unidad base", async () => {
    if (skipIfNoCredentials()) return;

    const { error } = await serviceDb.from("familias_producto").insert({
      tenant_id: tenantAId,
      nombre: "Familia Sin Unidad",
      unidad_base_id: null as any,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23502"); // not_null_violation
  });

  it("RN-PR11: el código de barras es único cuando existe", async () => {
    if (skipIfNoCredentials()) return;

    // 1. Primer producto con código de barras
    const { error: err1 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: "SKU-BAR-1",
      nombre: "Producto Barcode 1",
      unidad_medida_id: unidadUnidadId,
      codigo_barras: "7791234567890",
    });
    expect(err1).toBeNull();

    // 2. Segundo producto con el mismo código de barras en el mismo tenant → falla
    const { error: err2 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: "SKU-BAR-2",
      nombre: "Producto Barcode 2",
      unidad_medida_id: unidadUnidadId,
      codigo_barras: "7791234567890",
    });
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23505");

    // 3. Tres productos con código de barras NULL en el mismo tenant → los tres funcionan
    for (let i = 1; i <= 3; i++) {
      const { error: errNull } = await serviceDb.from("productos").insert({
        tenant_id: tenantAId,
        codigo: `SKU-BAR-NULL-${i}`,
        nombre: `Producto Barcode Null ${i}`,
        unidad_medida_id: unidadUnidadId,
        codigo_barras: null,
      });
      expect(errNull).toBeNull();
    }
  });

  it("RN-PR12: el nombre es único entre los activos, insensible a mayúsculas", async () => {
    if (skipIfNoCredentials()) return;

    // 1. Crear 'Alimento X' activo
    const { data: prod1, error: err1 } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "SKU-NOMBRE-1",
        nombre: "Alimento X",
        unidad_medida_id: unidadUnidadId,
        activo: true,
      })
      .select("id")
      .single();
    expect(err1).toBeNull();

    // 2. Intentar 'alimento x' (minúsculas) activo → colisiona
    const { error: err2 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: "SKU-NOMBRE-2",
      nombre: "alimento x",
      unidad_medida_id: unidadUnidadId,
      activo: true,
    });
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23505");

    // 3. Dar de baja el primero
    const { error: errBaja } = await serviceDb
      .from("productos")
      .update({ activo: false })
      .eq("id", prod1?.id);
    expect(errBaja).toBeNull();

    // 4. Crear el segundo ahora que el primero está inactivo → funciona
    const { data: prod2, error: err3 } = await serviceDb
      .from("productos")
      .insert({
        tenant_id: tenantAId,
        codigo: "SKU-NOMBRE-2",
        nombre: "alimento x",
        unidad_medida_id: unidadUnidadId,
        activo: true,
      })
      .select("id")
      .single();
    expect(err3).toBeNull();

    // 5. Reactivar el primero → falla por colisión en el índice parcial
    const { error: errReactivar } = await serviceDb
      .from("productos")
      .update({ activo: true })
      .eq("id", prod1?.id);
    expect(errReactivar).not.toBeNull();
    expect(errReactivar?.code).toBe("23505");
  });

  it("RN-PRV1: proveedor único por razón social y por CUIT", async () => {
    if (skipIfNoCredentials()) return;

    // 1. Proveedor en tenant A
    const { error: err1 } = await serviceDb.from("proveedores").insert({
      tenant_id: tenantAId,
      razon_social: "Distribuidora Mayorista SA",
      cuit: "30-11223344-5",
    });
    expect(err1).toBeNull();

    // 2. Misma razón social en tenant A (con distinta mayúscula) → falla
    const { error: err2 } = await serviceDb.from("proveedores").insert({
      tenant_id: tenantAId,
      razon_social: "distribuidora mayorista sa",
      cuit: "30-99887766-5",
    });
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23505");

    // 3. Mismo CUIT en tenant B → funciona
    const { error: err3 } = await serviceDb.from("proveedores").insert({
      tenant_id: tenantBId,
      razon_social: "Otra Distribuidora SA",
      cuit: "30-11223344-5",
    });
    expect(err3).toBeNull();

    // 4. Dos proveedores con cuit NULL en tenant A → los dos funcionan
    const { error: errNull1 } = await serviceDb.from("proveedores").insert({
      tenant_id: tenantAId,
      razon_social: "Proveedor Sin Cuit 1",
      cuit: null,
    });
    expect(errNull1).toBeNull();

    const { error: errNull2 } = await serviceDb.from("proveedores").insert({
      tenant_id: tenantAId,
      razon_social: "Proveedor Sin Cuit 2",
      cuit: null,
    });
    expect(errNull2).toBeNull();
  });

  it("RN-FR2: el grafo de conversiones es acíclico", async () => {
    if (skipIfNoCredentials()) return;

    // Crear 3 productos: A, B, C
    const { data: pA } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: "CONV-A", nombre: "Caja Medicamento", unidad_medida_id: unidadUnidadId,
    }).select("id").single();
    const { data: pB } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: "CONV-B", nombre: "Blíster Medicamento", unidad_medida_id: unidadUnidadId,
    }).select("id").single();
    const { data: pC } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: "CONV-C", nombre: "Comprimido Suelto", unidad_medida_id: unidadCompId,
    }).select("id").single();

    // A → B (1 caja = 10 blísters)
    const { error: errAB } = await serviceDb.from("producto_conversiones").insert({
      tenant_id: tenantAId,
      producto_origen_id: pA?.id,
      producto_destino_id: pB?.id,
      factor_teorico: 10,
    });
    expect(errAB).toBeNull();

    // B → C (1 blíster = 10 comprimidos)
    const { error: errBC } = await serviceDb.from("producto_conversiones").insert({
      tenant_id: tenantAId,
      producto_origen_id: pB?.id,
      producto_destino_id: pC?.id,
      factor_teorico: 10,
    });
    expect(errBC).toBeNull();

    // Intentar C → A → cierra ciclo A→B→C→A → debe saltar RAISE EXCEPTION 'CONVERSION_CYCLE'
    const { error: errCA } = await serviceDb.from("producto_conversiones").insert({
      tenant_id: tenantAId,
      producto_origen_id: pC?.id,
      producto_destino_id: pA?.id,
      factor_teorico: 0.01,
    });
    expect(errCA).not.toBeNull();
    expect(errCA?.message).toContain("CONVERSION_CYCLE");

    // Intentar A → A (autorreferencia) → falla por CHECK chk_conversiones_no_autoreferencia
    const { error: errAA } = await serviceDb.from("producto_conversiones").insert({
      tenant_id: tenantAId,
      producto_origen_id: pA?.id,
      producto_destino_id: pA?.id,
      factor_teorico: 1,
    });
    expect(errAA).not.toBeNull();
    expect(errAA?.code).toBe("23514"); // check_violation, NOT CONVERSION_CYCLE
    expect(errAA?.message).not.toContain("CONVERSION_CYCLE");
  });
});
