import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Stethoscope } from "lucide-react";
import { Card, CardContent } from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { ClienteCombobox } from "../components/historial/ClienteCombobox.tsx";
import { listarMascotas } from "../api/mascotas.ts";
import { ApiError, type Cliente, type Mascota } from "../types/index.ts";

/**
 * Punto de entrada del módulo Historial Clínico desde el sidebar: elegir
 * dueño y mascota, y navegar al mismo `/historial/:mascotaId` que se usa
 * desde la ficha de la mascota en el módulo Mascotas.
 */
export function HistorialClinicoIndexPage() {
  const navigate = useNavigate();

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [mascotas, setMascotas] = useState<Mascota[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cliente) {
      setMascotas([]);
      return;
    }
    setLoading(true);
    setError(null);
    listarMascotas({ clientId: cliente.id, limit: 100 })
      .then(({ items }) => setMascotas(items))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "No se pudieron cargar las mascotas");
      })
      .finally(() => setLoading(false));
  }, [cliente]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Stethoscope className="size-6" aria-hidden />
          Historial Clínico
        </h1>
        <p className="text-sm text-muted-foreground">
          Elegí un dueño y una mascota para consultar su historial clínico.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Dueño</p>
            <ClienteCombobox value={cliente} onChange={setCliente} />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Mascota</p>
            {!cliente ? (
              <p className="text-sm text-muted-foreground">Elegí primero un dueño.</p>
            ) : loading ? (
              <Skeleton className="h-9 w-full max-w-sm" />
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : mascotas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este cliente no tiene mascotas registradas.</p>
            ) : (
              <Select
                onValueChange={(mascotaId) =>
                  navigate(`/historial/${mascotaId}`, { state: { from: "historial" } })
                }
              >
                <SelectTrigger aria-label="Mascota" className="max-w-sm">
                  <SelectValue placeholder="Seleccionar mascota..." />
                </SelectTrigger>
                <SelectContent>
                  {mascotas.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}{m.estado === "Fallecida" ? " (Fallecida)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
