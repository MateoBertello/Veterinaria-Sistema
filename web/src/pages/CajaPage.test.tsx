import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CajaPage } from "./CajaPage.tsx";
import * as cajaApi from "../api/comercial/caja.ts";
import * as catalogosComercialApi from "../api/catalogos-comercial.ts";
import type { Caja, MedioPago, ResumenSesion, SesionCaja } from "../types/index.ts";

const MOCK_CAJAS: Caja[] = [
  { id: "caja-1", nombre: "Caja Principal", activa: true, createdAt: "2026-01-01T00:00:00Z" },
  { id: "caja-2", nombre: "Caja Secundaria", activa: true, createdAt: "2026-01-01T00:00:00Z" },
];

const MOCK_MEDIOS_PAGO: MedioPago[] = [
  { id: "mp-efectivo", codigo: "efectivo", nombre: "Efectivo", afecta_arqueo: true, requiere_referencia: false },
  { id: "mp-transferencia", codigo: "transferencia", nombre: "Transferencia Bancaria", afecta_arqueo: false, requiere_referencia: true },
  { id: "mp-tarjeta-debito", codigo: "tarjeta_debito", nombre: "Tarjeta Débito", afecta_arqueo: false, requiere_referencia: true },
];

const MOCK_SESION_ABIERTA: SesionCaja = {
  id: "ses-1",
  cajaId: "caja-1",
  cajaNombre: "Caja Principal",
  estado: "abierta",
  aperturaAt: "2026-09-05T09:00:00.000Z",
  aperturaUsuarioId: "user-1",
  cierreAt: null,
  cierreUsuarioId: null,
  saldoInicial: 10000,
  saldoTeoricoEfectivo: 15000,
  efectivoContado: null,
  diferencia: null,
  motivoDiferencia: null,
  observaciones: null,
  movimientos: [
    {
      id: "mov-1",
      sesionCajaId: "ses-1",
      tipo: "ingreso_manual",
      medioPagoId: "mp-efectivo",
      medioPago: { id: "mp-efectivo", codigo: "efectivo", nombre: "Efectivo", afectaArqueo: true },
      importe: 5000,
      motivo: "Fondo de cambio adicional",
      usuarioId: "user-1",
      createdAt: "2026-09-05T10:00:00.000Z",
    },
  ],
};

const MOCK_RESUMEN: ResumenSesion = {
  sesionId: "ses-1",
  saldoInicial: 10000,
  saldoTeoricoEfectivo: 15000,
  efectivoContado: null,
  diferencia: null,
  totalesPorMedioPago: [
    {
      medioPagoId: "mp-efectivo",
      codigo: "efectivo",
      nombre: "Efectivo",
      afectaArqueo: true,
      ingresos: 5000,
      egresos: 0,
      neto: 5000,
    },
    {
      medioPagoId: "mp-transferencia",
      codigo: "transferencia",
      nombre: "Transferencia Bancaria",
      afectaArqueo: false,
      ingresos: 12000,
      egresos: 0,
      neto: 12000,
    },
  ],
};

const MOCK_HISTORIAL = {
  items: [
    {
      id: "ses-0",
      cajaId: "caja-1",
      cajaNombre: "Caja Principal",
      estado: "cerrada",
      aperturaAt: "2026-09-04T09:00:00.000Z",
      aperturaUsuarioId: "user-1",
      cierreAt: "2026-09-04T18:00:00.000Z",
      cierreUsuarioId: "user-1",
      saldoInicial: 10000,
      saldoTeoricoEfectivo: 20000,
      efectivoContado: 20000,
      diferencia: 0,
      motivoDiferencia: null,
      observaciones: null,
    },
  ],
  meta: { page: 1, limit: 10, total: 1 },
};

describe("CajaPage (F3·T1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(cajaApi, "listarCajas").mockResolvedValue(MOCK_CAJAS);
    vi.spyOn(catalogosComercialApi, "listarMediosPago").mockResolvedValue(MOCK_MEDIOS_PAGO);
    vi.spyOn(cajaApi, "listarSesiones").mockResolvedValue(MOCK_HISTORIAL);
  });

  it("sin sesión abierta se muestra el formulario de apertura; con sesión abierta, los tres bloques", async () => {
    // 1. Sin sesión abierta
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(null);

    const { unmount } = render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    // Debe mostrar el formulario de apertura
    expect(await screen.findByRole("heading", { level: 2, name: /apertura de caja/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/saldo inicial/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /abrir caja/i })).toBeInTheDocument();
    expect(screen.queryByText(/cabecera de la sesión/i)).not.toBeInTheDocument();

    unmount();

    // 2. Con sesión abierta
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    // Bloque 1: Cabecera con botón Cerrar caja
    expect(await screen.findByRole("button", { name: /cerrar caja/i })).toBeInTheDocument();
    expect(screen.getAllByText(/caja principal/i).length).toBeGreaterThanOrEqual(1);

    // Bloque 2: Resumen en vivo
    expect(screen.getByText(/resumen en vivo/i)).toBeInTheDocument();
    expect(screen.getByText(/saldo teórico/i)).toBeInTheDocument();

    // Bloque 3: Movimientos
    expect(screen.getByRole("heading", { name: /movimientos de la sesión/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /nuevo movimiento/i })).toBeInTheDocument();
  });

  it("abrir manda { cajaId, saldoInicial } y no lleva AlertDialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(null);
    const mockAbrir = vi.spyOn(cajaApi, "abrirSesion").mockResolvedValue(MOCK_SESION_ABIERTA);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const saldoInput = await screen.findByLabelText(/saldo inicial/i);
    await user.clear(saldoInput);
    await user.type(saldoInput, "1500");

    const submitBtn = screen.getByRole("button", { name: /abrir caja/i });
    await user.click(submitBtn);

    // Verificar que abrirSesion fue llamado sin alert dialog
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mockAbrir).toHaveBeenCalledWith(
      expect.objectContaining({
        cajaId: "caja-1",
        saldoInicial: 1500,
      }),
    );
  });

  it("el Select de medios de pago se llena desde listarMediosPago() (PostgREST), no desde la API", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const nuevoMovBtn = await screen.findByRole("button", { name: /nuevo movimiento/i });
    await user.click(nuevoMovBtn);

    // Abre el dialog
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(catalogosComercialApi.listarMediosPago).toHaveBeenCalled();
  });

  it("un motivo de 5 caracteres no habilita el botón; uno de 10, sí", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const nuevoMovBtn = await screen.findByRole("button", { name: /nuevo movimiento/i });
    await user.click(nuevoMovBtn);

    const dialog = await screen.findByRole("dialog");

    const importeInput = within(dialog).getByLabelText(/importe/i);
    await user.type(importeInput, "500");

    const motivoInput = within(dialog).getByLabelText(/motivo/i);
    // Motivo de 5 caracteres
    await user.type(motivoInput, "12345");

    const guardarBtn = within(dialog).getByRole("button", { name: /registrar movimiento/i });
    expect(guardarBtn).toBeDisabled();

    // Completamos a 10 caracteres
    await user.type(motivoInput, "67890");
    expect(guardarBtn).not.toBeDisabled();
  });

  it("elegir un medio con requiere_referencia: true marca referencia como requerida", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const nuevoMovBtn = await screen.findByRole("button", { name: /nuevo movimiento/i });
    await user.click(nuevoMovBtn);

    const dialog = await screen.findByRole("dialog");

    // Seleccionamos transferencia que tiene requiere_referencia = true
    const medioPagoSelect = within(dialog).getByLabelText(/medio de pago/i);
    await user.selectOptions(medioPagoSelect, "mp-transferencia");

    // Debe indicar que la referencia es requerida
    expect(within(dialog).getByLabelText(/referencia/i)).toHaveAttribute("required");
    expect(within(dialog).getByText(/\(requerido\)/i)).toBeInTheDocument();
  });

  it("el importe negativo o cero se rechaza en el cliente", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const nuevoMovBtn = await screen.findByRole("button", { name: /nuevo movimiento/i });
    await user.click(nuevoMovBtn);

    const dialog = await screen.findByRole("dialog");

    const importeInput = within(dialog).getByLabelText(/importe/i);
    const guardarBtn = within(dialog).getByRole("button", { name: /registrar movimiento/i });

    // Importe 0
    await user.type(importeInput, "0");
    expect(guardarBtn).toBeDisabled();

    // Importe negativo
    await user.clear(importeInput);
    await user.type(importeInput, "-100");
    expect(guardarBtn).toBeDisabled();
  });

  it("ingreso_venta muestra la advertencia", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const nuevoMovBtn = await screen.findByRole("button", { name: /nuevo movimiento/i });
    await user.click(nuevoMovBtn);

    const dialog = await screen.findByRole("dialog");

    const tipoSelect = within(dialog).getByLabelText(/tipo de movimiento/i);
    await user.selectOptions(tipoSelect, "ingreso_venta");

    expect(
      within(dialog).getByText(/las ventas registran su ingreso automáticamente\. usá esta opción solo para corregir\./i),
    ).toBeInTheDocument();
  });

  it("el resumen marca cuáles medios afectan el arqueo", async () => {
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/resumen en vivo/i)).toBeInTheDocument();

    // Debe mostrar indicador de afectación de arqueo
    expect(screen.getByText(/afecta arqueo/i)).toBeInTheDocument();
    expect(screen.getByText(/informativo/i)).toBeInTheDocument();
  });

  it("ningún request lleva tenantId", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(null);
    const mockAbrir = vi.spyOn(cajaApi, "abrirSesion").mockResolvedValue(MOCK_SESION_ABIERTA);

    render(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const saldoInput = await screen.findByLabelText(/saldo inicial/i);
    await user.clear(saldoInput);
    await user.type(saldoInput, "2000");

    await user.click(screen.getByRole("button", { name: /abrir caja/i }));

    expect(mockAbrir).toHaveBeenCalled();
    const callArg = mockAbrir.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("tenantId");
    expect(callArg).not.toHaveProperty("tenant_id");
  });
});
