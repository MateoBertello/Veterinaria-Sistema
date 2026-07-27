import { DomainError, ErrorCode } from "./errors.ts";

/**
 * Verificación de la FIRMA de los JWT de Supabase Auth.
 *
 * Por qué existe este módulo
 * ──────────────────────────
 * La Edge Function corre con `verify_jwt = false` (supabase/config.toml): tiene
 * que atender `/auth/login`, que por definición llega sin token. Eso significa
 * que el gateway NO valida nada y la función es públicamente alcanzable.
 * Mientras los middlewares se limitaron a DECODIFICAR el payload (base64, sin
 * criptografía), cualquiera podía fabricar un token con los claims que quisiera.
 *
 * En las rutas de tenant el daño estaba acotado porque toda consulta va a
 * PostgREST con ese mismo token y PostgREST sí verifica la firma. Pero
 * `/admin/*` opera con `service_role` (RLS bypasseada) y confiaba únicamente en
 * el claim `app_metadata.platform_role` decodificado: un token inventado
 * entregaba la consola de plataforma completa. Este módulo cierra eso.
 *
 * Algoritmos soportados
 * ─────────────────────
 * Supabase emite hoy JWT ASIMÉTRICOS (ES256, curva P-256) y publica la clave
 * pública en el JWKS del proyecto; los proyectos antiguos todavía usan HS256
 * con el secreto compartido. Se soportan los dos:
 *
 *   • ES256 / RS256 → clave pública del JWKS (`SUPABASE_URL` + ruta estándar),
 *     cacheada en memoria y refrescada ante un `kid` desconocido (rotación).
 *   • HS256        → `SUPABASE_JWT_SECRET`. Si no está seteado y llega un token
 *     HS256, se rechaza: es preferible un 401 a validar contra nada.
 *
 * Se usa Web Crypto (disponible en Deno y en Node ≥18), sin dependencias nuevas.
 */

// ─── Configuración ────────────────────────────────────────────────────────────

/** Algoritmos aceptados. `none` y cualquier otro se rechazan explícitamente. */
const ALGORITMOS_SOPORTADOS = ["ES256", "RS256", "HS256"] as const;
type AlgoritmoSoportado = (typeof ALGORITMOS_SOPORTADOS)[number];

/** Tolerancia de reloj para `exp`/`nbf` (segundos). */
const TOLERANCIA_RELOJ_S = 5;

/** TTL del JWKS en memoria. */
const JWKS_TTL_MS = 10 * 60 * 1000;

/** Piso entre dos refetch del JWKS ante `kid` desconocido (anti-estampida). */
const JWKS_REFETCH_COOLDOWN_MS = 30 * 1000;

function getEnv(key: string): string | undefined {
  const value = process.env[key] ?? (globalThis as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub?:           string;
  exp?:           number;
  nbf?:           number;
  iat?:           number;
  email?:         string;
  role?:          string;
  app_metadata?:  Record<string, unknown>;
  [claim: string]: unknown;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

// ─── Caché de claves ──────────────────────────────────────────────────────────

let jwksCache:      { keys: Jwk[]; fetchedAt: number } | null = null;
let jwksEnVuelo:    Promise<Jwk[]> | null = null;
let ultimoRefetchAt = 0;

/** CryptoKey ya importada, por `kid` (importar es caro y se repite por request). */
const cryptoKeyCache = new Map<string, CryptoKey>();

/** Limpia las cachés de claves. Para tests y para rotaciones forzadas. */
export function resetJwtKeyCache(): void {
  jwksCache       = null;
  jwksEnVuelo     = null;
  ultimoRefetchAt = 0;
  cryptoKeyCache.clear();
}

// ─── Utilidades de codificación ───────────────────────────────────────────────

/**
 * Devuelve un `ArrayBuffer` (no un `Uint8Array`) porque es lo que consume
 * `crypto.subtle` sin pelearse con los tipos de `BufferSource`.
 *
 * Devuelve `null` si el segmento no es base64url válido. Importa que NO lance:
 * `atob` tira `InvalidCharacterError`, y un token basura tiene que terminar en
 * un 401 limpio — no en un 500 que además dispara una alerta de Sentry por algo
 * que es, simplemente, alguien mandando un token mal formado.
 */
function base64UrlADecodificado(input: string): ArrayBuffer | null {
  try {
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binario = typeof atob !== "undefined"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");

    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

/** Idem para texto plano (cabecera+payload a firmar, secreto HS256). */
function textoADecodificado(texto: string): ArrayBuffer {
  const codificado = new TextEncoder().encode(texto);
  const copia = new Uint8Array(codificado.length);
  copia.set(codificado);
  return copia.buffer;
}

function base64UrlAJson(input: string): Record<string, unknown> | null {
  try {
    const bytes = base64UrlADecodificado(input);
    if (!bytes) return null;

    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function noAutorizado(mensaje: string): DomainError {
  // Mensaje deliberadamente parco: el cliente no necesita saber si falló la
  // firma, el `exp` o el `kid`, y detallarlo ayuda a quien esté probando.
  return new DomainError(ErrorCode.UNAUTHORIZED, 401, mensaje);
}

// ─── JWKS ─────────────────────────────────────────────────────────────────────

function urlDelJwks(): string {
  const base = getEnv("SUPABASE_URL");
  if (!base) throw new Error("Variable de entorno requerida: SUPABASE_URL");
  return `${base.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
}

async function descargarJwks(): Promise<Jwk[]> {
  const respuesta = await fetch(urlDelJwks(), { headers: { Accept: "application/json" } });
  if (!respuesta.ok) {
    throw new Error(`JWKS respondió ${respuesta.status}`);
  }
  const cuerpo = await respuesta.json() as { keys?: Jwk[] };
  if (!Array.isArray(cuerpo?.keys)) {
    throw new Error("JWKS sin arreglo `keys`");
  }
  return cuerpo.keys;
}

/**
 * JWKS del proyecto, cacheado. `forzarRefresh` lo re-descarga (rotación de
 * claves: aparece un `kid` que todavía no teníamos), con un cooldown para que
 * una andanada de tokens con `kid` inventado no se convierta en una andanada de
 * requests al endpoint de JWKS.
 */
async function obtenerJwks(forzarRefresh = false): Promise<Jwk[]> {
  const ahora = Date.now();
  const vigente = jwksCache && ahora - jwksCache.fetchedAt < JWKS_TTL_MS;

  if (vigente && !forzarRefresh) return jwksCache!.keys;

  if (forzarRefresh && vigente && ahora - ultimoRefetchAt < JWKS_REFETCH_COOLDOWN_MS) {
    return jwksCache!.keys;
  }

  // Una sola descarga concurrente: el resto de los requests espera la misma.
  if (!jwksEnVuelo) {
    ultimoRefetchAt = ahora;
    jwksEnVuelo = descargarJwks()
      .then((keys) => {
        jwksCache = { keys, fetchedAt: Date.now() };
        return keys;
      })
      .finally(() => {
        jwksEnVuelo = null;
      });
  }

  try {
    return await jwksEnVuelo;
  } catch (err) {
    // Si el JWKS no responde pero teníamos una copia, se sigue usando: preferimos
    // validar con una clave vieja (que sigue siendo criptográficamente válida)
    // antes que rechazar a todos los usuarios por una caída del endpoint.
    if (jwksCache) return jwksCache.keys;
    throw err;
  }
}

async function claveAsimetrica(kid: string | undefined, alg: AlgoritmoSoportado): Promise<CryptoKey> {
  const cacheKey = `${alg}:${kid ?? "sin-kid"}`;
  const cacheada = cryptoKeyCache.get(cacheKey);
  if (cacheada) return cacheada;

  const buscar = (keys: Jwk[]): Jwk | undefined =>
    kid ? keys.find((k) => k.kid === kid) : keys[0];

  let keys = await obtenerJwks();
  let jwk  = buscar(keys);

  if (!jwk) {
    // `kid` desconocido → puede ser una rotación de claves recién hecha.
    keys = await obtenerJwks(true);
    jwk  = buscar(keys);
  }

  if (!jwk) throw noAutorizado("Token de autenticación inválido");

  // Defensa contra confusión de algoritmos: si el JWK declara `alg`, tiene que
  // coincidir con el del header. Nunca se elige el algoritmo solo por el header.
  if (jwk.alg && jwk.alg !== alg) throw noAutorizado("Token de autenticación inválido");

  const params: EcKeyImportParams | RsaHashedImportParams = alg === "ES256"
    ? { name: "ECDSA", namedCurve: "P-256" }
    : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

  const key = await crypto.subtle.importKey("jwk", jwk, params, false, ["verify"]);
  cryptoKeyCache.set(cacheKey, key);
  return key;
}

async function claveSimetrica(): Promise<CryptoKey> {
  const cacheada = cryptoKeyCache.get("HS256");
  if (cacheada) return cacheada;

  const secreto = getEnv("SUPABASE_JWT_SECRET");
  if (!secreto) {
    // Sin secreto no hay forma de validar un HS256. Se rechaza en vez de
    // aceptar a ciegas: un proyecto asimétrico jamás debería recibir HS256.
    throw noAutorizado("Token de autenticación inválido");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    textoADecodificado(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  cryptoKeyCache.set("HS256", key);
  return key;
}

// ─── Verificación ─────────────────────────────────────────────────────────────

/**
 * Verifica firma y vigencia del JWT y devuelve su payload.
 *
 * Lanza `DomainError` 401 ante cualquier problema: firma inválida, algoritmo no
 * soportado (incluido `none`), token vencido o todavía no vigente, o estructura
 * corrupta. NO valida claims de negocio (tenant_id, platform_role): de eso se
 * ocupa cada middleware.
 */
export async function verifyJwt(token: string): Promise<JwtPayload> {
  const partes = token.split(".");
  if (partes.length !== 3) throw noAutorizado("Token de autenticación inválido");

  const [headerB64, payloadB64, signatureB64] = partes as [string, string, string];

  const header = base64UrlAJson(headerB64) as JwtHeader | null;
  if (!header) throw noAutorizado("Token de autenticación inválido");

  const alg = header.alg;
  if (!alg || !ALGORITMOS_SOPORTADOS.includes(alg as AlgoritmoSoportado)) {
    // Incluye el caso `alg: "none"`, que es exactamente el ataque que esto corta.
    throw noAutorizado("Token de autenticación inválido");
  }
  const algoritmo = alg as AlgoritmoSoportado;

  const firma  = base64UrlADecodificado(signatureB64);
  if (!firma) throw noAutorizado("Token de autenticación inválido");

  const datos  = textoADecodificado(`${headerB64}.${payloadB64}`);

  let valida = false;
  if (algoritmo === "HS256") {
    const key = await claveSimetrica();
    valida = await crypto.subtle.verify("HMAC", key, firma, datos);
  } else if (algoritmo === "ES256") {
    const key = await claveAsimetrica(header.kid, algoritmo);
    // La firma ES256 de un JWT ya viene en formato R||S (IEEE P1363), que es
    // justo lo que espera Web Crypto: no hace falta convertir desde DER.
    valida = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, firma, datos);
  } else {
    const key = await claveAsimetrica(header.kid, algoritmo);
    valida = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, firma, datos);
  }

  if (!valida) throw noAutorizado("Token de autenticación inválido");

  const payload = base64UrlAJson(payloadB64) as JwtPayload | null;
  if (!payload) throw noAutorizado("Token de autenticación inválido");

  const ahoraS = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === "number" && payload.exp + TOLERANCIA_RELOJ_S < ahoraS) {
    throw noAutorizado("La sesión expiró. Volvé a iniciar sesión.");
  }
  if (typeof payload.nbf === "number" && payload.nbf - TOLERANCIA_RELOJ_S > ahoraS) {
    throw noAutorizado("Token de autenticación inválido");
  }

  return payload;
}
