import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.tsx";
import { DoctorCombobox } from "../components/horarios/DoctorCombobox.tsx";
import { FranjaFormDialog } from "../components/horarios/FranjaFormDialog.tsx";
import { EliminarFranjaDialog } from "../components/horarios/EliminarFranjaDialog.tsx";
import {
  alternarFranja,
  crearFranja,
  eliminarFranja,
  listarHorariosDeDoctor,
} from "../api/horarios.ts";
import { listarDoctores } from "../api/doctores.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { ApiError, type Doctor, type Franja } from "../types/index.ts";

const DIA_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function HorariosPage() {
  const { user } = useAuth();
  // RN-HOR7: quien no administra la clínica solo puede tocar SU horario, así que
  // no se le ofrece un selector donde casi toda opción terminaría en 403: se le
  // precarga su propio perfil profesional.
  const esAdmin = user?.permissions.includes("manage_users") ?? false;

  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [perfilPropioError, setPerfilPropioError] = useState<string | null>(null);
  const [franjas, setFranjas] = useState<Franja[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Franja | null>(null);
  const [toEliminar, setToEliminar] = useState<Franja | null>(null);

  const cargar = useCallback(async () => {
    if (!doctor) return;
    setLoading(true);
    setError(null);
    try {
      setFranjas(await listarHorariosDeDoctor(doctor.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los horarios");
    } finally {
      setLoading(false);
    }
  }, [doctor]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Profesional no administrador: se resuelve su propio perfil por el userId de
  // la sesión (`Doctor.userId`) y queda fijo.
  useEffect(() => {
    if (esAdmin || !user) return;
    let activo = true;

    listarDoctores({ limit: 100 })
      .then(({ items }) => {
        if (!activo) return;
        const propio = items.find((d) => d.userId === user.id);
        if (propio) setDoctor(propio);
        else {
          setPerfilPropioError(
            "Tu usuario no tiene un perfil profesional asociado, así que no tenés horarios propios que gestionar.",
          );
        }
      })
      .catch((err) => {
        if (activo) {
          setPerfilPropioError(
            err instanceof ApiError ? err.message : "No se pudo cargar tu perfil profesional",
          );
        }
      });

    return () => { activo = false; };
  }, [esAdmin, user]);

  function abrirNueva() { setEditing(null); setFormOpen(true); }
  function abrirEdicion(f: Franja) { setEditing(f); setFormOpen(true); }

  async function toggleActiva(f: Franja) {
    try {
      const actualizada = await alternarFranja(f.id, !f.active);
      setFranjas((prev) => prev.map((x) => (x.id === actualizada.id ? actualizada : x)));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      setError(message);
    }
  }

  const porDia: Franja[][] = Array.from({ length: 7 }, (_, dia) =>
    franjas.filter((f) => f.dayOfWeek === dia),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <CalendarClock className="size-6" aria-hidden />
          Horarios de Atención
        </h1>
        <p className="text-sm text-muted-foreground">
          Franjas semanales por profesional; alimentan los turnos disponibles.
        </p>
      </header>

      {esAdmin ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Doctor</p>
          <DoctorCombobox value={doctor} onChange={setDoctor} />
        </div>
      ) : null}

      {!doctor ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {esAdmin
              ? "Elegí un doctor para ver y gestionar sus horarios."
              : perfilPropioError ?? "Cargando tu perfil profesional…"}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{doctor.name}</p>
              {doctor.specialty ? (
                <p className="text-sm text-muted-foreground">{doctor.specialty}</p>
              ) : null}
            </div>
            <Button onClick={abrirNueva}>
              <Plus className="size-4" aria-hidden />
              Agregar franja
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
                  Reintentar
                </Button>
              </CardContent>
            </Card>
          ) : franjas.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Este doctor todavía no tiene franjas configuradas.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {porDia.map((delDia, dia) =>
                delDia.length === 0 ? null : (
                  <Card key={dia}>
                    <CardHeader className="bg-gradient-to-r from-orange-50 to-white">
                      <CardTitle className="text-base">{DIA_LABEL[dia]}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {delDia.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-3 rounded-md border p-3"
                        >
                          <div className="flex items-center gap-3">
                            <Badge variant="outline">
                              {f.startTime} – {f.endTime}
                            </Badge>
                            {f.active ? (
                              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>
                            ) : (
                              <Badge variant="secondary">Inactiva</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={f.active}
                              onCheckedChange={() => void toggleActiva(f)}
                              aria-label={f.active ? `Desactivar franja ${f.startTime} a ${f.endTime}` : `Activar franja ${f.startTime} a ${f.endTime}`}
                            />
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Editar franja ${f.startTime} a ${f.endTime}`}
                                  onClick={() => abrirEdicion(f)}
                                >
                                  <Pencil className="size-4" aria-hidden />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Editar</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Eliminar franja ${f.startTime} a ${f.endTime}`}
                                  onClick={() => setToEliminar(f)}
                                >
                                  <Trash2 className="size-4" aria-hidden />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Eliminar</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ),
              )}
            </div>
          )}

          <FranjaFormDialog
            doctorId={doctor.id}
            franja={editing}
            open={formOpen}
            onOpenChange={setFormOpen}
            crearFranja={crearFranja}
            eliminarFranja={eliminarFranja}
            onSaved={() => void cargar()}
          />

          <EliminarFranjaDialog
            franja={toEliminar}
            open={Boolean(toEliminar)}
            onOpenChange={(o) => !o && setToEliminar(null)}
            eliminarFranja={eliminarFranja}
            onSuccess={() => void cargar()}
          />
        </>
      )}
    </div>
  );
}
