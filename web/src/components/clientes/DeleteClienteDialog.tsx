import { useState } from "react";
import { toast } from "sonner";
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
import { ApiError, ErrorCode, type Cliente } from "../../types/index.ts";

interface Props {
  /** Cliente a dar de baja; null cierra el diálogo. */
  cliente: Cliente | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
  /** Inyectable para tests; por defecto usa la capa de datos real. */
  eliminar: (id: string) => Promise<{ id: string; deleted: true }>;
}

export function DeleteClienteDialog({ cliente, onOpenChange, onDeleted, eliminar }: Props) {
  const [eliminando, setEliminando] = useState(false);

  async function onConfirm() {
    if (!cliente) return;
    setEliminando(true);
    try {
      await eliminar(cliente.id);
      toast.success("Cliente eliminado");
      onDeleted(cliente.id);
      onOpenChange(false);
    } catch (err) {
      // Fallback defensivo (RN-CL8): si el backend rechaza por mascotas vivas
      // —p. ej. carrera entre cargar la lista y confirmar— se informa con toast.
      if (err instanceof ApiError && err.code === ErrorCode.CLIENT_HAS_PETS) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof ApiError ? err.message : "No se pudo eliminar el cliente");
      }
      onOpenChange(false);
    } finally {
      setEliminando(false);
    }
  }

  return (
    <AlertDialog open={Boolean(cliente)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar cliente</AlertDialogTitle>
          <AlertDialogDescription>
            ¿Seguro que querés dar de baja a{" "}
            <span className="font-medium text-foreground">{cliente?.fullName}</span>? Esta acción
            aplica una baja lógica y deja de mostrarse en el listado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={eliminando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Evita que el AlertDialog cierre antes de resolver la baja.
              e.preventDefault();
              void onConfirm();
            }}
            disabled={eliminando}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
