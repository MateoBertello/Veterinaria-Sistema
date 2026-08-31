/**
 * BLOQUEANTE — todo `module:` que un Service le pase a `recordAudit` tiene que
 * ser un valor del enum `modulo_auditoria`.
 *
 * POR QUÉ EXISTE ESTE TEST
 *
 * El CRUD de catálogos se mergeó auditando con `module: "catalogs"`, un valor
 * que no estaba en el enum. Como `recordAudit` es best-effort —atrapa el error,
 * lo loguea y deja seguir la operación—, el síntoma no fue un 500 sino la
 * AUSENCIA de asientos: el catálogo se escribía y la auditoría no quedaba.
 * Nadie lo vio hasta que apareció en el stderr de una suite de integración que
 * pasaba en verde.
 *
 * Los tests unitarios del Service no podían atraparlo: mockean `recordAudit` y
 * verifican con qué argumentos se lo llamó, no que la base acepte esos
 * argumentos. Y los de integración tampoco, porque el fallo no rompe nada que
 * se esté aseverando.
 *
 * Este chequeo cierra esa brecha del lado barato: cruza las dos fuentes
 * —el enum, parseado de las migraciones; y los literales, parseados de los
 * Services— sin necesidad de una base levantada, y corre en cada `npm test`.
 *
 * Mismo criterio que `tenant-filter-guardrail.test.ts`: además de correr el
 * chequeo real, se verifica POR MUTACIÓN que el detector se pone rojo cuando
 * debe. Un guardrail que no se sabe si detecta algo no es un guardrail.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT      = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");
const MODULES_DIR    = join(REPO_ROOT, "supabase/functions/api/src/modules");
const SHARED_DIR     = join(REPO_ROOT, "supabase/functions/api/src/shared");

// ─── Fuente 1: el enum, tal como lo dejan las migraciones ────────────────────

/**
 * Reconstruye `modulo_auditoria` leyendo las migraciones en orden: el
 * `CREATE TYPE` inicial más todo `ALTER TYPE ... ADD VALUE` posterior. Se parsea
 * el DDL en vez de hardcodear la lista justamente para que agregar un valor en
 * una migración alcance, sin tener que acordarse de tocar también este test.
 */
export function enumModulosDesdeMigraciones(
  files: Array<{ name: string; content: string }>,
): Set<string> {
  const valores = new Set<string>();

  for (const { content } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sinComentarios = content.replace(/--[^\n]*/g, "");

    const create = sinComentarios.match(
      /CREATE\s+TYPE\s+modulo_auditoria\s+AS\s+ENUM\s*\(([\s\S]*?)\)/i,
    );
    if (create?.[1]) {
      for (const m of create[1].matchAll(/'([^']+)'/g)) valores.add(m[1]!);
    }

    for (const m of sinComentarios.matchAll(
      /ALTER\s+TYPE\s+modulo_auditoria\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi,
    )) {
      valores.add(m[1]!);
    }
  }

  return valores;
}

// ─── Fuente 2: los literales que los Services le pasan a recordAudit ─────────

export interface UsoModulo {
  file:   string;
  line:   number;
  module: string;
}

/**
 * Busca `module: "algo"` en el código. Es deliberadamente sintáctico y no
 * intenta seguir variables: un módulo que se arme en runtime no se puede
 * verificar acá, y quedar fuera es preferible a dar un verde falso.
 */
export function usosDeModulo(relPath: string, source: string): UsoModulo[] {
  const usos: UsoModulo[] = [];
  const lineas = source.split("\n");

  lineas.forEach((linea, i) => {
    if (linea.trim().startsWith("//") || linea.trim().startsWith("*")) return;
    for (const m of linea.matchAll(/\bmodule:\s*"([^"]+)"/g)) {
      usos.push({ file: relPath, line: i + 1, module: m[1]! });
    }
  });

  return usos;
}

// ─── Recolección ─────────────────────────────────────────────────────────────

function archivosDeCodigo(): Array<{ relPath: string; content: string }> {
  const out: Array<{ relPath: string; content: string }> = [];

  const agregar = (abs: string) => {
    out.push({
      relPath: relative(REPO_ROOT, abs).split(sep).join("/"),
      content: readFileSync(abs, "utf-8"),
    });
  };

  for (const dir of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = join(MODULES_DIR, dir.name);
    for (const entry of readdirSync(dirPath)) {
      if (entry.endsWith(".ts")) agregar(join(dirPath, entry));
    }
  }
  for (const entry of readdirSync(SHARED_DIR)) {
    if (entry.endsWith(".ts")) agregar(join(SHARED_DIR, entry));
  }

  return out;
}

function migraciones(): Array<{ name: string; content: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, content: readFileSync(join(MIGRATIONS_DIR, name), "utf-8") }));
}

// ─── El chequeo real ─────────────────────────────────────────────────────────

describe("BLOQUEANTE: todo module: de recordAudit existe en el enum modulo_auditoria", () => {
  const permitidos = enumModulosDesdeMigraciones(migraciones());

  it("el enum se parsea desde las migraciones y trae los módulos conocidos", () => {
    // Si esto falla, el parser dejó de entender el DDL y el chequeo de abajo
    // estaría dando verde por leer una lista vacía.
    expect(permitidos.size).toBeGreaterThan(5);
    expect(permitidos).toContain("medical_records");
    expect(permitidos).toContain("catalogs");
  });

  it("ningún Service audita con un módulo que la base va a rechazar", () => {
    const invalidos = archivosDeCodigo()
      .flatMap((f) => usosDeModulo(f.relPath, f.content))
      .filter((u) => !permitidos.has(u.module));

    const detalle = invalidos
      .map((u) => `  ${u.file}:${u.line} — module: "${u.module}"`)
      .join("\n");

    expect(
      invalidos,
      invalidos.length === 0 ? "" :
        `${invalidos.length} asiento(s) de auditoría con un módulo que no está en el enum ` +
        `modulo_auditoria:\n${detalle}\n\n` +
        "recordAudit es best-effort: esto NO rompe la operación, simplemente el asiento " +
        "no queda (RN-S3 / regla 6 del CLAUDE.md). Agregá el valor con " +
        "ALTER TYPE modulo_auditoria ADD VALUE en una migración nueva.\n" +
        `Valores válidos hoy: ${[...permitidos].sort().join(", ")}`,
    ).toEqual([]);
  });
});

// ─── Autoverificación por mutación ───────────────────────────────────────────

describe("motor del guardrail — se pone rojo cuando debe", () => {
  it("parsea el CREATE TYPE inicial", () => {
    const enums = enumModulosDesdeMigraciones([
      { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients', 'pets');" },
    ]);
    expect([...enums].sort()).toEqual(["clients", "pets"]);
  });

  it("suma los ALTER TYPE ... ADD VALUE posteriores, en orden de migración", () => {
    const enums = enumModulosDesdeMigraciones([
      { name: "b.sql", content: "ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'catalogs';" },
      { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients');" },
    ]);
    expect([...enums].sort()).toEqual(["catalogs", "clients"]);
  });

  it("ignora un ADD VALUE comentado", () => {
    const enums = enumModulosDesdeMigraciones([
      { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients');\n-- ALTER TYPE modulo_auditoria ADD VALUE 'fantasma';" },
    ]);
    expect(enums.has("fantasma")).toBe(false);
  });

  it("encuentra el module: de una llamada a recordAudit", () => {
    const usos = usosDeModulo("x.ts", 'await recordAudit(db, { action: "CREATE", module: "catalogs" });');
    expect(usos).toEqual([{ file: "x.ts", line: 1, module: "catalogs" }]);
  });

  it("no confunde un module: que está dentro de un comentario", () => {
    expect(usosDeModulo("x.ts", '  // module: "inventado"')).toEqual([]);
    expect(usosDeModulo("x.ts", '   * module: "inventado"')).toEqual([]);
  });

  it("MUTACIÓN — un módulo que no está en el enum se detecta", () => {
    // Éste es exactamente el bug que se escapó: el literal existía en el
    // Service y el valor no existía en la base.
    const permitidos = enumModulosDesdeMigraciones([
      { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients');" },
    ]);
    const usos = usosDeModulo("catalogos.service.ts", 'module:   "catalogs",');

    expect(usos.filter((u) => !permitidos.has(u.module))).toHaveLength(1);
  });
});
