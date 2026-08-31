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
import { ApiError } from "../../types/index.ts";

interface Props {
  /** Nombre del ítem a dar de baja; `null` cierra el diálogo. */
  nombre:       string | null;
  /** "especie" | "raza" | "tipo de vacuna" — para redactar el texto. */
  entidad:      string;
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  desactivar:   () => Promise<unknown>;
  onSuccess:    () => void;
}

/**
 * Confirma la baja lógica de un ítem del catálogo (RN-CAT4: nunca se borra).
 *
 * RN-CAT5: si el ítem está en uso, el backend responde 409 CATALOG_IN_USE. El
 * error se muestra DENTRO del diálogo y sin cerrarlo, igual que en servicios:
 * cerrarlo y mostrar un toast deja al usuario sin saber qué fila falló ni por
 * qué, que es justo lo que necesita para decidir qué hacer.
 */
export function DesactivarCatalogoDialog({
  nombre, entidad, open, onOpenChange, desactivar, onSuccess,
}: Props) {
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    setLoading(true);
    setError(null);
    try {
      await desactivar();
      onSuccess();
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
          <AlertDialogTitle>Dar de baja {entidad}</AlertDialogTitle>
          <AlertDialogDescription>
            {nombre
              ? `"${nombre}" dejará de ofrecerse en las altas nuevas. Las fichas que ya lo usan lo siguen mostrando. Si está en uso, no podrá darse de baja.`
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
            Dar de baja
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
