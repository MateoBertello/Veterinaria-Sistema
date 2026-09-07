import { cn } from "../ui/utils.ts";

/**
 * Ruta única del logo de la marca. La identidad aparece en tres superficies
 * (sidebar, barra superior de mobile y login), así que el valor vive acá y no
 * repetido en cada pantalla.
 */
export const LOGO_MARCA_SRC = "/logo-vetercor.png";

/**
 * Logo de la marca. Es **decorativo** (`alt=""`) a propósito: en las tres
 * superficies donde se usa, el nombre del sistema ya está en el texto contiguo
 * o en el `aria-label` del enlace que lo envuelve, así que un texto alternativo
 * lo anunciaría dos veces.
 *
 * La imagen trae su propio fondo de marca, por eso no lleva la caja con
 * degradado que envolvía al ícono anterior.
 */
export function LogoMarca({ className }: { className?: string }) {
  return (
    <img
      src={LOGO_MARCA_SRC}
      alt=""
      className={cn("rounded-xl object-contain shadow-md", className)}
    />
  );
}

export default LogoMarca;
