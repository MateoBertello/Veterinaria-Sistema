import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog.tsx";
import { ApiError, type Servicio } from "../../types/index.ts";

interface Props {
  servicio: Servicio | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cambiarEstado: (id: string, activo: boolean) => Promise<Servicio>;
  onSuccess: (servicio: Servicio) => void;
}

/**
 * Confirma la baja lógica de un servicio. RN-SV3: si tiene turnos futuros que lo
 * referencian, el backend rechaza con 422 VALIDATION_ERROR — se muestra dentro
 * del propio diálogo, sin cerrarlo, para que el usuario entienda por qué no procedió.
 */
export function DesactivarServicioDialog({ servicio, open, onOpenChange, cambiarEstado, onSuccess }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    if (!servicio) return;
    setLoading(true);
    setError(null);
    try {
      const actualizado = await cambiarEstado(servicio.id, false);
      onSuccess(actualizado);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ocurrió un error inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desactivar servicio</AlertDialogTitle>
          <AlertDialogDescription>
            {servicio
              ? `"${servicio.nombre}" dejará de estar disponible en el selector de Turnos. Si tiene turnos futuros asignados, no podrá desactivarse.`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={(e) => {
              e.preventDefault();
              void confirmar();
            }}
          >
            Desactivar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
