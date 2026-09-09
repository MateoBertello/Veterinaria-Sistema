import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Power } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { ModulosPanel } from "../../components/admin/ModulosPanel.tsx";
import { TenantFormSheet } from "../../components/admin/TenantFormSheet.tsx";
import { CambiarEstadoTenantDialog } from "../../components/admin/CambiarEstadoTenantDialog.tsx";
import { getPlanMeta } from "../../lib/planes.ts";
import {
  cambiarEstadoTenant,
  crearTenant,
  editarTenant,
  listarModulosTenant,
  obtenerTenant,
  setModuloTenant,
} from "../../api/admin.ts";
import { ApiError, type Tenant } from "../../types/index.ts";

export function TenantDetallePage() {
  const { id = "" } = useParams<{ id: string }>();

  const [tenant,  setTenant]  = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [formOpen,  setFormOpen]  = useState(false);
  const [estadoOpen, setEstadoOpen] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTenant(await obtenerTenant(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la clínica");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6" role="status" aria-live="polite">
        <span className="sr-only">Cargando clínica…</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <VolverALista />
        <div className="rounded-lg border py-10 text-center">
          <p role="alert" className="text-sm text-destructive">
            {error ?? "No se encontró la clínica."}
          </p>
          <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const planMeta = getPlanMeta(tenant.plan);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <VolverALista />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-orange-800">{tenant.nombre}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={planMeta.badgeClass}>{planMeta.label}</Badge>
            {tenant.activo ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activo</Badge>
            ) : (
              <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Suspendido</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setFormOpen(true)}>
            <Pencil className="size-4" aria-hidden />
            Editar
          </Button>
          <Button variant="outline" onClick={() => setEstadoOpen(true)}>
            <Power className="size-4" aria-hidden />
            {tenant.activo ? "Suspender" : "Reactivar"}
          </Button>
        </div>
      </header>

      {/* Datos comerciales (RN-SA4: nunca datos de negocio del tenant). */}
      <Card>
        <CardHeader>
          <CardTitle>Datos de la clínica</CardTitle>
          <CardDescription>
            Metadatos comerciales de la plataforma. No se accede a los datos internos del tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Dato label="Nombre" valor={tenant.nombre} />
            <Dato label="CUIT / RUT" valor={tenant.cuitRut} />
            <Dato label="Email de contacto" valor={tenant.emailContacto} />
            <Dato label="Plan" valor={planMeta.label} />
            <Dato label="Estado" valor={tenant.activo ? "Activo" : "Suspendido"} />
            <Dato label="Alta" valor={formatearFecha(tenant.createdAt)} />
          </dl>
        </CardContent>
      </Card>

      {/* Administrador del tenant (RN-SA2). */}
      <Card>
        <CardHeader>
          <CardTitle>Administrador de la clínica</CardTitle>
          <CardDescription>
            El administrador se da de alta por la API, con{" "}
            <code>POST /admin/tenants/{tenant.id}/admin</code>. Ya no se envía ningún mail de
            invitación: la contraseña inicial la elige quien da el alta y el administrador la
            cambia al entrar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Estado:{" "}
            {tenant.adminInvitado ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                Con administrador
              </Badge>
            ) : (
              <Badge variant="secondary">Sin administrador</Badge>
            )}
          </p>
        </CardContent>
      </Card>

      <ModulosPanel
        tenantId={tenant.id}
        listarModulos={listarModulosTenant}
        setModulo={setModuloTenant}
      />

      <TenantFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        tenant={tenant}
        crear={crearTenant}
        editar={editarTenant}
        onSaved={(actualizado) => setTenant(actualizado)}
      />

      <CambiarEstadoTenantDialog
        tenant={tenant}
        open={estadoOpen}
        onOpenChange={setEstadoOpen}
        cambiarEstado={cambiarEstadoTenant}
        onSuccess={(actualizado) => setTenant(actualizado)}
      />
    </div>
  );
}

function VolverALista() {
  return (
    <Link
      to="/admin/tenants"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Volver a Tenants
    </Link>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{valor}</dd>
    </div>
  );
}

function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleDateString("es-AR");
}
