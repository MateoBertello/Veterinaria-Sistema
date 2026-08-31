/**
 * BLOQUEANTE — RN-MV1 y RN-MV10: la existencia solo cambia por el libro mayor.
 *
 * `existencias_lote` es una caché derivada, mantenida EXCLUSIVAMENTE por el
 * trigger `existencias_lote_aplicar_movimiento` sobre `movimientos_stock`. Y
 * `movimientos_stock` solo lo escriben los RPC, que validan bajo `FOR UPDATE`.
 *
 * El riesgo que este guardrail cubre es R-02 de la spec: "agregar stock_actual
 * por performance". Aparece cuando una consulta va lenta y materializar es la
 * solución obvia; el atajo natural es un `.update()` sobre existencias_lote
 * desde un Service. Eso funciona perfecto en desarrollo y rompe el inventario
 * en producción, porque salta la validación bajo bloqueo y no deja asiento.
 *
 * Es sintáctico, como los otros dos guardrails del repo: detecta la FORMA de la
 * escritura, no su semántica. Es barato de sostener y atrapa exactamente el
 * atajo que la gente toma cuando tiene apuro.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MODULES_DIR = join(REPO_ROOT, "supabase/functions/api/src/modules");

export interface Violacion {
  file: string;
  line: number;
  table: string;
  operation: string;
  snippet: string;
}

export function listModuleFiles(dir = MODULES_DIR): Array<{ relPath: string; fullPath: string }> {
  const results: Array<{ relPath: string; fullPath: string }> = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".ts")) {
        results.push({
          relPath: relative(REPO_ROOT, fullPath),
          fullPath,
        });
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Escanea un código fuente buscando escrituras prohibidas sobre
 * `existencias_lote` y `movimientos_stock` (.insert, .update, .delete, .upsert).
 * Ignora comentarios de una línea y de bloque.
 */
export function escrituraProhibida(relPath: string, source: string): Violacion[] {
  const violaciones: Violacion[] = [];

  // Mapear líneas para reportar el número de línea exacto
  const lines = source.split("\n");

  // Limpiar comentarios de bloque pero preservando newlines para mantener números de línea
  let inBlockComment = false;
  const cleanedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    if (inBlockComment) {
      const endComment = line.indexOf("*/");
      if (endComment !== -1) {
        inBlockComment = false;
        line = " ".repeat(endComment + 2) + line.slice(endComment + 2);
      } else {
        cleanedLines.push("");
        continue;
      }
    }

    const startComment = line.indexOf("/*");
    if (startComment !== -1) {
      const endComment = line.indexOf("*/", startComment + 2);
      if (endComment !== -1) {
        line = line.slice(0, startComment) + " ".repeat(endComment - startComment + 2) + line.slice(endComment + 2);
      } else {
        inBlockComment = true;
        line = line.slice(0, startComment);
      }
    }

    // Quitar comentarios de línea //
    const singleComment = line.indexOf("//");
    if (singleComment !== -1) {
      line = line.slice(0, singleComment);
    }

    cleanedLines.push(line);
  }

  const cleanedSource = cleanedLines.join("\n");

  // Regex para detectar .from("tabla")...op(
  // Busca .from\(\s*["'](existencias_lote|movimientos_stock)["']\s*\) seguido de
  // llamadas encadenadas hasta encontrar .(insert|update|delete|upsert)(
  const regex = /\.from\s*\(\s*["'](existencias_lote|movimientos_stock)["']\s*\)(?:(?!\.from)[^;])*?\.(insert|update|delete|upsert)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleanedSource)) !== null) {
    const table = match[1]!;
    const operation = match[2]!;
    const matchIndex = match.index;

    // Calcular el número de línea
    const lineNumber = cleanedSource.slice(0, matchIndex).split("\n").length;
    const snippet = match[0].replace(/\s+/g, " ").trim();

    violaciones.push({
      file: relPath,
      line: lineNumber,
      table,
      operation,
      snippet,
    });
  }

  return violaciones;
}

describe("Stock Ledger Guardrail (RN-MV1, RN-MV10)", () => {
  describe("Autoverificación por mutación del detector", () => {
    it("el guardrail está escaneando archivos de verdad", () => {
      expect(listModuleFiles().length).toBeGreaterThan(10);
    });

    it("MUTACIÓN — una escritura a existencias_lote se detecta", () => {
      const violaciones = escrituraProhibida(
        "stock.service.ts",
        'await db.from("existencias_lote").update({ cantidad: 5 }).eq("lote_id", id);',
      );
      expect(violaciones).toHaveLength(1);
      expect(violaciones[0]?.table).toBe("existencias_lote");
      expect(violaciones[0]?.operation).toBe("update");
    });

    it("MUTACIÓN — un insert a movimientos_stock se detecta", () => {
      const violaciones = escrituraProhibida(
        "ventas.service.ts",
        'await db.from("movimientos_stock").insert({ cantidad: 1 });',
      );
      expect(violaciones).toHaveLength(1);
      expect(violaciones[0]?.table).toBe("movimientos_stock");
      expect(violaciones[0]?.operation).toBe("insert");
    });

    it("una LECTURA de existencias_lote no es violación", () => {
      const violaciones = escrituraProhibida(
        "stock.service.ts",
        'const { data } = await db.from("existencias_lote").select("*").eq("tenant_id", t);',
      );
      expect(violaciones).toEqual([]);
    });

    it("no confunde una escritura que está en un comentario", () => {
      expect(escrituraProhibida("x.ts", '// db.from("existencias_lote").update({})')).toEqual([]);
    });

    it("detecta escrituras multilínea", () => {
      const source = `
        const { error } = await db
          .from("existencias_lote")
          .update({ cantidad: 10 })
          .eq("id", id);
      `;
      const violaciones = escrituraProhibida("multiline.ts", source);
      expect(violaciones).toHaveLength(1);
      expect(violaciones[0]?.table).toBe("existencias_lote");
      expect(violaciones[0]?.operation).toBe("update");
    });
  });

  describe("RN-MV1 y RN-MV10 — Escaneo real sobre src/modules", () => {
    const files = listModuleFiles();

    it("RN-MV1: ningún módulo escribe movimientos_stock fuera de un RPC", () => {
      const todasLasViolaciones: Violacion[] = [];
      for (const { relPath, fullPath } of files) {
        const content = readFileSync(fullPath, "utf-8");
        const violaciones = escrituraProhibida(relPath, content).filter(
          (v) => v.table === "movimientos_stock",
        );
        todasLasViolaciones.push(...violaciones);
      }

      expect(
        todasLasViolaciones,
        `Se encontraron escrituras directas sobre movimientos_stock:\n` +
          todasLasViolaciones.map((v) => `  ${v.file}:${v.line} [${v.operation}] ${v.snippet}`).join("\n"),
      ).toEqual([]);
    });

    it("RN-MV10: ningún módulo escribe existencias_lote", () => {
      const todasLasViolaciones: Violacion[] = [];
      for (const { relPath, fullPath } of files) {
        const content = readFileSync(fullPath, "utf-8");
        const violaciones = escrituraProhibida(relPath, content).filter(
          (v) => v.table === "existencias_lote",
        );
        todasLasViolaciones.push(...violaciones);
      }

      expect(
        todasLasViolaciones,
        `Se encontraron escrituras directas sobre existencias_lote:\n` +
          todasLasViolaciones.map((v) => `  ${v.file}:${v.line} [${v.operation}] ${v.snippet}`).join("\n"),
      ).toEqual([]);
    });
  });
});
