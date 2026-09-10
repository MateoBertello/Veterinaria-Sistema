/**
 * SONDA TEMPORAL DE LATENCIA — quitar cuando termine la medición.
 *
 * Este módulo existe para que su cuerpo se evalúe ANTES que el grafo de
 * `main.ts`. En ESM los imports se evalúan en el orden en que aparecen, así que
 * `index.ts` lo importa primero y `T0` queda tomado antes de que se evalúe el
 * grafo de los 28 controllers. Con eso se puede medir cuánto cuesta el arranque
 * y, sobre todo, si ese arranque se paga una vez o en cada request.
 */

/** Instante en que arrancó a evaluarse el grafo de módulos de este isolate. */
export const T0 = performance.now();

/** Reloj de pared del arranque, para cruzar con los logs del dashboard. */
export const T0_WALL = Date.now();

/** Requests servidos por ESTE isolate. Si siempre vale 1, el isolate es nuevo por request. */
let servidos = 0;
export function contarRequest(): number {
  servidos += 1;
  return servidos;
}

declare module "hono" {
  interface ContextVariableMap {
    /** SONDA TEMPORAL: `performance.now()` en el primer borde del recorrido. */
    tReqIn: number;
  }
}
