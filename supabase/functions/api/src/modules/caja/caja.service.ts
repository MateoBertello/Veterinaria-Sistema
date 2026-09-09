import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  type AbrirSesionDto,
  type RegistrarMovimientoDto,
  type CerrarSesionDto,
  type ListarSesionesQuery,
} from "./caja.schemas.ts";

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface CajaPublica {
  id:        string;
  nombre:    string;
  activa:    boolean;
  createdAt: string;
}

export interface SesionCajaPublica {
  id:                    string;
  cajaId:                string;
  cajaNombre?:           string;
  estado:                string;
  aperturaAt:            string;
  aperturaUsuarioId:     string;
  cierreAt:              string | null;
  cierreUsuarioId:       string | null;
  saldoInicial:          number;
  saldoTeoricoEfectivo:  number | null;
  efectivoContado:       number | null;
  diferencia:            number | null;
  motivoDiferencia:      string | null;
  observaciones:         string | null;
}

export interface MovimientoCajaPublico {
  id:           string;
  sesionCajaId: string;
  tipo:         string;
  medioPagoId:  string;
  medioPago?:   {
    id:           string;
    codigo:       string;
    nombre:       string;
    afectaArqueo: boolean;
  };
  importe:      number;
  motivo:       string | null;
  usuarioId:    string;
  createdAt:    string;
}

export interface SesionCajaDetallePublica extends SesionCajaPublica {
  movimientos: MovimientoCajaPublico[];
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

export interface ResumenSesionPublico {
  sesionId:             string;
  saldoInicial:         number;
  saldoTeoricoEfectivo: number | null;
  efectivoContado:      number | null;
  diferencia:           number | null;
  totalesPorMedioPago:  TotalMedioPago[];
}

/**
 * Traduce el RAISE EXCEPTION del RPC a DomainError. El mensaje que llega de
 * PostgREST contiene el código tal cual lo lanzó el RPC.
 */
export function mapCajaRpcError(error: { message: string }, contexto: string): DomainError {
  const msg = error.message ?? "";
  if (msg.includes("CASH_SESSION_ALREADY_OPEN"))
    return new DomainError(ErrorCode.CASH_SESSION_ALREADY_OPEN, 409, "Ya hay una sesión abierta en esta caja");
  if (msg.includes("CASH_SESSION_CLOSED"))
    return new DomainError(ErrorCode.CASH_SESSION_CLOSED, 409, "La sesión de caja está cerrada");
  if (msg.includes("CASH_SESSION_NOT_FOUND"))
    return new DomainError(ErrorCode.CASH_SESSION_NOT_FOUND, 404, "Sesión de caja no encontrada en este tenant");
  if (msg.includes("PAYMENT_REFERENCE_REQUIRED"))
    return new DomainError(ErrorCode.PAYMENT_REFERENCE_REQUIRED, 422, "El medio de pago exige número de operación");
  if (msg.includes("PAYMENT_METHOD_DISABLED"))
    return new DomainError(ErrorCode.PAYMENT_METHOD_DISABLED, 422, "El medio de pago no está disponible");
  if (msg.includes("REASON_REQUIRED"))
    return new DomainError(ErrorCode.REASON_REQUIRED, 422, "La operación exige un motivo de al menos 10 caracteres");
  if (msg.includes("INVALID_OPENING_BALANCE"))
    return new DomainError(ErrorCode.INVALID_OPENING_BALANCE, 422, "El saldo declarado es inválido");
  if (msg.includes("INVALID_QUANTITY"))
    return new DomainError(ErrorCode.INVALID_QUANTITY, 422, "El importe debe ser mayor que cero");
  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, `Error en ${contexto}`);
}

function mapCajaRow(row: any): CajaPublica {
  return {
    id:        row.id,
    nombre:    row.nombre,
    activa:    Boolean(row.activa),
    createdAt: row.created_at,
  };
}

function mapSesionRow(row: any): SesionCajaPublica {
  return {
    id:                   row.id,
    cajaId:               row.caja_id,
    cajaNombre:           row.caja?.nombre,
    estado:               row.estado,
    aperturaAt:           row.apertura_at,
    aperturaUsuarioId:    row.apertura_usuario_id,
    cierreAt:             row.cierre_at ?? null,
    cierreUsuarioId:      row.cierre_usuario_id ?? null,
    saldoInicial:         Number(row.saldo_inicial),
    saldoTeoricoEfectivo: row.saldo_teorico_efectivo !== null ? Number(row.saldo_teorico_efectivo) : null,
    efectivoContado:      row.efectivo_contado !== null ? Number(row.efectivo_contado) : null,
    diferencia:           row.diferencia !== null ? Number(row.diferencia) : null,
    motivoDiferencia:     row.motivo_diferencia ?? null,
    observaciones:        row.observaciones ?? null,
  };
}

function mapMovimientoRow(row: any): MovimientoCajaPublico {
  return {
    id:           row.id,
    sesionCajaId: row.sesion_caja_id,
    tipo:         row.tipo,
    medioPagoId:  row.medio_pago_id,
    medioPago:    row.medio_pago ? {
      id:           row.medio_pago.id,
      codigo:       row.medio_pago.codigo,
      nombre:       row.medio_pago.nombre,
      afectaArqueo: Boolean(row.medio_pago.afecta_arqueo),
    } : undefined,
    importe:      Number(row.importe),
    motivo:       row.motivo ?? null,
    usuarioId:    row.usuario_id,
    createdAt:    row.created_at,
  };
}

export class CajaService {
  /**
   * Lista las cajas del tenant.
   */
  static async listarCajas(tenantId: string): Promise<CajaPublica[]> {
    const db = getServiceDb();
    const { data, error } = await db
      .from("cajas")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al listar cajas");
    return (data || []).map(mapCajaRow);
  }

  /**
   * Asegura la existencia de al menos una caja en el tenant (crea "Caja principal" si no hay ninguna).
   * Idempotente: audita solo cuando crea.
   */
  static async asegurarCajaPrincipal(ctx: CallerContext): Promise<CajaPublica> {
    const db = getServiceDb();
    const { data: existente, error: errExistente } = await db
      .from("cajas")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (errExistente) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al verificar caja principal");
    if (existente) return mapCajaRow(existente);

    const { data: nueva, error: errNueva } = await db
      .from("cajas")
      .insert({
        tenant_id: ctx.tenantId,
        nombre:    "Caja principal",
        activa:    true,
      })
      .select()
      .single();

    if (errNueva || !nueva) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al crear caja principal");

    await recordAudit(db as unknown as any, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "cash_register",
      entityId:  nueva.id,
      newValues: { nombre: nueva.nombre, activa: nueva.activa },
    });

    return mapCajaRow(nueva);
  }

  /**
   * Abre una nueva sesión de caja llamando al RPC abrir_sesion_caja.
   */
  static async abrirSesion(dto: AbrirSesionDto, ctx: CallerContext): Promise<{
    id:           string;
    cajaId:       string;
    aperturaAt:   string;
    saldoInicial: number;
  }> {
    const db = getServiceDb();
    let cajaId = dto.cajaId;
    if (!cajaId) {
      const principal = await this.asegurarCajaPrincipal(ctx);
      cajaId = principal.id;
    }

    const { data, error } = await db.rpc("abrir_sesion_caja", {
      p_tenant_id:     ctx.tenantId,
      p_usuario_id:    ctx.callerUserId,
      p_caja_id:       cajaId,
      p_saldo_inicial: dto.saldoInicial,
    });

    if (error) throw mapCajaRpcError(error, "abrir sesión de caja");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      id:           row.sesion_id,
      cajaId:       row.caja_id,
      aperturaAt:   row.apertura_at,
      saldoInicial: Number(row.saldo_inicial),
    };
  }

  /**
   * Registra un movimiento en una sesión de caja abierta llamando al RPC registrar_movimiento_caja.
   */
  static async registrarMovimiento(
    sesionId: string,
    dto:      RegistrarMovimientoDto,
    ctx:      CallerContext,
  ): Promise<{
    id:           string;
    sesionCajaId: string;
  }> {
    const db = getServiceDb();

    // RN-CJ9: validación en el Service antes de llamar al RPC
    const { data: mp, error: errMp } = await db
      .from("medios_pago")
      .select("id, activo, requiere_referencia")
      .eq("id", dto.medioPagoId)
      .maybeSingle();

    if (errMp) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al validar medio de pago");
    if (!mp || !mp.activo) {
      throw new DomainError(ErrorCode.PAYMENT_METHOD_DISABLED, 422, "El medio de pago no está disponible");
    }
    if (mp.requiere_referencia && (!dto.referencia || dto.referencia.trim() === "")) {
      throw new DomainError(ErrorCode.PAYMENT_REFERENCE_REQUIRED, 422, "El medio de pago exige número de operación");
    }

    const { data, error } = await db.rpc("registrar_movimiento_caja", {
      p_tenant_id:     ctx.tenantId,
      p_usuario_id:    ctx.callerUserId,
      p_sesion_id:     sesionId,
      p_tipo:          dto.tipo,
      p_medio_pago_id: dto.medioPagoId,
      p_importe:       dto.importe,
      p_motivo:        dto.motivo ?? null,
      p_referencia:    dto.referencia ?? null,
    });

    if (error) throw mapCajaRpcError(error, "registrar movimiento de caja");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      id:           row.movimiento_id,
      sesionCajaId: row.sesion_id,
    };
  }

  /**
   * Cierra una sesión de caja con arqueo llamando al RPC cerrar_sesion_caja.
   */
  static async cerrarSesion(
    sesionId: string,
    dto:      CerrarSesionDto,
    ctx:      CallerContext,
  ): Promise<{
    id:                   string;
    saldoTeoricoEfectivo: number;
    efectivoContado:      number;
    diferencia:           number;
  }> {
    const db = getServiceDb();
    const { data, error } = await db.rpc("cerrar_sesion_caja", {
      p_tenant_id:        ctx.tenantId,
      p_usuario_id:       ctx.callerUserId,
      p_sesion_id:        sesionId,
      p_efectivo_contado: dto.efectivoContado,
      p_motivo:           dto.motivo ?? null,
      p_observaciones:    dto.observaciones ?? null,
    });

    if (error) throw mapCajaRpcError(error, "cerrar sesión de caja");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      id:                   row.sesion_id,
      saldoTeoricoEfectivo: Number(row.saldo_teorico_efectivo),
      efectivoContado:      Number(row.efectivo_contado),
      diferencia:           Number(row.diferencia),
    };
  }

  /**
   * Obtiene la sesión de caja actualmente abierta (o null si no hay ninguna).
   */
  static async sesionAbierta(tenantId: string, cajaId?: string): Promise<SesionCajaPublica | null> {
    const db = getServiceDb();
    let q = db
      .from("sesiones_caja")
      .select("*, caja:cajas!inner(id, nombre)")
      .eq("tenant_id", tenantId)
      .eq("estado", "abierta");

    if (cajaId) {
      q = q.eq("caja_id", cajaId);
    }

    const { data, error } = await q.maybeSingle();
    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar sesión abierta");
    if (!data) return null;
    return mapSesionRow(data);
  }

  /**
   * Obtiene el detalle de una sesión con sus movimientos embebidos en una sola consulta.
   */
  static async obtenerSesion(sesionId: string, tenantId: string): Promise<SesionCajaDetallePublica> {
    const db = getServiceDb();
    const { data, error } = await db
      .from("sesiones_caja")
      .select("*, caja:cajas!inner(id, nombre), movimientos:movimientos_caja(*, medio_pago:medios_pago(id, codigo, nombre, afecta_arqueo))")
      .eq("id", sesionId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al obtener sesión de caja");
    if (!data) throw new DomainError(ErrorCode.CASH_SESSION_NOT_FOUND, 404, "Sesión de caja no encontrada");

    const base = mapSesionRow(data);
    const movimientos = (data.movimientos || []).map(mapMovimientoRow);
    return {
      ...base,
      movimientos,
    };
  }

  /**
   * Lista sesiones de caja con paginación y filtros de estado / fecha.
   */
  static async listarSesiones(tenantId: string, opts: ListarSesionesQuery): Promise<{
    items: SesionCajaPublica[];
    total: number;
    page:  number;
    limit: number;
  }> {
    const db = getServiceDb();
    let q = db
      .from("sesiones_caja")
      .select("*, caja:cajas!inner(id, nombre)", { count: "exact" })
      .eq("tenant_id", tenantId);

    if (opts.estado) q = q.eq("estado", opts.estado);
    if (opts.desde)  q = q.gte("apertura_at", `${opts.desde}T00:00:00.000Z`);
    if (opts.hasta)  q = q.lte("apertura_at", `${opts.hasta}T23:59:59.999Z`);

    const from = (opts.page - 1) * opts.limit;
    const to = from + opts.limit - 1;

    const { data, count, error } = await q
      .order("apertura_at", { ascending: false })
      .range(from, to);

    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al listar sesiones de caja");

    return {
      items: (data || []).map(mapSesionRow),
      total: count ?? 0,
      page:  opts.page,
      limit: opts.limit,
    };
  }

  /**
   * Retorna el resumen de una sesión con totales agrupados por medio de pago en una sola consulta de movimientos.
   */
  static async resumenSesion(sesionId: string, tenantId: string): Promise<ResumenSesionPublico> {
    const db = getServiceDb();

    // Consulta de la sesión con sus campos congelados
    const { data: sesion, error: errSesion } = await db
      .from("sesiones_caja")
      .select("id, estado, saldo_inicial, saldo_teorico_efectivo, efectivo_contado, diferencia")
      .eq("id", sesionId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (errSesion) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar sesión");
    if (!sesion) throw new DomainError(ErrorCode.CASH_SESSION_NOT_FOUND, 404, "Sesión de caja no encontrada");

    // Una sola consulta para todos los movimientos de la sesión con su medio de pago
    const { data: movs, error: errMovs } = await db
      .from("movimientos_caja")
      .select("tipo, importe, medio_pago:medios_pago!inner(id, codigo, nombre, afecta_arqueo)")
      .eq("sesion_caja_id", sesionId)
      .eq("tenant_id", tenantId);

    if (errMovs) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar movimientos para resumen");

    const porMedioMap = new Map<string, TotalMedioPago>();

    for (const m of movs || []) {
      const mp = (m as any).medio_pago;
      const mpId = mp.id as string;
      if (!porMedioMap.has(mpId)) {
        porMedioMap.set(mpId, {
          medioPagoId:  mpId,
          codigo:       mp.codigo,
          nombre:       mp.nombre,
          afectaArqueo: Boolean(mp.afecta_arqueo),
          ingresos:     0,
          egresos:      0,
          neto:         0,
        });
      }
      const item = porMedioMap.get(mpId)!;
      const importe = Number(m.importe);
      const esIngreso = ["ingreso_venta", "ingreso_cobro_cuenta_corriente", "ingreso_manual"].includes(m.tipo);
      if (esIngreso) {
        item.ingresos += importe;
        item.neto += importe;
      } else {
        item.egresos += importe;
        item.neto -= importe;
      }
    }

    const totalAfectaArqueo = [...porMedioMap.values()]
      .filter((mp) => mp.afectaArqueo)
      .reduce((acc, mp) => acc + mp.neto, 0);

    const saldoTeoricoEfectivo =
      sesion.saldo_teorico_efectivo !== null
        ? Number(sesion.saldo_teorico_efectivo)
        : Number(sesion.saldo_inicial) + totalAfectaArqueo;

    return {
      sesionId,
      saldoInicial:         Number(sesion.saldo_inicial),
      saldoTeoricoEfectivo: saldoTeoricoEfectivo,
      efectivoContado:      sesion.efectivo_contado !== null ? Number(sesion.efectivo_contado) : null,
      diferencia:           sesion.diferencia !== null ? Number(sesion.diferencia) : null,
      totalesPorMedioPago:  [...porMedioMap.values()],
    };
  }
}
