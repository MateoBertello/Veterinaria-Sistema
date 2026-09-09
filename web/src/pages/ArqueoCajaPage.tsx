import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  Coins,
  DollarSign,
  Lock,
  Wallet,
} from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollContainer,
} from "../components/ui/table.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog.tsx";
import { cerrarSesion, obtenerSesion, resumenSesion } from "../api/comercial/caja.ts";
import { formatMoneda } from "./LotesPage.tsx";
import type { ResumenSesion, SesionCaja, TotalMedioPago } from "../types/index.ts";
import { StockBreadcrumb } from "../components/comercial/StockBreadcrumb.tsx";

const DENOMINACIONES = [20000, 10000, 2000, 1000, 500, 200, 100];

export function ArqueoCajaPage() {
  const { sesionId } = useParams<{ sesionId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [sesion, setSesion] = useState<SesionCaja | null>(null);
  const [resumen, setResumen] = useState<ResumenSesion | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // Formulario de arqueo (arranca estrictamente VACÍO)
  const [efectivoContado, setEfectivoContado] = useState<string>("");
  const [motivo, setMotivo] = useState<string>("");
  const [observaciones, setObservaciones] = useState<string>("");

  // Asistente de billetes
  const [mostrarBilletes, setMostrarBilletes] = useState(false);
  const [conteoBilletes, setConteoBilletes] = useState<Record<number, number>>({});

  // Diálogo de confirmación irreversible
  const [dialogConfirmar, setDialogConfirmar] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  const cargarDatos = useCallback(async () => {
    if (!sesionId) return;
    setLoading(true);
    setErrorCarga(null);
    try {
      const [sesRes, resuRes] = await Promise.all([
        obtenerSesion(sesionId),
        resumenSesion(sesionId),
      ]);
      setSesion(sesRes);
      setResumen(resuRes);
    } catch (err: any) {
      setErrorCarga(err?.message || "Error al cargar la sesión de caja.");
    } finally {
      setLoading(false);
    }
  }, [sesionId]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // Medios separados por afectaArqueo
  const { mediosEfectivo, mediosOtros } = useMemo(() => {
    const todos = resumen?.totalesPorMedioPago || [];
    const efectivo = todos.filter((mp) => mp.afectaArqueo);
    const otros = todos.filter((mp) => !mp.afectaArqueo);
    return { mediosEfectivo: efectivo, mediosOtros: otros };
  }, [resumen]);

  // Cálculo de diferencia en vivo
  const diferencia = useMemo(() => {
    if (efectivoContado === "" || isNaN(Number(efectivoContado))) return null;
    const teorico = resumen?.saldoTeoricoEfectivo ?? 0;
    return Number(efectivoContado) - teorico;
  }, [efectivoContado, resumen]);

  const hayDiferencia = diferencia !== null && diferencia !== 0;

  // Validación para permitir abrir diálogo de cierre
  const puedeCerrar = useMemo(() => {
    if (efectivoContado === "" || isNaN(Number(efectivoContado))) return false;
    if (Number(efectivoContado) < 0) return false;

    // Si hay diferencia (distinta de 0), motivo es obligatorio y min 10 caracteres
    if (hayDiferencia) {
      if (!motivo || motivo.trim().length < 10) return false;
    }

    return true;
  }, [efectivoContado, hayDiferencia, motivo]);

  // Total calculadora de billetes
  const totalBilletes = useMemo(() => {
    return Object.entries(conteoBilletes).reduce((acc, [denom, cant]) => {
      return acc + Number(denom) * (cant || 0);
    }, 0);
  }, [conteoBilletes]);

  function aplicarTotalBilletes() {
    setEfectivoContado(totalBilletes.toString());
  }

  // Ejecutar cierre de sesión
  async function handleConfirmarCierre() {
    if (!sesionId || !puedeCerrar) return;
    setCerrando(true);
    setErrorCierre(null);
    try {
      await cerrarSesion(sesionId, {
        efectivoContado: Number(efectivoContado),
        motivo: motivo.trim() ? motivo.trim() : null,
        observaciones: observaciones.trim() ? observaciones.trim() : null,
      });

      // Éxito: cerrar diálogo y recargar para pasar a modo solo lectura
      setDialogConfirmar(false);
      await cargarDatos();
    } catch (err: any) {
      setErrorCierre(err?.message || "Error al registrar el arqueo de cierre.");
    } finally {
      setCerrando(false);
    }
  }

  // La salida es la misma en los tres estados de la pantalla (cargando, error
  // y detalle), así que se declara una vez y se reusa.
  const migas = (
    <StockBreadcrumb
      raiz={{ label: "Ventas", href: "/ventas" }}
      items={[
        { label: "Caja", href: "/ventas/caja" },
        { label: "Detalle de Sesión de Caja" },
      ]}
    />
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {migas}
        <h1 className="text-2xl font-bold tracking-tight">Detalle de Sesión de Caja</h1>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (errorCarga || !sesion || !resumen) {
    return (
      <div className="space-y-6">
        {migas}
        <h1 className="text-2xl font-bold tracking-tight">Detalle de Sesión de Caja</h1>
        <div role="alert" className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-md">
          {errorCarga || "No se encontró la sesión solicitada."}
        </div>
        <Button variant="outline" asChild>
          <Link to="/ventas/caja" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Volver a Caja
          </Link>
        </Button>
      </div>
    );
  }

  const esSesionCerrada = sesion.estado === "cerrada";

  return (
    <div className="space-y-8">
      {migas}
      {/* Cabecera de página */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Detalle de Sesión de Caja</h1>
            {esSesionCerrada ? (
              <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 font-medium">
                Sesión Cerrada
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 font-medium">
                Sesión Abierta
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {sesion.cajaNombre || "Caja Principal"} — Abierta el{" "}
            {new Date(sesion.aperturaAt).toLocaleDateString("es-AR")} a las{" "}
            {new Date(sesion.aperturaAt).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        <Button variant="outline" asChild>
          <Link to="/ventas/caja" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Volver a Caja
          </Link>
        </Button>
      </div>

      {/* ─── MODO SOLO LECTURA (Sesión ya cerrada) ────────────────────────────── */}
      {esSesionCerrada ? (
        <div className="space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                Arqueo de cierre finalizado
              </CardTitle>
              <CardDescription>
                Cerrada el{" "}
                {sesion.cierreAt
                  ? `${new Date(sesion.cierreAt).toLocaleDateString("es-AR")} a las ${new Date(
                      sesion.cierreAt,
                    ).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
                  : "Fecha de cierre no disponible"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <span className="text-xs text-muted-foreground block font-medium uppercase tracking-wider">
                    Saldo inicial
                  </span>
                  <span className="text-xl font-semibold mt-1 block">
                    {formatMoneda(sesion.saldoInicial)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block font-medium uppercase tracking-wider">
                    Saldo teórico
                  </span>
                  <span className="text-xl font-semibold mt-1 block text-emerald-600">
                    {formatMoneda(sesion.saldoTeoricoEfectivo ?? resumen.saldoTeoricoEfectivo)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block font-medium uppercase tracking-wider">
                    Efectivo contado
                  </span>
                  <span className="text-xl font-bold mt-1 block">
                    {formatMoneda(sesion.efectivoContado)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block font-medium uppercase tracking-wider">
                    Diferencia
                  </span>
                  <div className="mt-1">
                    {sesion.diferencia === null || sesion.diferencia === 0 ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold"
                      >
                        Sin diferencia
                      </Badge>
                    ) : sesion.diferencia < 0 ? (
                      <Badge
                        variant="outline"
                        className="bg-rose-50 text-rose-700 border-rose-300 font-semibold"
                      >
                        Faltan {formatMoneda(Math.abs(sesion.diferencia))}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-amber-50 text-amber-700 border-amber-300 font-semibold"
                      >
                        Sobran {formatMoneda(sesion.diferencia)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {(sesion.motivoDiferencia || sesion.observaciones) && (
                <div className="mt-6 pt-6 border-t grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sesion.motivoDiferencia && (
                    <div className="bg-muted/40 p-3 rounded-md">
                      <span className="text-xs font-semibold text-muted-foreground block mb-1">
                        Motivo de la diferencia:
                      </span>
                      <p className="text-sm">{sesion.motivoDiferencia}</p>
                    </div>
                  )}
                  {sesion.observaciones && (
                    <div className="bg-muted/40 p-3 rounded-md">
                      <span className="text-xs font-semibold text-muted-foreground block mb-1">
                        Observaciones:
                      </span>
                      <p className="text-sm">{sesion.observaciones}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* ─── MODO ARQUEO Y CIERRE (Sesión Abierta) ────────────────────────────── */
        <div className="space-y-8">
          {/* Bloque 1: Saldo teórico y Medios de pago */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>Saldo inicial declarado</CardDescription>
                <CardTitle className="text-xl font-bold">
                  {formatMoneda(resumen.saldoInicial)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 border-t space-y-2">
                <span className="text-xs text-muted-foreground block font-medium uppercase tracking-wider">
                  Saldo teórico en efectivo
                </span>
                <div className="text-3xl font-extrabold text-emerald-600">
                  {formatMoneda(resumen.saldoTeoricoEfectivo)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Efectivo total que debe estar presente en el cajón físico.
                </p>
              </CardContent>
            </Card>

            <div className="lg:col-span-2 space-y-6">
              {/* Medios que afectan el arqueo */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    Medios que afectan el arqueo
                  </CardTitle>
                  <CardDescription>
                    Movimientos en efectivo que modifican el saldo físico del cajón.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <TableScrollContainer aria-label="Medios que afectan el arqueo">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Medio</TableHead>
                          <TableHead className="text-right">Ingresos</TableHead>
                          <TableHead className="text-right">Egresos</TableHead>
                          <TableHead className="text-right">Neto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mediosEfectivo.length > 0 ? (
                          mediosEfectivo.map((mp) => (
                            <TableRow key={mp.medioPagoId}>
                              <TableCell className="font-medium">{mp.nombre}</TableCell>
                              <TableCell className="text-right text-emerald-600">
                                {formatMoneda(mp.ingresos)}
                              </TableCell>
                              <TableCell className="text-right text-rose-600">
                                {formatMoneda(mp.egresos)}
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatMoneda(mp.neto)}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                              Sin movimientos en efectivo.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableScrollContainer>
                </CardContent>
              </Card>

              {/* Otros medios de cobro (informativos) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    Otros medios de cobro (informativos)
                  </CardTitle>
                  <CardDescription>
                    Cobros electrónicos o bancarios que no modifican el cajón físico.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <TableScrollContainer aria-label="Otros medios de cobro">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Medio</TableHead>
                          <TableHead className="text-right">Ingresos</TableHead>
                          <TableHead className="text-right">Egresos</TableHead>
                          <TableHead className="text-right">Neto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mediosOtros.length > 0 ? (
                          mediosOtros.map((mp) => (
                            <TableRow key={mp.medioPagoId}>
                              <TableCell className="font-medium">{mp.nombre}</TableCell>
                              <TableCell className="text-right text-emerald-600">
                                {formatMoneda(mp.ingresos)}
                              </TableCell>
                              <TableCell className="text-right text-rose-600">
                                {formatMoneda(mp.egresos)}
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatMoneda(mp.neto)}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                              Sin movimientos electrónicos registrados.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableScrollContainer>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Bloque 2: Formulario de Conteo Físico y Arqueo */}
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Conteo físico de efectivo</CardTitle>
              <CardDescription>
                Contá el dinero presente en el cajón e ingresá el valor total.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="efectivo-contado">Efectivo contado ($) *</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setMostrarBilletes(!mostrarBilletes)}
                        className="text-xs h-7 gap-1 text-muted-foreground"
                      >
                        <Calculator className="h-3.5 w-3.5" />
                        {mostrarBilletes ? "Ocultar calculadora" : "Calculadora por billete"}
                      </Button>
                    </div>
                    <Input
                      id="efectivo-contado"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Ingresá el efectivo contado..."
                      value={efectivoContado}
                      onChange={(e) => setEfectivoContado(e.target.value)}
                      required
                      className="text-lg font-medium"
                    />
                  </div>

                  {/* Asistente de billetes */}
                  {mostrarBilletes && (
                    <div className="p-4 bg-muted/40 rounded-lg border space-y-3">
                      <span className="text-xs font-semibold text-muted-foreground block">
                        Conteo por denominación
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {DENOMINACIONES.map((den) => (
                          <div key={den} className="flex items-center gap-2">
                            <span className="text-xs font-medium w-16 text-right">${den}:</span>
                            <Input
                              type="number"
                              min="0"
                              className="h-8 text-sm"
                              value={conteoBilletes[den] || ""}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                setConteoBilletes((prev) => ({
                                  ...prev,
                                  [den]: isNaN(val) ? 0 : val,
                                }));
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t">
                        <span className="text-sm font-semibold">
                          Total: {formatMoneda(totalBilletes)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={aplicarTotalBilletes}
                        >
                          Usar este total
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Visualizador de diferencia en vivo */}
                  {diferencia !== null && (
                    <div className="p-4 rounded-lg border bg-card flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-muted-foreground block">
                          Diferencia en arqueo:
                        </span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          (Efectivo contado − Saldo teórico)
                        </p>
                      </div>
                      <div>
                        {diferencia === 0 ? (
                          <Badge
                            data-testid="diferencia-badge"
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-300 text-sm font-semibold px-3 py-1"
                          >
                            Sin diferencia ($ 0,00)
                          </Badge>
                        ) : diferencia < 0 ? (
                          <Badge
                            data-testid="diferencia-badge"
                            variant="outline"
                            className="bg-rose-50 text-rose-700 border-rose-300 text-sm font-semibold px-3 py-1"
                          >
                            Faltan {formatMoneda(Math.abs(diferencia))}
                          </Badge>
                        ) : (
                          <Badge
                            data-testid="diferencia-badge"
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-300 text-sm font-semibold px-3 py-1"
                          >
                            Sobran {formatMoneda(diferencia)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {/* Motivo (requerido si hay diferencia) */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="arqueo-motivo">
                        Motivo {hayDiferencia ? "(requerido por diferencia) *" : "(opcional)"}
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {motivo.length} / 10 caracteres mínimos
                      </span>
                    </div>
                    <Textarea
                      id="arqueo-motivo"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      required={hayDiferencia}
                      placeholder={
                        hayDiferencia
                          ? "Explicá el motivo de la diferencia encontrada (mínimo 10 caracteres)..."
                          : "Motivo opcional del cierre..."
                      }
                      maxLength={500}
                    />
                    {hayDiferencia && motivo.length > 0 && motivo.trim().length < 10 && (
                      <p className="text-xs text-destructive font-medium">
                        El motivo debe tener al menos 10 caracteres para justificar la diferencia.
                      </p>
                    )}
                  </div>

                  {/* Observaciones */}
                  <div className="space-y-2">
                    <Label htmlFor="arqueo-observaciones">Observaciones (opcional)</Label>
                    <Textarea
                      id="arqueo-observaciones"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Anotaciones complementarias para el siguiente turno..."
                      maxLength={500}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t flex justify-end">
                <Button
                  variant="destructive"
                  size="lg"
                  disabled={!puedeCerrar}
                  onClick={() => {
                    setErrorCierre(null);
                    setDialogConfirmar(true);
                  }}
                  className="gap-2 font-medium shadow-sm"
                >
                  <Lock className="h-4 w-4" />
                  Cerrar caja
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── AlertDialog de Confirmación Irreversible (§2.1) ────────────────── */}
      <AlertDialog open={dialogConfirmar} onOpenChange={setDialogConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar la caja</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm text-muted-foreground">
              <span>
                Se registra el arqueo con un efectivo contado de{" "}
                <strong className="text-foreground">{formatMoneda(Number(efectivoContado))}</strong> sobre
                un saldo teórico de{" "}
                <strong className="text-foreground">
                  {formatMoneda(resumen.saldoTeoricoEfectivo)}
                </strong>
                {diferencia === 0 ? (
                  ", sin diferencia."
                ) : (
                  <span>
                    , con una diferencia de{" "}
                    <strong className="text-foreground">
                      {formatMoneda(diferencia ?? 0)}
                    </strong>
                    .
                  </span>
                )}
              </span>
              <span className="block">
                La diferencia y su motivo quedan asentados en la sesión y en la auditoría.
              </span>
              <span className="block font-medium text-foreground">
                La sesión queda cerrada y no se puede volver a abrir: las ventas siguientes van a
                necesitar una sesión nueva.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Error dentro del diálogo */}
          {errorCierre && (
            <p role="alert" className="text-sm text-destructive font-medium">
              {errorCierre}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={cerrando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cerrando}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmarCierre();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cerrando ? "Cerrando sesión..." : "Confirmar cierre"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
