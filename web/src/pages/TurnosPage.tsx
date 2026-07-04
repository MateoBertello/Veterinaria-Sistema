import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { Button } from "../components/ui/button.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Input } from "../components/ui/input.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { listarTurnosPorFecha } from "../api/turnos.ts";
import { ApiError, type EstadoTurno, type Turno } from "../types/index.ts";

const COLUMNAS = 5;

// Paleta fijada en el Addendum v1.1 (pantalla 2, modal de detalle) para distinguir
// los 4 estados del ciclo de vida; se reutiliza igual cuando se conecte el modal en 6d-3.
const ESTADO_BADGE_CLASS: Record<EstadoTurno, string> = {
  Programado: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  Confirmado: "bg-green-100 text-green-800 hover:bg-green-100",
  Completado: "bg-gray-100 text-gray-800 hover:bg-gray-100",
  Cancelado: "bg-red-100 text-red-800 hover:bg-red-100",
};

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDias(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + delta);
  return fecha.toISOString().slice(0, 10);
}

function formatFechaLarga(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function abrirDetalle(turno: Turno) {
  void turno; // el modal de detalle con acciones por estado se conecta en 6d-3
}

export function TurnosPage() {
  const [fecha, setFecha] = useState(hoyISO());
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTurnos(await listarTurnosPorFecha(fecha));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la agenda");
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function irA(iso: string) {
    if (iso) setFecha(iso);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <CalendarDays className="size-6" aria-hidden />
          Agenda de Turnos
        </h1>
        <p className="text-sm text-muted-foreground">
          Turnos programados y confirmados para la fecha seleccionada.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Día anterior"
            onClick={() => irA(addDias(fecha, -1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="min-w-56 text-center text-sm font-medium capitalize">
            {formatFechaLarga(fecha)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Día siguiente"
            onClick={() => irA(addDias(fecha, 1))}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={fecha === hoyISO()}
          onClick={() => irA(hoyISO())}
        >
          Hoy
        </Button>

        <Input
          type="date"
          aria-label="Elegir fecha de la agenda"
          className="w-40"
          value={fecha}
          onChange={(e) => irA(e.target.value)}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Hora</TableHead>
              <TableHead>Servicio</TableHead>
              <TableHead className="hidden md:table-cell">Doctor</TableHead>
              <TableHead>Mascota / Cliente</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={COLUMNAS} className="py-10 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
                    Reintentar
                  </Button>
                </TableCell>
              </TableRow>
            ) : turnos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNAS} className="py-10 text-center text-sm text-muted-foreground">
                  No hay turnos para el {formatFechaLarga(fecha)}.
                </TableCell>
              </TableRow>
            ) : (
              turnos.map((t) => (
                <TableRow
                  key={t.id}
                  tabIndex={0}
                  aria-label={`Turno de ${t.mascota?.name ?? "sin mascota"} a las ${t.startTime}, estado ${t.status}`}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-500"
                  onClick={() => abrirDetalle(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      abrirDetalle(t);
                    }
                  }}
                >
                  <TableCell className="font-medium">
                    {t.startTime} – {t.endTime}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{t.servicio?.nombre ?? "—"}</span>
                      {t.servicio ? (
                        <span className="text-xs text-muted-foreground">
                          {t.servicio.duracionMinutos} min
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.doctor?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{t.mascota?.name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.cliente?.fullName ?? "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={ESTADO_BADGE_CLASS[t.status]}>{t.status}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: COLUMNAS }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
