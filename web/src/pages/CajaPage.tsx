import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  History,
  Lock,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { VentasNav } from "../components/comercial/VentasNav.tsx";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import {
  abrirSesion,
  listarCajas,
  listarSesiones,
  obtenerSesion,
  registrarMovimiento,
  resumenSesion,
  sesionActual,
} from "../api/comercial/caja.ts";
import { listarMediosPago } from "../api/catalogos-comercial.ts";
import { formatMoneda } from "./LotesPage.tsx";
import type {
  ApiMeta,
  Caja,
  MedioPago,
  MovimientoCaja,
  ResumenSesion,
  SesionCaja,
  TipoMovimientoCaja,
} from "../types/index.ts";

export function CajaPage() {
  const navigate = useNavigate();

  // Estados principales
  const [loading, setLoading] = useState(true);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [mediosPago, setMediosPago] = useState<MedioPago[]>([]);
  const [sesion, setSesion] = useState<SesionCaja | null>(null);
  const [resumen, setResumen] = useState<ResumenSesion | null>(null);
  const [historial, setHistorial] = useState<SesionCaja[]>([]);
  const [historialMeta, setHistorialMeta] = useState<ApiMeta | null>(null);

  // Formulario de apertura
  const [cajaSeleccionada, setCajaSeleccionada] = useState<string>("");
  const [saldoInicial, setSaldoInicial] = useState<string>("");
  const [abriendo, setAbriendo] = useState(false);
  const [errorApertura, setErrorApertura] = useState<string | null>(null);

  // Modal de registro de movimiento
  const [dialogMovimiento, setDialogMovimiento] = useState(false);
  const [movTipo, setMovTipo] = useState<TipoMovimientoCaja>("ingreso_manual");
  const [movMedioPagoId, setMovMedioPagoId] = useState<string>("");
  const [movImporte, setMovImporte] = useState<string>("");
  const [movMotivo, setMovMotivo] = useState<string>("");
  const [movReferencia, setMovReferencia] = useState<string>("");
  const [guardandoMov, setGuardandoMov] = useState(false);
  const [errorMovimiento, setErrorMovimiento] = useState<string | null>(null);

  // Carga inicial de datos
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const [cajasRes, mediosRes, sesionAct, histRes] = await Promise.all([
        listarCajas(),
        listarMediosPago(),
        sesionActual(),
        listarSesiones({ page: 1, limit: 10 }),
      ]);

      setCajas(cajasRes);
      if (cajasRes.length > 0) {
        setCajaSeleccionada(cajasRes[0].id);
      }

      setMediosPago(mediosRes);
      if (mediosRes.length > 0) {
        setMovMedioPagoId(mediosRes[0].id);
      }

      setHistorial(histRes.items);
      setHistorialMeta(histRes.meta);

      if (sesionAct && sesionAct.estado === "abierta") {
        const [detalle, resu] = await Promise.all([
          obtenerSesion(sesionAct.id),
          resumenSesion(sesionAct.id),
        ]);
        setSesion(detalle);
        setResumen(resu);
      } else {
        setSesion(null);
        setResumen(null);
      }
    } catch (err) {
      console.error("Error al cargar datos de caja:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // Manejador de apertura de caja
  async function handleAbrirCaja(e: React.FormEvent) {
    e.preventDefault();
    const saldoNum = Number(saldoInicial);
    if (isNaN(saldoNum) || saldoNum < 0) {
      setErrorApertura("El saldo inicial debe ser un número mayor o igual a 0.");
      return;
    }

    setAbriendo(true);
    setErrorApertura(null);
    try {
      const cajaId = cajaSeleccionada || (cajas.length > 0 ? cajas[0].id : undefined);
      await abrirSesion({ cajaId, saldoInicial: saldoNum });
      await cargarDatos();
    } catch (err: any) {
      setErrorApertura(err?.message || "Ocurrió un error al abrir la sesión de caja.");
    } finally {
      setAbriendo(false);
    }
  }

  // Medio de pago seleccionado actualmente en el modal
  const medioPagoSeleccionado = useMemo(() => {
    return mediosPago.find((mp) => mp.id === movMedioPagoId);
  }, [mediosPago, movMedioPagoId]);

  const esMovimientoManual = useMemo(() => {
    return ["ingreso_manual", "egreso_manual", "egreso_retiro"].includes(movTipo);
  }, [movTipo]);

  const puedeGuardarMovimiento = useMemo(() => {
    if (guardandoMov) return false;
    const imp = Number(movImporte);
    if (isNaN(imp) || imp <= 0) return false;
    if (!movMedioPagoId) return false;

    // Si el medio requiere referencia, debe completarse
    if (medioPagoSeleccionado?.requiere_referencia && (!movReferencia || movReferencia.trim() === "")) {
      return false;
    }

    // Movimiento manual exige motivo >= 10
    if (esMovimientoManual && (!movMotivo || movMotivo.trim().length < 10)) {
      return false;
    }

    // Si se escribió motivo pero tiene < 10 caracteres, no habilitar
    if (movMotivo.trim().length > 0 && movMotivo.trim().length < 10) {
      return false;
    }

    return true;
  }, [guardandoMov, movImporte, movMedioPagoId, medioPagoSeleccionado, movReferencia, esMovimientoManual, movMotivo]);

  // Guardar movimiento
  async function handleGuardarMovimiento(e: React.FormEvent) {
    e.preventDefault();
    if (!sesion || !puedeGuardarMovimiento) return;

    setGuardandoMov(true);
    setErrorMovimiento(null);
    try {
      await registrarMovimiento(sesion.id, {
        tipo: movTipo,
        medioPagoId: movMedioPagoId,
        importe: Number(movImporte),
        motivo: movMotivo.trim() ? movMotivo.trim() : null,
        referencia: movReferencia.trim() ? movReferencia.trim() : null,
      });

      // Refrescar sesión y resumen
      const [detalle, resu] = await Promise.all([
        obtenerSesion(sesion.id),
        resumenSesion(sesion.id),
      ]);
      setSesion(detalle);
      setResumen(resu);

      // Resetear modal
      setDialogMovimiento(false);
      setMovImporte("");
      setMovMotivo("");
      setMovReferencia("");
      setMovTipo("ingreso_manual");
    } catch (err: any) {
      setErrorMovimiento(err?.message || "Error al registrar el movimiento.");
    } finally {
      setGuardandoMov(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <VentasNav />
        <h1 className="text-2xl font-bold tracking-tight">Sesión de Caja</h1>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <VentasNav />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sesión de Caja</h1>
          <p className="text-sm text-muted-foreground">
            Control de apertura, movimientos en vivo y arqueo de turnos.
          </p>
        </div>
      </div>

      {/* ─── ESTADO A: Sin sesión abierta ────────────────────────────────────── */}
      {!sesion ? (
        <div className="py-6">
          <Card className="max-w-md mx-auto shadow-sm">
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Wallet className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold leading-none">Apertura de Caja</h2>
              <CardDescription>
                El saldo inicial es el efectivo con el que arranca el turno. Se usa para
                calcular el arqueo al cerrar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAbrirCaja} className="space-y-4">
                {cajas.length > 1 ? (
                  <div className="space-y-2">
                    <Label htmlFor="caja-select">Caja física</Label>
                    <select
                      id="caja-select"
                      value={cajaSeleccionada}
                      onChange={(e) => setCajaSeleccionada(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {cajas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  cajas.length === 1 && (
                    <div className="text-sm font-medium text-muted-foreground mb-2">
                      Caja: <span className="text-foreground">{cajas[0].nombre}</span>
                    </div>
                  )
                )}

                <div className="space-y-2">
                  <Label htmlFor="saldo-inicial">Saldo inicial ($) *</Label>
                  <Input
                    id="saldo-inicial"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={saldoInicial}
                    onChange={(e) => setSaldoInicial(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Efectivo disponible en el cajón al momento de abrir el turno.
                  </p>
                </div>

                {errorApertura && (
                  <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-sm">
                    {errorApertura}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={abriendo || saldoInicial === "" || Number(saldoInicial) < 0}
                  className="w-full"
                >
                  {abriendo ? "Abriendo caja..." : "Abrir caja"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* ─── ESTADO B: Con sesión abierta ─────────────────────────────────────── */
        <div className="space-y-8">
          {/* Bloque 1: Cabecera de la sesión */}
          <Card className="bg-muted/30 border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 font-medium">
                    Sesión Abierta
                  </Badge>
                  <CardTitle className="text-xl">
                    {sesion.cajaNombre || "Caja Principal"}
                  </CardTitle>
                </div>
                <CardDescription className="mt-1">
                  Abierta el {new Date(sesion.aperturaAt).toLocaleDateString("es-AR")} a las{" "}
                  {new Date(sesion.aperturaAt).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </CardDescription>
              </div>

              <Button
                variant="destructive"
                className="gap-2 shrink-0 font-medium shadow-sm"
                onClick={() => navigate(`/ventas/caja/${sesion.id}`)}
              >
                <Lock className="h-4 w-4" />
                Cerrar caja
              </Button>
            </CardHeader>
          </Card>

          {/* Bloque 2: Resumen en vivo */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold tracking-tight">Resumen en vivo</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Saldo inicial</CardDescription>
                  <CardTitle className="text-2xl font-bold">
                    {formatMoneda(resumen?.saldoInicial ?? sesion.saldoInicial)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Efectivo declarado en apertura</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Saldo teórico en efectivo</CardDescription>
                  <CardTitle className="text-2xl font-bold text-emerald-600">
                    {formatMoneda(resumen?.saldoTeoricoEfectivo ?? sesion.saldoTeoricoEfectivo)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Efectivo esperado en cajón (inicial + ingresos − egresos)
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Tabla de totales por medio de pago */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Desglose por medio de pago</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <TableScrollContainer aria-label="Desglose de totales por medio de pago">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Medio de pago</TableHead>
                        <TableHead className="text-right">Ingresos</TableHead>
                        <TableHead className="text-right">Egresos</TableHead>
                        <TableHead className="text-right">Neto</TableHead>
                        <TableHead className="text-center">Arqueo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resumen && resumen.totalesPorMedioPago.length > 0 ? (
                        resumen.totalesPorMedioPago.map((mp) => (
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
                            <TableCell className="text-center">
                              {mp.afectaArqueo ? (
                                <Badge
                                  variant="outline"
                                  className="bg-emerald-50 text-emerald-700 border-emerald-300 font-medium"
                                >
                                  Afecta arqueo
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground">
                                  Informativo
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                            Sin movimientos registrados para medios de pago.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableScrollContainer>
              </CardContent>
            </Card>
          </div>

          {/* Bloque 3: Movimientos de la sesión */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Movimientos de la sesión</h2>
              <Button onClick={() => setDialogMovimiento(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Nuevo movimiento
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <TableScrollContainer aria-label="Lista de movimientos de la sesión">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hora</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Medio de pago</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                        <TableHead>Motivo</TableHead>
                        {/*
                          Sin columna "Referencia": POST /caja/sesiones/:id/movimientos
                          acepta y exige `referencia` cuando el medio de pago la pide,
                          pero GET /caja/sesiones/:id no la devuelve (caja.service.ts,
                          mapMovimientoRow no la mapea). Una columna que siempre muestra
                          "—" da a entender que no se cargó ninguna referencia.
                          Deuda anotada en ADENDA_SPEC_COMERCIAL.md.
                        */}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sesion.movimientos && sesion.movimientos.length > 0 ? (
                        sesion.movimientos.map((m) => {
                          const esIngreso = m.tipo.startsWith("ingreso");
                          return (
                            <TableRow key={m.id}>
                              <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                                {new Date(m.createdAt).toLocaleTimeString("es-AR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    esIngreso
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                                      : "bg-rose-50 text-rose-700 border-rose-300"
                                  }
                                >
                                  {m.tipo.replace(/_/g, " ")}
                                </Badge>
                              </TableCell>
                              <TableCell>{m.medioPago?.nombre || "—"}</TableCell>
                              <TableCell
                                className={`text-right font-medium ${
                                  esIngreso ? "text-emerald-600" : "text-rose-600"
                                }`}
                              >
                                {esIngreso ? "+" : "-"}
                                {formatMoneda(m.importe)}
                              </TableCell>
                              <TableCell className="max-w-xs truncate text-sm">
                                {m.motivo || "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                            Aún no hay movimientos registrados en esta sesión.
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
      )}

      {/* ─── Bloque 4: Historial de sesiones ──────────────────────────────────── */}
      <div className="space-y-4 pt-6 border-t">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold tracking-tight">Historial de sesiones</h2>
        </div>

        <Card>
          <CardContent className="p-0">
            <TableScrollContainer aria-label="Historial de sesiones de caja">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Caja</TableHead>
                    <TableHead>Apertura</TableHead>
                    <TableHead>Cierre</TableHead>
                    <TableHead className="text-right">Saldo inicial</TableHead>
                    <TableHead className="text-right">Efectivo contado</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historial.length > 0 ? (
                    historial.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.cajaNombre || "Caja"}</TableCell>
                        <TableCell className="text-sm">
                          {new Date(s.aperturaAt).toLocaleDateString("es-AR")}{" "}
                          {new Date(s.aperturaAt).toLocaleTimeString("es-AR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.cierreAt
                            ? `${new Date(s.cierreAt).toLocaleDateString("es-AR")} ${new Date(
                                s.cierreAt,
                              ).toLocaleTimeString("es-AR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`
                            : "En curso"}
                        </TableCell>
                        <TableCell className="text-right">{formatMoneda(s.saldoInicial)}</TableCell>
                        <TableCell className="text-right">
                          {s.efectivoContado !== null ? formatMoneda(s.efectivoContado) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {s.diferencia === null ? (
                            "—"
                          ) : s.diferencia === 0 ? (
                            <span className="text-emerald-600">Sin diferencia</span>
                          ) : s.diferencia < 0 ? (
                            <span className="text-rose-600">
                              Faltan {formatMoneda(Math.abs(s.diferencia))}
                            </span>
                          ) : (
                            <span className="text-amber-600">
                              Sobran {formatMoneda(s.diferencia)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={
                              s.estado === "abierta"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                                : "bg-slate-100 text-slate-700 border-slate-300"
                            }
                          >
                            {s.estado}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            to={`/ventas/caja/${s.id}`}
                            className="text-primary hover:underline text-sm font-medium"
                          >
                            Ver detalle
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                        No hay sesiones registradas en el historial.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableScrollContainer>
          </CardContent>
        </Card>
      </div>

      {/* ─── Modal de Registro de Movimiento ─────────────────────────────────── */}
      <Dialog open={dialogMovimiento} onOpenChange={setDialogMovimiento}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleGuardarMovimiento} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Registrar movimiento de caja</DialogTitle>
              <DialogDescription>
                Registrá un ingreso o egreso de dinero en la sesión activa.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Tipo de movimiento */}
              <div className="space-y-2">
                <Label htmlFor="mov-tipo">Tipo de movimiento *</Label>
                <select
                  id="mov-tipo"
                  value={movTipo}
                  onChange={(e) => setMovTipo(e.target.value as TipoMovimientoCaja)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <optgroup label="Ingresos">
                    <option value="ingreso_manual">Ingreso manual</option>
                    <option value="ingreso_venta">Ingreso por venta</option>
                    <option value="ingreso_cobro_cuenta_corriente">
                      Cobro de cuenta corriente
                    </option>
                  </optgroup>
                  <optgroup label="Egresos">
                    <option value="egreso_manual">Egreso manual</option>
                    <option value="egreso_retiro">Retiro de efectivo</option>
                    <option value="egreso_pago_proveedor">Pago a proveedor</option>
                    <option value="egreso_devolucion">Devolución</option>
                  </optgroup>
                </select>

                {movTipo === "ingreso_venta" && (
                  <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                    Las ventas registran su ingreso automáticamente. Usá esta opción solo para
                    corregir.
                  </p>
                )}
              </div>

              {/* Medio de pago */}
              <div className="space-y-2">
                <Label htmlFor="mov-medio-pago">Medio de pago *</Label>
                <select
                  id="mov-medio-pago"
                  value={movMedioPagoId}
                  onChange={(e) => setMovMedioPagoId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {mediosPago.map((mp) => (
                    <option key={mp.id} value={mp.id}>
                      {mp.nombre} {mp.afecta_arqueo ? "(Efectivo)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Importe */}
              <div className="space-y-2">
                <Label htmlFor="mov-importe">Importe ($) *</Label>
                <Input
                  id="mov-importe"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={movImporte}
                  onChange={(e) => setMovImporte(e.target.value)}
                  required
                />
              </div>

              {/* Referencia */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="mov-referencia">
                    Referencia {medioPagoSeleccionado?.requiere_referencia ? "(requerido) *" : "(opcional)"}
                  </Label>
                </div>
                <Input
                  id="mov-referencia"
                  value={movReferencia}
                  onChange={(e) => setMovReferencia(e.target.value)}
                  required={Boolean(medioPagoSeleccionado?.requiere_referencia)}
                  placeholder={
                    medioPagoSeleccionado?.requiere_referencia
                      // §2.6: es el identificador externo que devuelve el medio de pago
                      // (autorización de tarjeta, N° de transferencia), no el numero_operacion
                      // de la venta. El copy no puede usar las cuatro palabras prohibidas.
                      ? "N° de autorización o transferencia"
                      : "Identificador opcional"
                  }
                />
              </div>

              {/* Motivo */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="mov-motivo">
                    Motivo {esMovimientoManual ? "*" : "(opcional)"}
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {movMotivo.length} / 10 caracteres mínimos
                  </span>
                </div>
                <Textarea
                  id="mov-motivo"
                  value={movMotivo}
                  onChange={(e) => setMovMotivo(e.target.value)}
                  placeholder="Descripción obligatoria de al menos 10 caracteres para movimientos manuales..."
                  maxLength={500}
                />
                {movMotivo.length > 0 && movMotivo.trim().length < 10 && (
                  <p className="text-xs text-destructive">
                    El motivo debe tener al menos 10 caracteres.
                  </p>
                )}
              </div>

              {errorMovimiento && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-sm">
                  {errorMovimiento}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogMovimiento(false)}
                disabled={guardandoMov}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!puedeGuardarMovimiento}>
                {guardandoMov ? "Registrando..." : "Registrar movimiento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
