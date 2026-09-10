/**
 * audit.ts — resolución del autor del asiento (RN-S3).
 *
 * El JWT solo trae `sub`, así que los controllers de tenant arman el contexto
 * con el sentinela CALLER_UNRESOLVED y es `recordAudit` quien resuelve nombre y
 * rol por `userId`. Antes de esto TODO asiento de negocio quedaba con "unknown"
 * y la auditoría no servía para lo único que importa: quién hizo el cambio.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALLER_UNRESOLVED,
  invalidateCallerCache,
  recordAudit,
} from "../../supabase/functions/api/src/shared/audit.ts";

interface DbMock {
  db:     SupabaseClient;
  insert: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  from:   ReturnType<typeof vi.fn>;
}

/** Cliente encadenable: `from().select().eq().single()` y `from().insert()`. */
function makeDb(usuarioRow: unknown, error: unknown = null): DbMock {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const single = vi.fn().mockResolvedValue({ data: usuarioRow, error });
  const chain: Record<string, unknown> = { insert, single };
  chain["select"] = vi.fn(() => chain);
  chain["eq"]     = vi.fn(() => chain);
  const from = vi.fn(() => chain);
  return { db: { from } as unknown as SupabaseClient, insert, single, from };
}

const PAYLOAD_BASE = {
  tenantId: "t-1",
  userId:   "u-1",
  action:   "CREATE" as const,
  module:   "clients" as const,
  entityId: "c-9",
};

beforeEach(() => {
  invalidateCallerCache();
});

describe("recordAudit — autor del asiento (RN-S3)", () => {
  it("resuelve nombre y rol reales cuando el controller no pudo (CALLER_UNRESOLVED)", async () => {
    const { db, insert } = makeDb({ username: "admin_leo", roles: { name: "admin" } });

    await recordAudit(db, {
      ...PAYLOAD_BASE,
      userName: CALLER_UNRESOLVED,
      userRole: CALLER_UNRESOLVED,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_name: "admin_leo", user_role: "admin", user_id: "u-1" }),
    );
  });

  it("acepta el embed de roles como array (PostgREST devuelve una u otra forma)", async () => {
    const { db, insert } = makeDb({ username: "vet_leo", roles: [{ name: "veterinario" }] });

    await recordAudit(db, { ...PAYLOAD_BASE, userName: null, userRole: null });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_name: "vet_leo", user_role: "veterinario" }),
    );
  });

  it("NO pisa un autor ya resuelto: el cron sigue siendo 'sistema'", async () => {
    const { db, insert, from } = makeDb({ username: "admin_leo", roles: { name: "admin" } });

    await recordAudit(db, {
      ...PAYLOAD_BASE,
      module:   "system",
      userName: "sistema",
      userRole: "sistema",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_name: "sistema", user_role: "sistema" }),
    );
    // Ni siquiera consulta `usuarios`: solo hace el insert.
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("registros_auditoria");
  });

  it("el Super Admin de plataforma (sin fila en usuarios) conserva su etiqueta", async () => {
    const { db, insert } = makeDb(null, { message: "no rows" });

    await recordAudit(db, {
      ...PAYLOAD_BASE,
      tenantId: null,
      module:   "platform",
      userName: "super_admin",
      userRole: "super_admin",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_name: "super_admin", user_role: "super_admin" }),
    );
  });

  it("si no se puede resolver, el asiento se escribe igual (la auditoría nunca corta el flujo)", async () => {
    const { db, insert } = makeDb(null, { message: "row not found" });

    await recordAudit(db, {
      ...PAYLOAD_BASE,
      userName: CALLER_UNRESOLVED,
      userRole: CALLER_UNRESOLVED,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_name: CALLER_UNRESOLVED, user_id: "u-1" }),
    );
  });

  it("sin userId no consulta la base", async () => {
    const { db, insert, from } = makeDb({ username: "admin_leo", roles: { name: "admin" } });

    await recordAudit(db, {
      ...PAYLOAD_BASE,
      userId:   null,
      userName: CALLER_UNRESOLVED,
      userRole: CALLER_UNRESOLVED,
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: null }));
  });

  it("memoiza la identidad en la misma ejecución: dos asientos del mismo usuario = una sola consulta", async () => {
    const { db, single } = makeDb({ username: "admin_leo", roles: { name: "admin" } });

    await recordAudit(db, { ...PAYLOAD_BASE, userName: CALLER_UNRESOLVED, userRole: CALLER_UNRESOLVED });
    await recordAudit(db, { ...PAYLOAD_BASE, userName: CALLER_UNRESOLVED, userRole: CALLER_UNRESOLVED });

    expect(single).toHaveBeenCalledTimes(1);
  });

  it("invalidateCallerCache fuerza a releer (limpieza de memoización)", async () => {
    const { db, single } = makeDb({ username: "admin_leo", roles: { name: "admin" } });

    await recordAudit(db, { ...PAYLOAD_BASE, userName: CALLER_UNRESOLVED, userRole: CALLER_UNRESOLVED });
    invalidateCallerCache("u-1");
    await recordAudit(db, { ...PAYLOAD_BASE, userName: CALLER_UNRESOLVED, userRole: CALLER_UNRESOLVED });

    expect(single).toHaveBeenCalledTimes(2);
  });
});
