/**
 * Tests de integración — Retención de auditoría (RN-AUD4, DT-9, Etapa 9 — S11).
 *
 * Verifica que la migración `20260707000002_purga_auditoria.sql`:
 *   1. RN-AUD4: `purgar_auditoria()` borra los asientos más viejos que el
 *      horizonte (12 meses por defecto) y conserva los recientes — en TODOS
 *      los tenants (la política del MVP es global).
 *   2. Guard: un horizonte no positivo se rechaza (VALIDATION_ERROR) sin
 *      tocar la tabla (evita un DELETE de tabla completa por typo).
 *   3. Endurecimiento: `anon` no puede ejecutar el RPC (EXECUTE revocado).
 *
 * El job pg_cron (`auditoria-purga-semanal`) no es verificable vía PostgREST
 * (el schema `cron` no está expuesto); se comprueba con SQL directo al aplicar
 * la migración (ver docs/DEPLOY.md).
 *
 * NOTA de aislamiento: la purga es GLOBAL. Los demás archivos de integración
 * solo generan auditoría con `now()` (DEFAULT de la columna), siempre dentro
 * del horizonte → esta purga no les borra nada. Las aserciones sobre lo
 * borrado son por id propio, robustas ante asientos de otros tenants.
 *
 * Requieren un proyecto Supabase real con las migraciones aplicadas.
 * Para correr: npx vitest run tests/integration
 */

import { it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { limpiarTenant } from "./_teardown.ts";

globalThis.WebSocket = class FakeWebSocket {} as never;

let serviceDb: SupabaseClient;
const tenantIds: string[] = [];

/** Ids de los asientos sembrados, por antigüedad. */
const viejos: string[] = [];
const recientes: string[] = [];

function fechaMesesAtras(meses: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return d.toISOString();
}

async function crearTenant(nombre: string): Promise<string> {
  const { data, error } = await serviceDb
    .from("tenants")
    .insert({
      nombre,
      cuit_rut:       `30-${Date.now().toString().slice(-8)}${tenantIds.length}-4`,
      email_contacto: `${nombre.toLowerCase().replace(/\s/g, "-")}@test.com`,
      plan:           "basico",
    })
    .select("id")
    .single();
  if (error) throw new Error(`No pude crear el tenant de prueba: ${error.message}`);
  tenantIds.push(data.id);
  return data.id;
}

async function sembrarAsiento(tenantId: string, timestamp: string): Promise<string> {
  const { data, error } = await serviceDb
    .from("registros_auditoria")
    .insert({
      tenant_id: tenantId,
      user_name: "Retención Test",
      user_role: "admin",
      action:    "CREATE",
      module:    "system",
      entity_id: "retencion-test",
      "timestamp": timestamp,
    })
    .select("id")
    .single();
  if (error) throw new Error(`No pude sembrar el asiento: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const tenantA = await crearTenant("Clínica Retención A");
  const tenantB = await crearTenant("Clínica Retención B");

  // Por tenant: un asiento fuera del horizonte (14 meses) y uno adentro (1 mes).
  for (const t of [tenantA, tenantB]) {
    viejos.push(await sembrarAsiento(t, fechaMesesAtras(14)));
    recientes.push(await sembrarAsiento(t, fechaMesesAtras(1)));
  }
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const id of tenantIds) await limpiarTenant(serviceDb, id);
});

describeIntegration("RN-AUD4: retención de auditoría (purga programada)", () => {
  it("RN-AUD4: purga los asientos más viejos que la retención y conserva los recientes (todos los tenants)", async () => {
    const { data, error } = await serviceDb.rpc("purgar_auditoria", {});
    expect(error).toBeNull();
    // Borró al menos los 2 sembrados fuera del horizonte (puede haber más de
    // otros orígenes; nunca menos).
    expect(data).toBeGreaterThanOrEqual(viejos.length);

    const { data: quedanViejos } = await serviceDb
      .from("registros_auditoria").select("id").in("id", viejos);
    expect(quedanViejos).toHaveLength(0);

    const { data: quedanRecientes } = await serviceDb
      .from("registros_auditoria").select("id").in("id", recientes);
    expect(quedanRecientes).toHaveLength(recientes.length);
  });

  it("guard: p_meses no positivo → VALIDATION_ERROR y no borra nada", async () => {
    // Asiento dentro del horizonte que un DELETE sin guard se llevaría puesto.
    const centinela = recientes[0];

    const { error } = await serviceDb.rpc("purgar_auditoria", { p_meses: 0 });
    expect(error?.message ?? "").toContain("VALIDATION_ERROR");

    const { data } = await serviceDb
      .from("registros_auditoria").select("id").eq("id", centinela);
    expect(data).toHaveLength(1);
  });

  it("endurecimiento: anon no puede ejecutar el RPC", async () => {
    const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anonDb.rpc("purgar_auditoria", {});
    // 42501 = permission denied for function (EXECUTE revocado a PUBLIC/anon).
    expect(error?.code).toBe("42501");
  });
});
