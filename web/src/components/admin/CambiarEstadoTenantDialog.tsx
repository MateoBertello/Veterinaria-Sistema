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
import { ApiError, type Tenant } from "../../types/index.ts";

interface Props {
  tenant: Tenant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cambiarEstado: (id: string, activo: boolean) => Promise<Tenant>;
  onSuccess: (tenant: Tenant) => void;
}

/**
 * Confirmación de suspensión/reactivación de un tenant (RN-SA3, baja lógica).
 * Suspender es la acción restrictiva: los usuarios de la clínica pierden acceso
 * a los módulos de inmediato, pero no se borra ningún dato. El error del
 * envelope se muestra dentro del diálogo, sin cerrarlo.
 */
export function CambiarEstadoTenantDialog({
  tenant,
  open,
  onOpenChange,
  cambiarEstado,
  onSuccess,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Se suspende lo activo y se reactiva lo suspendido.
  const suspender = tenant?.activo ?? true;

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const actualizado = await cambiarEstado(tenant.id, !tenant.activo);
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
          <AlertDialogTitle>
            {suspender ? "Suspender clínica" : "Reactivar clínica"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tenant
              ? suspender
                ? `Los usuarios de ${tenant.nombre} podrán autenticarse pero perderán el acceso a todos los módulos de inmediato. Los datos se conservan y la suspensión se puede revertir.`
                : `${tenant.nombre} vuelve a tener acceso a los módulos habilitados de su plan.`
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
            {suspender ? "Suspender" : "Reactivar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
