import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import {
  AjustesService,
  mapAjusteRpcError,
} from "../../supabase/functions/api/src/modules/ajustes/ajustes.service.ts";
import { ErrorCode, DomainError } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const LOTE_ID = "33333333-3333-4333-8333-333333333333";
const RECUENTO_ID = "44444444-4444-4444-8444-444444444444";
const VENTA_ID = "55555555-5555-4555-8555-555555555555";
const VENTA_ITEM_ID = "66666666-6666-4666-8666-666666666666";

describe("AjustesService & mapAjusteRpcError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Mapeo de errores RPC (mapAjusteRpcError)", () => {
    it("mapea REASON_REQUIRED a 422", () => {
      const err = mapAjusteRpcError({ message: "REASON_REQUIRED" });
      expect(err.code).toBe(ErrorCode.REASON_REQUIRED);
      expect(err.statusCode).toBe(422);
    });

    it("mapea BATCH_NOT_FOUND a 404", () => {
      const err = mapAjusteRpcError({ message: "BATCH_NOT_FOUND" });
      expect(err.code).toBe(ErrorCode.BATCH_NOT_FOUND);
      expect(err.statusCode).toBe(404);
    });

    it("mapea BATCH_EXPIRED a 409", () => {
      const err = mapAjusteRpcError({ message: "BATCH_EXPIRED" });
      expect(err.code).toBe(ErrorCode.BATCH_EXPIRED);
      expect(err.statusCode).toBe(409);
    });

    it("mapea BATCH_BLOCKED a 409", () => {
      const err = mapAjusteRpcError({ message: "BATCH_BLOCKED" });
      expect(err.code).toBe(ErrorCode.BATCH_BLOCKED);
      expect(err.statusCode).toBe(409);
    });

    it("mapea INSUFFICIENT_STOCK a 409", () => {
      const err = mapAjusteRpcError({ message: "INSUFFICIENT_STOCK" });
      expect(err.code).toBe(ErrorCode.INSUFFICIENT_STOCK);
      expect(err.statusCode).toBe(409);
    });

    it("mapea COUNT_NOT_FOUND a 404", () => {
      const err = mapAjusteRpcError({ message: "COUNT_NOT_FOUND" });
      expect(err.code).toBe(ErrorCode.COUNT_NOT_FOUND);
      expect(err.statusCode).toBe(404);
    });

    it("mapea COUNT_ALREADY_APPLIED a 409", () => {
      const err = mapAjusteRpcError({ message: "COUNT_ALREADY_APPLIED" });
      expect(err.code).toBe(ErrorCode.COUNT_ALREADY_APPLIED);
      expect(err.statusCode).toBe(409);
    });

    it("mapea COUNT_WITHOUT_DETAIL a 422", () => {
      const err = mapAjusteRpcError({ message: "COUNT_WITHOUT_DETAIL" });
      expect(err.code).toBe(ErrorCode.COUNT_WITHOUT_DETAIL);
      expect(err.statusCode).toBe(422);
    });

    it("mapea COUNT_STALE con JSON de lotes movidos a 409 con details", () => {
      const jsonPayload = JSON.stringify([{ loteId: LOTE_ID, cantidadVista: 10, cantidadActual: 7 }]);
      const err = mapAjusteRpcError({ message: `COUNT_STALE:${jsonPayload}` });
      expect(err.code).toBe(ErrorCode.COUNT_STALE);
      expect(err.statusCode).toBe(409);
      expect(err.details).toEqual([{ loteId: LOTE_ID, cantidadVista: 10, cantidadActual: 7 }]);
    });

    it("mapea RETURN_EXCEEDS_SOLD a 409", () => {
      const err = mapAjusteRpcError({ message: "RETURN_EXCEEDS_SOLD" });
      expect(err.code).toBe(ErrorCode.RETURN_EXCEEDS_SOLD);
      expect(err.statusCode).toBe(409);
    });

    it("mapea CASH_SESSION_REQUIRED a 409", () => {
      const err = mapAjusteRpcError({ message: "CASH_SESSION_REQUIRED" });
      expect(err.code).toBe(ErrorCode.CASH_SESSION_REQUIRED);
      expect(err.statusCode).toBe(409);
    });

    it("mapea uq_recuento_borrador a 409", () => {
      const err = mapAjusteRpcError({ message: "duplicate key value violates unique constraint \"uq_recuento_borrador\"" });
      expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.statusCode).toBe(409);
    });
  });

  describe("Ajustar existencia", () => {
    it("llama al RPC ajustar_existencia y retorna camelCase", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [{ operacion_id: "op-1", movimiento_id: "mov-1", existencia_final: "15.000" }],
        error: null,
      });
      mockGetServiceDb.mockReturnValue({ rpc: mockRpc } as any);

      const result = await AjustesService.ajustarExistencia(
        {
          loteId: LOTE_ID,
          tipo: "salida_ajuste",
          cantidad: 5,
          motivo: "Merma detectada en depósito",
        },
        TENANT_ID,
        USER_ID,
      );

      expect(mockRpc).toHaveBeenCalledWith("ajustar_existencia", {
        p_tenant_id: TENANT_ID,
        p_usuario_id: USER_ID,
        p_lote_id: LOTE_ID,
        p_tipo: "salida_ajuste",
        p_cantidad: 5,
        p_motivo: "Merma detectada en depósito",
      });
      expect(result).toEqual({
        operacionId: "op-1",
        movimientoId: "mov-1",
        existenciaFinal: 15,
      });
    });
  });

  describe("Bloqueo y desbloqueo de lote", () => {
    it("bloquearLote llama al RPC bloquear_lote", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [{ id: LOTE_ID, estado: "bloqueado", motivo_bloqueo: "Lote observado por laboratorio" }],
        error: null,
      });
      mockGetServiceDb.mockReturnValue({ rpc: mockRpc } as any);

      const result = await AjustesService.bloquearLote(
        LOTE_ID,
        { motivo: "Lote observado por laboratorio" },
        TENANT_ID,
        USER_ID,
      );

      expect(mockRpc).toHaveBeenCalledWith("bloquear_lote", {
        p_tenant_id: TENANT_ID,
        p_usuario_id: USER_ID,
        p_lote_id: LOTE_ID,
        p_motivo: "Lote observado por laboratorio",
      });
      expect(result.estado).toBe("bloqueado");
    });

    it("desbloquearLote llama al RPC desbloquear_lote", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [{ id: LOTE_ID, estado: "disponible", motivo_bloqueo: "Lote observado por laboratorio" }],
        error: null,
      });
      mockGetServiceDb.mockReturnValue({ rpc: mockRpc } as any);

      const result = await AjustesService.desbloquearLote(
        LOTE_ID,
        { motivo: "Aprobado tras análisis" },
        TENANT_ID,
        USER_ID,
      );

      expect(mockRpc).toHaveBeenCalledWith("desbloquear_lote", {
        p_tenant_id: TENANT_ID,
        p_usuario_id: USER_ID,
        p_lote_id: LOTE_ID,
        p_motivo: "Aprobado tras análisis",
      });
      expect(result.estado).toBe("disponible");
    });
  });

  describe("Recuentos CRUD y ciclo de vida", () => {
    it("crearRecuento inserta con estado borrador y tenant_id", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: RECUENTO_ID, numero: 1, estado: "borrador", observaciones: "Conteo mensual", created_at: "2026-08-31" },
          error: null,
        }),
      });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
      mockGetServiceDb.mockReturnValue({ from: mockFrom } as any);

      const res = await AjustesService.crearRecuento({ observaciones: "Conteo mensual" }, TENANT_ID, USER_ID);

      expect(mockFrom).toHaveBeenCalledWith("recuentos");
      expect(mockInsert).toHaveBeenCalledWith({
        tenant_id: TENANT_ID,
        usuario_id: USER_ID,
        estado: "borrador",
        observaciones: "Conteo mensual",
      });
      expect(res.id).toBe(RECUENTO_ID);
      expect(res.estado).toBe("borrador");
    });

    it("guardarDetallesRecuento rechaza si el recuento ya está aplicado", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: RECUENTO_ID, estado: "aplicado" },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) }) });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
      mockGetServiceDb.mockReturnValue({ from: mockFrom } as any);

      await expect(
        AjustesService.guardarDetallesRecuento(
          RECUENTO_ID,
          { items: [{ loteId: LOTE_ID, cantidadContada: 10 }] },
          TENANT_ID,
        ),
      ).rejects.toThrow(DomainError);
    });

    it("aplicarRecuento invoca RPC aplicar_recuento", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [{ recuento_id: RECUENTO_ID, operacion_id: "op-1", ajustes_generados: 2, lotes_movidos: null }],
        error: null,
      });
      mockGetServiceDb.mockReturnValue({ rpc: mockRpc } as any);

      const res = await AjustesService.aplicarRecuento(RECUENTO_ID, { confirmarDesvios: true }, TENANT_ID, USER_ID);

      expect(mockRpc).toHaveBeenCalledWith("aplicar_recuento", {
        p_tenant_id: TENANT_ID,
        p_usuario_id: USER_ID,
        p_recuento_id: RECUENTO_ID,
        p_confirmar_desvios: true,
      });
      expect(res.ajustesGenerados).toBe(2);
    });
  });

  describe("Devoluciones", () => {
    it("registrarDevolucion invoca RPC registrar_devolucion", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [{ devolucion_id: "dev-1", operacion_id: "op-1", items_devueltos: 1, reintegro_total: "1500.00" }],
        error: null,
      });
      mockGetServiceDb.mockReturnValue({ rpc: mockRpc } as any);

      const res = await AjustesService.registrarDevolucion(
        {
          ventaId: VENTA_ID,
          items: [{ ventaItemId: VENTA_ITEM_ID, cantidad: 1, revendible: true }],
          motivo: "Cliente devuelve producto en buen estado",
          reintegraEfectivo: false,
        },
        TENANT_ID,
        USER_ID,
      );

      expect(mockRpc).toHaveBeenCalledWith("registrar_devolucion", {
        p_tenant_id: TENANT_ID,
        p_usuario_id: USER_ID,
        p_venta_id: VENTA_ID,
        p_items: JSON.stringify([{ ventaItemId: VENTA_ITEM_ID, cantidad: 1, revendible: true }]),
        p_motivo: "Cliente devuelve producto en buen estado",
        p_reintegra_efectivo: false,
        p_sesion_caja_id: null,
      });
      expect(res.devolucionId).toBe("dev-1");
      expect(res.reintegroTotal).toBe(1500);
    });
  });
});
