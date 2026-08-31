import type { getServiceDb } from "./db.ts";

/**
 * Rate limit de los LOGIN (RN-AUT5), compartido por el login de tenant
 * (`POST /auth/login`) y el de plataforma (`POST /admin/auth/login`).
 *
 * Vive acá y no dentro de un service por dos razones:
 *
 *  • Los dos caminos de login tienen que contar contra los MISMOS buckets. Si
 *    cada uno llevara su propio contador, el endpoint de plataforma sería un
 *    oráculo gratis para adivinar contraseñas de cuentas ya frenadas en el
 *    endpoint de tenant (y viceversa).
 *  • El comportamiento temporal de un login fallido debe ser indistinguible
 *    entre ambos: mismo umbral, misma ventana, mismo mensaje.
 *
 * El estado vive en la tabla `intentos_login`, NO en memoria del isolate: en
 * serverless el proceso se recicla constantemente y hay varias instancias en
 * paralelo, así que un Map de módulo se reiniciaba solo y no frenaba nada.
 * Ver la migración 20260725000004 para el detalle del diseño.
 */

export const WINDOW_MINUTES = 15;

/** Intentos permitidos contra UNA cuenta antes de bloquearla. */
const MAX_POR_USUARIO = 5;

/**
 * Intentos permitidos desde UNA IP. Deliberadamente holgado: una clínica entera
 * sale por una sola IP pública, así que un umbral bajo acá castiga al local
 * completo por las contraseñas mal tipeadas de cualquiera. Sirve para frenar el
 * barrido automatizado de muchas cuentas, no para proteger una cuenta puntual
 * —de eso se ocupa MAX_POR_USUARIO—.
 */
const MAX_POR_IP = 50;

export interface BucketsDeIntento {
  claves:  string[];
  maximos: number[];
}

type ServiceDb = ReturnType<typeof getServiceDb>;

/**
 * Buckets contra los que se cuenta un intento, con su techo respectivo.
 *
 * El bucket por IDENTIFICADOR es el que hace el trabajo: quien ataca una cuenta
 * concreta no puede escaparle, porque el identificador es justamente lo que
 * necesita mantener fijo. El bucket por IP es defensa secundaria y se asume
 * falsificable (llega de un header).
 */
export function bucketsDeIntento(ip: string, identificador: string): BucketsDeIntento {
  return {
    claves:  [`user:${identificador.trim().toLowerCase()}`, `ip:${ip}`],
    maximos: [MAX_POR_USUARIO, MAX_POR_IP],
  };
}

/** Suma el intento y devuelve `true` si quedó bloqueado. */
export async function registrarIntento(
  db: ServiceDb,
  buckets: BucketsDeIntento,
): Promise<boolean> {
  const { data, error } = await db.rpc("registrar_intento_login", {
    p_claves:          buckets.claves,
    p_maximos:         buckets.maximos,
    p_ventana_minutos: WINDOW_MINUTES,
  });

  if (error) {
    // Si el contador no está disponible no se bloquea el login: sin base de
    // datos el login va a fallar igual unas líneas más abajo, y dejar a todo el
    // mundo afuera por un problema del limitador es peor que el riesgo que cubre.
    console.error("[rate-limit] No se pudo registrar el intento:", error.message);
    return false;
  }

  return data === true;
}

/** Limpia los buckets tras un login exitoso. */
export async function limpiarIntentos(
  db: ServiceDb,
  buckets: { claves: string[] },
): Promise<void> {
  const { error } = await db.rpc("limpiar_intentos_login", { p_claves: buckets.claves });
  if (error) {
    console.error("[rate-limit] No se pudieron limpiar los intentos:", error.message);
  }
}
