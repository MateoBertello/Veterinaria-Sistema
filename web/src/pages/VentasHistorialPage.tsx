import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ShoppingCart,
  ArrowLeft,
  Filter,
  RefreshCw,
  AlertCircle,
  Eye,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext.tsx";
import { VentasNav } from "../components/comercial/VentasNav.tsx";
import { listarVentas, type ListarVentasParams } from "../api/comercial/ventas.ts";
import { listarUsuarios } from "../api/usuarios.ts";
import type { EstadoVenta, Usuario, Venta } from "../types/index.ts";
import { formatMoneda } from "./LotesPage.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Badge } from "../components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { StockBreadcrumb } from "../components/comercial/StockBreadcrumb.tsx";

export default function VentasHistorialPage() {
  const { user } = useAuth();
  const canViewAllSales = Boolean(user?.permissions?.includes("view_sales"));

  const [searchParams, setSearchParams] = useSearchParams();

  // Filtros
  const [desde, setDesde] = useState(searchParams.get("desde") ?? "");
  const [hasta, setHasta] = useState(searchParams.get("hasta") ?? "");
  const [estado, setEstado] = useState<EstadoVenta | "">(
    (searchParams.get("estado") as EstadoVenta) ?? "",
  );
  const [usuarioId, setUsuarioId] = useState(searchParams.get("usuarioId") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const limit = 20;

  // Lista de vendedores (solo cargada si tiene view_sales)
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);

  // Estado de datos
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cargar vendedores si tiene permiso view_sales
  useEffect(() => {
    if (!canViewAllSales) return;
    let cancel = false;
    listarUsuarios({ limit: 100 })
      .then((res) => {
        if (!cancel) setUsuarios(res.items);
      })
      .catch(() => {
        // Silencioso si falla
      });
    return () => {
      cancel = true;
    };
  }, [canViewAllSales]);

  // Cargar ventas
  const fetchVentas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ListarVentasParams = {
        page,
        limit,
      };
      if (desde) params.desde = desde;
      if (hasta) params.hasta = hasta;
      if (estado) params.estado = estado as EstadoVenta;
      // Solo mandar usuarioId si el llamador tiene view_sales (§8.2)
      if (canViewAllSales && usuarioId) {
        params.usuarioId = usuarioId;
      }

      const res = await listarVentas(params);
      setVentas(res.items);
      setTotalCount(res.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar historial de ventas");
    } finally {
      setLoading(false);
    }
  }, [page, limit, desde, hasta, estado, usuarioId, canViewAllSales]);

  useEffect(() => {
    void fetchVentas();
  }, [fetchVentas]);

  const totalPages = Math.ceil(totalCount / limit) || 1;

  const handleLimpiarFiltros = () => {
    setDesde("");
    setHasta("");
    setEstado("");
    setUsuarioId("");
    setPage(1);
    setSearchParams({});
  };

  return (
    <div className="space-y-6">
      <VentasNav />
      <StockBreadcrumb
        raiz={{ label: "Ventas", href: "/ventas" }}
        items={[{ label: "Historial" }]}
      />
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              to="/ventas/mostrador"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="size-3" />
              Volver al Mostrador
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <ShoppingCart className="size-6 text-orange-600" aria-hidden />
            Historial de Ventas
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro de operaciones comerciales realizadas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/ventas/mostrador">
              <ShoppingCart className="size-4 mr-1.5" />
              Ir al Mostrador
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchVentas()}
            disabled={loading}
          >
            <RefreshCw className={`size-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Tarjeta de Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="size-4 text-orange-600" />
            Filtros de búsqueda
          </CardTitle>
          <CardDescription>
            Filtrá las operaciones por fecha, estado o vendedor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Fecha Desde */}
            <div className="space-y-1">
              <Label htmlFor="filtro-desde" className="text-xs">
                Fecha Desde
              </Label>
              <Input
                id="filtro-desde"
                type="date"
                value={desde}
                onChange={(e) => {
                  setDesde(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs"
              />
            </div>

            {/* Fecha Hasta */}
            <div className="space-y-1">
              <Label htmlFor="filtro-hasta" className="text-xs">
                Fecha Hasta
              </Label>
              <Input
                id="filtro-hasta"
                type="date"
                value={hasta}
                onChange={(e) => {
                  setHasta(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs"
              />
            </div>

            {/* Estado */}
            <div className="space-y-1">
              <Label htmlFor="filtro-estado" className="text-xs">
                Estado
              </Label>
              <select
                id="filtro-estado"
                value={estado}
                onChange={(e) => {
                  setEstado(e.target.value as EstadoVenta | "");
                  setPage(1);
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Todos los estados</option>
                <option value="registrada">Registrada</option>
                <option value="anulada">Anulada</option>
              </select>
            </div>

            {/* Vendedor: SOLO si tiene view_sales (§8.2) */}
            {canViewAllSales && (
              <div className="space-y-1">
                <Label htmlFor="filtro-vendedor" className="text-xs">
                  Vendedor
                </Label>
                <select
                  id="filtro-vendedor"
                  value={usuarioId}
                  onChange={(e) => {
                    setUsuarioId(e.target.value);
                    setPage(1);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Todos los vendedores</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName || u.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLimpiarFiltros}
              className="text-xs text-muted-foreground"
            >
              Limpiar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de Resultados */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : error ? (
            <div className="p-8">
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>No se pudo cargar el historial de ventas</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>{error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchVentas()}
                  >
                    Reintentar
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : ventas.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <ShoppingCart className="size-10 text-muted-foreground mx-auto stroke-1" />
              <div className="text-sm font-medium text-muted-foreground">
                {/* Copy cuidadoso del estado vacío (§8.2): */}
                {canViewAllSales
                  ? "No hay ventas con estos filtros."
                  : "No registraste ventas con estos filtros."}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold text-xs whitespace-nowrap">
                      Operación N°
                    </TableHead>
                    <TableHead className="font-semibold text-xs whitespace-nowrap">
                      Fecha / Hora
                    </TableHead>
                    <TableHead className="font-semibold text-xs">
                      Cliente
                    </TableHead>
                    <TableHead className="font-semibold text-xs">
                      Vendedor
                    </TableHead>
                    <TableHead className="font-semibold text-xs">
                      Condición
                    </TableHead>
                    <TableHead className="font-semibold text-xs text-right whitespace-nowrap">
                      Total
                    </TableHead>
                    <TableHead className="font-semibold text-xs text-right whitespace-nowrap">
                      Saldo pendiente
                    </TableHead>
                    <TableHead className="font-semibold text-xs text-center">
                      Estado
                    </TableHead>
                    <TableHead className="font-semibold text-xs text-right">
                      Acciones
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ventas.map((v) => {
                    const esAnulada = v.estado === "anulada";
                    const fechaFmt = new Date(v.createdAt).toLocaleString("es-AR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    });

                    return (
                      <TableRow key={v.id} className={esAnulada ? "opacity-75 bg-muted/20" : ""}>
                        <TableCell className="font-mono text-xs font-semibold whitespace-nowrap">
                          <Link
                            to={`/ventas/${v.id}`}
                            className="text-orange-600 hover:text-orange-700 hover:underline"
                          >
                            Operación N° {v.numeroOperacion}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fechaFmt}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          {v.cliente?.full_name || "Mostrador"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {v.usuario?.full_name || "—"}
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {v.condicionPago === "contado" ? "Contado" : "Cuenta Corriente"}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-medium text-right whitespace-nowrap">
                          {formatMoneda(v.total)}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right whitespace-nowrap">
                          {v.saldoPendiente > 0 ? (
                            <span className="text-amber-600 font-semibold">
                              {formatMoneda(v.saldoPendiente)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">$ 0,00</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={esAnulada ? "destructive" : "default"}
                            className={
                              esAnulada
                                ? ""
                                : "bg-emerald-600 hover:bg-emerald-700 text-white"
                            }
                          >
                            {v.estado}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                            <Link to={`/ventas/${v.id}`}>
                              <Eye className="size-3.5 mr-1" />
                              Ver
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Paginación */}
      {!loading && !error && totalCount > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <div>
            Mostrando {ventas.length} de {totalCount} operaciones (Página {page} de {totalPages})
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-8 text-xs"
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-8 text-xs"
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
