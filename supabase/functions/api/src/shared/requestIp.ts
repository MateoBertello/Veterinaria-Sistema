import type { Context } from "hono";

/**
 * IP del cliente, para el rate limit de los login (RN-AUT5).
 *
 * `X-Forwarded-For` es una LISTA que el cliente puede empezar a escribir: si
 * manda `X-Forwarded-For: loquesea`, el proxy le agrega la IP real DETRÁS. Por
 * eso se toma la ÚLTIMA entrada (la que puso el proxy más cercano) y no la
 * primera, que es la que controla quien llama. Igual no se confía del todo en
 * este valor: el bucket que sostiene la regla es el del identificador.
 *
 * Compartida por el login de tenant y el de plataforma para que los dos cuenten
 * exactamente el mismo bucket de IP.
 */
export function ipDelRequest(c: Context): string {
  const xff = c.req.header("X-Forwarded-For");
  if (xff) {
    const entradas = xff.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
    const ultima = entradas[entradas.length - 1];
    if (ultima) return ultima;
  }
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}
