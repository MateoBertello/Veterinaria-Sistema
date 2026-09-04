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

export interface DbOnlyAllowlistEntry {
  module: string;
  reason: string;
}

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

// ─── Fuente 2b: los literales que los RPCs en SQL le pasan a registros_auditoria ──

/**
 * Parsea los argumentos SQL de una lista separada por comas respetando paréntesis y comillas.
 * Devuelve un array de objetos con el texto y el offset del argumento respecto al inicio del string.
 */
export function splitSqlArgs(str: string): Array<{ text: string; offset: number }> {
  const args: Array<{ text: string; offset: number }> = [];
  let current = "";
  let parenDepth = 0;
  let inString = false;
  let stringChar = "";
  let startOffset = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      current += ch;
      if (ch === stringChar) {
        if (str[i + 1] === stringChar) {
          current += str[i + 1];
          i++;
        } else {
          inString = false;
        }
      }
    } else {
      if (ch === "'" || ch === '"') {
        inString = true;
        stringChar = ch;
        current += ch;
      } else if (ch === "(") {
        parenDepth++;
        current += ch;
      } else if (ch === ")") {
        parenDepth--;
        current += ch;
      } else if (ch === "," && parenDepth === 0) {
        args.push({ text: current.trim(), offset: startOffset });
        current = "";
        startOffset = i + 1;
      } else {
        if (current.length === 0 && (ch === " " || ch === "\t" || ch === "\n" || ch === "\r")) {
          startOffset = i + 1;
        } else {
          current += ch;
        }
      }
    }
  }
  if (current.trim()) {
    args.push({ text: current.trim(), offset: startOffset });
  }
  return args;
}

/**
 * Busca `INSERT INTO registros_auditoria` en archivos de migración y extrae el literal
 * en la columna `module`.
 */
export function usosDeModuloEnMigraciones(
  files: Array<{ name: string; content: string }>,
): UsoModulo[] {
  const usos: UsoModulo[] = [];

  for (const { name, content } of files) {
    const clean = content.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
    const regex = /INSERT\s+INTO\s+registros_auditoria\s*\(([\s\S]*?)\)\s*VALUES\s*\(/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(clean)) !== null) {
      const colsStr = match[1]!;
      const cols = colsStr.split(",").map((c) => c.trim().toLowerCase());
      const modIdx = cols.indexOf("module");
      if (modIdx === -1) continue;

      const valuesStart = regex.lastIndex;
      let depth = 1;
      let inStr = false;
      let strCh = "";
      let valuesEnd = valuesStart;

      for (let i = valuesStart; i < clean.length; i++) {
        const ch = clean[i];
        if (inStr) {
          if (ch === strCh) {
            if (clean[i + 1] === strCh) {
              i++;
            } else {
              inStr = false;
            }
          }
        } else {
          if (ch === "'" || ch === '"') {
            inStr = true;
            strCh = ch;
          } else if (ch === "(") {
            depth++;
          } else if (ch === ")") {
            depth--;
            if (depth === 0) {
              valuesEnd = i;
              break;
            }
          }
        }
      }

      const valStr = clean.slice(valuesStart, valuesEnd);
      const args = splitSqlArgs(valStr);
      if (modIdx >= args.length) continue;

      const modArg = args[modIdx]!;
      const m = modArg.text.match(/'([^']+)'/);
      if (m?.[1]) {
        const absOffset = valuesStart + modArg.offset;
        const line = content.slice(0, absOffset).split("\n").length;
        usos.push({ file: name, line, module: m[1] });
      }
    }
  }

  return usos;
}

// ─── Fuente 3: el tipo TypeScript AuditModule ────────────────────────────────

/**
 * Parsea los literales de la unión `export type AuditModule = ...;` en shared/audit.ts.
 * Ignora literales dentro de comentarios de línea (`//`).
 */
export function modulosDesdeTipoAuditModule(source: string): Set<string> {
  const valores = new Set<string>();
  const match = source.match(/export\s+type\s+AuditModule\s*=([\s\S]*?);/);
  if (!match?.[1]) return valores;

  const lineas = match[1].split("\n");
  for (const linea of lineas) {
    const sinComentario = linea.replace(/\/\/[^\n]*/, "");
    for (const m of sinComentario.matchAll(/"([^"]+)"/g)) {
      valores.add(m[1]!);
    }
  }

  return valores;
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

  it("ningún RPC en migraciones audita con un módulo que la base va a rechazar", () => {
    const invalidos = usosDeModuloEnMigraciones(migraciones())
      .filter((u) => !permitidos.has(u.module));

    const detalle = invalidos
      .map((u) => `  ${u.file}:${u.line} — module: "${u.module}"`)
      .join("\n");

    expect(
      invalidos,
      invalidos.length === 0 ? "" :
        `${invalidos.length} INSERT INTO registros_auditoria en RPC(s) con un módulo que no está en el enum ` +
        `modulo_auditoria:\n${detalle}\n\n` +
        "En un RPC, un módulo inválido revienta la transacción completa con error de PostgreSQL. " +
        "Agregá el valor con ALTER TYPE modulo_auditoria ADD VALUE en una migración previa o corregí el literal.\n" +
        `Valores válidos hoy: ${[...permitidos].sort().join(", ")}`,
    ).toEqual([]);
  });
});

describe("BLOQUEANTE: correspondencia bidireccional entre AuditModule y modulo_auditoria", () => {
  const enEnum = enumModulosDesdeMigraciones(migraciones());
  const enTipo = modulosDesdeTipoAuditModule(
    readFileSync(join(SHARED_DIR, "audit.ts"), "utf-8"),
  );

  it("el tipo se parsea y trae los módulos conocidos", () => {
    // Si esto falla, el parser dejó de entender el tipo y el chequeo de abajo
    // estaría dando verde por leer un conjunto vacío.
    expect(enTipo.size).toBeGreaterThan(10);
    expect(enTipo).toContain("medical_records");
    expect(enTipo).toContain("catalogs");
  });

  it("RN-SC6: ningún valor del tipo AuditModule falta en el enum de la base", () => {
    const faltantes = [...enTipo].filter((m) => !enEnum.has(m));
    expect(
      faltantes,
      faltantes.length === 0 ? "" :
        `${faltantes.length} valor(es) del tipo AuditModule que la base va a rechazar: ` +
        `${faltantes.join(", ")}\n\n` +
        "recordAudit es best-effort: esto NO rompe la operación, el asiento simplemente " +
        "no queda. Agregá el valor con ALTER TYPE modulo_auditoria ADD VALUE en una " +
        "migración nueva.",
    ).toEqual([]);
  });

  it("RN-SC6: todo valor del enum modulo_auditoria existe en el tipo AuditModule (bidireccional)", () => {
    // Si la base tiene valores de ENUM que deliberadamente no se usan desde TS,
    // deben listarse en ALLOWLIST_DB_ONLY con su justificación obligatoria.
    const ALLOWLIST_DB_ONLY: DbOnlyAllowlistEntry[] = [];

    for (const entry of ALLOWLIST_DB_ONLY) {
      expect(entry.module).toBeTruthy();
      expect(entry.reason.trim().length).toBeGreaterThan(15);
    }

    const allowlisted = new Set(ALLOWLIST_DB_ONLY.map((e) => e.module));

    const faltantes = [...enEnum]
      .filter((m) => !enTipo.has(m) && !allowlisted.has(m));

    expect(
      faltantes,
      faltantes.length === 0 ? "" :
        `${faltantes.length} valor(es) del enum modulo_auditoria que faltan en el tipo AuditModule: ` +
        `${faltantes.join(", ")}\n\n` +
        "Agregá los valores a AuditModule en supabase/functions/api/src/shared/audit.ts o " +
        "documentalos en ALLOWLIST_DB_ONLY con su justificación.",
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

  it("parsea los literales de la unión de tipos", () => {
    const s = 'export type AuditModule =\n  | "clients" | "pets"\n  | "inventory";';
    expect([...modulosDesdeTipoAuditModule(s)].sort()).toEqual(["clients", "inventory", "pets"]);
  });

  it("ignora un literal que está en un comentario", () => {
    const s = 'export type AuditModule =\n  // | "fantasma"\n  | "clients";';
    expect(modulosDesdeTipoAuditModule(s).has("fantasma")).toBe(false);
  });

  it("MUTACIÓN — un valor del tipo que no está en el enum se detecta", () => {
    const enEnum = enumModulosDesdeMigraciones([
      { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients');" },
    ]);
    const enTipo = modulosDesdeTipoAuditModule('export type AuditModule = | "clients" | "inventory";');
    expect([...enTipo].filter((m) => !enEnum.has(m))).toEqual(["inventory"]);
  });

  it("parsea el module de INSERT INTO registros_auditoria en migraciones", () => {
    const sql = `
      INSERT INTO registros_auditoria (
        tenant_id, user_id, user_name, user_role, action, module, entity_id, details
      ) VALUES (
        p_tenant_id, p_usuario_id, 'Admin', 'admin', 'UPDATE', 'inventory', p_id::text, '{}'::jsonb
      );
    `;
    const usos = usosDeModuloEnMigraciones([{ name: "test_migration.sql", content: sql }]);
    expect(usos).toEqual([{ file: "test_migration.sql", line: 5, module: "inventory" }]);
  });

  it("MUTACIÓN — un módulo en un RPC que no está en el enum se detecta", () => {
    const permitidos = enumModulosDesdeMigraciones([
      { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients');" },
    ]);
    const sql = `
      INSERT INTO registros_auditoria (
        tenant_id, user_id, action, module, entity_id
      ) VALUES (
        p_tenant_id, p_usuario_id, 'UPDATE', 'inventoryy', p_id::text
      );
    `;
    const usos = usosDeModuloEnMigraciones([{ name: "rpc.sql", content: sql }]);
    const invalidos = usos.filter((u) => !permitidos.has(u.module));
    expect(invalidos).toHaveLength(1);
    expect(invalidos[0]?.module).toBe("inventoryy");
  });

  it("MUTACIÓN — un valor en el enum que falta en el tipo AuditModule se detecta por chequeo inverso", () => {
    const enEnum = enumModulosDesdeMigraciones([
      { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients', 'suppliers');" },
    ]);
    const enTipo = modulosDesdeTipoAuditModule('export type AuditModule = | "clients";');
    expect([...enEnum].filter((m) => !enTipo.has(m))).toEqual(["suppliers"]);
  });

  it("MUTACIÓN — ALLOWLIST_DB_ONLY requiere reason documentado y exime el valor", () => {
    const allowlist: DbOnlyAllowlistEntry[] = [
      { module: "solo_db", reason: "Módulo utilizado exclusivamente por triggers de base de datos" },
    ];
    expect(allowlist[0]?.reason.length).toBeGreaterThan(15);
    const allowlisted = new Set(allowlist.map((e) => e.module));
    const faltantes = ["solo_db"].filter((m) => !allowlisted.has(m));
    expect(faltantes).toEqual([]);
  });
});
