import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ArqueoCajaPage } from "./ArqueoCajaPage.tsx";
import * as cajaApi from "../api/comercial/caja.ts";
import { ApiError } from "../types/index.ts";
import type { ResumenSesion, SesionCaja } from "../types/index.ts";

const MOCK_SESION_ABIERTA: SesionCaja = {
  id: "ses-123",
  cajaId: "caja-1",
  cajaNombre: "Caja Principal",
  estado: "abierta",
  aperturaAt: "2026-09-05T08:00:00.000Z",
  aperturaUsuarioId: "user-1",
  cierreAt: null,
  cierreUsuarioId: null,
  saldoInicial: 10000,
  saldoTeoricoEfectivo: 15000,
  efectivoContado: null,
  diferencia: null,
  motivoDiferencia: null,
  observaciones: null,
};

const MOCK_SESION_CERRADA: SesionCaja = {
  id: "ses-cerrada",
  cajaId: "caja-1",
  cajaNombre: "Caja Principal",
  estado: "cerrada",
  aperturaAt: "2026-09-05T08:00:00.000Z",
  aperturaUsuarioId: "user-1",
  cierreAt: "2026-09-05T18:00:00.000Z",
  cierreUsuarioId: "user-1",
  saldoInicial: 10000,
  saldoTeoricoEfectivo: 15000,
  efectivoContado: 14500,
  diferencia: -500,
  motivoDiferencia: "Faltante por error de cambio en mostrador",
  observaciones: "Turno cerrado normalmente",
};

const MOCK_RESUMEN: ResumenSesion = {
  sesionId: "ses-123",
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
      ingresos: 7000,
      egresos: 2000,
      neto: 5000,
    },
    {
      medioPagoId: "mp-tarjeta",
      codigo: "tarjeta_credito",
      nombre: "Tarjeta de Crédito",
      afectaArqueo: false,
      ingresos: 25000,
      egresos: 0,
      neto: 25000,
    },
  ],
};

function renderArqueoPage(sesionId = "ses-123") {
  return render(
    <MemoryRouter initialEntries={[`/ventas/caja/${sesionId}`]}>
      <Routes>
        <Route path="/ventas/caja/:sesionId" element={<ArqueoCajaPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ArqueoCajaPage (F3·T2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue(MOCK_RESUMEN);
  });

  it("el resumen se renderiza con los datos y la tabla por medio de pago, separando los que afectan el arqueo", async () => {
    renderArqueoPage();

    // Título y saldo teórico tras cargar
    expect(await screen.findByText(/saldo teórico en efectivo/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /detalle de sesión de caja/i })).toBeInTheDocument();
    expect(screen.getAllByText(/\$ 15\.000,00/).length).toBeGreaterThanOrEqual(1);

    // Separación entre los que afectan arqueo y los que no
    expect(screen.getByText(/medios que afectan el arqueo/i)).toBeInTheDocument();
    expect(screen.getByText(/otros medios de cobro \(informativos\)/i)).toBeInTheDocument();
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
    expect(screen.getByText("Tarjeta de Crédito")).toBeInTheDocument();
  });

  it("§2.3/§1.2: el campo de efectivo contado arranca VACÍO, no precargado con el teórico", async () => {
    renderArqueoPage();

    const contadoInput = await screen.findByLabelText(/efectivo contado/i);
    expect(contadoInput).toHaveValue(null);
    expect(contadoInput).not.toHaveValue(15000);
  });

  it("la diferencia se calcula y se colorea bien en los tres casos (0, faltante, sobrante)", async () => {
    const user = userEvent.setup();
    renderArqueoPage();

    const contadoInput = await screen.findByLabelText(/efectivo contado/i);

    // 1. Conteo igual al teórico (15000) -> 0 "Sin diferencia" en verde
    await user.type(contadoInput, "15000");
    const diffZero = await screen.findByTestId("diferencia-badge");
    expect(diffZero).toHaveTextContent(/sin diferencia/i);
    expect(diffZero.className).toMatch(/emerald/);

    // 2. Conteo menor (14500) -> "Faltan $ 500,00" en rojo
    await user.clear(contadoInput);
    await user.type(contadoInput, "14500");
    const diffFaltante = await screen.findByTestId("diferencia-badge");
    expect(diffFaltante).toHaveTextContent(/faltan/i);
    expect(diffFaltante).toHaveTextContent(/500/);
    expect(diffFaltante.className).toMatch(/rose|destructive/);

    // 3. Conteo mayor (15800) -> "Sobran $ 800,00" en ámbar
    await user.clear(contadoInput);
    await user.type(contadoInput, "15800");
    const diffSobrante = await screen.findByTestId("diferencia-badge");
    expect(diffSobrante).toHaveTextContent(/sobran/i);
    expect(diffSobrante).toHaveTextContent(/800/);
    expect(diffSobrante.className).toMatch(/amber/);
  });

  it("con diferencia distinta de 0, motivo es requerido y con menos de 10 caracteres el botón de cerrar no se habilita", async () => {
    const user = userEvent.setup();
    renderArqueoPage();

    const contadoInput = await screen.findByLabelText(/efectivo contado/i);
    await user.type(contadoInput, "14500"); // Diferencia de -500

    const motivoInput = screen.getByLabelText(/motivo/i);
    expect(motivoInput).toHaveAttribute("required");

    const cerrarBtn = screen.getByRole("button", { name: /cerrar caja/i });
    expect(cerrarBtn).toBeDisabled();

    // 5 caracteres: sigue deshabilitado
    await user.type(motivoInput, "Error");
    expect(cerrarBtn).toBeDisabled();

    // 10 caracteres o más: se habilita
    await user.type(motivoInput, " en cambio");
    expect(cerrarBtn).not.toBeDisabled();
  });

  it("con diferencia 0, motivo no es requerido", async () => {
    const user = userEvent.setup();
    renderArqueoPage();

    const contadoInput = await screen.findByLabelText(/efectivo contado/i);
    await user.type(contadoInput, "15000"); // Sin diferencia

    const motivoInput = screen.getByLabelText(/motivo/i);
    expect(motivoInput).not.toHaveAttribute("required");

    const cerrarBtn = screen.getByRole("button", { name: /cerrar caja/i });
    expect(cerrarBtn).not.toBeDisabled();
  });

  it("RN §2.1: el AlertDialog nombra el efectivo contado, el teórico, la diferencia, y dice que la sesión no se puede volver a abrir", async () => {
    const user = userEvent.setup();
    renderArqueoPage();

    const contadoInput = await screen.findByLabelText(/efectivo contado/i);
    await user.type(contadoInput, "14500");

    const motivoInput = screen.getByLabelText(/motivo/i);
    await user.type(motivoInput, "Faltante de caja verificado");

    const cerrarBtn = screen.getByRole("button", { name: /cerrar caja/i });
    await user.click(cerrarBtn);

    // Debe abrir el AlertDialog
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    // Debe contener el efectivo contado, saldo teórico, diferencia y advertencia de que no se puede reabrir
    expect(within(dialog).getByText(/14\.500/)).toBeInTheDocument();
    expect(within(dialog).getByText(/15\.000/)).toBeInTheDocument();
    expect(within(dialog).getByText(/-\$\s*500/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/la sesión queda cerrada y no se puede (volver a abrir|reabrir)/i),
    ).toBeInTheDocument();
  });

  it("RN §2.1: el error del backend queda DENTRO del diálogo y el diálogo no se cierra", async () => {
    const user = userEvent.setup();
    vi.spyOn(cajaApi, "cerrarSesion").mockRejectedValue(
      new ApiError("CASH_SESSION_CLOSED", 409, "La sesión ya fue cerrada por otro usuario"),
    );

    renderArqueoPage();

    const contadoInput = await screen.findByLabelText(/efectivo contado/i);
    await user.type(contadoInput, "15000");

    const cerrarBtn = screen.getByRole("button", { name: /cerrar caja/i });
    await user.click(cerrarBtn);

    const dialog = await screen.findByRole("alertdialog");
    const confirmarBtn = within(dialog).getByRole("button", { name: /confirmar cierre/i });
    await user.click(confirmarBtn);

    // El error debe verse dentro del diálogo con role="alert"
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/la sesión ya fue cerrada por otro usuario/i);
    // El diálogo permanece abierto
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("una sesión con estado cerrada se renderiza en solo lectura, sin formulario", async () => {
    vi.spyOn(cajaApi, "obtenerSesion").mockResolvedValue(MOCK_SESION_CERRADA);
    vi.spyOn(cajaApi, "resumenSesion").mockResolvedValue({
      ...MOCK_RESUMEN,
      efectivoContado: 14500,
      diferencia: -500,
    });

    renderArqueoPage("ses-cerrada");

    // Título y datos de solo lectura tras cargar
    expect(await screen.findByText(/sesión cerrada/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /detalle de sesión de caja/i })).toBeInTheDocument();
    expect(screen.getByText(/14\.500,00/)).toBeInTheDocument();
    expect(screen.getByText(/faltante por error de cambio/i)).toBeInTheDocument();

    // No debe haber inputs ni botón de cerrar
    expect(screen.queryByLabelText(/efectivo contado \*/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirmar cierre/i })).not.toBeInTheDocument();

    // Debe ofrecer botón para volver a la caja
    expect(screen.getByRole("link", { name: /volver a caja/i })).toBeInTheDocument();
  });

  it("ningún request lleva tenantId", async () => {
    const user = userEvent.setup();
    const mockCerrar = vi.spyOn(cajaApi, "cerrarSesion").mockResolvedValue(MOCK_SESION_CERRADA);

    renderArqueoPage();

    const contadoInput = await screen.findByLabelText(/efectivo contado/i);
    await user.type(contadoInput, "15000");

    await user.click(screen.getByRole("button", { name: /cerrar caja/i }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /confirmar cierre/i }));

    expect(mockCerrar).toHaveBeenCalled();
    const callArg = mockCerrar.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("tenantId");
    expect(callArg).not.toHaveProperty("tenant_id");
  });
});
