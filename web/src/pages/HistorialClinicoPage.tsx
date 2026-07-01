import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Stethoscope } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { EventoTimeline } from "../components/historial/EventoTimeline.tsx";
import { EventoClinicoFormDialog } from "../components/historial/EventoClinicoFormDialog.tsx";
import { listarHistorial, resumenClinico } from "../api/historial-clinico.ts";
import { ApiError, type HistorialItem, type ResumenClinico, type ApiMeta } from "../types/index.ts";

const PAGE_SIZE = 20;

export function HistorialClinicoPage() {
  const { mascotaId } = useParams<{ mascotaId: string }>();
  const navigate = useNavigate();

  const [resumen, setResumen] = useState<ResumenClinico | null>(null);
  const [resumenError, setResumenError] = useState<string | null>(null);

  const [eventos, setEventos] = useState<HistorialItem[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);

  const cargarResumen = useCallback(async () => {
    if (!mascotaId) return;
    setResumenError(null);
    try {
      setResumen(await resumenClinico(mascotaId));
    } catch (err) {
      setResumenError(err instanceof ApiError ? err.message : "No se pudo cargar la ficha de la mascota");
    }
  }, [mascotaId]);

  const cargarHistorial = useCallback(async () => {
    if (!mascotaId) return;
    setLoading(true);
    setError(null);
    try {
      const { items, meta } = await listarHistorial(mascotaId, { page, limit: PAGE_SIZE });
      setEventos(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial clínico");
    } finally {
      setLoading(false);
    }
  }, [mascotaId, page]);

  useEffect(() => { void cargarResumen(); }, [cargarResumen]);
  useEffect(() => { void cargarHistorial(); }, [cargarHistorial]);

  if (!mascotaId) return null;

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));
  const esFallecida = resumen?.estado === "Fallecida";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/mascotas")}>
        <ArrowLeft className="size-4" aria-hidden />
        Volver a mascotas
      </Button>

      <header className="space-y-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Stethoscope className="size-6" aria-hidden />
          Historial Clínico
        </h1>

        {resumenError ? (
          <p className="text-sm text-destructive">{resumenError}</p>
        ) : resumen ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-gradient-to-r from-orange-50 to-white p-4">
            <div className="space-y-1">
              <p className="text-lg font-medium">{resumen.name}</p>
              <p className="text-sm text-muted-foreground">
                {resumen.especieName ?? "—"}{resumen.razaName ? ` · ${resumen.razaName}` : ""} · Dueño: {resumen.ownerName ?? "—"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="secondary">
                Último peso: {resumen.ultimoPeso != null ? `${resumen.ultimoPeso} kg` : "sin registro"}
              </Badge>
              {esFallecida ? (
                <Badge variant="secondary">Fallecida</Badge>
              ) : (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>
              )}
            </div>
          </div>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </header>

      {esFallecida ? (
        <Alert>
          <AlertTitle>Mascota fallecida</AlertTitle>
          <AlertDescription>
            Esta mascota está marcada como fallecida — no se pueden registrar nuevos eventos
            clínicos. El historial existente sigue disponible para su consulta.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Registrar evento
          </Button>
        </div>
      )}

      <div className="rounded-lg border">
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" className="mt-3" onClick={() => void cargarHistorial()}>
              Reintentar
            </Button>
          </div>
        ) : eventos.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Todavía no hay eventos clínicos registrados para esta mascota.
          </p>
        ) : (
          <div className="px-4">
            <EventoTimeline eventos={eventos} />
          </div>
        )}
      </div>

      {!loading && !error && eventos.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {meta.total} evento{meta.total === 1 ? "" : "s"} · Página {meta.page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}

      <EventoClinicoFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        petId={mascotaId}
        onSaved={() => { void cargarHistorial(); void cargarResumen(); }}
      />
    </div>
  );
}
