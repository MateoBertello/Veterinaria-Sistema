/**
 * Tests de integración — Guardería: Registrar Estadía con guarda de cupo
 * (Etapa 7, v1.0 §5 + Addendum v1.1, RN-GU1..GU5).
 *
 * El cupo por día (RN-GU4) se resuelve en DB con el RPC `crear_estadia_con_cupo`,
 * que serializa los altas por tenant con `SELECT cupo_maximo_diario ... FOR UPDATE`
 * sobre la fila singleton de configuracion_tenant. Los tests unitarios mockean la
 * base y por tanto NUNCA ejecutan ese RPC: esta suite es la que lo ejerce DE VERDAD
 * contra el stack local (con la migración 20260629000001 aplicada), igual que la
 * suite de eutanasia con su RPC.
 *
 * Casos pactados (todos bloqueantes):
 *   1. CONCURRENCIA (el crítico): dos altas SIMULTÁNEAS (Promise.all) por el último
 *      lugar → sólo una persiste; la otra recibe CUPO_GUARDERIA_AGOTADO. Prueba que
 *      el FOR UPDATE serializa de verdad (sin él, ambas contarían 0<cupo → overbooking).
 *   2. Borde exacto: ocupados == cupo → rechaza, con los días sin cupo en `details`.
 *   3. RN-CF3: el cupo se lee VIGENTE dentro de la transacción (subir el cupo permite
 *      un alta que antes se rechazaba; sin caché).
 *   4. RLS / aislamiento: el módulo usa getServiceDb (bypasa RLS), así que el
 *      aislamiento depende del filtro EXPLÍCITO de tenant_id en cada query. B no ve
 *      ni cuenta ni crea estadías de A.
 *   + Bonus: `anon` no puede ejecutar el RPC (EXECUTE revocado de PUBLIC).
 *
 * Requieren Supabase real con TODAS las migraciones aplicadas y .env con
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Para correr: npx vitest run tests/integration
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración guardería omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

const adminHeaders = () => ({
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey":        SERVICE_ROLE_KEY,
});

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body:    JSON.stringify({ email, password }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? "";
}

async function createAuthUser(email: string, appMetadata: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  "POST",
    headers: adminHeaders(),
    body:    JSON.stringify({ email, password: "TestPass123!", email_confirm: true, app_metadata: appMetadata }),
  });
  const user = await res.json() as { id?: string };
  return user.id ?? "";
}

async function callApp(path: string, opts: { method?: string; jwt?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  return app.request(`http://localhost/api/v1${path}`, {
    method:  opts.method ?? "GET",
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

/** Aprovisiona un tenant PREMIUM (módulo guarderia habilitado) con su admin y un cliente. */
async function provisionTenant(serviceDb: SupabaseClient, sufijo: string) {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Guardería ${sufijo}`,
      cuit_rut:       `34-${Date.now().toString().slice(-7)}${sufijo}-9`,
      email_contacto: `guarderia-${sufijo}@test.com`,
      plan:           "premium", // premium → módulo guarderia habilitado
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  const email  = `admin-guarderia-${sufijo}@test.com`;
  const userId = await createAuthUser(email, { tenant_id: tenantId });
  const { data: rolAdmin } = await serviceDb
    .from("roles").select("id").eq("tenant_id", tenantId).eq("name", "admin").single();
  await serviceDb.from("usuarios").insert({
    id: userId, tenant_id: tenantId, username: `admin_${sufijo}`,
    email, full_name: `Admin ${sufijo}`, rol_id: rolAdmin?.id, active: true,
  });
  const jwt = await signIn(email, "TestPass123!");

  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({ tenant_id: tenantId, full_name: `Dueño ${sufijo}`, phone: "1112223334" })
    .select("id")
    .single();

  return { tenantId, jwt, userId, clienteId: cliente?.id as string };
}

let serviceDb: SupabaseClient;
let tenantA = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let tenantB = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let especieId = "";

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: especie } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = especie?.id ?? "";

  tenantA = await provisionTenant(serviceDb, "GA");
  tenantB = await provisionTenant(serviceDb, "GB");
}, 60_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of [tenantA.tenantId, tenantB.tenantId]) {
    if (!tid) continue;
    const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tid);
    for (const u of (usuarios ?? []) as { id: string }[]) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders() });
    }
    await serviceDb.from("tenants").delete().eq("id", tid);
  }
});

// ─── Helpers de datos ──────────────────────────────────────────────────────────

/** Crea una mascota Activa (tamaño Mediano) de un tenant vía API y devuelve su id. */
async function crearMascota(t: typeof tenantA, name: string): Promise<string> {
  const res = await callApp("/mascotas", {
    method: "POST", jwt: t.jwt,
    body: { name, clientId: t.clienteId, especieId, sex: "Macho", tamano: "Mediano" },
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

async function setCupo(tenantId: string, n: number) {
  await serviceDb.from("configuracion_tenant").update({ cupo_maximo_diario: n }).eq("tenant_id", tenantId);
}

/** Cuenta las estadías activas (Reservada/EnCurso) del tenant que cubren `day`. */
async function contarActivasEnDia(tenantId: string, day: string): Promise<number> {
  const { data } = await serviceDb
    .from("estadias")
    .select("check_in_date, check_out_date")
    .eq("tenant_id", tenantId)
    .in("status", ["Reservada", "EnCurso"]);
  return ((data ?? []) as Array<{ check_in_date: string; check_out_date: string }>)
    .filter((r) => r.check_in_date <= day && day <= r.check_out_date).length;
}

/** Mismos 7 args que envía el Service, opcionales explícitos, para no depender de overloads de PostgREST. */
function estadiaRpcParams(
  tenantId: string, clientId: string, petId: string,
  checkIn: string, checkOut: string, over: Record<string, unknown> = {},
) {
  return {
    p_tenant_id: tenantId,
    p_client_id: clientId,
    p_pet_id:    petId,
    p_check_in:  checkIn,
    p_check_out: checkOut,
    p_reason:    "Estadía de integración",
    p_notes:     null,
    ...over,
  };
}

type RpcResult = { data: unknown; error: { message: string } | null };

/** Una llamada al RPC ejecutó de verdad (no fue "function not found" / cache). */
function rpcReallyRan(error: { message: string } | null): boolean {
  return !/could not find|schema cache/i.test(error?.message ?? "");
}

function esExito(r: RpcResult): boolean {
  return r.error === null && Array.isArray(r.data) && r.data.length === 1;
}

// ─── Caso 1: CONCURRENCIA por el último lugar (el más crítico) ──────────────────

describeIntegration("Guardería: concurrencia por el último lugar (RN-GU4, FOR UPDATE)", () => {
  it("dos altas SIMULTÁNEAS con cupo=1 → exactamente una persiste; la otra CUPO_GUARDERIA_AGOTADO", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 1);
    const dia = "2027-01-10";

    // Dos mascotas DISTINTAS (mismo pet daría STAY_OVERLAP, no CUPO) compitiendo
    // por el mismo día con un único lugar.
    const pet1 = await crearMascota(tenantA, "Concurrente1");
    const pet2 = await crearMascota(tenantA, "Concurrente2");

    // Promise.all: las dos RPC salen a la base CASI a la vez → sesiones/transacciones
    // concurrentes. El FOR UPDATE de configuracion_tenant las serializa.
    const [r1, r2] = await Promise.all([
      serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, pet1, dia, dia)),
      serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, pet2, dia, dia)),
    ]) as [RpcResult, RpcResult];

    // Ambas llamadas ejecutaron el RPC real (no falso verde por función inexistente).
    expect(rpcReallyRan(r1.error)).toBe(true);
    expect(rpcReallyRan(r2.error)).toBe(true);

    const exitos  = [r1, r2].filter(esExito);
    const fallos  = [r1, r2].filter((r) => r.error !== null);

    expect(exitos).toHaveLength(1);   // sólo una ganó el lugar
    expect(fallos).toHaveLength(1);   // la otra fue rechazada
    expect(fallos[0].error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // Garantía dura: en la base hay EXACTAMENTE una estadía activa ese día (no overbooking).
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(1);
  });
});

// ─── Caso 2: Borde exacto (ocupados == cupo) ────────────────────────────────────

describeIntegration("Guardería: borde exacto ocupados == cupo (RN-GU4)", () => {
  it("con cupo=2 y 2 estadías el día D, la 3.ª se rechaza con D en details", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 2);
    const dia = "2027-02-10";

    const petA = await crearMascota(tenantA, "Borde1");
    const petB = await crearMascota(tenantA, "Borde2");
    const petC = await crearMascota(tenantA, "Borde3");

    const r1 = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petA, dia, dia)) as RpcResult;
    const r2 = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petB, dia, dia)) as RpcResult;
    expect(esExito(r1)).toBe(true);
    expect(esExito(r2)).toBe(true);

    // ocupados (2) == cupo (2) → la 3.ª se rechaza.
    const r3 = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petC, dia, dia)) as RpcResult;
    expect(r3.error).toBeTruthy();
    expect(rpcReallyRan(r3.error)).toBe(true);

    const msg = r3.error?.message ?? "";
    expect(msg).toContain("CUPO_GUARDERIA_AGOTADO");
    // El día sin cupo viaja como JSON tras los dos puntos (lo que el Service pone en details).
    const dias = JSON.parse(msg.slice(msg.indexOf(":", msg.indexOf("CUPO_GUARDERIA_AGOTADO")) + 1)) as string[];
    expect(dias).toContain(dia);

    // No hubo overbooking: siguen siendo 2 activas ese día.
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(2);
  });
});

// ─── Caso 3: RN-CF3 — el cupo se lee VIGENTE dentro de la transacción ───────────

describeIntegration("Guardería: cupo vigente sin caché (RN-CF3)", () => {
  it("subir cupo_maximo_diario permite un alta que antes se rechazaba", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 1);
    const dia = "2027-03-10";

    const petX = await crearMascota(tenantA, "Vigente1");
    const petY = await crearMascota(tenantA, "Vigente2");

    // Con cupo=1, la primera entra y la segunda se rechaza.
    expect(esExito(await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petX, dia, dia)) as RpcResult)).toBe(true);
    const rechazo = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petY, dia, dia)) as RpcResult;
    expect(rechazo.error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // Subimos el cupo: el RPC debe leer el valor NUEVO (no uno cacheado).
    await setCupo(tenantA.tenantId, 2);
    const reintento = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petY, dia, dia)) as RpcResult;
    expect(rpcReallyRan(reintento.error)).toBe(true);
    expect(esExito(reintento)).toBe(true);

    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(2);
  });
});

// ─── Caso 4: RLS / aislamiento por tenant (filtro explícito) ────────────────────

describeIntegration("Guardería: aislamiento por tenant (bloqueante)", () => {
  it("B no puede registrar una estadía sobre una mascota de A vía API → MASCOTA_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const petDeA = await crearMascota(tenantA, "AjenaEstadia");

    const res = await callApp("/estadias", {
      method: "POST", jwt: tenantB.jwt,
      body: { clientId: tenantB.clienteId, petId: petDeA, checkInDate: "2027-04-10", checkOutDate: "2027-04-11", reason: "Intento ajeno" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");

    // No se creó nada para B.
    const { data } = await serviceDb.from("estadias").select("id").eq("tenant_id", tenantB.tenantId);
    expect((data ?? []).length).toBe(0);
  });

  it("el RPC con p_tenant_id de B sobre mascota de A no la encuentra (scoping explícito)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petDeA = await crearMascota(tenantA, "RpcCrossTenant");
    const r = await serviceDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantB.tenantId, tenantB.clienteId, petDeA, "2027-04-12", "2027-04-12"),
    ) as RpcResult;
    expect(r.error).toBeTruthy();
    expect(rpcReallyRan(r.error)).toBe(true);
    expect(r.error?.message ?? "").toContain("MASCOTA_NOT_FOUND");
  });

  it("GET /estadias/cupo de B no cuenta las estadías de A (ocupación aislada)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia = "2027-05-10";

    // A crea una estadía ese día.
    const petDeA = await crearMascota(tenantA, "OcupacionA");
    expect(esExito(await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia)) as RpcResult)).toBe(true);

    // B consulta el cupo de ese día: no debe ver la ocupación de A.
    const res = await callApp(`/estadias/cupo?dateFrom=${dia}&dateTo=${dia}`, { jwt: tenantB.jwt });
    const body = await res.json() as { data: Array<{ date: string; ocupados: number }> };
    expect(res.status).toBe(200);
    expect(body.data[0].ocupados).toBe(0);
  });
});

// ─── Bonus: endurecimiento de EXECUTE (REVOKE FROM PUBLIC) ──────────────────────

describeIntegration("Guardería: endurecimiento del RPC (anon no puede ejecutarlo)", () => {
  it("un cliente anon no puede invocar crear_estadia_con_cupo (EXECUTE revocado de PUBLIC)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId  = await crearMascota(tenantA, "AnonNoPuede");
    const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

    const { error } = await anonDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petId, "2027-06-10", "2027-06-10"),
    ) as RpcResult;
    expect(error?.message ?? "").toMatch(/permission denied/i);
  });
});
