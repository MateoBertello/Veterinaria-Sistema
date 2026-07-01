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
import { ApiError, type Franja } from "../../types/index.ts";

interface Props {
  franja: Franja | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eliminarFranja: (horarioId: string) => Promise<{ deleted: true }>;
  onSuccess: (horarioId: string) => void;
}

export function EliminarFranjaDialog({ franja, open, onOpenChange, eliminarFranja, onSuccess }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    if (!franja) return;
    setLoading(true);
    setError(null);
    try {
      await eliminarFranja(franja.id);
      onSuccess(franja.id);
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
          <AlertDialogTitle>Eliminar franja</AlertDialogTitle>
          <AlertDialogDescription>
            {franja
              ? `Se eliminará la franja de ${franja.startTime} a ${franja.endTime}. Esta acción no se puede deshacer.`
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
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
