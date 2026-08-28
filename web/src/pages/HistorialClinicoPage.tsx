import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileSpreadsheet, FileText, Loader2, Plus, Stethoscope, Syringe, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { EventoTimeline } from "../components/historial/EventoTimeline.tsx";
import { EventoClinicoFormDialog } from "../components/historial/EventoClinicoFormDialog.tsx";
import { EutanasiaDialog } from "../components/historial/EutanasiaDialog.tsx";
import { PlanVacunacionTimeline } from "../components/vacunacion/PlanVacunacionTimeline.tsx";
import { ProgramarDosisDialog } from "../components/vacunacion/ProgramarDosisDialog.tsx";
import { MarcarAplicadaDialog } from "../components/vacunacion/MarcarAplicadaDialog.tsx";
import { exportarHistorial, listarHistorial, resumenClinico, type FormatoExport } from "../api/historial-clinico.ts";
import { listarPlanVacunacion, listarTiposVacunaAplicables } from "../api/vacunacion.ts";
import { calcularRefuerzoSugerido, type RefuerzoSugerido } from "../lib/vacunacion.ts";
import {
  ApiError,
  ErrorCode,
  type ApiMeta,
  type DosisVacunacion,
  type HistorialItem,
  type ResumenClinico,
  type TipoVacunaAplicable,
} from "../types/index.ts";

const PAGE_SIZE = 20;

function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function HistorialClinicoPage() {
  const { mascotaId } = useParams<{ mascotaId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // El origen de la navegación (Mascotas o el selector de Historial Clínico)
  // determina a dónde vuelve "Volver": por defecto Mascotas (incluye acceso
  // directo por URL), salvo que se haya llegado desde /historial (RN-HC ux).
  const vieneDeHistorial = (location.state as { from?: string } | null)?.from === "historial";

  const [resumen, setResumen] = useState<ResumenClinico | null>(null);
  const [resumenError, setResumenError] = useState<string | null>(null);

  const [eventos, setEventos] = useState<HistorialItem[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [eutanasiaOpen, setEutanasiaOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<FormatoExport | null>(null);

  const [activeTab, setActiveTab] = useState<"historial" | "vacunacion">("historial");
  const [dosis, setDosis] = useState<DosisVacunacion[]>([]);
  const [dosisMeta, setDosisMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [dosisLoading, setDosisLoading] = useState(false);
  const [dosisError, setDosisError] = useState<string | null>(null);
  const [dosisPage, setDosisPage] = useState(1);
  const [programarOpen, setProgramarOpen] = useState(false);
  const [dosisParaAplicar, setDosisParaAplicar] = useState<DosisVacunacion | null>(null);
  const [tiposVacuna, setTiposVacuna] = useState<TipoVacunaAplicable[]>([]);
  const [refuerzo, setRefuerzo] = useState<RefuerzoSugerido | null>(null);

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

  const cargarPlanVacunacion = useCallback(async () => {
    if (!mascotaId) return;
    setDosisLoading(true);
    setDosisError(null);
    try {
      const { items, meta } = await listarPlanVacunacion(mascotaId, { page: dosisPage, limit: PAGE_SIZE });
      setDosis(items);
      setDosisMeta(meta);
    } catch (err) {
      setDosisError(err instanceof ApiError ? err.message : "No se pudo cargar el plan de vacunación");
    } finally {
      setDosisLoading(false);
    }
  }, [mascotaId, dosisPage]);

  useEffect(() => { void cargarResumen(); }, [cargarResumen]);
  useEffect(() => { void cargarHistorial(); }, [cargarHistorial]);

  useEffect(() => {
    if (activeTab !== "vacunacion") return;
    void cargarPlanVacunacion();
  }, [activeTab, cargarPlanVacunacion]);

  // Vacunas aplicables A ESTA MASCOTA (RN-PV11): una sola carga al entrar a la
  // pestaña, y queda en memoria. Las consumen el diálogo de programar y el
  // refuerzo sugerido (RN-PV10), que así no dispara un fetch por dosis aplicada.
  //
  // Antes esto pedía el catálogo entero y por eso el combo ofrecía vacunas de
  // otra especie. Ahora la especie la resuelve el backend, así que la lista
  // depende de `mascotaId`: si cambia, se vuelve a pedir.
  useEffect(() => {
    if (activeTab !== "vacunacion" || !mascotaId) return;
    listarTiposVacunaAplicables(mascotaId)
      .then(setTiposVacuna)
      .catch(() => setTiposVacuna([]));
  }, [activeTab, mascotaId]);

  /**
   * RN-PV10: al aplicar una dosis se propone el refuerzo siguiente, nunca se crea
   * solo. Si el tipo de vacuna no tiene `meses_refuerzo_sugerido` (o el catálogo
   * no cargó), no hay sugerencia y el flujo termina como siempre.
   */
  function proponerRefuerzo(aplicada: DosisVacunacion, fechaAplicada: string) {
    const tipo = tiposVacuna.find((t) => t.id === aplicada.tipoVacunaId);
    setRefuerzo(calcularRefuerzoSugerido(tipo, fechaAplicada));
  }

  async function handleExport(format: FormatoExport) {
    if (!mascotaId) return;
    setExportingFormat(format);
    try {
      const { blob, filename } = await exportarHistorial(mascotaId, format);
      descargarBlob(blob, filename);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.EMPTY_HISTORY) {
        toast.error("El historial está vacío; no hay nada para exportar");
      } else {
        toast.error(err instanceof ApiError ? err.message : "No se pudo exportar el historial");
      }
    } finally {
      setExportingFormat(null);
    }
  }

  if (!mascotaId) return null;

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));
  const esFallecida = resumen?.estado === "Fallecida";
  const exportDisabled = loading || meta.total === 0 || exportingFormat !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(vieneDeHistorial ? "/historial" : "/mascotas")}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {vieneDeHistorial ? "Volver a Historial Clínico" : "Volver a mascotas"}
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
                {resumen.especieName ?? "—"}{resumen.razaName ? ` · ${resumen.razaName}` : ""} · Tutor: {resumen.ownerName ?? "—"}
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
      ) : null}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "historial" | "vacunacion")}>
        <TabsList className="bg-orange-50">
          <TabsTrigger value="historial">
            <Stethoscope className="size-4" aria-hidden />
            Historial Clínico
          </TabsTrigger>
          <TabsTrigger value="vacunacion">
            <Syringe className="size-4" aria-hidden />
            Plan de Vacunación
          </TabsTrigger>
        </TabsList>

        <TabsContent value="historial" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800"
                disabled={exportDisabled}
                onClick={() => void handleExport("xlsx")}
              >
                {exportingFormat === "xlsx" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <FileSpreadsheet className="size-4" aria-hidden />
                )}
                Exportar Excel
              </Button>
              <Button
                type="button"
                disabled={exportDisabled}
                onClick={() => void handleExport("pdf")}
              >
                {exportingFormat === "pdf" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <FileText className="size-4" aria-hidden />
                )}
                Exportar PDF
              </Button>
            </div>

            {!esFallecida ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => setEutanasiaOpen(true)}
                >
                  <TriangleAlert className="size-4" aria-hidden />
                  Registrar eutanasia
                </Button>
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="size-4" aria-hidden />
                  Registrar evento
                </Button>
              </div>
            ) : null}
          </div>

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
        </TabsContent>

        <TabsContent value="vacunacion" className="space-y-6">
          {!esFallecida ? (
            <div className="flex justify-end">
              <Button type="button" onClick={() => setProgramarOpen(true)}>
                <Plus className="size-4" aria-hidden />
                Programar dosis
              </Button>
            </div>
          ) : null}

          <div className="rounded-lg border">
            {dosisLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : dosisError ? (
              <div className="py-10 text-center">
                <p className="text-sm text-destructive">{dosisError}</p>
                <Button variant="outline" className="mt-3" onClick={() => void cargarPlanVacunacion()}>
                  Reintentar
                </Button>
              </div>
            ) : dosis.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Todavía no hay dosis registradas en el plan de vacunación de esta mascota.
              </p>
            ) : (
              <div className="px-4">
                <PlanVacunacionTimeline dosis={dosis} onMarcarAplicada={setDosisParaAplicar} />
              </div>
            )}
          </div>

          {!dosisLoading && !dosisError && dosis.length > 0 ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {dosisMeta.total} dosis · Página {dosisMeta.page} de {Math.max(1, Math.ceil(dosisMeta.total / (dosisMeta.limit || PAGE_SIZE)))}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={dosisPage <= 1}
                  onClick={() => setDosisPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={dosisPage >= Math.max(1, Math.ceil(dosisMeta.total / (dosisMeta.limit || PAGE_SIZE)))}
                  onClick={() => setDosisPage((p) => p + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      <EventoClinicoFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        petId={mascotaId}
        onSaved={() => { void cargarHistorial(); void cargarResumen(); }}
      />

      <EutanasiaDialog
        open={eutanasiaOpen}
        onOpenChange={setEutanasiaOpen}
        petId={mascotaId}
        mascotaName={resumen?.name ?? ""}
        onSuccess={() => { void cargarHistorial(); void cargarResumen(); }}
      />

      <ProgramarDosisDialog
        open={programarOpen}
        onOpenChange={setProgramarOpen}
        petId={mascotaId}
        tiposVacuna={tiposVacuna}
        onSaved={() => { void cargarPlanVacunacion(); }}
      />

      <MarcarAplicadaDialog
        open={dosisParaAplicar != null}
        onOpenChange={(open) => { if (!open) setDosisParaAplicar(null); }}
        dosis={dosisParaAplicar}
        onSaved={(aplicada, fechaAplicada) => {
          void cargarPlanVacunacion();
          proponerRefuerzo(aplicada, fechaAplicada);
        }}
      />

      {/*
        RN-PV10: el refuerzo se propone pre-cargado y solo se crea si el
        veterinario confirma. Programarlo NO vuelve a sugerir: la cadena termina
        acá (la sugerencia nace únicamente de aplicar una dosis).
      */}
      <ProgramarDosisDialog
        open={refuerzo != null}
        onOpenChange={(open) => { if (!open) setRefuerzo(null); }}
        petId={mascotaId}
        tiposVacuna={tiposVacuna}
        sugerencia={refuerzo?.mensaje ?? null}
        initialValues={
          refuerzo
            ? { tipoVacunaId: refuerzo.tipoVacunaId, fechaEstimada: refuerzo.fechaEstimada }
            : undefined
        }
        onSaved={() => { void cargarPlanVacunacion(); }}
      />
    </div>
  );
}
