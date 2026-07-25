import { useCallback, useEffect, useState } from "react";
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
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { Switch } from "../ui/switch.tsx";
import { MODULO_META, MODULOS_ORDEN, getModuloLabel } from "../../lib/planes.ts";
import { ApiError, type ModuloContratado, type ModuloVendible } from "../../types/index.ts";

interface Props {
  tenantId: string;
  listarModulos: (tenantId: string) => Promise<ModuloContratado[]>;
  setModulo: (
    tenantId: string,
    modulo: ModuloVendible,
    habilitado: boolean,
  ) => Promise<ModuloContratado>;
}

/**
 * Panel de módulos vendibles del tenant (RN-SM2/SM3/SM4). Un switch por módulo:
 * habilitar aplica directo; deshabilitar pide confirmación porque es la acción
 * restrictiva (los usuarios pierden acceso inmediato, aunque los datos quedan).
 * Si el backend rechaza (MODULE_UNKNOWN, TENANT_NOT_FOUND, 5xx), el switch
 * vuelve a su estado anterior y se muestra el mensaje del envelope.
 */
export function ModulosPanel({ tenantId, listarModulos, setModulo }: Props) {
  const [modulos, setModulos] = useState<ModuloContratado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  /** Módulo con un PUT en vuelo (deshabilita su switch para evitar dobles envíos). */
  const [pendiente, setPendiente] = useState<ModuloVendible | null>(null);
  const [aDeshabilitar, setADeshabilitar] = useState<ModuloContratado | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setModulos(await listarModulos(tenantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los módulos");
    } finally {
      setLoading(false);
    }
  }, [tenantId, listarModulos]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function aplicar(modulo: ModuloVendible, habilitado: boolean) {
    setPendiente(modulo);
    try {
      const actualizado = await setModulo(tenantId, modulo, habilitado);
      setModulos((prev) => prev.map((m) => (m.modulo === modulo ? actualizado : m)));
      toast.success(
        habilitado
          ? `${getModuloLabel(modulo)} habilitado`
          : `${getModuloLabel(modulo)} deshabilitado`,
      );
    } catch (err) {
      // El estado local no se tocó antes del PUT: el switch ya refleja el valor
      // previo, así que solo hay que informar el error.
      toast.error(err instanceof ApiError ? err.message : "No se pudo actualizar el módulo");
    } finally {
      setPendiente(null);
    }
  }

  function onToggle(modulo: ModuloContratado, habilitado: boolean) {
    if (habilitado) {
      void aplicar(modulo.modulo, true);
      return;
    }
    setADeshabilitar(modulo);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Módulos contratados</CardTitle>
        <CardDescription>
          Los cambios rigen de inmediato: deshabilitar bloquea el acceso, nunca borra datos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-4" role="status" aria-live="polite">
            <span className="sr-only">Cargando módulos…</span>
            {MODULOS_ORDEN.map((m) => (
              <Skeleton key={m} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="py-4 text-center">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
              Reintentar
            </Button>
          </div>
        ) : modulos.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Esta clínica todavía no tiene módulos aprovisionados.
          </p>
        ) : (
          <ul className="divide-y">
            {modulos.map((m) => {
              const meta = MODULO_META[m.modulo];
              return (
                <li key={m.modulo} className="flex items-start justify-between gap-4 py-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {meta ? `${meta.sigla} · ${meta.label}` : m.modulo}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {meta?.description ?? "Módulo vendible."}
                    </p>
                    {m.fechaAlta ? (
                      <p className="text-xs text-muted-foreground">Alta: {m.fechaAlta}</p>
                    ) : null}
                  </div>
                  <Switch
                    checked={m.habilitado}
                    disabled={pendiente === m.modulo}
                    onCheckedChange={(valor) => onToggle(m, valor)}
                    aria-label={`${meta?.label ?? m.modulo}: ${m.habilitado ? "habilitado" : "deshabilitado"}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* RN-SM2: confirmación solo al deshabilitar (acción restrictiva). */}
      <AlertDialog
        open={Boolean(aDeshabilitar)}
        onOpenChange={(o) => !o && setADeshabilitar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deshabilitar {aDeshabilitar ? getModuloLabel(aDeshabilitar.modulo) : "módulo"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Los usuarios perderán acceso inmediato al módulo. Los datos se conservan y el módulo
              se puede volver a habilitar cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const modulo = aDeshabilitar?.modulo;
                setADeshabilitar(null);
                if (modulo) void aplicar(modulo, false);
              }}
            >
              Deshabilitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
