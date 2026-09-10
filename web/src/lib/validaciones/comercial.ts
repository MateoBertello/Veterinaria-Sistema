import {
  alicuotaIva,
  decimalesMaximos,
  email,
  enValores,
  fechaIso,
  maxLongitud,
  maxValor,
  minLongitud,
  minValor,
  noNegativo,
  positivo,
  requerido,
  uuid,
} from "./reglas.ts";
import type { EsquemaValidacion } from "./types.ts";

// ─── Productos y Familias ───────────────────────────────────────────────────

export interface ProductoFormValues {
  codigo: string;
  nombre: string;
  unidadMedidaId: string;
  codigoBarras?: string | null;
  familiaId?: string | null;
  marca?: string | null;
  descripcion?: string | null;
  costoReposicion?: number | string | null;
  margenGanancia?: number | string | null;
  precioVenta?: number | string | null;
  alicuotaIva?: number | string | null;
  stockMinimo?: number | string | null;
  stockMaximo?: number | string | null;
  permiteFraccionar?: boolean;
}

export const productoEsquema: EsquemaValidacion<ProductoFormValues> = {
  codigo: [
    requerido("El código es obligatorio"),
    minLongitud(1, "El código es obligatorio"),
    maxLongitud(50, "El código no puede superar 50 caracteres"),
  ],
  nombre: [
    requerido("El nombre es requerido"),
    minLongitud(3, "El nombre requiere al menos 3 caracteres"),
    maxLongitud(150, "Máximo 150 caracteres"),
  ],
  unidadMedidaId: [
    requerido("Debe seleccionar una unidad de medida"),
    uuid("unidadMedidaId debe ser un UUID válido"),
  ],
  codigoBarras: [maxLongitud(50, "Máximo 50 caracteres")],
  marca: [maxLongitud(80, "Máximo 80 caracteres")],
  descripcion: [maxLongitud(500, "Máximo 500 caracteres")],
  familiaId: [uuid("familiaId debe ser un UUID válido")],
  costoReposicion: [
    noNegativo("El costo de reposición no puede ser negativo"),
    decimalesMaximos(4, "Admite hasta 4 decimales"),
  ],
  margenGanancia: [noNegativo("El margen no puede ser negativo")],
  precioVenta: [
    noNegativo("El precio de venta no puede ser negativo"),
    decimalesMaximos(2, "Admite hasta 2 decimales"),
  ],
  alicuotaIva: [alicuotaIva()],
  stockMinimo: [noNegativo("El stock mínimo no puede ser negativo")],
  stockMaximo: [noNegativo("El stock máximo no puede ser negativo")],
};

export interface FamiliaFormValues {
  nombre: string;
  codigo?: string | null;
  descripcion?: string | null;
}

export const familiaEsquema: EsquemaValidacion<FamiliaFormValues> = {
  nombre: [
    requerido("El nombre es requerido"),
    minLongitud(2, "El nombre requiere al menos 2 caracteres"),
    maxLongitud(100, "Máximo 100 caracteres"),
  ],
  codigo: [maxLongitud(30, "Máximo 30 caracteres")],
  descripcion: [maxLongitud(200, "Máximo 200 caracteres")],
};

// ─── Proveedores ────────────────────────────────────────────────────────────

export interface ProveedorFormValues {
  razonSocial: string;
  cuit?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  contactoNombre?: string | null;
  observaciones?: string | null;
}

export const proveedorEsquema: EsquemaValidacion<ProveedorFormValues> = {
  razonSocial: [
    requerido("La razón social es requerida"),
    minLongitud(2, "La razón social requiere al menos 2 caracteres"),
    maxLongitud(150, "Máximo 150 caracteres"),
  ],
  cuit: [maxLongitud(20, "Máximo 20 caracteres")],
  telefono: [maxLongitud(40, "Máximo 40 caracteres")],
  email: [email("Formato de email inválido"), maxLongitud(150, "Máximo 150 caracteres")],
  direccion: [maxLongitud(200, "Máximo 200 caracteres")],
  contactoNombre: [maxLongitud(120, "Máximo 120 caracteres")],
  observaciones: [maxLongitud(500, "Máximo 500 caracteres")],
};

// ─── Compras ────────────────────────────────────────────────────────────────

export interface CompraNuevaFormValues {
  proveedorId: string;
  fecha: string;
  comprobanteProveedorTipo?: string | null;
  comprobanteProveedorNumero?: string | null;
  observaciones?: string | null;
}

// Discrepancia identificada en inventario: actualmente en frontend solo valida si está presente el proveedor
export const compraNuevaEsquema: EsquemaValidacion<CompraNuevaFormValues> = {
  proveedorId: [
    requerido("Seleccione un proveedor para la compra"),
    uuid("proveedorId debe ser un UUID válido"),
  ],
  fecha: [
    requerido("La fecha es requerida"),
    fechaIso("Formato YYYY-MM-DD"),
  ],
  comprobanteProveedorTipo: [maxLongitud(50, "Máximo 50 caracteres")],
  comprobanteProveedorNumero: [maxLongitud(100, "Máximo 100 caracteres")],
};

export interface CompraItemFormValues {
  productoId: string;
  cantidad: number | string;
  costoUnitarioNeto: number | string;
  alicuotaIva: number | string;
  codigoLote?: string | null;
  fechaVencimiento?: string | null;
}

export const compraItemEsquema: EsquemaValidacion<CompraItemFormValues> = {
  productoId: [requerido("El producto es requerido"), uuid()],
  cantidad: [requerido("La cantidad es requerida"), positivo("La cantidad debe ser mayor a 0")],
  costoUnitarioNeto: [requerido("El costo es requerido"), noNegativo("El costo unitario neto no puede ser negativo")],
  alicuotaIva: [requerido("La alícuota es requerida"), alicuotaIva()],
  codigoLote: [maxLongitud(100, "Máximo 100 caracteres")],
  fechaVencimiento: [fechaIso("Formato YYYY-MM-DD")],
};

export interface AnularCompraFormValues {
  motivo: string;
}

export const anularCompraEsquema: EsquemaValidacion<AnularCompraFormValues> = {
  motivo: [
    requerido("El motivo de anulación es requerido"),
    minLongitud(10, "El motivo debe tener al menos 10 caracteres"),
  ],
};

// ─── Lotes ──────────────────────────────────────────────────────────────────

export interface BloquearLoteFormValues {
  motivo: string;
}

export const bloquearLoteEsquema: EsquemaValidacion<BloquearLoteFormValues> = {
  motivo: [
    requerido("El motivo del bloqueo es requerido"),
    minLongitud(10, "El motivo debe tener al menos 10 caracteres"),
  ],
};

// ─── Fraccionamiento ────────────────────────────────────────────────────────

export interface FraccionamientoFormValues {
  productoOrigenId: string;
  loteOrigenId: string;
  productoDestinoId: string;
  cantidadOrigen: number | string;
  cantidadObtenida: number | string; // NUNCA se precarga
  codigoLoteDestino?: string | null;
  fechaVencimientoDestino?: string | null;
}

export const fraccionamientoEsquema: EsquemaValidacion<FraccionamientoFormValues> = {
  productoOrigenId: [requerido("El producto de origen es requerido"), uuid()],
  loteOrigenId: [requerido("El lote de origen es requerido"), uuid()],
  productoDestinoId: [requerido("El producto de destino es requerido"), uuid()],
  cantidadOrigen: [requerido("La cantidad de origen es requerida"), positivo("La cantidad debe ser mayor a 0")],
  cantidadObtenida: [requerido("La cantidad obtenida es requerida"), positivo("La cantidad debe ser mayor a 0")],
  codigoLoteDestino: [maxLongitud(50, "Máximo 50 caracteres")],
  fechaVencimientoDestino: [fechaIso("Formato YYYY-MM-DD")],
};

// ─── Ajustes de Stock ───────────────────────────────────────────────────────

export interface AjusteStockFormValues {
  productoId: string;
  loteId: string;
  tipoAjuste: "ingreso" | "egreso";
  cantidad: number | string;
  motivo: string;
}

export const ajusteStockEsquema: EsquemaValidacion<AjusteStockFormValues> = {
  productoId: [requerido("El producto es requerido"), uuid()],
  loteId: [requerido("El lote es requerido"), uuid()],
  tipoAjuste: [requerido("El tipo es requerido"), enValores(["ingreso", "egreso"])],
  cantidad: [requerido("La cantidad es requerida"), positivo("La cantidad debe ser mayor a 0")],
  motivo: [
    requerido("El motivo es requerido"),
    minLongitud(10, "El motivo debe tener al menos 10 caracteres"),
  ],
};

// ─── Recuentos de Stock ─────────────────────────────────────────────────────

export interface RecuentoItemFormValues {
  cantidadContada: number | string; // NUNCA se precarga
}

export const recuentoItemEsquema: EsquemaValidacion<RecuentoItemFormValues> = {
  cantidadContada: [
    requerido("La cantidad contada es requerida"),
    noNegativo("La cantidad contada no puede ser negativa"),
  ],
};

// ─── Caja y Ventas ──────────────────────────────────────────────────────────

export interface AperturaCajaFormValues {
  montoInicial: number | string;
}

export const aperturaCajaEsquema: EsquemaValidacion<AperturaCajaFormValues> = {
  montoInicial: [
    requerido("El monto inicial es requerido"),
    noNegativo("El monto inicial no puede ser negativo"),
    decimalesMaximos(2, "Admite hasta 2 decimales"),
  ],
};

export interface ArqueoCajaFormValues {
  efectivoContado: number | string; // NUNCA se precarga
  motivoDiferencia?: string | null;
}

export const arqueoCajaEsquema: EsquemaValidacion<ArqueoCajaFormValues> = {
  efectivoContado: [
    requerido("El efectivo contado es requerido"),
    noNegativo("El efectivo no puede ser negativo"),
    decimalesMaximos(2, "Admite hasta 2 decimales"),
  ],
  motivoDiferencia: [minLongitud(10, "El motivo de la diferencia debe tener al menos 10 caracteres")],
};

export interface MovimientoManualCajaFormValues {
  tipo: "ingreso_manual" | "egreso_manual";
  monto: number | string;
  motivo: string;
}

export const movimientoManualCajaEsquema: EsquemaValidacion<MovimientoManualCajaFormValues> = {
  tipo: [requerido("El tipo de movimiento es requerido"), enValores(["ingreso_manual", "egreso_manual"])],
  monto: [requerido("El monto es requerido"), positivo("El monto debe ser mayor a 0"), decimalesMaximos(2, "Admite hasta 2 decimales")],
  motivo: [
    requerido("El motivo es requerido"),
    minLongitud(3, "El motivo debe tener al menos 3 caracteres"),
    maxLongitud(200, "Máximo 200 caracteres"),
  ],
};

export interface AnularVentaFormValues {
  motivo: string;
}

export const anularVentaEsquema: EsquemaValidacion<AnularVentaFormValues> = {
  motivo: [
    requerido("El motivo de anulación es requerido"),
    minLongitud(10, "El motivo debe tener al menos 10 caracteres"),
  ],
};

export interface DevolucionVentaFormValues {
  motivo: string;
}

export const devolucionVentaEsquema: EsquemaValidacion<DevolucionVentaFormValues> = {
  motivo: [
    requerido("El motivo de la devolución es requerido"),
    minLongitud(10, "El motivo debe tener al menos 10 caracteres"),
  ],
};
