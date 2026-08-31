/**
 * BLOQUEANTE — Guardrail estático de aislamiento por tenant.
 *
 * Contexto (ver CLAUDE.md, sección "Aislamiento explícito en el camino de la
 * API"): la mayoría de los Services abre la conexión con `getServiceDb()`
 * (service role), que bypasea RLS por diseño. En ese camino el aislamiento por
 * tenant NO lo impone la base — lo impone, entera y exclusivamente, que cada
 * consulta escriba su `.eq("tenant_id", ctx.tenantId)`. Es disciplina, no una
 * barrera técnica.
 *
 * Migrar esos Services a `getDb()` (RLS activa) se evaluó y se descartó: exige
 * revertir el `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated` de
 * `20260725000003_hardening_authenticated_rls.sql`, que es justamente lo que
 * impide que un JWT robado escriba directo contra PostgREST salteando la Edge
 * Function. La disciplina del `.eq("tenant_id", ...)` sigue siendo el único
 * control — este archivo es lo que la sostiene: un test que recorre los
 * fuentes de los Services y falla si una `.from("<tabla-de-tenant>")` que
 * corre con `getServiceDb()` no lleva su filtro de tenant en la misma cadena.
 *
 * ES SINTÁCTICO, NO SEMÁNTICO (ver el doc-comment de
 * `tests/unit/_helpers/tenantFilterAnalysis.ts`). Detecta la FORMA de la
 * consulta — ¿aparece `.eq("tenant_id", ...)`? — no el valor. Un
 * `.eq("tenant_id", undefined)` pasa este guardrail: de que el valor sea el
 * correcto se ocupa `tests/integration/aislamiento-api.integration.test.ts`,
 * pegándole a la API real con JWTs de tenants distintos. El objetivo acá es
 * más angosto y más barato de sostener: que nadie OLVIDE el filtro.
 *
 * Las tablas con `tenant_id` se derivan del DDL real en `supabase/migrations/`
 * (no de una lista escrita a mano): una tabla nueva con `tenant_id` entra sola
 * al alcance del guardrail el día que se agregue su migración.
 *
 * ALLOWLIST: hay tres consultas reales sin `.eq("tenant_id", ...)`, las tres
 * en `auth.service.ts` (login, recuperación de contraseña/usuario) — todas
 * búsquedas deliberadamente cross-tenant porque el tenant todavía no se
 * conoce en ese punto del flujo. Cada entrada documenta por qué. Si esta
 * lista creciera mucho más allá de eso, es señal de que conviene la otra
 * opción evaluada (un wrapper que exija el tenant por construcción) en vez de
 * seguir sumando excepciones.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSchemaFromMigrations, scanSourceForViolations } from "./_helpers/tenantFilterAnalysis.ts";

const REPO_ROOT      = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");
const SERVICES_DIR   = join(REPO_ROOT, "supabase/functions/api/src/modules");

function loadRealSchema() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, content: readFileSync(join(MIGRATIONS_DIR, name), "utf-8") }));
  return extractSchemaFromMigrations(files);
}

function listServiceFiles(): Array<{ absPath: string; relPath: string }> {
  const moduleDirs = readdirSync(SERVICES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  const files: Array<{ absPath: string; relPath: string }> = [];
  for (const dir of moduleDirs) {
    const dirPath = join(SERVICES_DIR, dir.name);
    for (const entry of readdirSync(dirPath)) {
      if (entry.endsWith(".service.ts")) {
        const absPath = join(dirPath, entry);
        files.push({ absPath, relPath: relative(REPO_ROOT, absPath).split(sep).join("/") });
      }
    }
  }
  return files;
}

// ─── Allowlist ──────────────────────────────────────────────────────────────

interface AllowlistEntry {
  file:   string;
  line:   number;
  table:  string;
  reason: string;
}

const ALLOWLIST: AllowlistEntry[] = [
  {
    file:  "supabase/functions/api/src/modules/auth/auth.service.ts",
    line:  128,
    table: "usuarios",
    reason:
      "Login: el tenant todavía no se conoce (se identifica al usuario por username/email ANTES " +
      "de resolver el tenant). Búsqueda cross-tenant deliberada, con .limit(2) + " +
      "ErrorCode.AMBIGUOUS_IDENTIFIER para no elegir arbitrariamente entre homónimos de distintas " +
      "clínicas (ver comentario extenso en el propio método).",
  },
  {
    file:  "supabase/functions/api/src/modules/auth/auth.service.ts",
    line:  191,
    table: "usuarios",
    reason:
      "Update de last_login por id (PK única global) de la MISMA fila ya resuelta unas líneas " +
      "arriba, en el mismo método, por la búsqueda de la entrada anterior. Ninguna otra fila puede " +
      "coincidir por id: omitir tenant_id acá no es una fuga, es redundante. No se agrega el filtro " +
      "para no tocar el service sin que el guardrail haya encontrado una fuga real.",
  },
  {
    file:  "supabase/functions/api/src/modules/auth/auth.service.ts",
    line:  399,
    table: "usuarios",
    reason:
      "Recuperación de usuario: endpoint público, sin sesión — el tenant no se conoce. Búsqueda " +
      "cross-tenant deliberada por email_ci con .limit(MAX_COINCIDENCIAS_RECUPERACION) en vez de " +
      ".single() (ver comentario RN-REC2/DT-19 en el propio método).",
  },
];

// ─── Derivación del esquema ─────────────────────────────────────────────────

describe("extractSchemaFromMigrations", () => {
  it("detecta tablas con tenant_id y excluye el catálogo global / la tabla raíz", () => {
    const sql = `
      CREATE TABLE tenants (
        id UUID PRIMARY KEY
      );
      CREATE TABLE mascotas (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id)
      );
      CREATE TABLE permisos (
        id UUID PRIMARY KEY,
        name TEXT
      );
    `;
    const { allTables, tenantTables } = extractSchemaFromMigrations([{ name: "x.sql", content: sql }]);

    expect(allTables.has("tenants")).toBe(true);
    expect(allTables.has("mascotas")).toBe(true);
    expect(allTables.has("permisos")).toBe(true);

    expect(tenantTables.has("mascotas")).toBe(true);
    expect(tenantTables.has("tenants")).toBe(false);
    expect(tenantTables.has("permisos")).toBe(false);
  });

  it("detecta tenant_id agregado después vía ALTER TABLE ADD COLUMN", () => {
    const sql = `
      CREATE TABLE cosa (id UUID PRIMARY KEY);
      ALTER TABLE cosa ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
    `;
    const { tenantTables } = extractSchemaFromMigrations([{ name: "x.sql", content: sql }]);
    expect(tenantTables.has("cosa")).toBe(true);
  });

  it("ignora un CREATE TABLE comentado con --", () => {
    const sql = `-- CREATE TABLE fantasma (id UUID, tenant_id UUID);`;
    const { allTables } = extractSchemaFromMigrations([{ name: "x.sql", content: sql }]);
    expect(allTables.has("fantasma")).toBe(false);
  });
});

describe("esquema real del proyecto", () => {
  const schema = loadRealSchema();

  it("reconoce las tablas de negocio con tenant_id", () => {
    const esperadas = [
      "modulos_contratados", "configuracion_tenant", "roles", "usuarios", "doctores",
      "horarios_doctor", "clientes", "mascotas", "cambios_propietario", "servicios",
      "historial_clinico", "adjuntos_medicos", "plan_vacunacion", "turnos", "notificaciones",
      "estadias", "registros_auditoria",
      // Catálogos clínicos: dejaron de ser globales en
      // 20260827000001_catalogos_por_tenant.sql y cada clínica administra el suyo.
      // Entran por el `ALTER TABLE ... ADD COLUMN tenant_id`, no por el CREATE TABLE:
      // que aparezcan acá confirma que el parser cubre las dos formas.
      "especies", "razas", "tipos_vacuna",
      // Qué vacuna aplica a qué especie (20260828000001_vacunas_por_especie.sql).
      "especie_tipo_vacuna",
    ];
    for (const tabla of esperadas) {
      expect(schema.tenantTables.has(tabla), `se esperaba que "${tabla}" tuviera tenant_id`).toBe(true);
    }
  });

  it("no marca como tenant las tablas de plataforma ni el catálogo global de permisos", () => {
    // `permisos` es el único catálogo que sigue siendo global: lo define el
    // sistema y lo referencia `rol_permiso`, no lo administra ninguna clínica.
    const noTenant = ["tenants", "permisos", "rol_permiso", "intentos_login"];
    for (const tabla of noTenant) {
      expect(schema.allTables.has(tabla), `se esperaba que "${tabla}" existiera en el esquema`).toBe(true);
      expect(schema.tenantTables.has(tabla), `"${tabla}" no debería tener tenant_id`).toBe(false);
    }
  });
});

// ─── Motor: autoverificación por mutación ──────────────────────────────────
//
// La etapa anterior encontró, sobre el pucho, que un fixture puede dar verde
// contra una URL rota (`/historial/undefined`) sin que nadie lo note. Acá se
// aplica la misma lección al revés: en vez de confiar en que el detector
// funciona, se lo pone a prueba MUTÁNDOLO — sacándole el filtro (o la pieza
// que lo transporta) a un snippet controlado y confirmando que se pone rojo.
// Corre en cada `npm test`, no es un paso manual que alguien tenga que acordarse.

const TENANT_TABLES = new Set(["mascotas", "usuarios"]);

describe("scanSourceForViolations — motor del guardrail", () => {
  it("cadena simple CON filtro: no reporta nada", () => {
    const src = `
      const db = getServiceDb();
      const { data } = await db.from("mascotas").select("*").eq("tenant_id", tenantId).single();
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("MUTACIÓN — la misma cadena SIN el .eq(tenant_id): se pone rojo", () => {
    const conFiltro = `
      const db = getServiceDb();
      const { data } = await db.from("mascotas").select("*").eq("tenant_id", tenantId).single();
    `;
    const sinFiltro = conFiltro.replace('.eq("tenant_id", tenantId)', "");

    expect(scanSourceForViolations("x.ts", conFiltro, TENANT_TABLES)).toHaveLength(0);
    const violaciones = scanSourceForViolations("x.ts", sinFiltro, TENANT_TABLES);
    expect(violaciones).toHaveLength(1);
    expect(violaciones[0]!.table).toBe("mascotas");
  });

  it("reasignación (let query = ...; if (x) query = query.foo(...)): filtro en el tramo inicial alcanza", () => {
    const src = `
      async function listar(tenantId) {
        const db = getServiceDb();
        let query = db.from("mascotas").select("*").eq("tenant_id", tenantId);
        if (opts.search) {
          query = query.ilike("name", opts.search);
        }
        const { data } = await query;
      }
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("delegación a un helper (patrón applyFiltros de auditoria.service.ts): sigue la pista", () => {
    const src = `
      function applyFiltros(q, filtros, tenantId) {
        q = q.eq("tenant_id", tenantId);
        if (filtros.module) q = q.eq("module", filtros.module);
        return q;
      }
      async function buscar(filtros, ctx) {
        const db = getServiceDb();
        let q = db.from("registros_auditoria").select("*");
        q = applyFiltros(q, filtros, ctx.tenantId);
        const { data } = await q;
      }
    `;
    expect(scanSourceForViolations("x.ts", src, new Set(["registros_auditoria"]))).toHaveLength(0);
  });

  it("MUTACIÓN — mismo patrón de delegación, sin el .eq(tenant_id) DENTRO del helper: se pone rojo", () => {
    const src = `
      function applyFiltros(q, filtros, tenantId) {
        if (filtros.module) q = q.eq("module", filtros.module);
        return q;
      }
      async function buscar(filtros, ctx) {
        const db = getServiceDb();
        let q = db.from("registros_auditoria").select("*");
        q = applyFiltros(q, filtros, ctx.tenantId);
        const { data } = await q;
      }
    `;
    const violaciones = scanSourceForViolations("x.ts", src, new Set(["registros_auditoria"]));
    expect(violaciones).toHaveLength(1);
    expect(violaciones[0]!.table).toBe("registros_auditoria");
  });

  it("insert con tenant_id inline en el payload: no requiere .eq()", () => {
    const src = `
      const db = getServiceDb();
      await db.from("mascotas").insert({ tenant_id: ctx.tenantId, name: data.name }).select("*").single();
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("insert con el payload armado en una const aparte: sigue la variable", () => {
    const src = `
      async function crear(ctx, data) {
        const db = getServiceDb();
        const payload = { tenant_id: ctx.tenantId, name: data.name };
        const { data: row } = await db.from("mascotas").insert(payload).select("*").single();
      }
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("MUTACIÓN — insert cuyo payload NO tiene tenant_id: se pone rojo", () => {
    const src = `
      async function crear(ctx, data) {
        const db = getServiceDb();
        const payload = { name: data.name };
        const { data: row } = await db.from("mascotas").insert(payload).select("*").single();
      }
    `;
    const violaciones = scanSourceForViolations("x.ts", src, TENANT_TABLES);
    expect(violaciones).toHaveLength(1);
    expect(violaciones[0]!.table).toBe("mascotas");
  });

  // Insert masivo con `.map()`: lo estrenó `sincronizarEspecies` en
  // catalogos.service.ts, al asociar N especies a un tipo de vacuna de una sola
  // vez. Es la forma natural de insertar varias filas, así que el motor tiene
  // que saber leerla en vez de mandarla a la ALLOWLIST.
  it("insert masivo con .map() y arrow conciso: sigue el tenant_id al callback", () => {
    const src = `
      async function asociar(ctx, ids) {
        const db = getServiceDb();
        await db.from("mascotas").insert(ids.map((id) => ({ tenant_id: ctx.tenantId, especie_id: id })));
      }
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("insert masivo con .map() y callback de bloque: también lo sigue", () => {
    const src = `
      async function asociar(ctx, ids) {
        const db = getServiceDb();
        await db.from("mascotas").insert(ids.map((id) => {
          return { tenant_id: ctx.tenantId, especie_id: id };
        }));
      }
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("MUTACIÓN — insert masivo con .map() SIN tenant_id en la fila: se pone rojo", () => {
    const src = `
      async function asociar(ctx, ids) {
        const db = getServiceDb();
        await db.from("mascotas").insert(ids.map((id) => ({ especie_id: id })));
      }
    `;
    const violaciones = scanSourceForViolations("x.ts", src, TENANT_TABLES);
    expect(violaciones).toHaveLength(1);
    expect(violaciones[0]!.table).toBe("mascotas");
  });

  it("MUTACIÓN — .map() con un return sin tenant_id entre varios: se pone rojo", () => {
    // Basta UN camino que inserte sin tenant para que la fila pueda salir sin él.
    const src = `
      async function asociar(ctx, ids) {
        const db = getServiceDb();
        await db.from("mascotas").insert(ids.map((id) => {
          if (id === null) return { especie_id: id };
          return { tenant_id: ctx.tenantId, especie_id: id };
        }));
      }
    `;
    const violaciones = scanSourceForViolations("x.ts", src, TENANT_TABLES);
    expect(violaciones).toHaveLength(1);
  });

  it("tabla sin tenant_id: nunca requiere filtro, aunque corra con getServiceDb()", () => {
    const src = `
      const db = getServiceDb();
      const { data } = await db.from("permisos").select("*");
    `;
    expect(scanSourceForViolations("x.ts", src, new Set(["mascotas"]))).toHaveLength(0);
  });

  it("db.storage.from(bucket) se ignora: no es una tabla de la base", () => {
    const src = `
      const db = getServiceDb();
      await db.storage.from("adjuntos-clinicos").upload(path, file);
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("cliente getDb(...) (RLS activa): fuera de alcance aunque falte el .eq()", () => {
    const src = `
      const db = getDb(authHeader);
      const { data } = await db.from("mascotas").select("*");
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("parámetro SupabaseClient genérico resuelto vía call site → getDb(): fuera de alcance", () => {
    const src = `
      async function contar(db, tabla, tenantId) {
        const { count } = await db.from(tabla).select("*", { count: "exact" });
        return count;
      }
      async function metricas(ctx) {
        const db = getDb(ctx.authHeader);
        return contar(db, "mascotas", ctx.tenantId);
      }
    `;
    expect(scanSourceForViolations("x.ts", src, TENANT_TABLES)).toHaveLength(0);
  });

  it("MUTACIÓN — mismo patrón, pero el call site usa getServiceDb(): se pone rojo", () => {
    const src = `
      async function contar(db, tabla, tenantId) {
        const { count } = await db.from(tabla).select("*", { count: "exact" });
        return count;
      }
      async function metricas(ctx) {
        const db = getServiceDb();
        return contar(db, "mascotas", ctx.tenantId);
      }
    `;
    const violaciones = scanSourceForViolations("x.ts", src, TENANT_TABLES);
    expect(violaciones).toHaveLength(1);
    expect(violaciones[0]!.table).toBe("(dinámica)");
  });
});

// ─── Scan real sobre los Services ───────────────────────────────────────────

it("BLOQUEANTE: toda .from() sobre tabla con tenant_id, corriendo con getServiceDb(), lleva su .eq(\"tenant_id\", ...)", () => {
  const { tenantTables } = loadRealSchema();
  const serviceFiles = listServiceFiles();
  expect(serviceFiles.length).toBeGreaterThan(0);

  const found: Array<{ file: string; line: number; table: string; snippet: string }> = [];
  for (const { absPath, relPath } of serviceFiles) {
    const sourceText = readFileSync(absPath, "utf-8");
    for (const v of scanSourceForViolations(relPath, sourceText, tenantTables)) {
      found.push({ file: relPath, ...v });
    }
  }

  const isAllowlisted = (v: { file: string; line: number; table: string }): boolean =>
    ALLOWLIST.some((a) => a.file === v.file && a.line === v.line && a.table === v.table);

  const unexpected = found.filter((v) => !isAllowlisted(v));
  const staleAllowlistEntries = ALLOWLIST.filter(
    (a) => !found.some((v) => v.file === a.file && v.line === a.line && v.table === a.table),
  );

  if (unexpected.length > 0) {
    const detalle = unexpected
      .map((v) => `  ${v.file}:${v.line} — tabla "${v.table}" sin .eq("tenant_id", ...) — ${v.snippet}`)
      .join("\n");
    throw new Error(
      `${unexpected.length} consulta(s) sobre tabla(s) con tenant_id, corriendo con getServiceDb(), ` +
      `sin filtro explícito de tenant:\n${detalle}\n\n` +
      `Si es una fuga real: agregá el .eq("tenant_id", ...) en el service.\n` +
      `Si es una excepción legítima (búsqueda cross-tenant deliberada, etc.): agregala a ALLOWLIST ` +
      `en tests/unit/tenant-filter-guardrail.test.ts con su motivo.`,
    );
  }

  if (staleAllowlistEntries.length > 0) {
    const detalle = staleAllowlistEntries.map((a) => `  ${a.file}:${a.line} — tabla "${a.table}"`).join("\n");
    throw new Error(
      `Estas entradas de ALLOWLIST ya no corresponden a ninguna consulta sin filtro detectada ` +
      `(el código cambió, o la línea se corrió). Actualizalas o quitalas:\n${detalle}`,
    );
  }

  expect(unexpected).toHaveLength(0);
});

describe("BLOQUEANTE: el guardrail efectivamente ve los services del módulo comercial", () => {
  // Los directorios de módulo del comercial, en el orden en que las etapas los crean.
  // Cada tanda que agrega un módulo nuevo agrega su nombre acá. Es la ÚNICA lista
  // escrita a mano de este archivo, y existe porque su ausencia es indetectable:
  // un guardrail que no escanea nada pasa en verde para siempre.
  const MODULOS_COMERCIALES = ["productos", "proveedores", "stock", "compras"];

  const escaneados = listServiceFiles().map((f) => f.relPath);

  it.each(MODULOS_COMERCIALES)(
    "el service de %s está dentro del alcance del guardrail",
    (modulo) => {
      const match = escaneados.filter((p) => p.includes(`/modules/${modulo}/`));
      expect(
        match,
        `El guardrail de tenant_id no está escaneando ningún .service.ts de ` +
        `src/modules/${modulo}/. Sus consultas NO están verificadas y el aislamiento ` +
        `por tenant de ese módulo no tiene ninguna red. Archivos que sí ve:\n` +
        escaneados.join("\n"),
      ).not.toHaveLength(0);
    },
  );

  it("el esquema derivado de las migraciones incluye las tablas del módulo", () => {
    const { tenantTables } = loadRealSchema();
    for (const tabla of ["productos", "familias_producto", "producto_conversiones", "proveedores"]) {
      expect(
        tenantTables.has(tabla),
        `La tabla ${tabla} no quedó en el esquema derivado del DDL: el guardrail no va ` +
        `a exigir el filtro de tenant en sus consultas.`,
      ).toBe(true);
    }
  });
});
