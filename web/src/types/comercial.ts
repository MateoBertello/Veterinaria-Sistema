// ══════════════════════════════════════════════════════════════════════════════
// TIPOS DEL MÓDULO COMERCIAL (F1·T1)
// Espejo literal y tipado de los DTOs y modelos de la API de Hono y DB.
// ══════════════════════════════════════════════════════════════════════════════

// ─── Enums con valores exactos de la base / backend ──────────────────────────

export type CondicionVenta =
  | "libre"
  | "bajo_receta"
  | "bajo_receta_archivada"
  | "uso_profesional";

export type CondicionFiscal =
  | "consumidor_final"
  | "monotributista"
  | "responsable_inscripto"
  | "exento"
  | "no_alcanzado"
  | "sin_datos";

export type EstadoLote =
  | "disponible"
  | "cuarentena"
  | "bloqueado"
  | "agotado"
  | "vencido";

export type EstadoCompra = "borrador" | "confirmada" | "anulada";

export type EstadoVenta = "registrada" | "anulada";

export type EstadoSesionCaja = "abierta" | "cerrada";

export type EstadoRecuento = "borrador" | "aplicado";

export type CondicionPago = "contado" | "cuenta_corriente";

export type TipoItemVenta = "producto" | "servicio";

export type TipoAjuste =
  | "entrada_ajuste"
  | "salida_ajuste"
  | "merma_rotura"
  | "merma_vencimiento";

export type TipoMovimientoCaja =
  | "ingreso_venta"
  | "ingreso_cobro_cuenta_corriente"
  | "ingreso_manual"
  | "egreso_pago_proveedor"
  | "egreso_devolucion"
  | "egreso_manual"
  | "egreso_retiro";

export type TipoMovimientoStock =
  | "entrada_compra"
  | "entrada_ajuste"
  | "entrada_fraccionamiento"
  | "entrada_inicial"
  | "entrada_devolucion"
  | "salida_venta"
  | "salida_consumo_clinico"
  | "salida_ajuste"
  | "salida_fraccionamiento"
  | "salida_vencimiento"
  | "salida_merma";

// ─── 1. Productos, Familias y Conversiones ────────────────────────────────────

export interface Producto {
  id:                          string;
  tenantId:                    string;
  codigo:                      string;
  nombre:                      string;
  descripcion:                 string | null;
  familiaId:                   string | null;
  unidadMedidaId:              string;
  marca:                       string | null;
  alicuotaIva:                 number;
  condicionVenta:              CondicionVenta | string;
  controlaLote:                boolean;
  controlaVencimiento:         boolean;
  vidaUtilPostAperturaDias:    number | null;
  precioVenta:                 number | null;
  costoReposicion:             number | null;
  margenObjetivo:              number | null;
  stockMinimo:                 number | null;
  esVendible:                  boolean;
  esConsumibleClinico:         boolean;
  requiereFrio:                boolean;
  trazable:                    boolean;
  codigoBarras:                string | null;
  activo:                      boolean;
  createdAt:                   string;
  updatedAt:                   string;
}

export interface CrearProductoInput {
  codigo:                    string;
  nombre:                    string;
  descripcion?:              string | null;
  familiaId?:                string | null;
  unidadMedidaId:            string;
  marca?:                    string | null;
  alicuotaIva?:              number;
  condicionVenta?:           CondicionVenta;
  controlaLote?:             boolean;
  controlaVencimiento?:      boolean;
  vidaUtilPostAperturaDias?: number | null;
  precioVenta?:              number | null;
  costoReposicion?:          number | null;
  margenObjetivo?:           number | null;
  stockMinimo?:              number | null;
  esVendible?:               boolean;
  esConsumibleClinico?:      boolean;
  requiereFrio?:             boolean;
  trazable?:                 boolean;
  codigoBarras?:             string | null;
}

export type ActualizarProductoInput = Partial<CrearProductoInput>;

export interface CrearDerivadoInput {
  codigo:                    string;
  nombre:                    string;
  unidadMedidaId:            string;
  factorTeorico:             number;
  mermaEsperadaPorcentaje?:  number;
  precioVenta?:              number | null;
  vidaUtilPostAperturaDias?: number | null;
  stockMinimo?:              number | null;
  descripcion?:              string | null;
}

export interface Familia {
  id:           string;
  tenantId:     string;
  nombre:       string;
  unidadBaseId: string;
  activo:       boolean;
  createdAt:    string;
}

export interface CrearFamiliaInput {
  nombre:       string;
  unidadBaseId: string;
}

export type ActualizarFamiliaInput = Partial<CrearFamiliaInput>;

export interface Conversion {
  id:                      string;
  tenantId:                string;
  productoOrigenId:        string;
  productoDestinoId:       string;
  factorTeorico:           number;
  mermaEsperadaPorcentaje: number;
  activo:                  boolean;
  createdAt:               string;
}

export interface CrearConversionInput {
  productoOrigenId:         string;
  productoDestinoId:        string;
  factorTeorico:            number;
  mermaEsperadaPorcentaje?: number;
}

export type ActualizarConversionInput = Partial<CrearConversionInput>;

// ─── 2. Proveedores ──────────────────────────────────────────────────────────

export interface Proveedor {
  id:              string;
  tenantId:        string;
  razonSocial:     string;
  nombreFantasia:  string | null;
  cuit:            string | null;
  condicionFiscal: CondicionFiscal | string | null;
  telefono:        string | null;
  email:           string | null;
  direccion:       string | null;
  contactoNombre:  string | null;
  observaciones:   string | null;
  clienteId:       string | null;
  activo:          boolean;
  createdAt:       string;
  updatedAt:       string;
}

export interface CrearProveedorInput {
  razonSocial:      string;
  nombreFantasia?:  string | null;
  cuit?:            string | null;
  condicionFiscal?: CondicionFiscal | null;
  telefono?:        string | null;
  email?:           string | null;
  direccion?:       string | null;
  contactoNombre?:  string | null;
  observaciones?:   string | null;
  clienteId?:       string | null;
}

export type ActualizarProveedorInput = Partial<CrearProveedorInput>;

// ─── 3. Stock, Lotes y Movimientos ───────────────────────────────────────────

export interface Lote {
  id:                    string;
  codigoLote:            string | null;
  fechaVencimiento:      string | null;
  fechaIngreso:          string;
  costoUnitarioNeto:     number;
  costoUnitarioEfectivo: number;
  estado:                EstadoLote | string;
  origen:                string;
  producto:              { id: string; codigo: string; nombre: string } | null;
  proveedor:             { id: string; razonSocial: string } | null;
  cantidad:              number;
}

export interface LoteCandidato {
  loteId:                string;
  codigoLote:            string | null;
  fechaVencimiento:      string | null;
  fechaIngreso:          string;
  estado:                EstadoLote | string;
  costoUnitarioEfectivo: number;
  cantidadDisponible:    number;
}

export interface KardexMovimiento {
  id:               string;
  fecha:            string;
  tipo:             TipoMovimientoStock | string;
  cantidad:         number;
  cantidadConSigno: number;
  costoUnitario:    number;
  costoTotal:       number;
  motivo:           string | null;
  saldoAcumulado:   number;
}

export interface MovimientoStock {
  id:               string;
  operacionId:      string | null;
  tipo:             TipoMovimientoStock | string;
  cantidad:         number;
  cantidadConSigno: number;
  costoUnitario:    number;
  costoTotal:       number;
  motivo:           string | null;
  createdAt:        string;
  producto?:        { id: string; codigo: string; nombre: string } | null;
  lote?:            { id: string; codigoLote: string } | null;
}

export interface ExistenciaFila {
  productoId: string;
  cantidad:   number;
  producto:   {
    id:            string;
    codigo:        string;
    nombre:        string;
    unidad_medida?: { id: string; codigo: string; nombre: string };
  };
}

export interface TrazabilidadNodo {
  loteId:                string;
  productoId:            string;
  productoNombre:        string;
  codigoLote:            string | null;
  fechaVencimiento:      string | null;
  costoUnitarioEfectivo: number;
  nivel:                 number;
  direccion:             string;
}

export interface ValorizacionStock {
  totalValorizado: number;
  productos: Array<{
    producto:      { id: string; codigo: string; nombre: string };
    cantidadTotal: number;
    valorTotal:    number;
  }>;
}

// ─── 4. Compras ──────────────────────────────────────────────────────────────

export interface CompraItem {
  id:                string;
  productoId:        string;
  producto?:         { id: string; codigo: string; nombre: string };
  cantidad:          number;
  costoUnitarioNeto: number;
  alicuotaIva:       number;
  codigoLote:        string | null;
  fechaVencimiento:  string | null;
  importeNeto:       number;
  importeIva:        number;
  importeTotal:      number;
}

export interface Compra {
  id:                         string;
  fecha:                      string;
  comprobanteProveedorTipo:   string | null;
  comprobanteProveedorNumero: string | null;
  totalNeto:                  number;
  totalIva:                   number;
  total:                      number;
  estado:                     EstadoCompra | string;
  generaEgresoCaja:           boolean;
  observaciones:              string | null;
  proveedor?:                 { id: string; razonSocial: string; cuit: string | null };
  items?:                     CompraItem[];
  createdAt:                  string;
  updatedAt:                  string;
}

export interface CrearCompraInput {
  proveedorId:                 string;
  fecha:                       string;
  comprobanteProveedorTipo?:   string;
  comprobanteProveedorNumero?: string;
  observaciones?:              string;
  generaEgresoCaja?:           boolean;
}

export type ActualizarCompraInput = Partial<CrearCompraInput>;

export interface AgregarItemCompraInput {
  productoId:        string;
  cantidad:          number;
  costoUnitarioNeto: number;
  alicuotaIva:       number;
  codigoLote?:       string | null;
  fechaVencimiento?: string | null;
}

export type ActualizarItemCompraInput = Partial<AgregarItemCompraInput>;

// ─── 5. Caja ─────────────────────────────────────────────────────────────────

export interface Caja {
  id:        string;
  nombre:    string;
  activa:    boolean;
  createdAt: string;
}

export interface SesionCaja {
  id:                   string;
  cajaId:               string;
  cajaNombre?:          string;
  estado:               EstadoSesionCaja | string;
  aperturaAt:           string;
  aperturaUsuarioId:    string;
  cierreAt:             string | null;
  cierreUsuarioId:      string | null;
  saldoInicial:         number;
  saldoTeoricoEfectivo: number | null;
  efectivoContado:      number | null;
  diferencia:           number | null;
  motivoDiferencia:     string | null;
  observaciones:        string | null;
  movimientos?:         MovimientoCaja[];
}

export interface MovimientoCaja {
  id:           string;
  sesionCajaId: string;
  tipo:         TipoMovimientoCaja | string;
  medioPagoId:  string;
  medioPago?: {
    id:           string;
    codigo:       string;
    nombre:       string;
    afectaArqueo: boolean;
  };
  importe:   number;
  motivo:    string | null;
  usuarioId: string;
  createdAt: string;
}

export interface TotalMedioPago {
  medioPagoId:  string;
  codigo:       string;
  nombre:       string;
  afectaArqueo: boolean;
  ingresos:     number;
  egresos:      number;
  neto:         number;
}

export interface ResumenSesion {
  sesionId:             string;
  saldoInicial:         number;
  saldoTeoricoEfectivo: number | null;
  efectivoContado:      number | null;
  diferencia:           number | null;
  totalesPorMedioPago:  TotalMedioPago[];
}

export interface AbrirSesionInput {
  cajaId?:      string;
  saldoInicial: number;
}

export interface RegistrarMovimientoCajaInput {
  tipo:        TipoMovimientoCaja;
  medioPagoId: string;
  importe:     number;
  motivo?:     string | null;
  referencia?: string | null;
}

export interface CerrarSesionInput {
  efectivoContado: number;
  motivo?:         string | null;
  observaciones?:  string | null;
}

// ─── 6. Ventas ───────────────────────────────────────────────────────────────

/** Forma snake_case tal como llega desde PostgREST crudo (GET /ventas y GET /ventas/:id) */
export interface VentaItemRow {
  id:                       string;
  venta_id:                 string;
  tipo_item:                TipoItemVenta;
  producto_id:              string | null;
  servicio_id:              string | null;
  lote_id:                  string | null;
  motivo_fefo:              string | null;
  mascota_id:               string | null;
  cantidad:                 number;
  precio_unitario:          number;
  subtotal_neto:            number;
  alicuota_iva:             number;
  importe_iva:              number;
  total_linea:              number;
  costo_unitario_historico: number | null;
  created_at?:              string;
}

export interface VentaPagoRow {
  id:            string;
  venta_id:      string;
  medio_pago_id: string;
  importe:       number;
  referencia:    string | null;
  created_at:    string;
}

export interface VentaRow {
  id:               string;
  tenant_id:        string;
  sesion_caja_id:   string;
  cliente_id:       string | null;
  usuario_id:       string;
  numero_operacion: string;
  condicion_pago:   CondicionPago;
  subtotal_neto:    number;
  total_iva:        number;
  total:            number;
  saldo_pendiente:  number;
  estado:           EstadoVenta;
  observaciones:    string | null;
  created_at:       string;
  anulada_at:       string | null;
  anulada_motivo:   string | null;
  items?:           VentaItemRow[];
  pagos?:           VentaPagoRow[];
  cliente?:         { id?: string; full_name?: string; dni_cuit?: string | null; condicion_fiscal?: string | null } | null;
  usuario?:         { id?: string; full_name?: string; email?: string } | null;
}

/** Forma normalizada en camelCase que consume el frontend */
export interface VentaItem {
  id:                     string;
  ventaId:                string;
  tipoItem:               TipoItemVenta;
  productoId:             string | null;
  servicioId:             string | null;
  loteId:                 string | null;
  motivoFefo:             string | null;
  mascotaId:              string | null;
  cantidad:               number;
  precioUnitario:         number;
  subtotalNeto:           number;
  alicuotaIva:            number;
  importeIva:             number;
  totalLinea:             number;
  costoUnitarioHistorico: number | null;
}

export interface VentaPago {
  id:          string;
  ventaId:     string;
  medioPagoId: string;
  importe:     number;
  referencia:  string | null;
  createdAt:   string;
}

export interface Venta {
  id:              string;
  tenantId:        string;
  sesionCajaId:    string;
  clienteId:       string | null;
  usuarioId:       string;
  numeroOperacion: string;
  condicionPago:   CondicionPago;
  subtotalNeto:    number;
  totalIva:        number;
  total:           number;
  saldoPendiente:  number;
  estado:          EstadoVenta;
  observaciones:   string | null;
  createdAt:       string;
  anuladaAt:       string | null;
  anuladaMotivo:   string | null;
  items:           VentaItem[];
  pagos:           VentaPago[];
  cliente?:        { id?: string; full_name?: string; dni_cuit?: string | null; condicion_fiscal?: string | null } | null;
  usuario?:        { id?: string; full_name?: string; email?: string } | null;
}

export interface ItemVentaInput {
  tipoItem:             TipoItemVenta;
  productoId?:          string | null;
  servicioId?:          string | null;
  cantidad:             number;
  precioUnitario?:      number;
  descuentoPorcentaje?: number;
  loteId?:              string | null;
  motivoFefo?:          string | null;
  mascotaId?:           string | null;
}

export interface PagoVentaInput {
  medioPagoId: string;
  importe:     number;
  referencia?: string | null;
}

export interface RegistrarVentaInput {
  sesionCajaId:   string;
  clienteId?:      string | null;
  condicionPago?:  CondicionPago;
  items:          ItemVentaInput[];
  pagos?:         PagoVentaInput[];
  descuento?:     number;
  observaciones?: string | null;
}

export interface ResultadoVenta {
  ventaId:         string;
  numeroOperacion: string;
  operacionId:     string;
  subtotalNeto:    number;
  totalIva:        number;
  total:           number;
  saldoPendiente:  number;
}

export interface AnularVentaInput {
  sesionCajaId?: string | null;
  motivo:        string;
}

// ─── 7. Ajustes, Recuentos y Devoluciones ─────────────────────────────────────

export interface AjustarExistenciaInput {
  loteId:   string;
  tipo:     TipoAjuste;
  cantidad: number;
  motivo:   string;
}

export interface ResultadoAjuste {
  operacionId:     string;
  movimientoId:    string;
  existenciaFinal: number;
}

export interface RecuentoDetalle {
  id:              string;
  loteId:          string;
  codigoLote:      string | null;
  fechaVencimiento: string | null;
  producto:        { id: string; codigo: string; nombre: string } | null;
  cantidadSistema: number | null;
  cantidadContada: number;
  diferencia:      number | null;
  motivo:          string | null;
}

export interface Recuento {
  id:            string;
  fecha:         string;
  estado:        EstadoRecuento | string;
  observaciones: string | null;
  createdAt:     string;
  aplicadoAt:    string | null;
  usuario?:      { id: string; nombre: string } | null;
  aplicadoPor?:  { id: string; nombre: string } | null;
  detalles?:     RecuentoDetalle[];
}

export interface ItemRecuentoInput {
  loteId:           string;
  cantidadContada:  number;
  cantidadSistema?: number | null;
  motivo?:          string | null;
}

export interface ResultadoAplicarRecuento {
  recuentoId:       string;
  operacionId:      string;
  ajustesGenerados: number;
  lotesMovidos:     number | null;
}

export interface ItemDevolucionInput {
  ventaItemId: string;
  cantidad:    number;
  revendible?: boolean;
}

export interface RegistrarDevolucionInput {
  ventaId:           string;
  items:             ItemDevolucionInput[];
  motivo:            string;
  reintegraEfectivo?: boolean;
  sesionCajaId?:     string | null;
}

export interface ResultadoDevolucion {
  devolucionId:         string;
  operacionId:          string;
  itemsDevueltos:       number;
  reintegroTotal:       number;
  movimientosGenerados: number;
  importeReintegrado:   number;
}

// ─── 8. Fraccionamiento ───────────────────────────────────────────────────────

export interface FraccionarLoteInput {
  loteOrigenId:             string;
  productoDestinoId:        string;
  cantidadOrigen:           number;
  cantidadObtenida:         number;
  fechaVencimientoDestino?: string | null;
  codigoLoteDestino:        string;
  motivo?:                  string | null;
}

export interface ResultadoFraccionamiento {
  operacionId:       string;
  loteDestinoId:     string;
  cantidadTeorica:   number;
  cantidadObtenida:  number;
  desvioPorcentaje:  number;
  costoUnitarioHijo: number;
  mermaRegistrada:   number;
}

export interface ItemHistorialFraccionamiento {
  tenantId:              string;
  operacionId:           string;
  productoOrigenId:      string;
  productoDestinoId:     string;
  productoOrigenNombre:  string;
  productoDestinoNombre: string;
  cantidadOrigen:        number;
  factorTeorico:         number;
  cantidadTeorica:       number;
  cantidadObtenida:      number;
  merma:                 number;
  costoConsumido:        number;
  costoUnitarioHijo:     number;
  sobrecosto:            number | null;
  fraccionadoAt:         string;
}

// ─── 9. Consumo Clínico ───────────────────────────────────────────────────────

export interface ConsumoItemInput {
  productoId:  string;
  cantidad:    number;
  loteId?:     string | null;
  motivoFefo?: string | null;
}

export interface RegistrarConsumoInput {
  historialId:               string;
  planVacunacionId?:         string | null;
  recetaId?:                 string | null;
  profesionalPrescriptorId?: string | null;
  items:                     ConsumoItemInput[];
}

export interface DisponibilidadLoteItem {
  cantidad: number;
  lotes: {
    id:               string;
    codigo_lote:      string | null;
    fecha_vencimiento: string | null;
    estado:           EstadoLote | string;
  };
}

// ─── 10. Reportes ─────────────────────────────────────────────────────────────

export interface ReporteValorizacion {
  fechaCorte:        string;
  totalLineas:       number;
  totalUnidades:     number;
  valorizacionTotal: number;
  items: Array<{
    loteId:                string;
    codigoLote:            string | null;
    fechaVencimiento:      string | null;
    productoId:            string;
    productoCodigo:        string;
    productoNombre:        string;
    familiaId:             string | null;
    familiaNombre:         string | null;
    unidadMedida:          string;
    cantidad:              number;
    costoUnitarioEfectivo: number;
    valorTotal:            number;
  }>;
}

export interface ReporteRotacion {
  totalProductos: number;
  sinMovimiento:  number;
  items: Array<{
    productoId:         string;
    codigo:             string;
    nombre:             string;
    familiaNombre:      string;
    diasSinMovimiento:  number;
    ultimoMovimiento:   string | null;
    existenciaActual:   number;
    costoReposicion:    number;
    valorInmovilizado:  number;
  }>;
}

export interface ReporteRentabilidad {
  totalVentas:     number;
  margenPromedio:  number;
  gananciaTotal:   number;
  items: Array<{
    ventaId:             string;
    fecha:               string;
    productoId:          string;
    codigo:              string;
    nombre:              string;
    familiaNombre:       string;
    cantidad:            number;
    precioVentaUnitario: number;
    costoUnitario:       number;
    margenPorcentaje:    number;
    gananciaTotal:       number;
  }>;
}

export interface ReporteFraccionamiento {
  totalOperaciones:     number;
  mermaTotalPromedio:   number;
  items: Array<{
    fraccionamientoId:    string;
    fecha:                string;
    productoOrigen:       string;
    cantidadOrigen:       number;
    productoDestino:      string;
    cantidadDestino:      number;
    mermaPorcentaje:      number;
    costoOrigenTotal:     number;
    costoDestinoUnitario: number;
  }>;
}

export interface ReporteVentasUsuario {
  totalVentas:    number;
  totalRecaudado: number;
  usuarios: Array<{
    usuarioId:      string;
    nombre:         string;
    cantidadVentas: number;
    totalRecaudado: number;
    ticketPromedio: number;
  }>;
}

export interface ReporteVentasSesion {
  totalSesiones:  number;
  totalRecaudado: number;
  sesiones: Array<{
    sesionId:         string;
    cajaNombre:       string;
    fechaApertura:    string;
    fechaCierre:      string | null;
    estado:           string;
    totalVentas:      number;
    totalRecaudado:   number;
    diferenciaArqueo: number | null;
  }>;
}

export interface ReporteVentasMedioPago {
  totalRecaudado: number;
  mediosPago: Array<{
    medioPagoId:        string;
    codigo:             string;
    nombre:             string;
    cantidadOperaciones: number;
    totalRecaudado:     number;
    porcentajeDelTotal: number;
  }>;
}

export interface ReporteConsumoProfesional {
  totalConsumos:   number;
  totalValorizado: number;
  profesionales: Array<{
    profesionalId:   string;
    nombre:          string;
    cantidadEventos: number;
    totalInsumos:    number;
    valorTotal:      number;
  }>;
}

export interface ReporteConsumoEspecie {
  totalConsumos:   number;
  totalValorizado: number;
  especies: Array<{
    especieId:       string;
    nombre:          string;
    cantidadEventos: number;
    totalInsumos:    number;
    valorTotal:      number;
  }>;
}

// ─── 11. Catálogos PostgREST ─────────────────────────────────────────────────

export interface UnidadMedida {
  id:               string;
  codigo:           string;
  nombre:           string;
  abreviatura:      string;
  admite_decimales: boolean;
  escala_decimal:   number;
}

export interface MedioPago {
  id:                  string;
  codigo:              string;
  nombre:              string;
  afecta_arqueo:       boolean;
  requiere_referencia: boolean;
}

export interface ServicioVendible {
  id:           string;
  nombre:       string;
  precio:       number | null;
  alicuota_iva: number | null;
  tipo:         string;
}
