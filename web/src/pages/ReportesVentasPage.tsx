import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Download,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Users,
  Wallet,
  CreditCard,
  Percent,
  ListOrdered,
  ExternalLink,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs.tsx";
import { VentasNav } from "../components/comercial/VentasNav.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollContainer,
} from "../components/ui/table.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { hoyISO, formatFechaISO } from "../lib/fechas.ts";
import { formatMoneda } from "./LotesPage.tsx";
import { exportarACSV } from "./ReportesStockPage.tsx";
import {
  rentabilidad,
  ventasUsuario,
  ventasSesion,
  ventasMedioPago,
} from "../api/comercial/reportes.ts";
import { reporteMargen, reporteItemsVendidos } from "../api/comercial/ventas.ts";
import { listarFamilias, listarProductos } from "../api/comercial/productos.ts";
import { listarUsuarios } from "../api/usuarios.ts";
import { listarCajas } from "../api/comercial/caja.ts";
import { listarMediosPago } from "../api/catalogos-comercial.ts";
import { StockBreadcrumb } from "../components/comercial/StockBreadcrumb.tsx";
import type {
  Caja,
  Familia,
  ItemReporteItemsVendidos,
  ItemReporteMargen,
  MedioPago,
  Producto,
  ReporteRentabilidad,
  ReporteVentasMedioPago,
  ReporteVentasSesion,
  ReporteVentasUsuario,
  TipoItemVenta,
  Usuario,
} from "../types/index.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pestaña: Rentabilidad y Margen Histórico
// ─────────────────────────────────────────────────────────────────────────────

export function TabRentabilidad() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [familiaId, setFamiliaId] = useState<string>("todas");
  const [productoId, setProductoId] = useState<string>("todos");
  const [ordenDesc, setOrdenDesc] = useState<boolean>(true);

  const [familias, setFamilias] = useState<Familia[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);

  const [data, setData] = useState<ReporteRentabilidad | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    Promise.all([
      listarFamilias({ limit: 100 }).catch(() => ({ items: [] })),
      listarProductos({ limit: 100 }).catch(() => ({ items: [] })),
    ]).then(([fRes, pRes]) => {
      if (cancel) return;
      setFamilias(fRes.items);
      setProductos(pRes.items);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await rentabilidad({
        desde: desde || undefined,
        hasta: hasta || undefined,
        familiaId: familiaId !== "todas" ? familiaId : undefined,
        productoId: productoId !== "todos" ? productoId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de rentabilidad");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, familiaId, productoId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const itemsOrdenados = useMemo(() => {
    if (!data) return [];
    return [...data.items].sort((a, b) => {
      return ordenDesc ? b.margenBruto - a.margenBruto : a.margenBruto - b.margenBruto;
    });
  }, [data, ordenDesc]);

  const handleExportCSV = () => {
    if (!data || itemsOrdenados.length === 0) return;
    const encabezados = [
      "Ítem",
      "Tipo",
      "Unidades Vendidas",
      "Total Neto",
      "Costo Histórico",
      "Margen Bruto",
      "Margen %",
    ];
    const filas = itemsOrdenados.map((i) => [
      i.itemNombre,
      i.tipoItem,
      i.cantidadVendida,
      i.netoTotal,
      i.costoTotal,
      i.margenBruto,
      i.margenPct,
    ]);
    exportarACSV(`rentabilidad_ventas_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-rentabilidad-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-rent">Desde</Label>
          <Input
            id="filtro-desde-rent"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-rent">Hasta</Label>
          <Input
            id="filtro-hasta-rent"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-familia-rent">Familia</Label>
          <Select value={familiaId} onValueChange={setFamiliaId}>
            <SelectTrigger id="filtro-familia-rent">
              <SelectValue placeholder="Todas las familias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las familias</SelectItem>
              {familias.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-prod-rent">Producto</Label>
          <Select value={productoId} onValueChange={setProductoId}>
            <SelectTrigger id="filtro-prod-rent">
              <SelectValue placeholder="Todos los productos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los productos</SelectItem>
              {productos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.codigo} - {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw className={`size-4 mr-1.5 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={cargando || !data || itemsOrdenados.length === 0}
          >
            <Download className="size-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Estados */}
      {cargando && (
        <div className="space-y-3" data-testid="cargando-rentabilidad">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-rentabilidad">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar el reporte</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={cargarDatos} className="mt-2 sm:mt-0">
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!cargando && !error && data && (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Margen Bruto Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatMoneda(data.totalMargenBruto)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Ganancia real a costo histórico
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Margen Promedio
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {data.margenPromedioPct}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Sobre el total neto</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Neto
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatMoneda(data.totalNeto)}</div>
                <p className="text-xs text-muted-foreground mt-1">Ingresos sin impuestos</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Costo Histórico Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatMoneda(data.totalCosto)}</div>
                <p className="text-xs text-muted-foreground mt-1">Valuación congelada de lotes</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {itemsOrdenados.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-rentabilidad"
            >
              No se encontraron ventas para los criterios seleccionados.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de rentabilidad por producto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ítem</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Unidades Vendidas</TableHead>
                    <TableHead className="text-right">Total Neto</TableHead>
                    <TableHead className="text-right">Costo Total</TableHead>
                    <TableHead className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-mr-3 h-8 font-semibold"
                        onClick={() => setOrdenDesc(!ordenDesc)}
                      >
                        Margen Bruto {ordenDesc ? "↓" : "↑"}
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">Margen %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemsOrdenados.map((i) => (
                    <TableRow key={i.itemId}>
                      <TableCell className="font-medium">{i.itemNombre}</TableCell>
                      <TableCell className="capitalize text-xs text-muted-foreground">
                        {i.tipoItem}
                      </TableCell>
                      <TableCell className="text-right">{i.cantidadVendida}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoneda(i.netoTotal)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {formatMoneda(i.costoTotal)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatMoneda(i.margenBruto)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {i.margenPct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollContainer>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pestaña: Ventas por Usuario / Vendedor
// ─────────────────────────────────────────────────────────────────────────────

export function TabVentasUsuario() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [usuarioId, setUsuarioId] = useState<string>("todos");

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [data, setData] = useState<ReporteVentasUsuario | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarUsuarios({ limit: 100 })
      .then((res) => {
        if (!cancel) setUsuarios(res.items);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await ventasUsuario({
        desde: desde || undefined,
        hasta: hasta || undefined,
        usuarioId: usuarioId !== "todos" ? usuarioId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de ventas por usuario");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, usuarioId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totales = useMemo(() => {
    if (!data) return { totalVentas: 0, totalOperaciones: 0, totalNeto: 0 };
    return {
      totalVentas: data.reduce((acc, cur) => acc + cur.totalVentas, 0),
      totalOperaciones: data.reduce((acc, cur) => acc + cur.cantidadOperaciones, 0),
      totalNeto: data.reduce((acc, cur) => acc + cur.subtotalNeto, 0),
    };
  }, [data]);

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;
    const encabezados = [
      "Vendedor",
      "Usuario",
      "Operaciones",
      "Subtotal Neto",
      "Total IVA",
      "Descuentos",
      "Total Ventas",
      "Promedio por Operación",
    ];
    const filas = data.map((i) => [
      i.usuarioNombre,
      i.usuarioUsername,
      i.cantidadOperaciones,
      i.subtotalNeto,
      i.totalIva,
      i.totalDescuentos,
      i.totalVentas,
      i.ticketPromedio,
    ]);
    exportarACSV(`ventas_por_usuario_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-usuario-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-usr">Desde</Label>
          <Input
            id="filtro-desde-usr"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-usr">Hasta</Label>
          <Input
            id="filtro-hasta-usr"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-usuario">Vendedor / Usuario</Label>
          <Select value={usuarioId} onValueChange={setUsuarioId}>
            <SelectTrigger id="filtro-usuario">
              <SelectValue placeholder="Todos los usuarios" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los usuarios</SelectItem>
              {usuarios.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.fullName || u.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw className={`size-4 mr-1.5 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={cargando || !data || data.length === 0}
          >
            <Download className="size-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Estados */}
      {cargando && (
        <div className="space-y-3" data-testid="cargando-usuario">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-usuario">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar el reporte</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={cargarDatos} className="mt-2 sm:mt-0">
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!cargando && !error && data && (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Ventas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatMoneda(totales.totalVentas)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Ventas registradas del período</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Operaciones Totales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totales.totalOperaciones}</div>
                <p className="text-xs text-muted-foreground mt-1">Transacciones de venta cerradas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Promedio por Operación General
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totales.totalOperaciones > 0
                    ? formatMoneda(totales.totalVentas / totales.totalOperaciones)
                    : "—"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Promedio por operación</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-usuario"
            >
              No se registraron ventas para el usuario o período seleccionado.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de ventas por usuario">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Operaciones</TableHead>
                    <TableHead className="text-right">Subtotal Neto</TableHead>
                    <TableHead className="text-right">Total IVA</TableHead>
                    <TableHead className="text-right">Descuentos</TableHead>
                    <TableHead className="text-right">Total Ventas</TableHead>
                    <TableHead className="text-right">Promedio por Operación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((i) => (
                    <TableRow key={i.usuarioId}>
                      <TableCell className="font-medium">
                        <div>{i.usuarioNombre}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          @{i.usuarioUsername}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {i.cantidadOperaciones}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoneda(i.subtotalNeto)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoneda(i.totalIva)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-destructive">
                        {i.totalDescuentos > 0 ? `-${formatMoneda(i.totalDescuentos)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatMoneda(i.totalVentas)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoneda(i.ticketPromedio)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollContainer>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pestaña: Ventas por Sesión de Caja
// ─────────────────────────────────────────────────────────────────────────────

export function TabVentasSesion() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [cajaId, setCajaId] = useState<string>("todas");

  // Si listarCajas da 403 (falta manage_cash), se oculta o degrada sin romper la pantalla
  const [cajas, setCajas] = useState<Caja[] | null>([]);
  const [data, setData] = useState<ReporteVentasSesion | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarCajas()
      .then((res) => {
        if (!cancel) setCajas(res);
      })
      .catch(() => {
        // Degradar silenciosamente si no tiene permiso manage_cash
        if (!cancel) setCajas(null);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await ventasSesion({
        desde: desde || undefined,
        hasta: hasta || undefined,
        cajaId: cajaId !== "todas" ? cajaId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de ventas por sesión");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cajaId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totales = useMemo(() => {
    if (!data) return { totalVentas: 0, totalOperaciones: 0, totalSesiones: 0 };
    return {
      totalVentas: data.reduce((acc, cur) => acc + cur.totalVentas, 0),
      totalOperaciones: data.reduce((acc, cur) => acc + cur.cantidadVentas, 0),
      totalSesiones: data.length,
    };
  }, [data]);

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;
    const encabezados = [
      "Caja",
      "Estado",
      "Apertura",
      "Cierre",
      "Usuario Apertura",
      "Usuario Cierre",
      "Operaciones",
      "Total Ventas",
      "Diferencia Arqueo",
    ];
    const filas = data.map((i) => [
      i.cajaNombre,
      i.estado,
      i.aperturaAt,
      i.cierreAt ?? "",
      i.usuarioApertura ?? "",
      i.usuarioCierre ?? "",
      i.cantidadVentas,
      i.totalVentas,
      i.diferencia ?? "",
    ]);
    exportarACSV(`ventas_por_sesion_caja_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-sesion-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-ses">Desde</Label>
          <Input
            id="filtro-desde-ses"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-ses">Hasta</Label>
          <Input
            id="filtro-hasta-ses"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        {/* Solo se muestra si el usuario tiene acceso a cajas */}
        {cajas !== null && (
          <div className="space-y-1 min-w-[200px]" data-testid="filtro-caja-container">
            <Label htmlFor="filtro-caja">Caja</Label>
            <Select value={cajaId} onValueChange={setCajaId}>
              <SelectTrigger id="filtro-caja">
                <SelectValue placeholder="Todas las cajas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las cajas</SelectItem>
                {cajas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw className={`size-4 mr-1.5 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={cargando || !data || data.length === 0}
          >
            <Download className="size-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Estados */}
      {cargando && (
        <div className="space-y-3" data-testid="cargando-sesion">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-sesion">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar el reporte</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={cargarDatos} className="mt-2 sm:mt-0">
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!cargando && !error && data && (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Ventas en Sesiones
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatMoneda(totales.totalVentas)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Suma de ventas en caja</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Operaciones Totales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totales.totalOperaciones}</div>
                <p className="text-xs text-muted-foreground mt-1">Transacciones procesadas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Sesiones Analizadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totales.totalSesiones}</div>
                <p className="text-xs text-muted-foreground mt-1">Sesiones de caja en el período</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-sesion"
            >
              No se registraron sesiones para los criterios seleccionados.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de ventas por sesión de caja">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Caja</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Apertura</TableHead>
                    <TableHead>Cierre</TableHead>
                    <TableHead className="text-right">Operaciones</TableHead>
                    <TableHead className="text-right">Total Ventas</TableHead>
                    <TableHead className="text-right">Diferencia Arqueo</TableHead>
                    <TableHead className="text-center">Arqueo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((i) => (
                    <TableRow key={i.sesionId}>
                      <TableCell className="font-medium">{i.cajaNombre}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            i.estado === "abierta"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {i.estado}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatFechaISO(i.aperturaAt.slice(0, 10))}
                      </TableCell>
                      <TableCell className="text-xs">
                        {i.cierreAt ? formatFechaISO(i.cierreAt.slice(0, 10)) : "En curso"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {i.cantidadVentas}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatMoneda(i.totalVentas)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          i.diferencia !== null && i.diferencia < 0
                            ? "text-destructive font-semibold"
                            : i.diferencia !== null && i.diferencia > 0
                            ? "text-emerald-600 font-semibold"
                            : ""
                        }`}
                      >
                        {i.diferencia !== null ? formatMoneda(i.diferencia) : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/ventas/caja/${i.sesionId}`} title="Ver arqueo de sesión">
                            <ExternalLink className="size-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollContainer>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Pestaña: Ventas por Medio de Pago
// ─────────────────────────────────────────────────────────────────────────────

export function TabVentasMedioPago() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [medioPagoId, setMedioPagoId] = useState<string>("todos");

  const [mediosPago, setMediosPago] = useState<MedioPago[]>([]);
  const [data, setData] = useState<ReporteVentasMedioPago | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarMediosPago()
      .then((res) => {
        if (!cancel) setMediosPago(res);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await ventasMedioPago({
        desde: desde || undefined,
        hasta: hasta || undefined,
        medioPagoId: medioPagoId !== "todos" ? medioPagoId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de ventas por medio de pago");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, medioPagoId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const handleExportCSV = () => {
    if (!data || data.items.length === 0) return;
    const encabezados = [
      "Medio de Pago",
      "Código",
      "Operaciones / Transacciones",
      "Total Recaudado",
      "Porcentaje del Total",
    ];
    const filas = data.items.map((i) => [
      i.medioPagoNombre,
      i.medioPagoCodigo,
      i.cantidadTransacciones,
      i.totalRecaudado,
      `${i.porcentajeDelTotal}%`,
    ]);
    exportarACSV(`ventas_por_medio_pago_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-medio-pago-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-mp">Desde</Label>
          <Input
            id="filtro-desde-mp"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-mp">Hasta</Label>
          <Input
            id="filtro-hasta-mp"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-medio-pago">Medio de Pago</Label>
          <Select value={medioPagoId} onValueChange={setMedioPagoId}>
            <SelectTrigger id="filtro-medio-pago">
              <SelectValue placeholder="Todos los medios de pago" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los medios de pago</SelectItem>
              {mediosPago.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw className={`size-4 mr-1.5 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={cargando || !data || data.items.length === 0}
          >
            <Download className="size-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Estados */}
      {cargando && (
        <div className="space-y-3" data-testid="cargando-medio-pago">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-medio-pago">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar el reporte</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={cargarDatos} className="mt-2 sm:mt-0">
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!cargando && !error && data && (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Gran Total Recaudado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatMoneda(data.granTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Total cobrado en ventas registradas
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Transacciones de Cobro
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.totalTransacciones}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Pagos individuales asentados
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Gráfico de composición por medio de pago */}
          {data.items.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Composición de Cobranzas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.items.map((i) => (
                  <div key={i.medioPagoId} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{i.medioPagoNombre}</span>
                      <span className="font-mono text-muted-foreground">
                        {formatMoneda(i.totalRecaudado)} ({i.porcentajeDelTotal}%)
                      </span>
                    </div>
                    <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                      <div
                        className="bg-primary h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, i.porcentajeDelTotal))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Tabla */}
          {data.items.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-medio-pago"
            >
              No se registraron cobros para los criterios seleccionados.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de ventas por medio de pago">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medio de Pago</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead className="text-right">Transacciones</TableHead>
                    <TableHead className="text-right">Total Recaudado</TableHead>
                    <TableHead className="text-right">% del Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((i) => (
                    <TableRow key={i.medioPagoId}>
                      <TableCell className="font-medium">{i.medioPagoNombre}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {i.medioPagoCodigo}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {i.cantidadTransacciones}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatMoneda(i.totalRecaudado)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {i.porcentajeDelTotal}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollContainer>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Pestaña: Margen por Línea de Venta (/ventas/reportes/margen)
// ─────────────────────────────────────────────────────────────────────────────

export function TabMargenItems() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [tipoItem, setTipoItem] = useState<string>("todos");

  const [data, setData] = useState<ItemReporteMargen[] | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await reporteMargen({
        desde: desde || undefined,
        hasta: hasta || undefined,
        tipoItem: tipoItem !== "todos" ? (tipoItem as TipoItemVenta) : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de margen por ítem");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, tipoItem]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totales = useMemo(() => {
    if (!data) return { totalMargen: 0, totalNeto: 0, totalCosto: 0 };
    return {
      totalMargen: data.reduce((acc, cur) => acc + Number(cur.margen || 0), 0),
      totalNeto: data.reduce((acc, cur) => acc + Number(cur.neto_total || 0), 0),
      totalCosto: data.reduce((acc, cur) => acc + Number(cur.costo_total || 0), 0),
    };
  }, [data]);

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;
    const encabezados = [
      "Fecha",
      "Ítem",
      "Tipo",
      "Cantidad",
      "Importe Total",
      "Neto Total",
      "Costo Histórico",
      "Margen Bruto",
    ];
    const filas = data.map((i) => [
      i.vendido_at ? i.vendido_at.slice(0, 10) : "",
      i.item_nombre,
      i.tipo_item,
      i.cantidad,
      i.importe_total,
      i.neto_total,
      i.costo_total,
      i.margen,
    ]);
    exportarACSV(`margen_items_vendidos_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-margen-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-mrg">Desde</Label>
          <Input
            id="filtro-desde-mrg"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-mrg">Hasta</Label>
          <Input
            id="filtro-hasta-mrg"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[180px]">
          <Label htmlFor="filtro-tipo-mrg">Tipo de Ítem</Label>
          <Select value={tipoItem} onValueChange={setTipoItem}>
            <SelectTrigger id="filtro-tipo-mrg">
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los tipos</SelectItem>
              <SelectItem value="producto">Solo Productos</SelectItem>
              <SelectItem value="servicio">Solo Servicios</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw className={`size-4 mr-1.5 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={cargando || !data || data.length === 0}
          >
            <Download className="size-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Estados */}
      {cargando && (
        <div className="space-y-3" data-testid="cargando-margen">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-margen">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar el reporte</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={cargarDatos} className="mt-2 sm:mt-0">
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!cargando && !error && data && (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Margen Bruto Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatMoneda(totales.totalMargen)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Margen real de líneas registradas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Neto Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatMoneda(totales.totalNeto)}</div>
                <p className="text-xs text-muted-foreground mt-1">Subtotal neto sin impuestos</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Costo Histórico
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatMoneda(totales.totalCosto)}</div>
                <p className="text-xs text-muted-foreground mt-1">Costo efectivo al momento de la venta</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-margen"
            >
              No se encontraron registros de margen para los filtros seleccionados.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de margen por ítem">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Ítem</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Neto Total</TableHead>
                    <TableHead className="text-right">Costo Total</TableHead>
                    <TableHead className="text-right">Margen Bruto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((i, idx) => (
                    <TableRow key={`${i.venta_id}-${i.item_id}-${idx}`}>
                      <TableCell className="text-xs">
                        {i.vendido_at ? formatFechaISO(i.vendido_at.slice(0, 10)) : "—"}
                      </TableCell>
                      <TableCell className="font-medium">{i.item_nombre}</TableCell>
                      <TableCell className="capitalize text-xs text-muted-foreground">
                        {i.tipo_item}
                      </TableCell>
                      <TableCell className="text-right">{i.cantidad}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoneda(i.neto_total)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {formatMoneda(i.costo_total)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatMoneda(i.margen)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollContainer>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pestaña: Detalle de Ítems Vendidos (/ventas/reportes/items-vendidos)
// ─────────────────────────────────────────────────────────────────────────────

export function TabItemsVendidos() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [tipoItem, setTipoItem] = useState<string>("todos");

  const [data, setData] = useState<ItemReporteItemsVendidos[] | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await reporteItemsVendidos({
        desde: desde || undefined,
        hasta: hasta || undefined,
        tipoItem: tipoItem !== "todos" ? (tipoItem as TipoItemVenta) : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de ítems vendidos");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, tipoItem]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totales = useMemo(() => {
    if (!data) return { totalCantidad: 0, totalImporte: 0, lineas: 0 };
    return {
      totalCantidad: data.reduce((acc, cur) => acc + Number(cur.cantidad || 0), 0),
      totalImporte: data.reduce((acc, cur) => acc + Number(cur.importe_total || 0), 0),
      lineas: data.length,
    };
  }, [data]);

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;
    const encabezados = [
      "Operación N°",
      "Fecha",
      "Ítem",
      "Tipo",
      "Cantidad",
      "Precio Unitario",
      "Neto Unitario",
      "IVA Unitario",
      "Importe Total",
      "Costo Efectivo",
    ];
    const filas = data.map((i) => [
      i.numero_operacion,
      i.vendido_at ? i.vendido_at.slice(0, 10) : "",
      i.item_nombre,
      i.tipo_item,
      i.cantidad,
      i.precio_unitario,
      i.neto_unitario,
      i.iva_unitario,
      i.importe_total,
      i.costo_unitario_efectivo ?? "",
    ]);
    exportarACSV(`items_vendidos_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-items-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-it">Desde</Label>
          <Input
            id="filtro-desde-it"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-it">Hasta</Label>
          <Input
            id="filtro-hasta-it"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[180px]">
          <Label htmlFor="filtro-tipo-it">Tipo de Ítem</Label>
          <Select value={tipoItem} onValueChange={setTipoItem}>
            <SelectTrigger id="filtro-tipo-it">
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los tipos</SelectItem>
              <SelectItem value="producto">Solo Productos</SelectItem>
              <SelectItem value="servicio">Solo Servicios</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw className={`size-4 mr-1.5 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={cargando || !data || data.length === 0}
          >
            <Download className="size-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Estados */}
      {cargando && (
        <div className="space-y-3" data-testid="cargando-items">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-items">
          <AlertCircle className="size-4" />
          <AlertTitle>Error al cargar el reporte</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={cargarDatos} className="mt-2 sm:mt-0">
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!cargando && !error && data && (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unidades Totales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totales.totalCantidad.toLocaleString("es-AR")}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Cantidad acumulada de ítems</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Importe Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatMoneda(totales.totalImporte)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Importe total de las líneas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Líneas de Venta
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totales.lineas}</div>
                <p className="text-xs text-muted-foreground mt-1">Registros individuales procesados</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-items"
            >
              No se encontraron ítems vendidos para los criterios seleccionados.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de ítems vendidos">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operación N°</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Ítem</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Precio Unit.</TableHead>
                    <TableHead className="text-right">Neto Unit.</TableHead>
                    <TableHead className="text-right">IVA Unit.</TableHead>
                    <TableHead className="text-right">Importe Total</TableHead>
                    <TableHead className="text-right">Costo Unit.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((i, idx) => (
                    <TableRow key={`${i.venta_id}-${i.item_id}-${idx}`}>
                      <TableCell className="font-mono text-xs font-semibold">
                        #{i.numero_operacion}
                      </TableCell>
                      <TableCell className="text-xs">
                        {i.vendido_at ? formatFechaISO(i.vendido_at.slice(0, 10)) : "—"}
                      </TableCell>
                      <TableCell className="font-medium">{i.item_nombre}</TableCell>
                      <TableCell className="capitalize text-xs text-muted-foreground">
                        {i.tipo_item}
                      </TableCell>
                      <TableCell className="text-right font-medium">{i.cantidad}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoneda(i.precio_unitario)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatMoneda(i.neto_unitario)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatMoneda(i.iva_unitario)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatMoneda(i.importe_total)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {i.costo_unitario_efectivo !== null
                          ? formatMoneda(i.costo_unitario_efectivo)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollContainer>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente Principal: ReportesVentasPage
// ─────────────────────────────────────────────────────────────────────────────

export function ReportesVentasPage() {
  const [activeTab, setActiveTab] = useState<string>("rentabilidad");

  return (
    <div className="space-y-6">
      <VentasNav />
      <StockBreadcrumb
        raiz={{ label: "Ventas", href: "/ventas" }}
        items={[{ label: "Reportes" }]}
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes de Ventas</h1>
        <p className="text-sm text-muted-foreground">
          Rentabilidad histórica, rendimiento por vendedor, sesiones de caja y medios de pago.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 w-full h-auto p-1 gap-1">
          <TabsTrigger value="rentabilidad" className="flex items-center gap-2 py-2">
            <TrendingUp className="size-4 shrink-0" />
            <span>Rentabilidad</span>
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="flex items-center gap-2 py-2">
            <Users className="size-4 shrink-0" />
            <span>Por Vendedor</span>
          </TabsTrigger>
          <TabsTrigger value="sesiones" className="flex items-center gap-2 py-2">
            <Wallet className="size-4 shrink-0" />
            <span>Sesiones Caja</span>
          </TabsTrigger>
          <TabsTrigger value="medios-pago" className="flex items-center gap-2 py-2">
            <CreditCard className="size-4 shrink-0" />
            <span>Medios de Pago</span>
          </TabsTrigger>
          <TabsTrigger value="margen" className="flex items-center gap-2 py-2">
            <Percent className="size-4 shrink-0" />
            <span>Margen Líneas</span>
          </TabsTrigger>
          <TabsTrigger value="items-vendidos" className="flex items-center gap-2 py-2">
            <ListOrdered className="size-4 shrink-0" />
            <span>Ítems Vendidos</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rentabilidad" className="focus-visible:outline-none">
          {activeTab === "rentabilidad" && <TabRentabilidad />}
        </TabsContent>

        <TabsContent value="usuarios" className="focus-visible:outline-none">
          {activeTab === "usuarios" && <TabVentasUsuario />}
        </TabsContent>

        <TabsContent value="sesiones" className="focus-visible:outline-none">
          {activeTab === "sesiones" && <TabVentasSesion />}
        </TabsContent>

        <TabsContent value="medios-pago" className="focus-visible:outline-none">
          {activeTab === "medios-pago" && <TabVentasMedioPago />}
        </TabsContent>

        <TabsContent value="margen" className="focus-visible:outline-none">
          {activeTab === "margen" && <TabMargenItems />}
        </TabsContent>

        <TabsContent value="items-vendidos" className="focus-visible:outline-none">
          {activeTab === "items-vendidos" && <TabItemsVendidos />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ReportesVentasPage;
