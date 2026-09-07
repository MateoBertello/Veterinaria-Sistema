import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, AlertCircle, TrendingDown, Layers, Scissors, UserCheck, Dog } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs.tsx";
import { StockBreadcrumb } from "../components/comercial/StockBreadcrumb.tsx";
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
import {
  valorizacionAFecha,
  rotacion,
  fraccionamiento as reporteFraccionamiento,
  consumoProfesional,
  consumoEspecie,
} from "../api/comercial/reportes.ts";
import { listarFamilias, listarProductos } from "../api/comercial/productos.ts";
import { listarDoctores } from "../api/doctores.ts";
import { listarEspecies } from "../api/catalogos.ts";
import type {
  Familia,
  Producto,
  Doctor,
  Especie,
  ReporteValorizacion,
  ReporteRotacion,
  ReporteFraccionamiento,
  ReporteConsumoProfesional,
  ReporteConsumoEspecie,
} from "../types/index.ts";

/** Helper para descargar CSV en el cliente sin endpoints de export */
export function exportarACSV(
  nombreArchivo: string,
  encabezados: string[],
  filas: (string | number | null | undefined)[][],
): void {
  const escapar = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const lineas = [
    encabezados.map(escapar).join(","),
    ...filas.map((fila) => fila.map(escapar).join(",")),
  ];

  const blob = new Blob([lineas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${nombreArchivo}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pestaña: Valorización a fecha corte
// ─────────────────────────────────────────────────────────────────────────────

export function TabValorizacion() {
  const [fechaCorte, setFechaCorte] = useState<string>(hoyISO());
  const [familiaId, setFamiliaId] = useState<string>("todas");
  const [productoId, setProductoId] = useState<string>("todos");

  const [familias, setFamilias] = useState<Familia[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);

  const [data, setData] = useState<ReporteValorizacion | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Cargar catálogos auxiliares de filtro
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
      const res = await valorizacionAFecha({
        fechaCorte: fechaCorte || undefined,
        familiaId: familiaId !== "todas" ? familiaId : undefined,
        productoId: productoId !== "todos" ? productoId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de valorización");
    } finally {
      setCargando(false);
    }
  }, [fechaCorte, familiaId, productoId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const handleExportCSV = () => {
    if (!data || data.items.length === 0) return;
    const encabezados = [
      "Código",
      "Producto",
      "Familia",
      "Lote",
      "Vencimiento",
      "Cantidad",
      "Unidad",
      "Costo Unitario",
      "Valor Total",
    ];
    const filas = data.items.map((i) => [
      i.productoCodigo,
      i.productoNombre,
      i.familiaNombre ?? "",
      i.codigoLote ?? "",
      i.fechaVencimiento ?? "",
      i.cantidadAFecha,
      i.unidadMedida,
      i.costoUnitarioEfectivo,
      i.valorTotal,
    ]);
    exportarACSV(`valorizacion_stock_${fechaCorte || hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-valorizacion-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-fecha-corte">Fecha de corte</Label>
          <Input
            id="filtro-fecha-corte"
            type="date"
            className="w-44"
            value={fechaCorte}
            onChange={(e) => setFechaCorte(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-familia">Familia</Label>
          <Select value={familiaId} onValueChange={setFamiliaId}>
            <SelectTrigger id="filtro-familia">
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

        <div className="space-y-1 min-w-[220px]">
          <Label htmlFor="filtro-producto">Producto</Label>
          <Select value={productoId} onValueChange={setProductoId}>
            <SelectTrigger id="filtro-producto">
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
            disabled={cargando || !data || data.items.length === 0}
          >
            <Download className="size-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Estados */}
      {cargando && (
        <div className="space-y-3" data-testid="cargando-valorizacion">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-valorizacion">
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
          {/* Tarjetas de totales */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Valorización Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatMoneda(data.valorizacionTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Al corte {formatFechaISO(data.fechaCorte.slice(0, 10))}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total de Unidades
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.totalUnidades.toLocaleString("es-AR")}</div>
                <p className="text-xs text-muted-foreground mt-1">Suma de existencias por lote</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Lotes con Existencia
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.totalLineas}</div>
                <p className="text-xs text-muted-foreground mt-1">Líneas de inventario activas</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.items.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-valorizacion"
            >
              No se encontraron registros de inventario a la fecha de corte seleccionada.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de valorización de stock">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Familia</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Costo Unitario</TableHead>
                    <TableHead className="text-right">Valor Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((i) => (
                    <TableRow key={i.loteId}>
                      <TableCell className="font-medium">
                        <div>{i.productoNombre}</div>
                        <div className="text-xs text-muted-foreground font-mono">{i.productoCodigo}</div>
                      </TableCell>
                      <TableCell>{i.familiaNombre ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{i.codigoLote ?? "—"}</TableCell>
                      <TableCell>
                        {i.fechaVencimiento ? formatFechaISO(i.fechaVencimiento.slice(0, 10)) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {i.cantidadAFecha} <span className="text-xs font-normal text-muted-foreground">{i.unidadMedida}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoneda(i.costoUnitarioEfectivo)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-sm">
                        {formatMoneda(i.valorTotal)}
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
// 2. Pestaña: Rotación e Inmovilizado
// ─────────────────────────────────────────────────────────────────────────────

export function TabRotacion() {
  const [diasSinMovimiento, setDiasSinMovimiento] = useState<number>(30);
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [familiaId, setFamiliaId] = useState<string>("todas");

  const [familias, setFamilias] = useState<Familia[]>([]);
  const [data, setData] = useState<ReporteRotacion | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarFamilias({ limit: 100 })
      .then((res) => {
        if (!cancel) setFamilias(res.items);
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
      const res = await rotacion({
        diasSinMovimiento: diasSinMovimiento >= 1 ? diasSinMovimiento : 30,
        desde: desde || undefined,
        hasta: hasta || undefined,
        familiaId: familiaId !== "todas" ? familiaId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de rotación");
    } finally {
      setCargando(false);
    }
  }, [diasSinMovimiento, desde, hasta, familiaId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const itemsOrdenados = useMemo(() => {
    if (!data) return [];
    return [...data.items].sort((a, b) => b.diasSinMovimiento - a.diasSinMovimiento);
  }, [data]);

  const handleExportCSV = () => {
    if (!data || itemsOrdenados.length === 0) return;
    const encabezados = [
      "Código",
      "Producto",
      "Familia",
      "Stock Actual",
      "Días sin Movimiento",
      "Sin Movimiento",
      "Último Movimiento",
      "Salidas Período",
      "Costo Reposición",
      "Valor Inmovilizado",
    ];
    const filas = itemsOrdenados.map((i) => [
      i.codigo,
      i.nombre,
      i.familiaNombre ?? "",
      i.stockActual,
      i.diasSinMovimiento,
      i.sinMovimiento ? "SÍ" : "NO",
      i.ultimoMovimientoAt ?? "",
      i.totalSalidasPeriodo,
      i.costoReposicion,
      i.valorInmovilizado,
    ]);
    exportarACSV(`rotacion_stock_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-rotacion-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-dias">Días sin movimiento (umbral)</Label>
          <Input
            id="filtro-dias"
            type="number"
            min={1}
            className="w-32"
            value={diasSinMovimiento}
            onChange={(e) => setDiasSinMovimiento(Number(e.target.value))}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-desde-rot">Desde</Label>
          <Input
            id="filtro-desde-rot"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-rot">Hasta</Label>
          <Input
            id="filtro-hasta-rot"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-familia-rot">Familia</Label>
          <Select value={familiaId} onValueChange={setFamiliaId}>
            <SelectTrigger id="filtro-familia-rot">
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
        <div className="space-y-3" data-testid="cargando-rotacion">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-rotacion">
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
                  Capital Inmovilizado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {formatMoneda(data.capitalInmovilizadoTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  En productos sin movimientos &gt; {data.diasLimite} días
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Productos Inmovilizados
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {data.totalSinMovimiento}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Con stock &gt; 0 sin salida reciente
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total de Productos Analizados
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.totalProductos}</div>
                <p className="text-xs text-muted-foreground mt-1">Productos activos del catálogo</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {itemsOrdenados.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-rotacion"
            >
              No se encontraron productos para los criterios seleccionados.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de rotación de stock">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Familia</TableHead>
                    <TableHead className="text-right">Stock Actual</TableHead>
                    <TableHead className="text-center">Días sin Movimiento</TableHead>
                    <TableHead>Último Movimiento</TableHead>
                    <TableHead className="text-right">Salidas en Período</TableHead>
                    <TableHead className="text-right">Costo Reposición</TableHead>
                    <TableHead className="text-right">Valor Inmovilizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemsOrdenados.map((i) => {
                    const esInmovilizado = i.sinMovimiento && i.stockActual > 0;
                    return (
                      <TableRow key={i.productoId}>
                        <TableCell className="font-medium">
                          <div>{i.nombre}</div>
                          <div className="text-xs text-muted-foreground font-mono">{i.codigo}</div>
                        </TableCell>
                        <TableCell>{i.familiaNombre ?? "—"}</TableCell>
                        <TableCell className="text-right font-medium">{i.stockActual}</TableCell>
                        <TableCell className="text-center">
                          {esInmovilizado ? (
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                              title="Supera el umbral de inmovilizado"
                            >
                              {i.diasSinMovimiento === 999 ? "Sin mov." : `${i.diasSinMovimiento} d`}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground font-mono">
                              {i.diasSinMovimiento === 999 ? "—" : `${i.diasSinMovimiento} d`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {i.ultimoMovimientoAt
                            ? formatFechaISO(i.ultimoMovimientoAt.slice(0, 10))
                            : "Sin movimientos"}
                        </TableCell>
                        <TableCell className="text-right">{i.totalSalidasPeriodo}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatMoneda(i.costoReposicion)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium text-sm">
                          {formatMoneda(i.valorInmovilizado)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
// 3. Pestaña: Mermas y Rendimiento de Fraccionamiento
// ─────────────────────────────────────────────────────────────────────────────

export function TabFraccionamiento() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [productoOrigenId, setProductoOrigenId] = useState<string>("todos");
  const [productoDestinoId, setProductoDestinoId] = useState<string>("todos");

  const [productos, setProductos] = useState<Producto[]>([]);
  const [data, setData] = useState<ReporteFraccionamiento | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarProductos({ limit: 100 })
      .then((res) => {
        if (!cancel) setProductos(res.items);
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
      const res = await reporteFraccionamiento({
        desde: desde || undefined,
        hasta: hasta || undefined,
        productoOrigenId: productoOrigenId !== "todos" ? productoOrigenId : undefined,
        productoDestinoId: productoDestinoId !== "todos" ? productoDestinoId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de fraccionamiento");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, productoOrigenId, productoDestinoId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totales = useMemo(() => {
    if (!data) return { mermaTotal: 0, sobrecostoTotal: 0, totalOperaciones: 0 };
    return {
      mermaTotal: data.reduce((acc, cur) => acc + Number(cur.merma || 0), 0),
      sobrecostoTotal: data.reduce((acc, cur) => acc + Number(cur.sobrecosto || 0), 0),
      totalOperaciones: data.length,
    };
  }, [data]);

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;
    const encabezados = [
      "Fecha",
      "Producto Origen",
      "Cantidad Origen",
      "Producto Destino",
      "Cantidad Obtenida",
      "Merma",
      "Costo Consumido",
      "Costo Unitario Hijo",
      "Sobrecosto",
    ];
    const filas = data.map((i) => [
      i.fraccionado_at ?? "",
      i.producto_origen_nombre,
      i.cantidad_origen,
      i.producto_destino_nombre,
      i.cantidad_obtenida,
      i.merma,
      i.costo_consumido,
      i.costo_unitario_hijo,
      i.sobrecosto ?? "",
    ]);
    exportarACSV(`mermas_fraccionamiento_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-fraccionamiento-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-fracc">Desde</Label>
          <Input
            id="filtro-desde-fracc"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-fracc">Hasta</Label>
          <Input
            id="filtro-hasta-fracc"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-prod-origen">Producto Origen</Label>
          <Select value={productoOrigenId} onValueChange={setProductoOrigenId}>
            <SelectTrigger id="filtro-prod-origen">
              <SelectValue placeholder="Todos los orígenes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los orígenes</SelectItem>
              {productos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-prod-destino">Producto Destino</Label>
          <Select value={productoDestinoId} onValueChange={setProductoDestinoId}>
            <SelectTrigger id="filtro-prod-destino">
              <SelectValue placeholder="Todos los destinos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los destinos</SelectItem>
              {productos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
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
        <div className="space-y-3" data-testid="cargando-fraccionamiento">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-fraccionamiento">
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
                  Merma Acumulada del Período
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">
                  {totales.mermaTotal.toLocaleString("es-AR", { maximumFractionDigits: 3 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Pérdida neta de unidades en fraccionamientos
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Sobrecosto Acumulado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {formatMoneda(totales.sobrecostoTotal)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Impacto financiero de la merma en el lote derivado
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Operaciones Realizadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totales.totalOperaciones}</div>
                <p className="text-xs text-muted-foreground mt-1">Fraccionamientos registrados</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-fraccionamiento"
            >
              No se registraron fraccionamientos en el período seleccionado.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de mermas de fraccionamiento">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead className="text-right">Cant. Origen</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Cant. Obtenida</TableHead>
                    <TableHead className="text-right">Merma</TableHead>
                    <TableHead className="text-right">Costo Consumido</TableHead>
                    <TableHead className="text-right">Costo Unit. Hijo</TableHead>
                    <TableHead className="text-right">Sobrecosto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((i) => (
                    <TableRow key={i.operacion_id}>
                      <TableCell className="text-xs">
                        {i.fraccionado_at ? formatFechaISO(i.fraccionado_at.slice(0, 10)) : "—"}
                      </TableCell>
                      <TableCell className="font-medium text-xs sm:text-sm">
                        {i.producto_origen_nombre}
                      </TableCell>
                      <TableCell className="text-right">{i.cantidad_origen}</TableCell>
                      <TableCell className="font-medium text-xs sm:text-sm">
                        {i.producto_destino_nombre}
                      </TableCell>
                      <TableCell className="text-right">{i.cantidad_obtenida}</TableCell>
                      <TableCell className="text-right text-destructive font-semibold">
                        {i.merma}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs sm:text-sm">
                        {formatMoneda(i.costo_consumido)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs sm:text-sm">
                        {formatMoneda(i.costo_unitario_hijo)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium text-xs sm:text-sm">
                        {i.sobrecosto !== null && i.sobrecosto !== undefined
                          ? formatMoneda(i.sobrecosto)
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
// 4. Pestaña: Consumo Clínico por Profesional
// ─────────────────────────────────────────────────────────────────────────────

export function TabConsumoProfesional() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [profesionalId, setProfesionalId] = useState<string>("todos");

  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [data, setData] = useState<ReporteConsumoProfesional | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarDoctores({ limit: 100 })
      .then((res) => {
        if (!cancel) setDoctores(res.items);
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
      const res = await consumoProfesional({
        desde: desde || undefined,
        hasta: hasta || undefined,
        profesionalId: profesionalId !== "todos" ? profesionalId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de consumo por profesional");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, profesionalId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totales = useMemo(() => {
    if (!data) return { totalConsumos: 0, totalCosto: 0, totalUnidades: 0 };
    return {
      totalConsumos: data.reduce((acc, cur) => acc + cur.cantidadConsumos, 0),
      totalCosto: data.reduce((acc, cur) => acc + cur.costoTotalInsumos, 0),
      totalUnidades: data.reduce((acc, cur) => acc + cur.unidadesConsumidas, 0),
    };
  }, [data]);

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;
    const encabezados = [
      "Profesional",
      "Cantidad Consumos",
      "Unidades Consumidas",
      "Costo Total Insumos",
    ];
    const filas = data.map((i) => [
      i.profesionalNombre,
      i.cantidadConsumos,
      i.unidadesConsumidas,
      i.costoTotalInsumos,
    ]);
    exportarACSV(`consumo_profesional_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-profesional-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-prof">Desde</Label>
          <Input
            id="filtro-desde-prof"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-prof">Hasta</Label>
          <Input
            id="filtro-hasta-prof"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[220px]">
          <Label htmlFor="filtro-profesional">Profesional Veterinario</Label>
          <Select value={profesionalId} onValueChange={setProfesionalId}>
            <SelectTrigger id="filtro-profesional">
              <SelectValue placeholder="Todos los profesionales" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los profesionales</SelectItem>
              {doctores.map((d) => (
                <SelectItem key={d.id} value={d.userId ?? d.id}>
                  {d.name} {d.specialty ? `(${d.specialty})` : ""}
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
        <div className="space-y-3" data-testid="cargando-profesional">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-profesional">
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
                  Costo Total Consumido
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatMoneda(totales.totalCosto)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Valuación a costo efectivo en historial clínico
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Eventos de Consumo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totales.totalConsumos}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Intervenciones clínicas registradas
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unidades Totales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totales.totalUnidades.toLocaleString("es-AR")}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Insumos aplicados en pacientes</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-profesional"
            >
              No se registraron consumos para el profesional o período seleccionado.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de consumo por profesional">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profesional</TableHead>
                    <TableHead className="text-right">Cantidad Consumos</TableHead>
                    <TableHead className="text-right">Unidades Consumidas</TableHead>
                    <TableHead className="text-right">Costo Total Insumos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((i) => (
                    <TableRow key={i.profesionalId}>
                      <TableCell className="font-medium">{i.profesionalNombre}</TableCell>
                      <TableCell className="text-right">{i.cantidadConsumos}</TableCell>
                      <TableCell className="text-right">{i.unidadesConsumidas}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatMoneda(i.costoTotalInsumos)}
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
// 5. Pestaña: Consumo Clínico por Especie Animal
// ─────────────────────────────────────────────────────────────────────────────

export function TabConsumoEspecie() {
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [especieId, setEspecieId] = useState<string>("todas");

  const [especies, setEspecies] = useState<Especie[]>([]);
  const [data, setData] = useState<ReporteConsumoEspecie | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarEspecies()
      .then((res) => {
        if (!cancel) setEspecies(res);
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
      const res = await consumoEspecie({
        desde: desde || undefined,
        hasta: hasta || undefined,
        especieId: especieId !== "todas" ? especieId : undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reporte de consumo por especie");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, especieId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totales = useMemo(() => {
    if (!data) return { totalConsumos: 0, totalCosto: 0, totalUnidades: 0 };
    return {
      totalConsumos: data.reduce((acc, cur) => acc + cur.cantidadConsumos, 0),
      totalCosto: data.reduce((acc, cur) => acc + cur.costoTotalInsumos, 0),
      totalUnidades: data.reduce((acc, cur) => acc + cur.unidadesConsumidas, 0),
    };
  }, [data]);

  const handleExportCSV = () => {
    if (!data || data.length === 0) return;
    const encabezados = [
      "Especie",
      "Cantidad Consumos",
      "Unidades Consumidas",
      "Costo Total Insumos",
    ];
    const filas = data.map((i) => [
      i.especieNombre,
      i.cantidadConsumos,
      i.unidadesConsumidas,
      i.costoTotalInsumos,
    ]);
    exportarACSV(`consumo_especie_${hoyISO()}`, encabezados, filas);
  };

  return (
    <div className="space-y-4" data-testid="tab-especie-content">
      {/* Filtros */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="filtro-desde-esp">Desde</Label>
          <Input
            id="filtro-desde-esp"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filtro-hasta-esp">Hasta</Label>
          <Input
            id="filtro-hasta-esp"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="filtro-especie">Especie</Label>
          <Select value={especieId} onValueChange={setEspecieId}>
            <SelectTrigger id="filtro-especie">
              <SelectValue placeholder="Todas las especies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las especies</SelectItem>
              {especies.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
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
        <div className="space-y-3" data-testid="cargando-especie">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {error && !cargando && (
        <Alert variant="destructive" data-testid="error-especie">
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
                  Costo Total Consumido
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatMoneda(totales.totalCosto)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Valuación de insumos por especie animal
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Eventos de Consumo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totales.totalConsumos}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Intervenciones sobre pacientes de la especie
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unidades Totales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totales.totalUnidades.toLocaleString("es-AR")}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Insumos aplicados</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla */}
          {data.length === 0 ? (
            <div
              className="text-center py-12 border rounded-lg bg-card text-muted-foreground"
              data-testid="vacio-especie"
            >
              No se registraron consumos para la especie o período seleccionado.
            </div>
          ) : (
            <TableScrollContainer aria-label="Tabla de consumo por especie">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Especie</TableHead>
                    <TableHead className="text-right">Cantidad Consumos</TableHead>
                    <TableHead className="text-right">Unidades Consumidas</TableHead>
                    <TableHead className="text-right">Costo Total Insumos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((i) => (
                    <TableRow key={i.especieId}>
                      <TableCell className="font-medium">{i.especieNombre}</TableCell>
                      <TableCell className="text-right">{i.cantidadConsumos}</TableCell>
                      <TableCell className="text-right">{i.unidadesConsumidas}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatMoneda(i.costoTotalInsumos)}
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
// Componente Principal: ReportesStockPage
// ─────────────────────────────────────────────────────────────────────────────

export function ReportesStockPage() {
  const [activeTab, setActiveTab] = useState<string>("valorizacion");

  return (
    <div className="space-y-6">
      <StockBreadcrumb items={[{ label: "Reportes" }]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes de Stock</h1>
        <p className="text-sm text-muted-foreground">
          Análisis de valorización, inmovilizado, trazabilidad de mermas y consumo clínico.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full h-auto p-1 gap-1">
          <TabsTrigger value="valorizacion" className="flex items-center gap-2 py-2">
            <Layers className="size-4 shrink-0" />
            <span>Valorización</span>
          </TabsTrigger>
          <TabsTrigger value="rotacion" className="flex items-center gap-2 py-2">
            <TrendingDown className="size-4 shrink-0" />
            <span>Rotación / Inmovilizado</span>
          </TabsTrigger>
          <TabsTrigger value="fraccionamiento" className="flex items-center gap-2 py-2">
            <Scissors className="size-4 shrink-0" />
            <span>Mermas Fracc.</span>
          </TabsTrigger>
          <TabsTrigger value="profesional" className="flex items-center gap-2 py-2">
            <UserCheck className="size-4 shrink-0" />
            <span>Por Profesional</span>
          </TabsTrigger>
          <TabsTrigger value="especie" className="flex items-center gap-2 py-2">
            <Dog className="size-4 shrink-0" />
            <span>Por Especie</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="valorizacion" className="focus-visible:outline-none">
          {activeTab === "valorizacion" && <TabValorizacion />}
        </TabsContent>

        <TabsContent value="rotacion" className="focus-visible:outline-none">
          {activeTab === "rotacion" && <TabRotacion />}
        </TabsContent>

        <TabsContent value="fraccionamiento" className="focus-visible:outline-none">
          {activeTab === "fraccionamiento" && <TabFraccionamiento />}
        </TabsContent>

        <TabsContent value="profesional" className="focus-visible:outline-none">
          {activeTab === "profesional" && <TabConsumoProfesional />}
        </TabsContent>

        <TabsContent value="especie" className="focus-visible:outline-none">
          {activeTab === "especie" && <TabConsumoEspecie />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ReportesStockPage;
