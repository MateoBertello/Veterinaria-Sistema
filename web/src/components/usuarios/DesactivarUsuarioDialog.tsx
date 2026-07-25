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
import { ApiError, type Usuario } from "../../types/index.ts";

interface Props {
  usuario: Usuario | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  desactivar: (id: string) => Promise<Usuario>;
  onSuccess: (usuario: Usuario) => void;
}

/**
 * Confirma la baja lógica de un usuario. RN-SEC6: si es el último administrador
 * activo, el backend rechaza con 409 LAST_ADMIN — se muestra dentro del propio
 * diálogo, sin cerrarlo, para que el usuario entienda por qué no procedió.
 */
export function DesactivarUsuarioDialog({ usuario, open, onOpenChange, desactivar, onSuccess }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    if (!usuario) return;
    setLoading(true);
    setError(null);
    try {
      const actualizado = await desactivar(usuario.id);
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
          <AlertDialogTitle>Desactivar usuario</AlertDialogTitle>
          <AlertDialogDescription>
            {usuario
              ? `${usuario.fullName} no podrá iniciar sesión hasta reactivarse. No se puede desactivar al último administrador activo.`
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
