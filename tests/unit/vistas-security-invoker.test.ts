/**
 * BLOQUEANTE — Toda vista creada en el esquema public debe tener
 * security_invoker = true y REVOKE ALL FROM anon, authenticated
 * en la misma migración o en alguna posterior. Sin allowlist.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");

export interface VistaInfo {
  nombre: string;
  migration: string;
}

export function limpiarSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Parsea las migraciones y extrae todas las vistas creadas en public.
 */
export function extraerVistasCreadas(
  files: Array<{ name: string; content: string }>,
): Map<string, string[]> {
  const vistas = new Map<string, string[]>();

  for (const { name, content } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const limpio = limpiarSql(content);
    for (const match of limpio.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\s*\.\s*([a-zA-Z0-9_]+)|(?!\w+\s*\.)([a-zA-Z0-9_]+))\b/gi,
    )) {
      const vista = match[1] || match[2]!;
      const list = vistas.get(vista) ?? [];
      list.push(name);
      vistas.set(vista, list);
    }
  }

  return vistas;
}

/**
 * Parsea las migraciones y extrae las vistas que tienen `security_invoker = true`.
 */
export function extraerVistasSecurityInvoker(
  files: Array<{ name: string; content: string }>,
): Map<string, string[]> {
  const vistas = new Map<string, string[]>();

  for (const { name, content } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const limpio = limpiarSql(content);
    for (const match of limpio.matchAll(
      /ALTER\s+VIEW\s+(?:public\s*\.\s*([a-zA-Z0-9_]+)|(?!\w+\s*\.)([a-zA-Z0-9_]+))\s+SET\s*\(\s*security_invoker\s*=\s*true\s*\)/gi,
    )) {
      const vista = match[1] || match[2]!;
      const list = vistas.get(vista) ?? [];
      list.push(name);
      vistas.set(vista, list);
    }
  }

  return vistas;
}

/**
 * Parsea las migraciones y extrae las vistas que tienen REVOKE ALL FROM anon, authenticated.
 */
export function extraerVistasRevoke(
  files: Array<{ name: string; content: string }>,
): Map<string, string[]> {
  const vistas = new Map<string, string[]>();

  for (const { name, content } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const limpio = limpiarSql(content);
    // REVOKE ALL [ON] [TABLE] [public.]<vista> FROM ...
    for (const match of limpio.matchAll(
      /REVOKE\s+ALL(?:\s+ON)?(?:\s+TABLE)?\s+(?:public\s*\.\s*([a-zA-Z0-9_]+)|(?!\w+\s*\.)([a-zA-Z0-9_]+))\s+FROM\s+([^;]+);/gi,
    )) {
      const vista = match[1] || match[2]!;
      const roles = match[3]!;
      if (/\banon\b/i.test(roles) && /\bauthenticated\b/i.test(roles)) {
        const list = vistas.get(vista) ?? [];
        list.push(name);
        vistas.set(vista, list);
      }
    }
  }

  return vistas;
}

function leerMigraciones(): Array<{ name: string; content: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, content: readFileSync(join(MIGRATIONS_DIR, name), "utf-8") }));
}

// ─── Tests reales ─────────────────────────────────────────────────────────────

describe("BLOQUEANTE: Toda vista pública tiene security_invoker = true y REVOKE ALL", () => {
  const files = leerMigraciones();
  const creadas = extraerVistasCreadas(files);
  const conInvoker = extraerVistasSecurityInvoker(files);
  const conRevoke = extraerVistasRevoke(files);

  it("encuentra las vistas públicas existentes en las migraciones", () => {
    expect(creadas.size).toBeGreaterThanOrEqual(7);
    expect(creadas.has("v_lotes_por_vencer")).toBe(true);
    expect(creadas.has("v_consumo_clinico")).toBe(true);
  });

  it("toda vista pública tiene ALTER VIEW ... SET (security_invoker = true) en la misma migración o posterior", () => {
    const sinInvoker: string[] = [];

    for (const [vista, migracionesCreacion] of creadas) {
      const primeraCreacion = migracionesCreacion[0]!;
      const migracionesInvoker = conInvoker.get(vista) ?? [];
      const cubierto = migracionesInvoker.some((m) => m >= primeraCreacion);

      if (!cubierto) {
        sinInvoker.push(`${vista} (creada en ${primeraCreacion})`);
      }
    }

    expect(
      sinInvoker,
      `FUGA DE SEGURIDAD: las siguientes vistas públicas carecen de security_invoker = true:\n` +
      sinInvoker.join("\n") +
      `\nUna vista sin security_invoker se ejecuta con los privilegios de su dueño y bypasea RLS.`,
    ).toEqual([]);
  });

  it("toda vista pública tiene REVOKE ALL ... FROM anon, authenticated en la misma migración o posterior", () => {
    const sinRevoke: string[] = [];

    for (const [vista, migracionesCreacion] of creadas) {
      const primeraCreacion = migracionesCreacion[0]!;
      const migracionesRev = conRevoke.get(vista) ?? [];
      const cubierto = migracionesRev.some((m) => m >= primeraCreacion);

      if (!cubierto) {
        sinRevoke.push(`${vista} (creada en ${primeraCreacion})`);
      }
    }

    expect(
      sinRevoke,
      `SUPERFICIE EXPUESTA: las siguientes vistas públicas no tienen REVOKE ALL FROM anon, authenticated:\n` +
      sinRevoke.join("\n") +
      `\nCualquier usuario autenticado podría consultar estas vistas directamente por PostgREST.`,
    ).toEqual([]);
  });
});

// ─── Tests del motor / Autoverificación ───────────────────────────────────────

describe("motor del guardrail de vistas — se pone rojo cuando debe", () => {
  it("detecta CREATE VIEW con o sin OR REPLACE y con o sin public.", () => {
    const files = [
      { name: "01.sql", content: "CREATE VIEW public.v_test1 AS SELECT 1;" },
      { name: "02.sql", content: "CREATE OR REPLACE VIEW v_test2 AS SELECT 2;" },
    ];
    const vistas = extraerVistasCreadas(files);
    expect(vistas.has("v_test1")).toBe(true);
    expect(vistas.has("v_test2")).toBe(true);
  });

  it("ignora CREATE VIEW comentado", () => {
    const files = [
      { name: "01.sql", content: "-- CREATE VIEW public.v_comentada AS SELECT 1;\n/* CREATE VIEW v_bloque AS SELECT 2; */" },
    ];
    const vistas = extraerVistasCreadas(files);
    expect(vistas.size).toBe(0);
  });

  it("no confunde format('CREATE VIEW public.%I', ...) con una vista fantasma llamada public", () => {
    const files = [
      { name: "01.sql", content: "EXECUTE format('CREATE VIEW public.%I AS SELECT 1', v_view_name);" },
    ];
    const vistas = extraerVistasCreadas(files);
    expect(vistas.has("public")).toBe(false);
  });

  it("detecta ALTER VIEW ... SET (security_invoker = true)", () => {
    const files = [
      { name: "01.sql", content: "ALTER VIEW public.v_test SET (security_invoker = true);" },
    ];
    const invokers = extraerVistasSecurityInvoker(files);
    expect(invokers.has("v_test")).toBe(true);
  });

  it("detecta REVOKE ALL ON public.vista FROM anon, authenticated", () => {
    const files = [
      { name: "01.sql", content: "REVOKE ALL ON public.v_test FROM anon, authenticated;" },
      { name: "02.sql", content: "REVOKE ALL ON TABLE v_test2 FROM authenticated, anon;" },
    ];
    const revokes = extraerVistasRevoke(files);
    expect(revokes.has("v_test")).toBe(true);
    expect(revokes.has("v_test2")).toBe(true);
  });

  it("MUTACIÓN — una vista sin security_invoker no pasa el chequeo", () => {
    const files = [
      { name: "01.sql", content: "CREATE VIEW public.v_vulnerable AS SELECT 1;" },
      { name: "02.sql", content: "REVOKE ALL ON public.v_vulnerable FROM anon, authenticated;" },
    ];
    const creadas = extraerVistasCreadas(files);
    const conInvoker = extraerVistasSecurityInvoker(files);
    const primera = creadas.get("v_vulnerable")![0]!;
    const cubierto = (conInvoker.get("v_vulnerable") ?? []).some((m) => m >= primera);
    expect(cubierto).toBe(false);
  });

  it("MUTACIÓN — una vista sin REVOKE no pasa el chequeo", () => {
    const files = [
      { name: "01.sql", content: "CREATE VIEW public.v_vulnerable AS SELECT 1;" },
      { name: "02.sql", content: "ALTER VIEW public.v_vulnerable SET (security_invoker = true);" },
    ];
    const creadas = extraerVistasCreadas(files);
    const conRevoke = extraerVistasRevoke(files);
    const primera = creadas.get("v_vulnerable")![0]!;
    const cubierto = (conRevoke.get("v_vulnerable") ?? []).some((m) => m >= primera);
    expect(cubierto).toBe(false);
  });
});
