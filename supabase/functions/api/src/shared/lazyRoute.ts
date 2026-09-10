import { Hono, type Context, type Next } from "hono";
import { errorHandler } from "../middleware/errorHandler.ts";

const BASE = "/api/v1";

/** Marca la respuesta que produce el notFound del sub-app, no un 404 de negocio. */
const SIN_RUTA = "x-lazy-sin-ruta";

/**
 * Monta un prefijo de rutas cargando su controller recién cuando llega un
 * request que le corresponde.
 *
 * El isolate de la Edge Function no sobrevive al request (ver la sonda de
 * arranque), así que el grafo de imports se evalúa entero en CADA request. Con
 * `app.route()` eso significa construir los 28 controllers —con sus services y
 * sus schemas— para atender una sola ruta. Con esto, un request a /turnos evalúa
 * el módulo de turnos y nada más.
 *
 * La delegación pasa el request ORIGINAL, sin clonarlo ni reescribir la URL: el
 * sub-app se arma con el mismo `basePath` y el mismo prefijo que usaba
 * `app.route()`, así que matchea exactamente igual. Eso evita tocar el cuerpo de
 * los POST/PUT y las subidas multipart, que es donde un clon de Request se rompe.
 *
 * `cargar` devuelve una LISTA porque varios prefijos montan más de un router de
 * forma aditiva (/mascotas, /doctores, /lotes). Se montan en el orden recibido,
 * que es el que decide las precedencias.
 */
export function montarPerezoso(
  app: Hono,
  prefijo: string,
  cargar: () => Promise<Hono[]>,
): void {
  let montado: Hono | null = null;

  const handler = async (c: Context, next: Next): Promise<Response | void> => {
    if (!montado) {
      const routers = await cargar();
      const sub = new Hono().basePath(BASE);
      // El sub-app atiende con su propio fetch, así que los errores de dominio
      // que se lancen adentro no llegan al onError del app externo: necesita el
      // mismo handler para seguir devolviendo el envelope de error.
      sub.onError(errorHandler);
      // Se marca el 404 "no hay ruta acá" para distinguirlo de un 404 de negocio
      // (una mascota que no existe), que sí es una respuesta final con envelope.
      sub.notFound(() => new Response(null, { status: 404, headers: { [SIN_RUTA]: "1" } }));
      for (const r of routers) sub.route(prefijo, r);
      montado = sub;
    }

    const res = await montado.fetch(c.req.raw, c.env);

    // Prefijos que se solapan (/turnos/notificaciones y /turnos) dependían de
    // que, si el primero no tenía la ruta, siguiera buscando en el siguiente.
    // `app.route()` lo daba gratis porque aplanaba todo en un router; acá hay
    // que devolver el control explícitamente.
    if (res.status === 404 && res.headers.has(SIN_RUTA)) return next();

    return res;
  };

  // El prefijo pelado y todo lo que cuelga: `app.route()` cubría ambos.
  app.all(prefijo, handler);
  app.all(`${prefijo}/*`, handler);
}
