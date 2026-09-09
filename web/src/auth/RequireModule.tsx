import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { useModulos } from "./ModulosContext.tsx";
import { ModuloNoContratado } from "../components/shell/ModuloNoContratado.tsx";
import type { ModuloVendible } from "../types/index.ts";

export interface RequireModuleProps {
  modulo:    ModuloVendible;
  children?: ReactNode;
}

/**
 * Gate de módulo contratado para rutas protegidas de la aplicación (RN-G2).
 * Si la veterinaria no tiene contratado el módulo, bloquea el acceso mostrando
 * la pantalla explicativa `ModuloNoContratado`, evitando llamadas a la API
 * que terminarían en 403 MODULE_NOT_LICENSED.
 *
 * Puede utilizarse como wrapper directo de un elemento o como Route element con `<Outlet />`.
 */
export function RequireModule({ modulo, children }: RequireModuleProps) {
  const { estaHabilitado, cargando } = useModulos();

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Verificando suscripción...
      </div>
    );
  }

  if (!estaHabilitado(modulo)) {
    return <ModuloNoContratado modulo={modulo} />;
  }

  return children ? <>{children}</> : <Outlet />;
}
