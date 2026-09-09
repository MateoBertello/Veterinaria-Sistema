/**
 * Motor del guardrail de aislamiento por tenant (ver
 * `tests/unit/tenant-filter-guardrail.test.ts`).
 *
 * Es SINTÁCTICO, no semántico: mira la forma del código (¿aparece
 * `.eq("tenant_id", ...)` en la cadena de esta consulta?), no evalúa qué valor
 * lleva ese `.eq`. Un `.eq("tenant_id", undefined)` pasa el guardrail — de que
 * el valor sea el correcto se ocupa
 * `tests/integration/aislamiento-api.integration.test.ts`, que le pega a la API
 * real con JWTs de tenants distintos. Este archivo solo evita el olvido: que
 * alguien agregue una consulta nueva sobre una tabla de tenant, corriendo con
 * `getServiceDb()`, y se olvide el filtro.
 *
 * Ante cualquier forma que no reconoce (identificador que no puede resolver,
 * tabla que no puede determinar en tiempo de análisis, etc.) el motor asume
 * que la consulta SÍ necesita filtro — prefiere un falso positivo (una entrada
 * de más en el allowlist) a un falso negativo (una fuga real que pasa
 * desapercibida).
 */

import * as ts from "typescript";

// ─── Esquema: qué tablas tienen tenant_id ──────────────────────────────────

export interface MigrationFile {
  name:    string;
  content: string;
}

export interface SchemaInfo {
  allTables:    Set<string>;
  tenantTables: Set<string>;
}

/**
 * Deriva del DDL real (no de una lista escrita a mano) qué relaciones existen y
 * cuáles exponen `tenant_id`. Cubre tres formas:
 *
 *   1. `CREATE TABLE (...)` con la columna en el cuerpo.
 *   2. `tenant_id` agregado después vía `ALTER TABLE ... ADD COLUMN`.
 *   3. `CREATE [OR REPLACE] VIEW ... AS <select>` cuyo cuerpo menciona `tenant_id`.
 *
 * El punto 3 lo agregó la auditoría del Módulo Comercial: el esquema salía solo
 * de CREATE/ALTER TABLE, así que las 7 vistas comerciales quedaban FUERA DEL
 * ALCANCE del guardrail por completo — las 12 consultas de los Services sobre
 * vistas no tenían ninguna red que exigiera su `.eq("tenant_id", ...)`. Y una
 * vista de reporte que cruza varias tablas es exactamente donde más caro sale
 * olvidarlo.
 *
 * Para una vista el criterio es MENCIONAR `tenant_id`, no proyectarlo: saber si
 * una columna llega a la lista de selección exige entender el SQL, y este motor
 * es sintáctico a propósito. El sesgo va, como en todo el archivo, hacia el
 * falso positivo: una vista que filtra por tenant sin exponerlo entraría al
 * alcance y pediría un `.eq()` de más. Preferible a dejarla afuera.
 */
export function extractSchemaFromMigrations(files: MigrationFile[]): SchemaInfo {
  const allTables    = new Set<string>();
  const tenantTables = new Set<string>();

  for (const { content } of files) {
    // Comentarios `-- ...` fuera de juego: evita falsos positivos de un
    // `-- CREATE TABLE foo (tenant_id ...)` dejado en un comentario.
    const cleaned = content.replace(/--.*$/gm, "");

    const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:["\w]+\.)?"?(\w+)"?\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(cleaned))) {
      const table = match[1]!;
      let depth = 1;
      let i     = createRe.lastIndex;
      while (i < cleaned.length && depth > 0) {
        if (cleaned[i] === "(") depth++;
        else if (cleaned[i] === ")") depth--;
        i++;
      }
      const body = cleaned.slice(createRe.lastIndex, i - 1);
      allTables.add(table);
      if (/\btenant_id\b\s+UUID/i.test(body)) tenantTables.add(table);
      createRe.lastIndex = i;
    }

    const alterRe = /ALTER TABLE\s+(?:ONLY\s+)?(?:["\w]+\.)?"?(\w+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?tenant_id"?\s+UUID/gi;
    while ((match = alterRe.exec(cleaned))) {
      allTables.add(match[1]!);
      tenantTables.add(match[1]!);
    }

    const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF NOT EXISTS\s+)?(?:["\w]+\.)?"?(\w+)"?\s+AS\b/gi;
    while ((match = viewRe.exec(cleaned))) {
      const view = match[1]!;
      allTables.add(view);
      const body = viewBody(cleaned, viewRe.lastIndex);
      if (/\btenant_id\b/i.test(body)) tenantTables.add(view);
      viewRe.lastIndex = viewRe.lastIndex + body.length;
    }
  }

  return { allTables, tenantTables };
}

/**
 * Cuerpo de un `CREATE VIEW ... AS` : desde `from` hasta el `;` que la cierra.
 * Los `;` dentro de literales entrecomillados no cuentan (`'a;b'`), que es la
 * única forma en que puede aparecer uno adentro del SELECT de una vista.
 */
function viewBody(sql: string, from: number): string {
  let inString = false;
  for (let i = from; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // `''` es una comilla escapada dentro del literal, no su cierre.
      if (inString && sql[i + 1] === "'") { i++; continue; }
      inString = !inString;
    } else if (ch === ";" && !inString) {
      return sql.slice(from, i);
    }
  }
  return sql.slice(from);
}

// ─── Utilidades de AST ──────────────────────────────────────────────────────

function unwrapCasts(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

/**
 * Subconjunto de nodos "función" que este motor sabe resolver. Se evita
 * `ts.FunctionLikeDeclaration` (el tipo que usa `ts.isFunctionLike`) porque
 * incluye firmas sin cuerpo (call/construct signatures de un `interface`),
 * que no aparecen en código de Services real y solo complican el tipado.
 */
type SupportedFunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isSupportedFunctionLike(node: ts.Node): node is SupportedFunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function findEnclosingFunctionLike(node: ts.Node): SupportedFunctionLike | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (isSupportedFunctionLike(cur)) return cur;
    cur = cur.parent;
  }
  return undefined;
}

function getFunctionName(fn: SupportedFunctionLike): string | undefined {
  if (
    (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) &&
    fn.name &&
    ts.isIdentifier(fn.name)
  ) {
    return fn.name.text;
  }
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) {
    return fn.parent.name.text;
  }
  return undefined;
}

function findVarDecl(root: ts.Node, name: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function findCallSites(sourceFile: ts.SourceFile, fnName: string): ts.CallExpression[] {
  const sites: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === fnName) sites.push(node);
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === fnName) sites.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

interface ChainMethod {
  name: string;
  args: readonly ts.Expression[];
}

/** Sube desde `.from(...)` acumulando los métodos encadenados a continuación (`.select`, `.eq`, ...). */
function walkChainUp(node: ts.CallExpression): { top: ts.Node; methods: ChainMethod[] } {
  const methods: ChainMethod[] = [];
  let current: ts.Node = node;
  for (;;) {
    const parent = current.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      const grand = parent.parent;
      if (grand && ts.isCallExpression(grand) && grand.expression === parent) {
        methods.push({ name: parent.name.text, args: grand.arguments });
        current = grand;
        continue;
      }
    }
    break;
  }
  return { top: current, methods };
}

/** Baja desde una expresión completa (p.ej. el lado derecho de `query = query.eq(...)`) hasta su raíz. */
function extractMethods(expr: ts.Expression): { root: ts.Expression; methods: ChainMethod[] } {
  const methods: ChainMethod[] = [];
  let cur: ts.Expression = expr;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    methods.unshift({ name: cur.expression.name.text, args: cur.arguments });
    cur = cur.expression.expression;
  }
  return { root: cur, methods };
}

function chainHasTenantEq(methods: ChainMethod[]): boolean {
  return methods.some(
    (m) =>
      m.name === "eq" &&
      m.args.length > 0 &&
      ts.isStringLiteralLike(m.args[0]!) &&
      (m.args[0] as ts.StringLiteralLike).text === "tenant_id",
  );
}

function findReassignments(scopeBody: ts.Node, varName: string): ts.BinaryExpression[] {
  const results: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === varName
    ) {
      results.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(scopeBody);
  return results;
}

interface FunctionInfo {
  parameters: readonly ts.ParameterDeclaration[];
  body:       ts.Node | undefined;
}

/** Indexa funciones del archivo por nombre: declaraciones, y `const x = (...) => {}` / `function(...) {}`. */
function buildFunctionIndex(sourceFile: ts.SourceFile): Map<string, FunctionInfo> {
  const map = new Map<string, FunctionInfo>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      map.set(node.name.text, { parameters: node.parameters, body: node.body });
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      map.set(node.name.text, { parameters: node.initializer.parameters, body: node.initializer.body });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return map;
}

/**
 * ¿La variable `varName`, en algún punto de `scopeBody`, termina llevando un
 * `.eq("tenant_id", ...)`? Sigue dos formas, las dos reales en este código base:
 *
 *   1. Reasignación directa:      `query = query.eq("tenant_id", x)`
 *   2. Delegación a un helper:    `q = applyFiltros(q, filtros, tenantId)`
 *      (y adentro de `applyFiltros`, el PRIMER parámetro recibe la misma
 *      reasignación directa — se sigue recursivamente, con guarda anti-ciclo).
 */
function traceVariableForTenantFilter(
  scopeBody: ts.Node,
  varName: string,
  functionIndex: Map<string, FunctionInfo>,
  visited: Set<string> = new Set(),
): boolean {
  for (const reassignment of findReassignments(scopeBody, varName)) {
    const { root, methods } = extractMethods(reassignment.right);
    if (ts.isIdentifier(root) && root.text === varName) {
      if (chainHasTenantEq(methods)) return true;
    } else if (ts.isCallExpression(root) && ts.isIdentifier(root.expression)) {
      const calleeName = root.expression.text;
      const argIndex    = root.arguments.findIndex((a) => ts.isIdentifier(a) && a.text === varName);
      if (argIndex >= 0 && !visited.has(calleeName)) {
        visited.add(calleeName);
        const fn = functionIndex.get(calleeName);
        const param = fn?.parameters[argIndex];
        if (fn?.body && param && ts.isIdentifier(param.name)) {
          if (traceVariableForTenantFilter(fn.body, param.name.text, functionIndex, visited)) return true;
        }
      }
    }
  }
  return false;
}

// ─── Origen del cliente: getServiceDb() (bypasea RLS) vs getDb() (RLS activa) ──

/**
 * true SOLO si se puede resolver con confianza que `name`, en `scope`, es un
 * cliente `getDb(...)` (JWT del usuario, RLS activa). Cualquier otra cosa —
 * `getServiceDb()`, un parámetro sin pista de tipo, un binding que no se
 * encuentra— devuelve false: el guardrail prefiere revisar de más.
 */
function isUserJwtClient(
  sourceFile: ts.SourceFile,
  scope: ts.Node,
  name: string,
  visited: Set<ts.Node> = new Set(),
): boolean {
  if (isSupportedFunctionLike(scope)) {
    const param = scope.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
    if (param) {
      const typeText = param.type ? param.type.getText(sourceFile) : "";
      if (typeText.includes("getServiceDb")) return false;
      if (typeText.includes("getDb")) return true;
      // Tipo genérico (`SupabaseClient`) o sin anotar: no hay pista en la firma,
      // así que se resuelve mirando qué le pasan sus call sites.
      return isUserJwtViaCallSites(sourceFile, scope, param, visited);
    }
  }

  const body = isSupportedFunctionLike(scope) ? scope.body : scope;
  if (body) {
    const decl = findVarDecl(body, name);
    if (decl) {
      if (decl.initializer) {
        const init = unwrapCasts(decl.initializer);
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          if (init.expression.text === "getDb") return true;
          if (init.expression.text === "getServiceDb") return false;
        }
      }
      return false;
    }
  }

  if (isSupportedFunctionLike(scope)) {
    const outer = findEnclosingFunctionLike(scope);
    if (outer) return isUserJwtClient(sourceFile, outer, name, visited);
  }
  return false;
}

/** Caso `db: SupabaseClient` (tipo genérico, sin pista): resuelve mirando qué le pasan sus call sites. */
function isUserJwtViaCallSites(
  sourceFile: ts.SourceFile,
  fn: SupportedFunctionLike,
  param: ts.ParameterDeclaration,
  visited: Set<ts.Node>,
): boolean {
  if (visited.has(fn)) return false;
  visited.add(fn);

  const fnName = getFunctionName(fn);
  if (!fnName) return false;

  const paramIndex = fn.parameters.indexOf(param);
  const callSites  = findCallSites(sourceFile, fnName);
  if (callSites.length === 0) return false;

  for (const call of callSites) {
    const argExpr = call.arguments[paramIndex];
    if (!argExpr) return false;
    const unwrapped = unwrapCasts(argExpr);

    if (ts.isCallExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
      if (unwrapped.expression.text === "getDb") continue;
      if (unwrapped.expression.text === "getServiceDb") return false;
    }
    if (ts.isIdentifier(unwrapped)) {
      const callScope = findEnclosingFunctionLike(call) ?? sourceFile;
      if (!isUserJwtClient(sourceFile, callScope, unwrapped.text, visited)) return false;
      continue;
    }
    return false;
  }
  return true;
}

// ─── INSERT/UPSERT: el tenant va en el payload, no en un .eq() ─────────────

function hasTenantIdKey(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some((p) => {
    if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
      const name = p.name;
      if (ts.isIdentifier(name) && name.text === "tenant_id") return true;
      if (ts.isStringLiteral(name) && name.text === "tenant_id") return true;
    }
    return false;
  });
}

function resolveInsertPayloadHasTenantId(argExpr: ts.Expression | undefined, scope: ts.Node): boolean {
  if (!argExpr) return false;
  const expr = unwrapCasts(argExpr);

  if (ts.isObjectLiteralExpression(expr)) {
    if (hasTenantIdKey(expr)) return true;
    for (const p of expr.properties) {
      if (ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression)) {
        if (resolveIdentifierPayloadHasTenantId(p.expression.text, scope)) return true;
      }
    }
    return false;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    if (expr.elements.length === 0) return false;
    return expr.elements.every((e) => resolveInsertPayloadHasTenantId(e, scope));
  }
  if (ts.isIdentifier(expr)) {
    return resolveIdentifierPayloadHasTenantId(expr.text, scope);
  }
  // Insert masivo armado con `.map(cb)`: la forma natural de insertar N filas
  // (`ids.map((id) => ({ tenant_id, ... }))`). Sin esto el motor no puede probar
  // nada de un array construido en runtime y lo reporta como fuga — un falso
  // positivo que empujaría a resolverlo por ALLOWLIST, que es justo lo que no
  // conviene: la allowlist apaga el chequeo para siempre, mientras que enseñarle
  // esta forma lo mantiene vigilando también las que vengan.
  if (isMapCall(expr)) {
    return mapCallbackReturnsTenantId(expr, scope);
  }
  return false;
}

/** ¿`<algo>.map(...)` con exactamente un argumento (el callback)? */
function isMapCall(expr: ts.Expression): expr is ts.CallExpression {
  return (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "map" &&
    expr.arguments.length === 1
  );
}

/**
 * ¿El callback de un `.map()` devuelve filas con `tenant_id`?
 *
 * Cubre las dos formas de escribirlo: la concisa —`(x) => ({ ... })`, donde el
 * cuerpo ES el objeto— y la de bloque con `return { ... }`. Cualquier otra
 * forma devuelve `false` y el motor sigue reportando: ante la duda, se avisa.
 */
function mapCallbackReturnsTenantId(call: ts.CallExpression, scope: ts.Node): boolean {
  const cb = unwrapCasts(call.arguments[0] as ts.Expression);
  if (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb)) return false;

  if (ts.isArrowFunction(cb) && !ts.isBlock(cb.body)) {
    return resolveInsertPayloadHasTenantId(cb.body, scope);
  }

  const body = cb.body;
  if (!body || !ts.isBlock(body)) return false;

  // Todo `return` con valor tiene que traer el tenant; uno solo que no lo traiga
  // basta para que la fila pueda salir sin él.
  const returns: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    // No se entra a funciones anidadas: sus `return` son de OTRA función.
    if (isSupportedFunctionLike(n) && n !== cb) return;
    if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);

  if (returns.length === 0) return false;
  return returns.every((r) => resolveInsertPayloadHasTenantId(r, scope));
}

function resolveIdentifierPayloadHasTenantId(name: string, scope: ts.Node): boolean {
  const fnScope  = isSupportedFunctionLike(scope) ? scope : findEnclosingFunctionLike(scope);
  const body     = fnScope ? fnScope.body : undefined;
  const searchRoot: ts.Node = body ?? scope.getSourceFile();
  const decl = findVarDecl(searchRoot, name);
  if (!decl || !decl.initializer) return false;
  return resolveInsertPayloadHasTenantId(decl.initializer, scope);
}

// ─── Scan principal ─────────────────────────────────────────────────────────

export interface Violation {
  table:   string;
  line:    number;
  snippet: string;
}

export function scanSourceForViolations(
  sourceFileName: string,
  sourceText: string,
  tenantTables: ReadonlySet<string>,
): Violation[] {
  const sourceFile = ts.createSourceFile(sourceFileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functionIndex = buildFunctionIndex(sourceFile);
  const violations: Violation[] = [];

  const fromCalls: ts.CallExpression[] = [];
  const collectFrom = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from"
    ) {
      fromCalls.push(node);
    }
    ts.forEachChild(node, collectFrom);
  };
  collectFrom(sourceFile);

  for (const fromCall of fromCalls) {
    const propAccess = fromCall.expression as ts.PropertyAccessExpression;
    const objectExpr = propAccess.expression;

    // `<cliente>.storage.from(bucket)` es Supabase Storage, no una tabla de DB.
    if (ts.isPropertyAccessExpression(objectExpr) && objectExpr.name.text === "storage") continue;

    const arg0 = fromCall.arguments[0];
    const tableName = arg0 && ts.isStringLiteralLike(arg0) ? arg0.text : null;

    // Nombre de tabla dinámico o desconocido: se trata como tabla de tenant
    // (fail-safe) salvo que se pueda confirmar lo contrario.
    const isTenantTable = tableName === null || tenantTables.has(tableName);
    if (!isTenantTable) continue;

    if (ts.isIdentifier(objectExpr)) {
      const scope = findEnclosingFunctionLike(fromCall) ?? sourceFile;
      if (isUserJwtClient(sourceFile, scope, objectExpr.text)) continue; // RLS activa, fuera de alcance
    }

    const { top, methods } = walkChainUp(fromCall);
    const writeCall = methods.find((m) => m.name === "insert" || m.name === "upsert");

    let filtered: boolean;
    if (writeCall) {
      const scope = findEnclosingFunctionLike(fromCall) ?? sourceFile;
      filtered = resolveInsertPayloadHasTenantId(writeCall.args[0], scope);
    } else {
      filtered = chainHasTenantEq(methods);
      if (!filtered) {
        const parent = top.parent;
        if (
          parent &&
          ts.isVariableDeclaration(parent) &&
          parent.initializer === top &&
          ts.isIdentifier(parent.name)
        ) {
          const scope = findEnclosingFunctionLike(parent) ?? sourceFile;
          const body  = isSupportedFunctionLike(scope) ? scope.body : scope;
          if (body) {
            filtered = traceVariableForTenantFilter(body, parent.name.text, functionIndex);
          }
        }
      }
    }

    if (!filtered) {
      const pos = sourceFile.getLineAndCharacterOfPosition(propAccess.name.getStart(sourceFile));
      violations.push({
        table:   tableName ?? "(dinámica)",
        line:    pos.line + 1,
        snippet: fromCall.getText(sourceFile).replace(/\s+/g, " ").slice(0, 140),
      });
    }
  }

  return violations;
}
