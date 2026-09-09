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
import { Textarea } from "../ui/textarea.tsx";
import { Label } from "../ui/label.tsx";
import { desbloquearLote } from "../../api/comercial/ajustes.ts";
import { ApiError } from "../../types/index.ts";

interface Props {
  lote: { id: string; codigoLote?: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (res: { id: string; estado: string }) => void;
}

export function DesbloquearLoteDialog({
  lote,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setMotivo("");
    }
    onOpenChange(next);
  }

  const motivoValido = motivo.trim().length >= 10;

  async function confirmar() {
    if (!lote || !motivoValido) return;
    setLoading(true);
    setError(null);
    try {
      const res = await desbloquearLote(lote.id, motivo.trim());
      onSuccess?.(res);
      handleOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Error al desbloquear lote");
    } finally {
      setLoading(false);
    }
  }

  const codigo = lote?.codigoLote ?? "S/L";

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desbloquear lote</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span>
              El lote {codigo} volverá a estar disponible para ventas y para consumo clínico. Su existencia no cambia. Se puede volver a bloquear después si fuera necesario.
            </span>
            <span className="block text-xs text-muted-foreground font-medium">
              Esta acción es reversible.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="motivo-desbloqueo">
            Motivo del desbloqueo (mínimo 10 caracteres)
          </Label>
          <Textarea
            id="motivo-desbloqueo"
            aria-label="Motivo del desbloqueo"
            placeholder="Describa el motivo por el cual se desbloquea este lote..."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={loading}
            className="min-h-20"
          />
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>{motivo.trim().length} / 10 caracteres (mínimo 10)</span>
            {!motivoValido && motivo.length > 0 && (
              <span className="text-amber-600 font-medium">Mínimo 10 caracteres</span>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive font-medium">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading || !motivoValido}
            onClick={(e) => {
              e.preventDefault();
              void confirmar();
            }}
          >
            {loading ? "Desbloqueando..." : "Desbloquear lote"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export default DesbloquearLoteDialog;
