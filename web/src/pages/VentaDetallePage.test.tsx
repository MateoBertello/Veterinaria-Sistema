import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import VentaDetallePage from "./VentaDetallePage.tsx";
import * as ventasApi from "../api/comercial/ventas.ts";
import * as ajustesApi from "../api/comercial/ajustes.ts";
import * as cajaApi from "../api/comercial/caja.ts";
import * as catalogosApi from "../api/catalogos-comercial.ts";
import type { AuthUser, SesionCaja, Venta } from "../types/index.ts";

const mockAuth = {
  user: {
    id: "user-admin",
    username: "admin",
    fullName: "Admin",
    roleName: "Administrador",
    permissions: ["manage_sales", "void_sales"],
  } as AuthUser | null,
  hasPermission: (p: string) => Boolean(mockAuth.user?.permissions?.includes(p)),
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

const VENTA_DETALLE_MOCK: Venta = {
  id: "v-100",
  tenantId: "t-1",
  sesionCajaId: "ses-original",
  clienteId: "cli-1",
  usuarioId: "user-1",
  numeroOperacion: "0001-00000088",
  condicionPago: "contado",
  subtotalNeto: 10000,
  totalIva: 2100,
  total: 12100,
  saldoPendiente: 0,
  estado: "registrada",
  observaciones: null,
  createdAt: "2026-09-05T12:00:00.000Z",
  anuladaAt: null,
  anuladaMotivo: null,
  cliente: { full_name: "María Gómez", dni_cuit: "27334445551" },
  usuario: { full_name: "Martín Veterinario", email: "martin@vet.com" },
  items: [
    {
      id: "vi-1",
      ventaId: "v-100",
      tipoItem: "producto",
      productoId: "prod-1",
      servicioId: null,
      descripcionSnapshot: "Vacuna Antirrábica Felina",
      loteId: "lote-1",
      motivoFefo: "Cliente solicitó lote con vencimiento más lejano",
      mascotaId: null,
      cantidad: 2,
      precioUnitario: 5000,
      subtotalNeto: 8264.46,
      alicuotaIva: 21,
      importeIva: 1735.54,
      totalLinea: 10000,
      costoUnitarioHistorico: 2500,
      descuentoPorcentaje: 0,
      lote: {
        id: "lote-1",
        codigoLote: "L-2026-99",
        numeroLote: "L-2026-99",
        fechaVencimiento: "2027-01-15",
      },
    },
    {
      id: "vi-2",
      ventaId: "v-100",
      tipoItem: "servicio",
      productoId: null,
      servicioId: "serv-1",
      descripcionSnapshot: "Consulta Veterinaria General",
      loteId: null,
      motivoFefo: null,
      mascotaId: null,
      cantidad: 1,
      precioUnitario: 2100,
      subtotalNeto: 1735.54,
      alicuotaIva: 21,
      importeIva: 364.46,
      totalLinea: 2100,
      costoUnitarioHistorico: null,
      descuentoPorcentaje: 0,
      lote: null,
    },
  ],
  pagos: [
    {
      id: "vp-1",
      ventaId: "v-100",
      medioPagoId: "mp-efectivo",
      importe: 12100,
      referencia: "Caja mostrador",
      createdAt: "2026-09-05T12:00:00.000Z",
    },
  ],
};

const SESION_CAJA_ABIERTA_MOCK: SesionCaja = {
  id: "ses-abierta-actual",
  cajaId: "caja-1",
  cajaNombre: "Caja Mostrador",
  aperturaUsuarioId: "user-admin",
  cierreUsuarioId: null,
  aperturaAt: "2026-09-05T08:00:00.000Z",
  cierreAt: null,
  saldoInicial: 10000,
  saldoTeoricoEfectivo: 22100,
  efectivoContado: null,
  diferencia: null,
  estado: "abierta",
  motivoDiferencia: null,
  observaciones: null,
};

describe("VentaDetallePage (F4·T3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = {
      id: "user-admin",
      username: "admin",
      fullName: "Admin",
      roleName: "Administrador",
      permissions: ["manage_sales", "void_sales"],
    };

    vi.spyOn(ventasApi, "obtenerVenta").mockResolvedValue(VENTA_DETALLE_MOCK);
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(SESION_CAJA_ABIERTA_MOCK);
    vi.spyOn(catalogosApi, "listarMediosPago").mockResolvedValue([
      {
        id: "mp-efectivo",
        codigo: "efectivo",
        nombre: "Efectivo",
        afecta_arqueo: true,
        requiere_referencia: false,
      },
    ]);
  });

  const renderPage = (saleId = "v-100") => {
    return render(
      <MemoryRouter initialEntries={[`/ventas/${saleId}`]}>
        <Routes>
          <Route path="/ventas/:id" element={<VentaDetallePage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("Renderiza la fila de venta con items y pagos embebidos", async () => {
    renderPage();

    expect(await screen.findByText("Operación N° 0001-00000088")).toBeInTheDocument();
    expect(screen.getByText("María Gómez")).toBeInTheDocument();
    expect(screen.getByText("Martín Veterinario")).toBeInTheDocument();

    // Items
    expect(screen.getByText("Vacuna Antirrábica Felina")).toBeInTheDocument();
    expect(screen.getByText("Consulta Veterinaria General")).toBeInTheDocument();
    expect(screen.getByText(/L-2026-99/)).toBeInTheDocument();

    // Pagos
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
    expect(screen.getByText("Caja mostrador")).toBeInTheDocument();
  });

  it("§2.2: si una línea tiene motivo_fefo, se muestra claramente", async () => {
    renderPage();

    expect(await screen.findByText("Operación N° 0001-00000088")).toBeInTheDocument();

    // Debe mostrar la etiqueta y el texto de la justificación FEFO
    expect(screen.getByText(/Excepción FEFO:/)).toBeInTheDocument();
    expect(
      screen.getByText(/Cliente solicitó lote con vencimiento más lejano/),
    ).toBeInTheDocument();
  });

  it("El desglose neto / IVA aparece acá (y no aparecía en el carrito)", async () => {
    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    // Desglose en tarjeta de totales
    expect(screen.getByText("Subtotal Neto:")).toBeInTheDocument();
    const cardResumen = screen.getByText("Resumen de Importes").closest("[data-slot='card']")! as HTMLElement;
    expect(within(cardResumen).getByText("$ 10.000,00")).toBeInTheDocument();

    expect(screen.getByText("Total IVA:")).toBeInTheDocument();
    expect(within(cardResumen).getByText("$ 2.100,00")).toBeInTheDocument();

    expect(screen.getByText("Total con IVA:")).toBeInTheDocument();
    expect(within(cardResumen).getByText("$ 12.100,00")).toBeInTheDocument();
  });

  it("§2.6: la pantalla NO contiene 'Comprobante', 'Factura', 'Ticket' ni 'Recibo'", async () => {
    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    const bodyText = document.body.textContent || "";
    expect(bodyText).not.toMatch(/comprobante/i);
    expect(bodyText).not.toMatch(/factura/i);
    expect(bodyText).not.toMatch(/ticket/i);
    expect(bodyText).not.toMatch(/recibo/i);
  });

  it("Sin void_sales el botón Anular no se renderiza", async () => {
    mockAuth.user = {
      id: "user-recepcion",
      username: "recepcion",
      fullName: "Recepcionista",
      roleName: "Recepcionista",
      permissions: ["manage_sales"], // NO tiene void_sales
    };

    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    expect(screen.queryByRole("button", { name: /Anular operación/i })).not.toBeInTheDocument();
    // Pero sí puede ver el botón Devolver
    expect(screen.getByRole("button", { name: /Devolver/i })).toBeInTheDocument();
  });

  it("Sin caja abierta, Anular queda deshabilitado y explicado con title", async () => {
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(null); // Sin caja abierta

    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    const btnAnular = screen.getByRole("button", { name: /Anular operación/i });
    expect(btnAnular).toBeDisabled();
    expect(btnAnular).toHaveAttribute(
      "title",
      "Requiere una sesión de caja abierta para registrar el egreso",
    );
  });

  it("RN §2.1: anular pide confirmación, el texto nombra el reintegro de stock, el egreso de caja y que no se puede deshacer", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    const btnAnular = screen.getByRole("button", { name: /Anular operación/i });
    await user.click(btnAnular);

    // Diálogo abierto
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    const desc = within(dialog).getByText(/Se reintegra el stock a los lotes de los que salió/i);
    expect(desc).toBeInTheDocument();
    expect(desc.textContent).toMatch(/se registra el egreso de \$ 12\.100,00 en la caja abierta/i);
    expect(desc.textContent).toMatch(/No se puede deshacer/i);
  });

  it("RN §2.1: el error de anular queda DENTRO del diálogo sin cerrarlo", async () => {
    const user = userEvent.setup();
    const spyAnular = vi.spyOn(ventasApi, "anularVenta").mockRejectedValue({
      code: "CASH_SESSION_REQUIRED",
      message: "La sesión de caja no está abierta",
    });

    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    await user.click(screen.getByRole("button", { name: /Anular operación/i }));

    const dialog = screen.getByRole("alertdialog");
    const textarea = within(dialog).getByLabelText(/Motivo de anulación/i);
    await user.type(textarea, "Motivo válido con más de 10 caracteres");

    const btnConfirmar = within(dialog).getByRole("button", { name: /Confirmar anulación/i });
    await user.click(btnConfirmar);

    // Diálogo sigue abierto y muestra el error dentro
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText("Se requiere una sesión de caja abierta para registrar el egreso."),
    ).toBeInTheDocument();
  });

  it("Anular manda sesionCajaId de la sesión abierta ahora (NO de la venta original)", async () => {
    const user = userEvent.setup();
    const spyAnular = vi.spyOn(ventasApi, "anularVenta").mockResolvedValue({
      ventaId: "v-100",
      operacionId: "op-1",
      estado: "anulada",
      anuladaAt: "2026-09-05T12:30:00.000Z",
    });

    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    await user.click(screen.getByRole("button", { name: /Anular operación/i }));

    const dialog = screen.getByRole("alertdialog");
    const textarea = within(dialog).getByLabelText(/Motivo de anulación/i);
    await user.type(textarea, "Cliente devolvió todos los productos por insatisfacción");

    const btnConfirmar = within(dialog).getByRole("button", { name: /Confirmar anulación/i });
    await user.click(btnConfirmar);

    expect(spyAnular).toHaveBeenCalledWith("v-100", {
      sesionCajaId: "ses-abierta-actual", // La sesión abierta ahora, NO ses-original
      motivo: "Cliente devolvió todos los productos por insatisfacción",
    });
  });

  it("Devolución: motivo menor a 10 caracteres no habilita el botón de continuar", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    await user.click(screen.getByRole("button", { name: /Devolver/i }));

    // Sheet abierto
    expect(screen.getByText("Registrar Devolución")).toBeInTheDocument();

    // Seleccionar ítem
    const checkItem = screen.getByLabelText("Vacuna Antirrábica Felina");
    await user.click(checkItem);

    const btnContinuar = screen.getByRole("button", { name: /Continuar a confirmación/i });
    expect(btnContinuar).toBeDisabled();

    // Escribir motivo corto
    const txtMotivo = screen.getByLabelText(/Motivo de devolución/i);
    await user.type(txtMotivo, "Corto");
    expect(btnContinuar).toBeDisabled();

    // Completar a 10 o más caracteres
    await user.type(txtMotivo, " y con más de diez caracteres");
    expect(btnContinuar).toBeEnabled();
  });

  it("RN §2.1: la confirmación de devolución distingue revendible de merma", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    await user.click(screen.getByRole("button", { name: /Devolver/i }));

    // Seleccionar ítem 1 (Vacuna)
    const checkItem = screen.getByLabelText("Vacuna Antirrábica Felina");
    await user.click(checkItem);

    // Escribir motivo válido
    const txtMotivo = screen.getByLabelText(/Motivo de devolución/i);
    await user.type(txtMotivo, "Devolución por rotura del envase secundario");

    // Click continuar a confirmación
    const btnContinuar = screen.getByRole("button", { name: /Continuar a confirmación/i });
    await user.click(btnContinuar);

    // AlertDialog abierto
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Las marcadas como revendibles vuelven al stock; las demás se registran como merma\./i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Unidades revendibles:/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Unidades registradas como merma:/)).toBeInTheDocument();
    expect(within(dialog).getByText(/no se puede deshacer/i)).toBeInTheDocument();
  });

  it("Devolución manda revendible por ítem y sesionCajaId si reintegra efectivo", async () => {
    const user = userEvent.setup();
    const spyDevolucion = vi.spyOn(ajustesApi, "registrarDevolucion").mockResolvedValue({
      devolucionId: "dev-1",
      operacionId: "op-dev",
      itemsDevueltos: 2,
      reintegroTotal: 10000,
      movimientosGenerados: 1,
      importeReintegrado: 10000,
    });

    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    await user.click(screen.getByRole("button", { name: /Devolver/i }));

    await user.click(screen.getByLabelText("Vacuna Antirrábica Felina"));

    await user.type(
      screen.getByLabelText(/Motivo de devolución/i),
      "Producto sin abrir devuelto por el cliente",
    );

    await user.click(screen.getByRole("button", { name: /Continuar a confirmación/i }));

    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /Confirmar devolución/i }));

    expect(spyDevolucion).toHaveBeenCalledWith({
      ventaId: "v-100",
      items: [
        {
          ventaItemId: "vi-1",
          cantidad: 2,
          revendible: true,
        },
      ],
      motivo: "Producto sin abrir devuelto por el cliente",
      reintegraEfectivo: true,
      sesionCajaId: "ses-abierta-actual",
    });
  });

  it("Venta anulada: banner rojo visible y acciones Anular/Devolver ocultas", async () => {
    vi.spyOn(ventasApi, "obtenerVenta").mockResolvedValue({
      ...VENTA_DETALLE_MOCK,
      estado: "anulada",
      anuladaAt: "2026-09-05T15:00:00.000Z",
      anuladaMotivo: "Venta cargada por error dos veces",
    });

    renderPage();

    expect(await screen.findByText("Operación Anulada")).toBeInTheDocument();
    expect(screen.getByText(/Venta cargada por error dos veces/)).toBeInTheDocument();

    // Las acciones NO se renderizan
    expect(screen.queryByRole("button", { name: /Anular operación/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Devolver/i })).not.toBeInTheDocument();
  });

  it("Ningún request manda tenantId", async () => {
    const spyObtener = vi.spyOn(ventasApi, "obtenerVenta");

    renderPage();

    await screen.findByText("Operación N° 0001-00000088");

    expect(spyObtener).toHaveBeenCalledWith("v-100");
  });
});
