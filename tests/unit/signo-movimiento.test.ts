/**
 * BLOQUEANTE — todo valor del enum `tipo_movimiento_stock` tiene que tener una
 * rama explícita en `signo_movimiento()`, y todo valor de `tipo_movimiento_caja`
 * una en `signo_movimiento_caja()`.
 *
 * POR QUÉ EXISTE ESTE TEST
 *
 * Las dos funciones cerraban con `ELSE -1`. Con ese ELSE, agregar un valor al
 * enum y olvidarse de la función no rompe nada visible: el valor nuevo recibe
 * -1 en silencio. Se demostró agregando `entrada_donacion` a
 * `tipo_movimiento_stock` sin tocar la función — las 66 suites unitarias y las
 * 4 de integración quedaron en verde, y una entrada de 5 unidades RESTABA 5 de
 * `existencias_lote`. En caja el mismo agujero está para cualquier `ingreso_*`
 * futuro: entraría al arqueo teórico de `cerrar_sesion_caja` con signo negativo.
 *
 * Ningún test de los que existían podía atraparlo, y no por estar mal escritos:
 * un valor de enum que todavía no existe no aparece en ninguna aserción. La
 * migración `20261029000002_signo_movimiento_enumeracion_exhaustiva.sql` saca
 * el ELSE para que un valor no contemplado dé NULL en vez de -1; este test es
 * lo que impide que el ELSE vuelva y lo que pone en rojo al valor nuevo que
 * llegue sin su rama.
 *
 * ALCANCE: es un chequeo SINTÁCTICO sobre el DDL en `supabase/migrations/`.
 * Cruza dos textos —los valores del enum y las ramas `WHEN` de la función— sin
 * base levantada. NO verifica que el signo asignado a cada valor sea el
 * correcto: que `entrada_compra` sume y `salida_venta` reste se prueba contra
 * PostgreSQL real en `tests/integration/stock.integration.test.ts` (RN-MV4).
 * Lo que este test garantiza es que ningún valor quede SIN decisión tomada.
 *
 * SIN ALLOWLIST, a propósito: no hay caso legítimo de un tipo de movimiento sin
 * signo definido. Si alguna vez lo hubiera, la rama se escribe igual
 * (`WHEN 'x' THEN 0`) y queda documentada en la función, que es donde se lee.
 *
 * FAIL-SAFE: si el parser no logra resolver la definición de una función o la
 * lista de valores de un enum, el test falla en vez de saltear el chequeo. Un
 * parser roto tiene que verse como un rojo, no como un verde.
 *
 * Mismo criterio que `audit-modulo-enum.test.ts` y `tenant-filter-guardrail.test.ts`:
 * además del chequeo real, el motor se verifica POR MUTACIÓN contra fragmentos
 * sintéticos, para que un detector que dejó de detectar no pase inadvertido.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT      = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");

export interface Migracion {
  name:    string;
  content: string;
}

/** Quita los comentarios `--` conservando las posiciones de línea. */
function sinComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

// ─── Fuente 1: los valores del enum, tal como los dejan las migraciones ──────

/**
 * Reconstruye un enum leyendo las migraciones en orden: el `CREATE TYPE`
 * inicial más todo `ALTER TYPE ... ADD VALUE` posterior. Se parsea el DDL y no
 * se hardcodea la lista justamente para que agregar un valor en una migración
 * alcance para que este guardrail lo cubra, sin acordarse de tocar el test.
 */
export function valoresDeEnum(files: Migracion[], enumName: string): string[] {
  const valores: string[] = [];
  const agregar = (v: string) => { if (!valores.includes(v)) valores.push(v); };

  for (const { content } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = sinComentarios(content);

    const create = sql.match(
      new RegExp(`CREATE\\s+TYPE\\s+(?:public\\.)?${enumName}\\s+AS\\s+ENUM\\s*\\(([\\s\\S]*?)\\)`, "i"),
    );
    if (create?.[1]) {
      for (const m of create[1].matchAll(/'([^']+)'/g)) agregar(m[1]!);
    }

    for (const m of sql.matchAll(
      new RegExp(`ALTER\\s+TYPE\\s+(?:public\\.)?${enumName}\\s+ADD\\s+VALUE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'([^']+)'`, "gi"),
    )) {
      agregar(m[1]!);
    }
  }

  return valores;
}

// ─── Fuente 2: la definición VIGENTE de la función ───────────────────────────

export interface DefinicionFuncion {
  file:       string;
  cabecera:   string;  // entre el `)` de los argumentos y el `AS $$`
  cuerpo:     string;  // entre `AS $$` y `$$`
}

/**
 * Devuelve la ÚLTIMA definición de la función según el orden de migraciones —
 * la que gana en la base, porque cada `CREATE OR REPLACE` pisa a la anterior.
 * Mirar sólo la primera daría un verde falso apenas alguien redefina la función
 * en una migración posterior (que es exactamente lo que pasó con
 * `signo_movimiento`, redefinida en C6·T1 para `merma_fraccionamiento`).
 */
export function definicionVigente(files: Migracion[], fnName: string): DefinicionFuncion | null {
  let ultima: DefinicionFuncion | null = null;

  for (const { name, content } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = sinComentarios(content);
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(([\\s\\S]*?)\\)([\\s\\S]*?)AS\\s*\\$\\$([\\s\\S]*?)\\$\\$`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      ultima = { file: name, cabecera: m[2] ?? "", cuerpo: m[3] ?? "" };
    }
  }

  return ultima;
}

/**
 * Valores con rama `WHEN` explícita en el cuerpo. Cubre las dos formas de CASE:
 *   CASE p_tipo WHEN 'x' THEN ...            (CASE simple)
 *   CASE WHEN p_tipo IN ('x','y') THEN ...   (CASE buscado)
 * Recorta cada tramo entre `WHEN` y su `THEN` y junta los literales de adentro,
 * así que no depende de cuál de las dos formas se haya usado.
 */
export function valoresConRama(cuerpo: string): string[] {
  const out: string[] = [];
  for (const m of sinComentarios(cuerpo).matchAll(/\bWHEN\b([\s\S]*?)\bTHEN\b/gi)) {
    for (const lit of (m[1] ?? "").matchAll(/'([^']+)'/g)) {
      if (!out.includes(lit[1]!)) out.push(lit[1]!);
    }
  }
  return out;
}

/** true si el cuerpo tiene un `ELSE` — la rama comodín que hace silencioso el hueco. */
export function tieneElse(cuerpo: string): boolean {
  return /\bELSE\b/i.test(sinComentarios(cuerpo));
}

// ─── Recolección ─────────────────────────────────────────────────────────────

function migraciones(): Migracion[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, content: readFileSync(join(MIGRATIONS_DIR, name), "utf-8") }));
}

const CASOS = [
  {
    fn:       "signo_movimiento",
    enumName: "tipo_movimiento_stock",
    minimo:   15,
    conocido: "salida_venta",
    riesgo:
      "Un tipo sin rama devuelve NULL y `movimientos_stock.cantidad_con_signo` " +
      "(NOT NULL desde 20261029000002) rechaza el INSERT. Con el ELSE que había antes " +
      "recibía -1 en silencio y una ENTRADA restaba stock.",
  },
  {
    fn:       "signo_movimiento_caja",
    enumName: "tipo_movimiento_caja",
    minimo:   7,
    conocido: "ingreso_venta",
    riesgo:
      "Un tipo sin rama devuelve NULL y el CHECK chk_mov_caja_signo_definido rechaza " +
      "el INSERT. Sin eso, `sum()` en el arqueo teórico de cerrar_sesion_caja (RN-CJ2) " +
      "IGNORA los NULL: el movimiento no contaría y el faltante aparecería como " +
      "diferencia de caja de un cajero.",
  },
] as const;

// ─── El chequeo real ─────────────────────────────────────────────────────────

describe.each(CASOS)(
  "BLOQUEANTE: $fn cubre todos los valores de $enumName",
  ({ fn, enumName, minimo, conocido, riesgo }) => {
    const files  = migraciones();
    const enumV  = valoresDeEnum(files, enumName);
    const def    = definicionVigente(files, fn);

    it(`el enum ${enumName} se parsea desde las migraciones`, () => {
      // Fail-safe: si el parser dejó de entender el DDL, el chequeo de abajo
      // estaría dando verde por comparar contra una lista vacía.
      expect(enumV.length).toBeGreaterThanOrEqual(minimo);
      expect(enumV).toContain(conocido);
    });

    it(`la definición vigente de ${fn}() se encuentra y sigue siendo sql IMMUTABLE`, () => {
      expect(def, `No se encontró ningún CREATE FUNCTION ${fn} en supabase/migrations/`).not.toBeNull();
      expect(valoresConRama(def!.cuerpo).length).toBeGreaterThan(0);
      // La columna generada `cantidad_con_signo` exige IMMUTABLE y necesita que
      // la función sea inlineable; plpgsql penalizaría cada INSERT del libro mayor.
      expect(def!.cabecera).toMatch(/LANGUAGE\s+sql/i);
      expect(def!.cabecera).toMatch(/IMMUTABLE/i);
    });

    it(`ningún valor de ${enumName} queda sin rama explícita en ${fn}()`, () => {
      const cubiertos = valoresConRama(def!.cuerpo);
      const huerfanos = enumV.filter((v) => !cubiertos.includes(v));

      expect(
        huerfanos,
        huerfanos.length === 0 ? "" :
          `${huerfanos.length} valor(es) de ${enumName} sin rama WHEN en ${fn}() ` +
          `(definición vigente: ${def!.file}):\n` +
          huerfanos.map((v) => `  '${v}'`).join("\n") + "\n\n" +
          `${riesgo}\n` +
          `Agregá la rama en una migración nueva con CREATE OR REPLACE FUNCTION ${fn}.`,
      ).toEqual([]);
    });

    it(`${fn}() no tiene ELSE: un valor no contemplado devuelve NULL, no un signo inventado`, () => {
      expect(
        tieneElse(def!.cuerpo),
        `${fn}() (definición vigente: ${def!.file}) tiene una rama ELSE. El ELSE es lo que ` +
        "hace silencioso el hueco: le da un signo a un tipo de movimiento que nadie decidió. " +
        "Enumerá los valores uno por uno y dejá que el CASE devuelva NULL para el resto.",
      ).toBe(false);
    });
  },
);

// ─── Autoverificación por mutación ───────────────────────────────────────────

describe("motor del guardrail — se pone rojo cuando debe", () => {
  const enumSQL  = "CREATE TYPE tipo_movimiento_stock AS ENUM ('entrada_compra', 'salida_venta');";
  const fnSQL    = `CREATE OR REPLACE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
    RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE p_tipo
        WHEN 'entrada_compra' THEN 1
        WHEN 'salida_venta'   THEN -1
      END;
    $$;`;

  it("parsea el CREATE TYPE inicial", () => {
    expect(valoresDeEnum([{ name: "a.sql", content: enumSQL }], "tipo_movimiento_stock"))
      .toEqual(["entrada_compra", "salida_venta"]);
  });

  it("suma los ALTER TYPE ... ADD VALUE posteriores, en orden de migración", () => {
    const v = valoresDeEnum([
      { name: "b.sql", content: "ALTER TYPE tipo_movimiento_stock ADD VALUE IF NOT EXISTS 'entrada_donacion';" },
      { name: "a.sql", content: enumSQL },
    ], "tipo_movimiento_stock");
    expect(v).toContain("entrada_donacion");
  });

  it("ignora un ADD VALUE comentado", () => {
    const v = valoresDeEnum([
      { name: "a.sql", content: `${enumSQL}\n-- ALTER TYPE tipo_movimiento_stock ADD VALUE 'fantasma';` },
    ], "tipo_movimiento_stock");
    expect(v).not.toContain("fantasma");
  });

  it("no confunde el enum de caja con el de stock", () => {
    const files = [
      { name: "a.sql", content: enumSQL },
      { name: "b.sql", content: "CREATE TYPE tipo_movimiento_caja AS ENUM ('ingreso_venta','egreso_retiro');" },
    ];
    expect(valoresDeEnum(files, "tipo_movimiento_caja")).toEqual(["ingreso_venta", "egreso_retiro"]);
  });

  it("toma la ÚLTIMA definición de la función, no la primera", () => {
    const vieja = `CREATE OR REPLACE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
      RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$ SELECT CASE p_tipo WHEN 'entrada_compra' THEN 1 END; $$;`;
    const def = definicionVigente([
      { name: "b_nueva.sql", content: fnSQL },
      { name: "a_vieja.sql", content: vieja },
    ], "signo_movimiento");
    expect(def?.file).toBe("b_nueva.sql");
    expect(valoresConRama(def!.cuerpo)).toEqual(["entrada_compra", "salida_venta"]);
  });

  it("entiende también la forma CASE WHEN p_tipo IN (...)", () => {
    const cuerpo = "SELECT CASE WHEN p_tipo IN ('entrada_compra','entrada_ajuste') THEN 1 WHEN p_tipo = 'salida_venta' THEN -1 END;";
    expect(valoresConRama(cuerpo)).toEqual(["entrada_compra", "entrada_ajuste", "salida_venta"]);
  });

  it("no cuenta como rama un valor que sólo aparece en un comentario", () => {
    const cuerpo = "SELECT CASE p_tipo\n -- WHEN 'entrada_donacion' THEN 1\n WHEN 'salida_venta' THEN -1 END;";
    expect(valoresConRama(cuerpo)).toEqual(["salida_venta"]);
  });

  it("MUTACIÓN — un valor agregado al enum sin su rama en la función se detecta y se nombra", () => {
    // Ésta es exactamente la mutación con la que se demostró el defecto:
    // entrada_donacion en el enum, la función sin tocar.
    const files: Migracion[] = [
      { name: "a.sql", content: `${enumSQL}\n${fnSQL}` },
      { name: "b.sql", content: "ALTER TYPE tipo_movimiento_stock ADD VALUE 'entrada_donacion';" },
    ];
    const enumV     = valoresDeEnum(files, "tipo_movimiento_stock");
    const cubiertos = valoresConRama(definicionVigente(files, "signo_movimiento")!.cuerpo);
    expect(enumV.filter((v) => !cubiertos.includes(v))).toEqual(["entrada_donacion"]);
  });

  it("MUTACIÓN — un ingreso_* nuevo en el enum de caja sin su rama se detecta y se nombra", () => {
    const files: Migracion[] = [
      {
        name: "a.sql",
        content: `CREATE TYPE tipo_movimiento_caja AS ENUM ('ingreso_venta','egreso_retiro');
          CREATE OR REPLACE FUNCTION public.signo_movimiento_caja(p_tipo tipo_movimiento_caja)
          RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
            SELECT CASE p_tipo WHEN 'ingreso_venta' THEN 1 WHEN 'egreso_retiro' THEN -1 END;
          $$;`,
      },
      { name: "b.sql", content: "ALTER TYPE tipo_movimiento_caja ADD VALUE 'ingreso_subsidio';" },
    ];
    const enumV     = valoresDeEnum(files, "tipo_movimiento_caja");
    const cubiertos = valoresConRama(definicionVigente(files, "signo_movimiento_caja")!.cuerpo);
    expect(enumV.filter((v) => !cubiertos.includes(v))).toEqual(["ingreso_subsidio"]);
  });

  it("MUTACIÓN — el ELSE que se acaba de sacar se detecta si vuelve", () => {
    const conElse = "SELECT CASE WHEN p_tipo IN ('entrada_compra') THEN 1 ELSE -1 END;";
    expect(tieneElse(conElse)).toBe(true);
    expect(tieneElse("SELECT CASE p_tipo WHEN 'entrada_compra' THEN 1 END;")).toBe(false);
  });

  it("MUTACIÓN — pasar la función a plpgsql se detecta", () => {
    const enPlpgsql = `CREATE OR REPLACE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
      RETURNS SMALLINT LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN 1; END; $$;`;
    const def = definicionVigente([{ name: "a.sql", content: enPlpgsql }], "signo_movimiento");
    expect(def!.cabecera).not.toMatch(/LANGUAGE\s+sql/i);
  });

  it("FAIL-SAFE — si la función no aparece, definicionVigente devuelve null (rojo, no verde)", () => {
    expect(definicionVigente([{ name: "a.sql", content: enumSQL }], "signo_movimiento")).toBeNull();
  });
});
