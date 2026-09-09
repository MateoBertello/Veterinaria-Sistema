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
import { bloquearLote } from "../../api/comercial/ajustes.ts";
import { ApiError } from "../../types/index.ts";

interface Props {
  lote: { id: string; codigoLote?: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (res: { id: string; estado: string; motivoBloqueo: string }) => void;
}

export function BloquearLoteDialog({
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
      const res = await bloquearLote(lote.id, motivo.trim());
      onSuccess?.(res);
      handleOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Error al bloquear lote");
    } finally {
      setLoading(false);
    }
  }

  const codigo = lote?.codigoLote ?? "S/L";

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bloquear lote</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span>
              El lote {codigo} deja de estar disponible para ventas y para consumo clínico. Su existencia no cambia. Se puede desbloquear después.
            </span>
            <span className="block text-xs text-muted-foreground font-medium">
              Esta acción es reversible.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="motivo-bloqueo">
            Motivo del bloqueo (mínimo 10 caracteres)
          </Label>
          <Textarea
            id="motivo-bloqueo"
            aria-label="Motivo del bloqueo"
            placeholder="Describa el motivo por el cual se bloquea este lote..."
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
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Bloqueando..." : "Bloquear lote"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export default BloquearLoteDialog;
