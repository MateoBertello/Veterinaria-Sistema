/**
 * Tests de integración — Historial Clínico + Supabase Storage (Etapa 5).
 * BLOQUEANTES: el aislamiento de adjuntos por tenant es regla 1 de CLAUDE.md.
 *
 * Requieren el stack local (o un proyecto Supabase real) con:
 *   - las migraciones aplicadas, incluida 20260623000001_storage_adjuntos.sql
 *     (bucket privado `adjuntos-clinicos` + 4 policies por prefijo de tenant);
 * y en .env:
 *   TEST_SUPABASE_URL=...
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=...
 *   SUPABASE_ANON_KEY=...
 *
 * Qué ejercita (contra el bucket y las policies REALES, no mocks):
 *   1. tenant A registra un evento y sube un adjunto (vía Service real) →
 *      el objeto queda bajo el prefijo `{tenantA}/{recordId}/...`.
 *   2. tenant A lee y firma su propio objeto (controles positivos).
 *   3. tenant B NO puede descargar, firmar, subir ni borrar ese objeto
 *      (policies SELECT/INSERT/DELETE por prefijo de tenant).
 *   4. Reglas reales del Service: PET_DECEASED en mascota Fallecida,
 *      INVALID_FILE_TYPE (.txt) y FILE_TOO_LARGE (>10 MB).
 *
 * Para correr: npx vitest run tests/integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY as ANON_KEY,
  SERVICE_ROLE_KEY,
  describeIntegration,
} from "./_env.ts";
import { crearUsuarioAuth, limpiarTenant, catalogoDelTenant } from "./_teardown.ts";

// deno-lint-ignore no-explicit-any
globalThis.WebSocket = class FakeWebSocket {} as any;

// _env.ts ya resolvió la convención única y espejó SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY a process.env, que es lo que lee getServiceDb().
import { HistorialService } from "../../supabase/functions/api/src/modules/historial/historial.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const BUCKET = "adjuntos-clinicos";

// ─── Estado del fixture ───────────────────────────────────────────────────────

let serviceDb: SupabaseClient;
let tenantAId = "";
let tenantBId = "";
let userAId   = "";
let userBId   = "";
let jwtA       = "";
let jwtB       = "";
let clienteAId = "";
let petActivaA   = "";
let petFallecidaA = "";
let recordAId    = "";
let adjuntoPathA = "";

const createdObjects: string[] = []; // paths a limpiar en Storage

function userClient(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false },
  });
}

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.warn("Saltando test de integración Historial/Storage: credenciales no configuradas");
    return true;
  }
  return false;
}

async function createUser(email: string, tenantId: string): Promise<{ id: string; jwt: string }> {
  const id = await crearUsuarioAuth(email, { tenant_id: tenantId }, "Password123!");
  const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  const token = await signIn.json() as { access_token?: string };
  return { id, jwt: token.access_token ?? "" };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Precondición BLOQUEANTE: el bucket debe existir (migración 20260623000001).
  // Sin esta verificación, los asserts de aislamiento ("B no puede…") pasarían
  // de forma espuria por un "Bucket not found" en lugar de por las policies.
  const { data: bucket, error: bucketErr } = await serviceDb.storage.getBucket(BUCKET);
  if (bucketErr || !bucket) {
    throw new Error(
      `El bucket privado "${BUCKET}" no existe. Aplicá la migración 20260623000001_storage_adjuntos.sql ` +
      `antes de correr este test (supabase db reset / push). Detalle: ${bucketErr?.message ?? "no encontrado"}`,
    );
  }
  expect(bucket.public).toBe(false); // debe ser privado (solo signed URLs)

  // Tenants con cuit_rut únicos entre suites (rls usa 1111/2222, auth usa 3333).
  const { data: tA } = await serviceDb.from("tenants")
    .insert({ nombre: "Clínica HC A", cuit_rut: "30-55555555-5", email_contacto: "hca@test.com", plan: "basico" })
    .select("id").single();
  tenantAId = tA?.id ?? "";

  const { data: tB } = await serviceDb.from("tenants")
    .insert({ nombre: "Clínica HC B", cuit_rut: "30-66666666-6", email_contacto: "hcb@test.com", plan: "basico" })
    .select("id").single();
  tenantBId = tB?.id ?? "";

  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantAId });
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantBId });

  const a = await createUser("hc-usera@test.com", tenantAId);
  const b = await createUser("hc-userb@test.com", tenantBId);
  userAId = a.id; jwtA = a.jwt;
  userBId = b.id; jwtB = b.jwt;

  // usuarios (rol admin) — userA es el profesional de los eventos
  const { data: rolA } = await serviceDb.from("roles").select("id").eq("tenant_id", tenantAId).eq("name", "admin").single();
  await serviceDb.from("usuarios").insert({
    id: userAId, tenant_id: tenantAId, username: "hc-usera", email: "hc-usera@test.com", full_name: "Usuario A", rol_id: rolA?.id,
  });
  const { data: rolB } = await serviceDb.from("roles").select("id").eq("tenant_id", tenantBId).eq("name", "admin").single();
  await serviceDb.from("usuarios").insert({
    id: userBId, tenant_id: tenantBId, username: "hc-userb", email: "hc-userb@test.com", full_name: "Usuario B", rol_id: rolB?.id,
  });

  // Catálogo del tenant A (por tenant desde
  // 20260827000001_catalogos_por_tenant.sql; las mascotas de esta suite son
  // todas de A, así que alcanza con el suyo).
  const { especieId } = await catalogoDelTenant(serviceDb, tenantAId);

  // Cliente + mascotas de A
  const { data: cli } = await serviceDb.from("clientes")
    .insert({ tenant_id: tenantAId, full_name: "Cliente HC A", phone: "1111", email: "cliente.hca@test.com" })
    .select("id").single();
  clienteAId = cli?.id ?? "";

  const { data: petActiva } = await serviceDb.from("mascotas").insert({
    tenant_id: tenantAId, name: "Firulais", client_id: clienteAId, especie_id: especieId,
    sex: "Macho", tamano: "Mediano", estado: "Activa",
  }).select("id").single();
  petActivaA = petActiva?.id ?? "";

  const { data: petMuerta } = await serviceDb.from("mascotas").insert({
    tenant_id: tenantAId, name: "Lazaro", client_id: clienteAId, especie_id: especieId,
    sex: "Macho", tamano: "Mediano", estado: "Fallecida", deceased_date: "2026-01-01", deceased_reason: "Enfermedad",
  }).select("id").single();
  petFallecidaA = petMuerta?.id ?? "";
}, 60_000);

// ─── Teardown ─────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!serviceDb) return;

  // Limpiar objetos de Storage (service role bypasea RLS).
  if (createdObjects.length > 0) {
    await serviceDb.storage.from(BUCKET).remove(createdObjects);
  }

  await limpiarTenant(serviceDb, tenantAId);
  await limpiarTenant(serviceDb, tenantBId);
}, 30_000);

// ─── 1. Tenant A registra evento + sube adjunto (Service real) ───────────────

describeIntegration("HC-Storage: tenant A registra y adjunta", () => {
  it("crearRegistro + adjuntarArchivo persisten el objeto bajo el prefijo del tenant A", async () => {
    if (skipIfNoCredentials()) return;

    const ctxA = { tenantId: tenantAId, callerUserId: userAId, callerName: "Usuario A", callerRole: "admin" };
    const evento = await HistorialService.crearRegistro(
      petActivaA,
      // Sin envío de email: este test cubre el aislamiento de Storage, no la
      // notificación. El canal de email (RN-EC9) está cubierto por unit tests
      // con mock, así que no dependemos de un proveedor externo aquí.
      { date: "2026-06-10", eventType: "Consulta", professionalId: userAId, description: "Control anual", sendEmailToClient: false },
      ctxA,
    );
    recordAId = evento.id;
    expect(evento.clientNameAtTime).toBe("Cliente HC A");
    expect(evento.emailSent).toBe(false); // no se solicitó envío

    const pdf = new File([new Blob(["%PDF-1.4 test"])], "rx.pdf", { type: "application/pdf" });
    const meta = await HistorialService.adjuntarArchivo(recordAId, pdf, ctxA);
    expect(meta.fileType).toBe("application/pdf");

    // storage_path real (se consulta con service role)
    const { data: adj } = await serviceDb
      .from("adjuntos_medicos").select("storage_path").eq("id", meta.id).single();
    adjuntoPathA = (adj?.storage_path as string) ?? "";
    createdObjects.push(adjuntoPathA);

    expect(adjuntoPathA.startsWith(`${tenantAId}/${recordAId}/`)).toBe(true);
  }, 30_000);
});

// ─── 2. Controles positivos: A accede a su propio objeto ─────────────────────

describeIntegration("HC-Storage: tenant A accede a su propio adjunto (control positivo)", () => {
  it("A puede descargar su objeto (policy SELECT)", async () => {
    if (skipIfNoCredentials()) return;
    const dbA = userClient(jwtA);
    const { data, error } = await dbA.storage.from(BUCKET).download(adjuntoPathA);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("A puede generar signed URL de su objeto", async () => {
    if (skipIfNoCredentials()) return;
    const dbA = userClient(jwtA);
    const { data, error } = await dbA.storage.from(BUCKET).createSignedUrl(adjuntoPathA, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });
});

// ─── 3. Aislamiento: tenant B NO accede al objeto de A ───────────────────────

describeIntegration("HC-Storage: aislamiento por tenant (policies por prefijo)", () => {
  it("B NO puede descargar el adjunto de A (policy SELECT)", async () => {
    if (skipIfNoCredentials()) return;
    const dbB = userClient(jwtB);
    const { data, error } = await dbB.storage.from(BUCKET).download(adjuntoPathA);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("B NO puede generar signed URL del adjunto de A (policy SELECT)", async () => {
    if (skipIfNoCredentials()) return;
    const dbB = userClient(jwtB);
    const { data, error } = await dbB.storage.from(BUCKET).createSignedUrl(adjuntoPathA, 60);
    expect(error).not.toBeNull();
    expect(data?.signedUrl ?? null).toBeNull();
  });

  it("B NO puede subir a un prefijo del tenant A (policy INSERT / WITH CHECK)", async () => {
    if (skipIfNoCredentials()) return;
    const dbB = userClient(jwtB);
    const { error } = await dbB.storage
      .from(BUCKET)
      .upload(`${tenantAId}/intruso/hack.pdf`, new Blob(["x"], { type: "application/pdf" }));
    expect(error).not.toBeNull();
  });

  it("B NO puede borrar el adjunto de A (policy DELETE) y el objeto sigue intacto", async () => {
    if (skipIfNoCredentials()) return;
    const dbB = userClient(jwtB);
    const { data: removed } = await dbB.storage.from(BUCKET).remove([adjuntoPathA]);
    expect(removed ?? []).toHaveLength(0); // RLS oculta la fila → no borra nada

    // El objeto sigue accesible para A (service role lo confirma).
    const { data, error } = await serviceDb.storage.from(BUCKET).download(adjuntoPathA);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("B SÍ puede subir a su propio prefijo (control positivo INSERT)", async () => {
    if (skipIfNoCredentials()) return;
    const dbB = userClient(jwtB);
    const path = `${tenantBId}/propio/ok.pdf`;
    const { error } = await dbB.storage.from(BUCKET).upload(path, new Blob(["x"], { type: "application/pdf" }));
    expect(error).toBeNull();
    createdObjects.push(path);
  });
});

// ─── 4. Reglas de negocio reales del Service ─────────────────────────────────

describeIntegration("HC-Storage: reglas de negocio (Service real)", () => {
  const ctxA = () => ({ tenantId: tenantAId, callerUserId: userAId, callerName: "Usuario A", callerRole: "admin" });

  it("RN-EC3: evento en mascota Fallecida → PET_DECEASED", async () => {
    if (skipIfNoCredentials()) return;
    await expect(
      HistorialService.crearRegistro(
        petFallecidaA,
        { date: "2026-06-10", eventType: "Consulta", professionalId: userAId, description: "x", sendEmailToClient: false },
        ctxA(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  it("RN-EC4: adjunto .txt → INVALID_FILE_TYPE", async () => {
    if (skipIfNoCredentials()) return;
    const txt = new File(["nota"], "nota.txt", { type: "text/plain" });
    await expect(
      HistorialService.adjuntarArchivo(recordAId, txt, ctxA()),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_FILE_TYPE, statusCode: 422 });
  });

  it("RN-EC4: adjunto > 10 MB → FILE_TOO_LARGE", async () => {
    if (skipIfNoCredentials()) return;
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    await expect(
      HistorialService.adjuntarArchivo(recordAId, big, ctxA()),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_TOO_LARGE, statusCode: 422 });
  });
});
