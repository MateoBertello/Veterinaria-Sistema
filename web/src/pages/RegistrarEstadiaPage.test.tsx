import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type Cliente, type Estadia, type Mascota } from "../types/index.ts";

vi.mock("../api/clientes.ts", () => ({
  listarClientes: vi.fn(),
}));
vi.mock("../api/mascotas.ts", () => ({
  listarMascotas: vi.fn(),
}));
vi.mock("../api/estadias.ts", () => ({
  crearEstadia: vi.fn(),
  modificarEstadia: vi.fn(),
  obtenerCupo: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RegistrarEstadiaPage } from "./RegistrarEstadiaPage.tsx";
import { listarClientes } from "../api/clientes.ts";
import { listarMascotas } from "../api/mascotas.ts";
import { crearEstadia, modificarEstadia, obtenerCupo } from "../api/estadias.ts";

const mockListarClientes = vi.mocked(listarClientes);
const mockListarMascotas = vi.mocked(listarMascotas);
const mockCrearEstadia = vi.mocked(crearEstadia);
const mockModificarEstadia = vi.mocked(modificarEstadia);
const mockObtenerCupo = vi.mocked(obtenerCupo);

const CHECK_IN = "2099-01-01";
const CHECK_OUT = "2099-01-03";

function makeCliente(over: Partial<Cliente> = {}): Cliente {
  return {
    id: "c1",
    fullName: "Juan Pérez",
    dniCuit: "20-12345678-9",
    phone: null,
    address: null,
    email: null,
    observations: null,
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    livePetCount: 1,
    ...over,
  };
}

function makeMascota(over: Partial<Mascota> = {}): Mascota {
  return {
    id: "m1",
    name: "Firulais",
    clientId: "c1",
    ownerName: "Juan Pérez",
    especieId: "e1",
    especieName: "Perro",
    razaId: null,
    razaName: null,
    sex: "Macho",
    tamano: "Grande",
    alimentoDieta: "Balanceado sin sal",
    birthDate: null,
    color: null,
    observations: null,
    estado: "Activa",
    deceasedDate: null,
    deceasedReason: null,
    ultimoPeso: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function makeEstadia(over: Partial<Estadia> = {}): Estadia {
  return {
    id: "e1",
    clientId: "c1",
    petId: "m1",
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    status: "Reservada",
    reason: "Vacaciones",
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    checkedInAt: null,
    checkedOutAt: null,
    petName: "Firulais",
    petTamano: "Grande",
    petDieta: "Balanceado sin sal",
    clientName: "Juan Pérez",
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RegistrarEstadiaPage />
    </MemoryRouter>,
  );
}

function renderEditPage(estadia?: Estadia) {
  return render(
    <MemoryRouter
      initialEntries={[
        estadia
          ? { pathname: `/guarderia/${estadia.id}/editar`, state: estadia }
          : "/guarderia/e1/editar",
      ]}
    >
      <Routes>
        <Route path="/guarderia/:id/editar" element={<RegistrarEstadiaPage />} />
        <Route path="/guarderia" element={<div>Ocupación de guardería (landing)</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function elegirCliente(cliente: Cliente) {
  await userEvent.click(screen.getByRole("combobox", { name: "Dueño" }));
  await userEvent.click(await screen.findByText(cliente.fullName));
}

async function elegirMascota(mascota: Mascota) {
  await userEvent.click(await screen.findByRole("combobox", { name: "Mascota" }));
  await userEvent.click(await screen.findByRole("option", { name: mascota.name }));
}

async function completarCamposBasicos(cliente: Cliente, mascota: Mascota) {
  await elegirCliente(cliente);
  await elegirMascota(mascota);
  fireEvent.change(screen.getByLabelText("Check-in *"), { target: { value: CHECK_IN } });
  fireEvent.change(screen.getByLabelText("Check-out *"), { target: { value: CHECK_OUT } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListarClientes.mockResolvedValue({ items: [], meta: { page: 1, limit: 15, total: 0 } });
  mockObtenerCupo.mockResolvedValue([]);
});

describe("RegistrarEstadiaPage", () => {
  it("al elegir cliente, carga sus mascotas activas", async () => {
    const cliente = makeCliente();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [makeMascota()], meta: { page: 1, limit: 100, total: 1 } });

    renderPage();
    await elegirCliente(cliente);

    await waitFor(() =>
      expect(mockListarMascotas).toHaveBeenCalledWith({ clientId: "c1", estado: "Activa", limit: 100 }),
    );
  });

  it("cliente sin mascotas activas muestra el mensaje correspondiente", async () => {
    const cliente = makeCliente();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [], meta: { page: 1, limit: 100, total: 0 } });

    renderPage();
    await elegirCliente(cliente);

    expect(await screen.findByText("Este cliente no tiene mascotas activas.")).toBeInTheDocument();
  });

  it("al elegir mascota muestra la tarjeta con tamaño y dieta", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota({ tamano: "Pequeño", alimentoDieta: "Dieta renal" });
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });

    renderPage();
    await elegirCliente(cliente);
    await elegirMascota(mascota);

    expect(await screen.findByText("Pequeño")).toBeInTheDocument();
    expect(screen.getByText("Dieta renal")).toBeInTheDocument();
  });

  it("mascota sin dieta cargada muestra el fallback", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota({ alimentoDieta: null });
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });

    renderPage();
    await elegirCliente(cliente);
    await elegirMascota(mascota);

    expect(await screen.findByText("Sin indicaciones de dieta")).toBeInTheDocument();
  });

  it("registra la estadía con el payload esperado y resetea el formulario", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearEstadia.mockResolvedValue(makeEstadia());

    renderPage();
    await completarCamposBasicos(cliente, mascota);
    await userEvent.type(screen.getByLabelText("Motivo *"), "Vacaciones");

    await userEvent.click(screen.getByRole("button", { name: "Registrar Estadía" }));

    await waitFor(() =>
      expect(mockCrearEstadia).toHaveBeenCalledWith({
        clientId: "c1",
        petId: "m1",
        checkInDate: CHECK_IN,
        checkOutDate: CHECK_OUT,
        reason: "Vacaciones",
        notes: undefined,
      }),
    );

    const { toast } = await import("sonner");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    // El form se resetea: la tarjeta de mascota desaparece.
    expect(screen.queryByText("Firulais")).not.toBeInTheDocument();
  });

  it("mapea CUPO_GUARDERIA_AGOTADO como toast y marca los días agotados", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockObtenerCupo.mockResolvedValue([
      { date: CHECK_IN, ocupados: 1, cupo: 5, disponible: 4 },
    ]);
    mockCrearEstadia.mockRejectedValue(
      new ApiError("CUPO_GUARDERIA_AGOTADO", 409, "No hay cupo de guardería disponible en los días seleccionados", [
        CHECK_IN,
      ]),
    );

    renderPage();
    await completarCamposBasicos(cliente, mascota);
    await userEvent.type(screen.getByLabelText("Motivo *"), "Vacaciones");
    await userEvent.click(screen.getByRole("button", { name: "Registrar Estadía" }));

    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "No hay cupo de guardería disponible en los días seleccionados",
      ),
    );
    expect(await screen.findByLabelText(/sin cupo disponible/)).toBeInTheDocument();
  });

  it("mapea STAY_OVERLAP solo como toast, sin error de campo", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearEstadia.mockRejectedValue(
      new ApiError("STAY_OVERLAP", 409, "La mascota ya tiene una estadía que se solapa con este rango"),
    );

    renderPage();
    await completarCamposBasicos(cliente, mascota);
    await userEvent.type(screen.getByLabelText("Motivo *"), "Vacaciones");
    await userEvent.click(screen.getByRole("button", { name: "Registrar Estadía" }));

    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "La mascota ya tiene una estadía que se solapa con este rango",
      ),
    );
  });

  it("mapea MASCOTA_NOT_FOUND/PET_DECEASED al campo Mascota", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearEstadia.mockRejectedValue(new ApiError("PET_DECEASED", 422, "La mascota está marcada como fallecida"));

    renderPage();
    await completarCamposBasicos(cliente, mascota);
    await userEvent.type(screen.getByLabelText("Motivo *"), "Vacaciones");
    await userEvent.click(screen.getByRole("button", { name: "Registrar Estadía" }));

    expect(await screen.findByText("La mascota está marcada como fallecida")).toBeInTheDocument();
  });

  it("mapea VALIDATION_ERROR de reason al campo correspondiente", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearEstadia.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", 422, "Datos inválidos", [
        { field: "reason", message: "El motivo es requerido" },
      ]),
    );

    renderPage();
    await completarCamposBasicos(cliente, mascota);
    await userEvent.type(screen.getByLabelText("Motivo *"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Registrar Estadía" }));

    expect(await screen.findByText("El motivo es requerido")).toBeInTheDocument();
  });

  it("valida client-side que el check-out no sea anterior al check-in, sin llamar a la API", async () => {
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });

    renderPage();
    await elegirCliente(cliente);
    await elegirMascota(mascota);
    fireEvent.change(screen.getByLabelText("Check-in *"), { target: { value: "2099-01-05" } });
    fireEvent.change(screen.getByLabelText("Check-out *"), { target: { value: "2099-01-01" } });
    await userEvent.type(screen.getByLabelText("Motivo *"), "Vacaciones");

    await userEvent.click(screen.getByRole("button", { name: "Registrar Estadía" }));

    expect(
      await screen.findByText("El check-out no puede ser anterior al check-in"),
    ).toBeInTheDocument();
    expect(mockCrearEstadia).not.toHaveBeenCalled();
  });

  describe("modo edición", () => {
    it("precarga fechas/motivo/notas y muestra cliente/mascota de solo lectura", async () => {
      const estadia = makeEstadia({ notes: "Traer su manta" });
      renderEditPage(estadia);

      expect(await screen.findByText("Modificar Estadía")).toBeInTheDocument();
      expect(screen.getByText("Firulais")).toBeInTheDocument();
      expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
      expect(screen.getByText("Grande")).toBeInTheDocument();
      expect(screen.getByText("Balanceado sin sal")).toBeInTheDocument();
      expect(screen.getByLabelText(/Check-in/)).toHaveValue(CHECK_IN);
      expect(screen.getByLabelText("Check-out *")).toHaveValue(CHECK_OUT);
      expect(screen.getByLabelText("Motivo *")).toHaveValue("Vacaciones");
      expect(screen.getByLabelText("Notas")).toHaveValue("Traer su manta");
      // No se puede cambiar cliente/mascota: no hay combobox/select para eso.
      expect(screen.queryByRole("combobox", { name: "Dueño" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Mascota" })).not.toBeInTheDocument();
    });

    it("envía el PUT con el payload esperado y navega a Ocupación", async () => {
      const estadia = makeEstadia();
      mockModificarEstadia.mockResolvedValue(makeEstadia({ checkOutDate: "2099-01-05" }));
      renderEditPage(estadia);

      await screen.findByText("Modificar Estadía");
      fireEvent.change(screen.getByLabelText("Check-out *"), { target: { value: "2099-01-05" } });
      await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() =>
        expect(mockModificarEstadia).toHaveBeenCalledWith("e1", {
          checkInDate: CHECK_IN,
          checkOutDate: "2099-01-05",
          reason: "Vacaciones",
          notes: null,
        }),
      );
      expect(await screen.findByText("Ocupación de guardería (landing)")).toBeInTheDocument();
    });

    it("En curso: deshabilita el campo de check-in", async () => {
      const estadia = makeEstadia({ status: "EnCurso" });
      renderEditPage(estadia);

      expect(await screen.findByLabelText(/Check-in/)).toBeDisabled();
      expect(screen.getByText("En curso: no se puede modificar el check-in.")).toBeInTheDocument();
    });

    it("STAY_LOCKED al modificar → toast de error, sin navegar", async () => {
      const estadia = makeEstadia();
      mockModificarEstadia.mockRejectedValue(
        new ApiError("STAY_LOCKED", 422, "La estadía ya no admite cambios"),
      );
      renderEditPage(estadia);

      await screen.findByText("Modificar Estadía");
      await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

      const { toast } = await import("sonner");
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("La estadía ya no admite cambios"),
      );
      expect(screen.getByText("Modificar Estadía")).toBeInTheDocument();
    });

    it("sin state de navegación (refresh/link directo) muestra el aviso de volver a Ocupación", async () => {
      renderEditPage();

      expect(
        await screen.findByText("No se pudo cargar la estadía a modificar. Volvé a Ocupación e intentá de nuevo."),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Volver a Ocupación" }));
      expect(await screen.findByText("Ocupación de guardería (landing)")).toBeInTheDocument();
    });
  });
});
