/**
 * BLOQUEANTE — Guardrails estáticos del frontend.
 *
 * Contexto. El backend cierra sus reglas transversales con tests de análisis
 * estático que escanean los fuentes y fallan sobre la CLASE de defecto, no
 * sobre la instancia conocida: `tests/unit/tenant-filter-guardrail.test.ts`,
 * `tests/unit/stock-ledger-guardrail.test.ts`, `tests/unit/audit-modulo-enum.test.ts`.
 * El frontend no tenía ninguno, y por eso dos defectos de la auditoría pasaron
 * inadvertidos: siete casts `as any` que apagaban el typecheck sobre huecos
 * reales de contrato (C3) y una pantalla con copy prohibido por §2.6 que era la
 * única sin el test de §2.6 (C5). Las dos reglas existían; lo que faltaba era
 * que algo las hiciera cumplir sin depender de que alguien se acuerde de
 * escribir el test en cada pantalla nueva.
 *
 * ES SINTÁCTICO, NO SEMÁNTICO. Los tres motores de detección de este archivo
 * miran la FORMA del código —¿aparece el texto `as any`?, ¿aparece la palabra
 * "comprobante"?, ¿este `{error}` está adentro de un `<Alert>`?— y nunca su
 * significado. No ejecutan nada ni montan componentes: leen los fuentes con
 * readFileSync/readdirSync. De que la pantalla efectivamente muestre el error
 * correcto, o de que el copy tenga sentido, se ocupan los tests por pantalla.
 * El objetivo acá es más angosto y más barato de sostener: que nadie OLVIDE la
 * regla en un archivo nuevo.
 *
 * FAIL-SAFE. Ante una forma que el detector no sabe resolver, la trata como
 * violación y obliga a decidir explícitamente (arreglarla o allowlistearla con
 * el motivo escrito), en vez de saltearla en silencio. Por eso las reglas 1 y 2
 * también miran adentro de comentarios y strings: un `as any` comentado o el
 * copy prohibido dentro de un literal cuentan igual.
 *
 * VERIFICACIÓN POR MUTACIÓN, PERMANENTE. Cada motor tiene su describe con
 * fragmentos sintéticos —uno que viola la regla y uno que la cumple— que viven
 * en la suite. Un guardrail que sólo se probó a mano el día que se escribió no
 * tiene cómo avisar si mañana deja de detectar: el caso positivo sintético es
 * lo que impide que este archivo se vuelva un falso verde.
 *
 * ALCANCE DE LAS REGLAS 1 Y 2: sólo fuentes de producción, no `*.test.tsx`.
 * El motivo es que en los tests las dos formas son legítimas y necesarias: un
 * `as any` es la única manera de asertar que un campo NO viaja en el payload
 * (`expect((callArgs as any).tenantId).toBeUndefined()`), y el test de §2.6 de
 * cada pantalla tiene que nombrar las palabras prohibidas para poder asertar
 * que no aparecen. Escanear los tests obligaría a una allowlist de una docena
 * de archivos, todos del mismo tipo legítimo, que es justamente la forma
 * elegante de desactivar el test.
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(process.cwd(), "src");

/** Directorios bajo el alcance de las reglas 1 y 2. */
const DIRECTORIOS_VIGILADOS = [
  "pages",
  "components/comercial",
  "components/historial",
];

interface Fuente {
  ruta:      string;
  contenido: string;
}

function esTest(nombre: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(nombre);
}

/**
 * Lista los fuentes de un directorio del alcance. `incluirTests` en false deja
 * afuera los `*.test.tsx` (ver ALCANCE en el encabezado del archivo).
 */
function listarFuentes(subdir: string, incluirTests: boolean): Fuente[] {
  const base = join(SRC_DIR, ...subdir.split("/"));
  const resultado: Fuente[] = [];

  function recorrer(dir: string) {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const completo = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(completo);
        continue;
      }
      if (![".ts", ".tsx"].includes(extname(entrada.name))) continue;
      if (!incluirTests && esTest(entrada.name)) continue;
      resultado.push({
        ruta:      relative(process.cwd(), completo).split(sep).join("/"),
        contenido: readFileSync(completo, "utf-8"),
      });
    }
  }

  recorrer(base);
  return resultado;
}

function fuentesVigiladas(incluirTests = false): Fuente[] {
  return DIRECTORIOS_VIGILADOS.flatMap((d) => listarFuentes(d, incluirTests));
}

interface Hallazgo {
  linea: number;
  texto: string;
}

function formatearHallazgos(ruta: string, hallazgos: Hallazgo[]): string {
  return hallazgos.map((h) => `  ${ruta}:${h.linea}  ${h.texto.trim()}`).join("\n");
}

// ─── Regla 1 — motor: casts que apagan el typecheck ─────────────────────────

/**
 * Sintáctico: busca el texto `as any` y `as unknown as Record`. No distingue
 * código de comentario ni de string, a propósito (fail-safe).
 */
export function detectarCasts(contenido: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  contenido.split("\n").forEach((linea, i) => {
    if (/\bas\s+any\b/.test(linea) || /\bas\s+unknown\s+as\s+Record\b/.test(linea)) {
      hallazgos.push({ linea: i + 1, texto: linea });
    }
  });
  return hallazgos;
}

/**
 * Excepciones de la regla 1. Cada entrada dice por qué ese caso es legítimo;
 * una entrada sin motivo escrito es una forma elegante de apagar el test.
 * Hoy está vacía: los siete casts de producción que encontró la auditoría se
 * corrigieron arreglando el hueco de contrato que tapaban, no allowlisteándolos.
 */
const ALLOWLIST_CASTS: Array<{ archivo: string; motivo: string }> = [];

// ─── Regla 2 — motor: copy prohibido por §2.6 ───────────────────────────────

const PALABRAS_PROHIBIDAS = ["comprobante", "factura", "ticket", "recibo"] as const;

/**
 * Quita comentarios de línea y de bloque (incluidos los `{/* ... *\/}` de JSX)
 * para que la regla 2 mire sólo copy que el usuario puede llegar a ver. Sin
 * esto, un comentario que NOMBRA la regla —"§2.6: Operación N°, nunca
 * Comprobante ni Factura"— se reporta como si fuera una violación de ella.
 *
 * El `//` no se corta cuando viene después de ':' para no romper una URL
 * dentro de un string ("https://..."): ante la duda se conserva el texto, que
 * es el lado fail-safe (se analiza de más, no de menos).
 */
export function quitarComentarios(contenido: string): string {
  return contenido
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linea) => linea.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * Sintáctico: busca las cuatro palabras de §2.6, sin distinguir mayúsculas,
 * como PALABRA COMPLETA y fuera de los comentarios.
 *
 * Se detecta la palabra y no sólo la forma "Comprobante N°": una pantalla que
 * diga "Comprobante de venta" viola §2.6 igual, y limitar el motor a la forma
 * con "N°" la dejaría pasar. Es el mismo criterio de los tests de §2.6 por
 * pantalla, que asertan /comprobante|factura|ticket|recibo/i contra el texto
 * renderizado.
 *
 * Los límites de palabra son los que hacen que este motor sirva sobre el
 * fuente y no sólo sobre el DOM: dejan afuera los identificadores del dominio
 * que contienen una de las cuatro sin nombrarla ("ticketPromedio", el ticket
 * promedio de venta; "facturación", la relación con el proveedor). Ninguno de
 * los dos le dice al usuario que el sistema emite un comprobante fiscal, que
 * es lo que §2.6 protege.
 */
export function detectarCopyProhibido(contenido: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const regex = new RegExp(`\\b(${PALABRAS_PROHIBIDAS.join("|")})\\b`, "i");
  quitarComentarios(contenido).split("\n").forEach((linea, i) => {
    if (regex.test(linea)) hallazgos.push({ linea: i + 1, texto: linea });
  });
  return hallazgos;
}

/**
 * Excepciones de la regla 2, acotadas al comprobante EXTERNO del proveedor.
 * En una compra, el comprobante es un documento real que emite el proveedor y
 * que la clínica transcribe (tipo y número): no es el `numero_operacion` del
 * sistema, que es lo que §2.6 protege. Llamarlo de otra forma sería mentirle
 * al usuario sobre qué está copiando del papel que tiene en la mano.
 */
const ALLOWLIST_COPY: Array<{ archivo: string; motivo: string }> = [
  {
    archivo: "src/pages/ComprasPage.tsx",
    motivo:
      "Campos 'Tipo Comprobante' y 'N° Comprobante' del alta de compra, y la columna " +
      "'Comprobante Proveedor' del listado: transcriben el documento que emitió el proveedor " +
      "(comprobanteProveedorTipo / comprobanteProveedorNumero), no el numero_operacion propio.",
  },
  {
    archivo: "src/pages/CompraDetallePage.tsx",
    motivo:
      "Bloque 'Comprobante Proveedor' del detalle de compra: muestra el tipo y número del " +
      "documento del proveedor cargado en el alta. Mismo motivo que ComprasPage.tsx.",
  },
];

// ─── Regla 3 — motor: el error de la pantalla se anuncia ────────────────────

/**
 * Sintáctico y con estado. Marca como violación cada render JSX de la variable
 * de error de la pantalla que quede fuera de una "región de alerta": el
 * subárbol de un `<Alert>` del kit (que trae `role="alert"` de fábrica, ver
 * components/ui/alert.tsx:30) o el de cualquier elemento con `role="alert"`
 * propio.
 *
 * Para saber dónde termina esa región lleva la profundidad del JSX contando
 * aperturas, cierres y etiquetas autocerradas, y cierra la región cuando la
 * profundidad vuelve al nivel en el que se abrió. Antes de contar, junta las
 * etiquetas de apertura partidas en varias líneas (`<div` / `role="alert"` /
 * `className=...` / `>`), que son la forma habitual en este repo: sin ese paso
 * el `role="alert"` queda en una línea distinta de la apertura y no se asocia
 * con nada.
 *
 * "Render JSX de la variable de error" = una expresión `{error}` / `{errorX}`
 * usada como contenido de un elemento. Deliberadamente NO incluye accesos a
 * propiedad (`{errores.codigo}`): esos son los errores por campo de un
 * formulario, otra cosa, que cada pantalla ya renderiza con su propio
 * `role="alert"`. Tampoco incluye el error pasado como prop (`mensaje={error}`),
 * porque ahí quien lo muestra es el componente hijo.
 *
 * Límite conocido: la profundidad se cuenta con una heurística de texto, no con
 * un parser de TSX. Excluye los genéricos (`useState<string | null>`) exigiendo
 * que el `<` no venga pegado a un identificador, pero una forma rara podría
 * descontarla mal. El número de línea que informa es el de la apertura de la
 * unidad, que con etiquetas multilínea es la primera de las juntadas.
 */
interface UnidadJsx {
  linea: number;
  texto: string;
}

/** Junta cada etiqueta de apertura partida en varias líneas en una sola unidad. */
export function unificarEtiquetas(lineas: string[]): UnidadJsx[] {
  const unidades: UnidadJsx[] = [];
  let i = 0;
  while (i < lineas.length) {
    const inicio = i;
    let texto = lineas[i] ?? "";
    // Una etiqueta abierta cuyo '>' todavía no apareció se sigue en la línea siguiente.
    while (/<[A-Za-z][^>]*$/.test(texto) && i + 1 < lineas.length) {
      i++;
      texto += " " + (lineas[i] ?? "").trim();
    }
    unidades.push({ linea: inicio + 1, texto });
    i++;
  }
  return unidades;
}

function saldoDeProfundidad(texto: string): number {
  // '<' pegado a un identificador es un genérico de TypeScript, no una etiqueta.
  const aperturas    = texto.match(/(?:^|[^A-Za-z0-9_$])<[A-Za-z][A-Za-z0-9.]*/g)?.length ?? 0;
  const autocerradas = texto.match(/\/>/g)?.length ?? 0;
  const cierres      = texto.match(/<\/[A-Za-z]/g)?.length ?? 0;
  return aperturas - autocerradas - cierres;
}

export function detectarErroresSinAnunciar(contenido: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const renderDeError = /\{\s*(error[A-Za-z0-9_]*)\s*\}/;

  let profundidad = 0;
  let regionAlerta: number | null = null;

  for (const unidad of unificarEtiquetas(contenido.split("\n"))) {
    const { linea, texto } = unidad;
    const profundidadPrevia = profundidad;

    const roleAlerta   = /role\s*=\s*["']alert["']/.test(texto);
    const alertDelKit  = /(?:^|[^A-Za-z0-9_$])<Alert(?![A-Za-z])/.test(texto);
    const etiquetaAlert = /(?:^|[^A-Za-z0-9_$])<Alert[A-Za-z]*/.test(texto);
    const abreAlerta   = roleAlerta || alertDelKit;

    const coincide = renderDeError.exec(texto);
    if (coincide) {
      const antes = texto.slice(0, coincide.index);
      // Contenido de un elemento (viene después de un '>') o expresión suelta.
      // Descarta props (`mensaje={error}`) y lógica JS (`if (error)`).
      const esContenidoJsx = />\s*$/.test(antes) || antes.trim() === "";
      const protegido = regionAlerta !== null || abreAlerta || etiquetaAlert;
      if (esContenidoJsx && !protegido) {
        hallazgos.push({ linea, texto });
      }
    }

    profundidad = Math.max(0, profundidad + saldoDeProfundidad(texto));

    if (regionAlerta !== null && profundidad <= regionAlerta) regionAlerta = null;
    if (regionAlerta === null && abreAlerta && profundidad > profundidadPrevia) {
      regionAlerta = profundidadPrevia;
    }
  }

  return hallazgos;
}

/**
 * Excepciones de la regla 3.
 *
 * Las catorce entradas son el MISMO defecto en trece pantallas de etapas
 * anteriores al Módulo Comercial: el error del estado se renderiza en un
 * `<p className="text-sm text-destructive">{error}</p>` pelado, sin
 * `role="alert"` ni el Alert del kit, así que un lector de pantalla no anuncia
 * la falla y el usuario que no ve la pantalla se queda esperando datos que no
 * van a llegar. El defecto es real y cada entrada dice de qué pantalla y de qué
 * etapa es; corregirlas excede el alcance de esta corrección de auditoría, que
 * es el frontend del Módulo Comercial (CLAUDE.md: no refactorizar otras etapas
 * sin pedirlo). Las tres instancias que sí estaban en alcance —los errores de
 * los diálogos de anulación y devolución de VentaDetallePage— se corrigieron.
 *
 * La excepción es por archivo Y por texto exacto de la línea: una violación
 * NUEVA o distinta en cualquiera de estas pantallas sigue rompiendo el test.
 * La allowlist tapa la deuda conocida, no el archivo entero.
 *
 * Es una allowlist grande y de una sola clase. Eso no es una excusa escrita
 * catorce veces: es la señal de que corresponde una tanda que las cierre de una
 * vez —el arreglo es envolver el `<p>` en `<Alert variant="destructive">` o
 * ponerle `role="alert"`— y no que se le sigan sumando entradas.
 */
const ALLOWLIST_ERRORES: Array<{ archivo: string; texto: string; motivo: string }> = [
  {
    archivo: "src/pages/ClientesPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 2 (Clientes): error del listado. Ver el bloque `) : error ? (` de la tabla.",
  },
  {
    archivo: "src/pages/MascotasPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 3 (Mascotas): error del listado. Mismo bloque `) : error ? (` de la tabla.",
  },
  {
    archivo: "src/pages/UsuariosPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 1 (Usuarios y roles): error del listado de usuarios del tenant.",
  },
  {
    archivo: "src/pages/DoctoresPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 1 (Doctores): error del listado de profesionales.",
  },
  {
    archivo: "src/pages/ServiciosPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 1 (Servicios): error del listado del catálogo de servicios.",
  },
  {
    archivo: "src/pages/HorariosPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 5 (Agenda): error de la grilla de horarios de atención.",
  },
  {
    archivo: "src/pages/AuditoriaPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 1 (Auditoría): error del listado de registros_auditoria.",
  },
  {
    archivo: "src/pages/DashboardPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 1 (Dashboard): error del resumen de métricas de la portada.",
  },
  {
    archivo: "src/pages/HistorialClinicoIndexPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 4 (Historial clínico): error del índice de mascotas con historial.",
  },
  {
    archivo: "src/pages/HistorialClinicoPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 4 (Historial clínico): error de la línea de tiempo del historial.",
  },
  {
    archivo: "src/pages/ConfiguracionPage.tsx",
    texto:   '<p className="text-sm text-destructive">{error}</p>',
    motivo:  
      "Etapa 1 (Configuración del tenant): error de la carga de los ajustes.",
  },
  {
    archivo: "src/pages/AgendarTurnoPage.tsx",
    texto:   '<p className="text-sm text-destructive">{errorTurno}</p>',
    motivo:  
      "Etapa 6 (Turnos): error del alta de turno en el formulario de agendado.",
  },
  {
    archivo: "src/pages/AgendarTurnoPage.tsx",
    texto:   '<p className="text-sm text-destructive">{errorMascotas}</p>',
    motivo:  
      "Etapa 6 (Turnos): error de la carga de mascotas del cliente elegido.",
  },
  {
    archivo: "src/pages/RegistrarEstadiaPage.tsx",
    texto:   '<p className="text-sm text-destructive">{errorMascotas}</p>',
    motivo:  
      "Etapa 7 (Guardería): error de la carga de mascotas al registrar una estadía.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Verificación por mutación de los motores (permanente, no manual)
// ═══════════════════════════════════════════════════════════════════════════

describe("motor de detección — regla 1 (casts)", () => {
  it("detecta `as any` y nombra la línea", () => {
    const hallazgos = detectarCasts(['const a = 1;', 'const b = (x as any).campo;'].join("\n"));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.linea).toBe(2);
  });

  it("detecta `as unknown as Record`", () => {
    const hallazgos = detectarCasts('const r = item as unknown as Record<string, unknown>;');
    expect(hallazgos).toHaveLength(1);
  });

  it("no marca código limpio", () => {
    expect(detectarCasts('const nombre = item.producto?.nombre ?? "Insumo";')).toHaveLength(0);
  });

  it("no confunde identificadores que contienen 'any' ni un `as` de tipo concreto", () => {
    expect(detectarCasts('const company = x as Empresa;\nconst anyway = 1;')).toHaveLength(0);
  });
});

describe("motor de detección — regla 2 (copy prohibido §2.6)", () => {
  it.each(PALABRAS_PROHIBIDAS)("detecta '%s'", (palabra) => {
    const hallazgos = detectarCopyProhibido(`<TableHead>${palabra} N°</TableHead>`);
    expect(hallazgos).toHaveLength(1);
  });

  it("detecta la palabra aunque no venga con 'N°'", () => {
    expect(detectarCopyProhibido("<span>Comprobante de venta</span>")).toHaveLength(1);
  });

  it("detecta el copy escondido en un atributo, no sólo en el texto", () => {
    expect(detectarCopyProhibido('placeholder="N° de comprobante / operación"')).toHaveLength(1);
  });

  it("no marca el copy correcto", () => {
    expect(detectarCopyProhibido('placeholder="N° de autorización o transferencia"')).toHaveLength(0);
    expect(detectarCopyProhibido("<span>Operación N° 1234</span>")).toHaveLength(0);
  });
});

describe("motor de detección — regla 3 (el error se anuncia)", () => {
  it("marca el error renderizado en un <p> pelado", () => {
    const jsx = '<p className="text-sm text-destructive">{error}</p>';
    const hallazgos = detectarErroresSinAnunciar(jsx);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.linea).toBe(1);
  });

  it("marca el error renderizado en un <div> pelado", () => {
    expect(
      detectarErroresSinAnunciar('<div className="text-sm font-medium text-destructive">{error}</div>'),
    ).toHaveLength(1);
  });

  it("acepta el error adentro del Alert del kit, aunque el <span> interno no traiga role", () => {
    const jsx = [
      '<Alert variant="destructive">',
      '  <AlertCircle className="size-4" />',
      '  <AlertDescription>',
      '    <span>{error}</span>',
      '  </AlertDescription>',
      '</Alert>',
    ].join("\n");
    expect(detectarErroresSinAnunciar(jsx)).toHaveLength(0);
  });

  it("acepta un role=\"alert\" propio en la misma etiqueta", () => {
    expect(detectarErroresSinAnunciar('<p role="alert">{error}</p>')).toHaveLength(0);
  });

  it("acepta la apertura con role=\"alert\" en la línea anterior", () => {
    const jsx = ['<p role="alert" className="text-xs text-destructive">', "  {error}", "</p>"].join("\n");
    expect(detectarErroresSinAnunciar(jsx)).toHaveLength(0);
  });

  it("vuelve a marcar después de cerrar el <Alert> (no se queda 'adentro' para siempre)", () => {
    const jsx = [
      "<Alert>",
      "  <AlertDescription>{errorCarga}</AlertDescription>",
      "</Alert>",
      '<p className="text-destructive">{error}</p>',
    ].join("\n");
    const hallazgos = detectarErroresSinAnunciar(jsx);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.linea).toBe(4);
  });

  it("no marca el error pasado como prop ni la lógica que lo consulta", () => {
    expect(detectarErroresSinAnunciar("<Componente mensaje={error} />")).toHaveLength(0);
    expect(detectarErroresSinAnunciar("if (error) { setError(null); }")).toHaveLength(0);
  });

  it("no marca los errores por campo de un formulario (acceso a propiedad)", () => {
    expect(detectarErroresSinAnunciar("<p>{errores.codigo}</p>")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// El guardrail efectivamente ve los archivos (si escanea cero, es falso verde)
// ═══════════════════════════════════════════════════════════════════════════

describe("BLOQUEANTE: el guardrail alcanza los fuentes que dice alcanzar", () => {
  it.each(DIRECTORIOS_VIGILADOS)("encuentra fuentes de producción en src/%s", (subdir) => {
    const fuentes = listarFuentes(subdir, false);
    expect(
      fuentes.length,
      `El guardrail no encontró ningún fuente en src/${subdir}. Si el directorio se ` +
      `movió o se renombró, las tres reglas quedan sin alcance sobre él y este archivo ` +
      `pasa en verde sin verificar nada.`,
    ).toBeGreaterThan(0);
  });

  it("las pantallas del Módulo Comercial están en el alcance", () => {
    const rutas = fuentesVigiladas().map((f) => f.ruta);
    for (const pantalla of [
      "src/pages/MostradorPage.tsx",
      "src/pages/CajaPage.tsx",
      "src/pages/ProductosPage.tsx",
      "src/pages/VentaDetallePage.tsx",
      "src/components/historial/ConsumoInsumosWidget.tsx",
    ]) {
      expect(rutas, `${pantalla} quedó fuera del alcance del guardrail.`).toContain(pantalla);
    }
  });

  it("toda entrada de allowlist apunta a un archivo que existe y tiene su motivo escrito", () => {
    const rutas = new Set(fuentesVigiladas().map((f) => f.ruta));
    const todas = [...ALLOWLIST_CASTS, ...ALLOWLIST_COPY, ...ALLOWLIST_ERRORES];
    for (const entrada of todas) {
      expect(rutas, `La allowlist nombra ${entrada.archivo}, que ya no está en el alcance: ` +
        `sobra la excepción o se movió el archivo.`).toContain(entrada.archivo);
      expect(
        entrada.motivo.trim().length,
        `La entrada de allowlist para ${entrada.archivo} no tiene motivo escrito. Una ` +
        `allowlist sin motivo por entrada es una forma elegante de apagar el test.`,
      ).toBeGreaterThan(30);
    }
  });

  it("ninguna entrada de ALLOWLIST_ERRORES quedó muerta (la deuda que tapaba ya se pagó)", () => {
    const porArchivo = new Map(listarFuentes("pages", false).map((f) => [f.ruta, f.contenido]));
    for (const entrada of ALLOWLIST_ERRORES) {
      const contenido = porArchivo.get(entrada.archivo) ?? "";
      const sigueViolando = detectarErroresSinAnunciar(contenido)
        .some((h) => h.texto.trim() === entrada.texto);
      expect(
        sigueViolando,
        `La excepción para ${entrada.archivo} ya no corresponde a ninguna violación: la ` +
        `pantalla se corrigió y la entrada quedó muerta. Borrala, o la allowlist se ` +
        `convierte en una lista de permisos que nadie vuelve a mirar.`,
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Las tres reglas, contra el árbol real
// ═══════════════════════════════════════════════════════════════════════════

describe("BLOQUEANTE: reglas transversales del frontend", () => {
  it("Regla 1 — ningún fuente de pantalla usa `as any` ni `as unknown as Record`", () => {
    const permitidos = new Set(ALLOWLIST_CASTS.map((e) => e.archivo));
    const infractores: string[] = [];

    for (const fuente of fuentesVigiladas()) {
      if (permitidos.has(fuente.ruta)) continue;
      const hallazgos = detectarCasts(fuente.contenido);
      if (hallazgos.length > 0) infractores.push(formatearHallazgos(fuente.ruta, hallazgos));
    }

    expect(
      infractores,
      "Hay casts que apagan el typecheck en pantallas del frontend. Un `as any` no arregla " +
      "un desajuste de tipos: lo esconde, y lo que queda escondido es un hueco de contrato " +
      "con la API (el caso C3 de la auditoría: seis fallbacks que nunca corrían y una columna " +
      "que renderizaba '—' siempre). Sacá el cast y arreglá lo que denuncie el compilador; si " +
      "el caso es legítimo, agregalo a ALLOWLIST_CASTS con el motivo escrito al lado.\n" +
      infractores.join("\n"),
    ).toEqual([]);
  });

  it("Regla 2 — ningún fuente de pantalla usa el copy prohibido por §2.6", () => {
    const permitidos = new Set(ALLOWLIST_COPY.map((e) => e.archivo));
    const infractores: string[] = [];

    for (const fuente of fuentesVigiladas()) {
      if (permitidos.has(fuente.ruta)) continue;
      const hallazgos = detectarCopyProhibido(fuente.contenido);
      if (hallazgos.length > 0) infractores.push(formatearHallazgos(fuente.ruta, hallazgos));
    }

    expect(
      infractores,
      "§2.6: el sistema no emite comprobantes fiscales, así que la UI no habla de " +
      "'comprobante', 'factura', 'ticket' ni 'recibo'. El identificador propio es " +
      "'Operación N°'. La única excepción es el comprobante EXTERNO del proveedor en las " +
      "pantallas de compras, que está en ALLOWLIST_COPY. Si aparece otro caso legítimo, " +
      "agregalo ahí con el motivo escrito al lado.\n" +
      infractores.join("\n"),
    ).toEqual([]);
  });

  it("Regla 3 — toda pantalla con `setError(` anuncia su error con role=\"alert\" o el Alert del kit", () => {
    const permitidos = new Set(ALLOWLIST_ERRORES.map((e) => `${e.archivo}::${e.texto}`));
    const infractores: string[] = [];

    for (const fuente of listarFuentes("pages", false)) {
      if (!fuente.contenido.includes("setError(")) continue;
      const hallazgos = detectarErroresSinAnunciar(fuente.contenido)
        .filter((h) => !permitidos.has(`${fuente.ruta}::${h.texto.trim()}`));
      if (hallazgos.length > 0) infractores.push(formatearHallazgos(fuente.ruta, hallazgos));
    }

    expect(
      infractores,
      "Hay pantallas que renderizan el error de su estado en un elemento pelado. Sin " +
      "role=\"alert\" (que el Alert del kit trae de fábrica, components/ui/alert.tsx:30) un " +
      "lector de pantalla no anuncia la falla: el usuario que no ve la pantalla se queda " +
      "esperando datos que nunca van a llegar. Envolvé el error en <Alert variant=\"destructive\"> " +
      "o poné role=\"alert\" en la etiqueta que lo muestra.\n" +
      infractores.join("\n"),
    ).toEqual([]);
  });
});
