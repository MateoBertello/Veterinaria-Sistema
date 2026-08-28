import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  ApiError,
  type Cliente,
  type Doctor,
  type Mascota,
  type Servicio,
  type Turno,
} from "../types/index.ts";

vi.mock("../api/servicios.ts", () => ({
  listarServicios: vi.fn(),
}));
vi.mock("../api/clientes.ts", () => ({
  listarClientes: vi.fn(),
}));
vi.mock("../api/mascotas.ts", () => ({
  listarMascotas: vi.fn(),
}));
vi.mock("../api/doctores.ts", () => ({
  listarDoctores: vi.fn(),
}));
vi.mock("../api/turnos.ts", () => ({
  crearTurno: vi.fn(),
  modificarTurno: vi.fn(),
  obtenerTurno: vi.fn(),
  obtenerSlotsDisponibles: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AgendarTurnoPage } from "./AgendarTurnoPage.tsx";
import { listarServicios } from "../api/servicios.ts";
import { listarClientes } from "../api/clientes.ts";
import { listarMascotas } from "../api/mascotas.ts";
import { listarDoctores } from "../api/doctores.ts";
import { crearTurno, modificarTurno, obtenerSlotsDisponibles, obtenerTurno } from "../api/turnos.ts";

const mockListarServicios = vi.mocked(listarServicios);
const mockListarClientes = vi.mocked(listarClientes);
const mockListarMascotas = vi.mocked(listarMascotas);
const mockListarDoctores = vi.mocked(listarDoctores);
const mockCrearTurno = vi.mocked(crearTurno);
const mockModificarTurno = vi.mocked(modificarTurno);
const mockObtenerTurno = vi.mocked(obtenerTurno);
const mockSlots = vi.mocked(obtenerSlotsDisponibles);

const FECHA_FUTURA = "2099-01-01";

function makeServicio(over: Partial<Servicio> = {}): Servicio {
  return {
    id: "s1",
    nombre: "Peluquería",
    tipo: "peluqueria",
    duracionMinutos: 30,
    requiereProfesional: false,
    descripcion: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

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
    tamano: "Mediano",
    alimentoDieta: null,
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

function makeDoctor(over: Partial<Doctor> = {}): Doctor {
  return {
    id: "d1",
    userId: "u1",
    name: "Dra. Ana Gómez",
    specialty: "Clínica general",
    licenseNumber: "MP-1234",
    available: true,
    createdAt: "2026-06-09T12:00:00Z",
    usuario: { username: "agomez", fullName: "Ana Gómez", active: true },
    ...over,
  };
}

function makeTurno(over: Partial<Turno> = {}): Turno {
  return {
    id: "t1",
    date: FECHA_FUTURA,
    startTime: "10:00",
    endTime: "10:30",
    status: "Confirmado",
    reason: "Control",
    notes: null,
    cancellationReason: null,
    cancelledAt: null,
    servicio: { id: "s1", nombre: "Peluquería", tipo: "peluqueria", duracionMinutos: 30 },
    doctor: null,
    mascota: { id: "m1", name: "Firulais" },
    cliente: { id: "c1", fullName: "Juan Pérez" },
    accionesDisponibles: [],
    vencido: false,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/turnos/nuevo"]}>
      <Routes>
        <Route path="/turnos/nuevo" element={<AgendarTurnoPage />} />
        <Route path="/turnos" element={<div>Agenda de turnos</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEditPage(turnoId = "t1") {
  return render(
    <MemoryRouter initialEntries={[`/turnos/${turnoId}/editar`]}>
      <Routes>
        <Route path="/turnos/:id/editar" element={<AgendarTurnoPage />} />
        <Route path="/turnos" element={<div>Agenda de turnos</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function elegirServicio(servicio: Servicio) {
  await userEvent.click(screen.getByRole("combobox", { name: "Servicio" }));
  await userEvent.click(await screen.findByText(servicio.nombre));
}

async function elegirCliente(cliente: Cliente) {
  await userEvent.click(screen.getByRole("combobox", { name: "Tutor" }));
  await userEvent.click(await screen.findByText(cliente.fullName));
}

async function elegirDoctor(doctor: Doctor) {
  // DoctorCombobox no tiene aria-label propio; con role="combobox" el nombre
  // accesible no sale del contenido de texto (a diferencia de un button nativo),
  // así que se ubica por el texto visible en lugar de por nombre accesible.
  await userEvent.click(screen.getByText("Buscar doctor..."));
  await userEvent.click(await screen.findByText(doctor.name));
}

async function elegirMascota(mascota: Mascota) {
  await userEvent.click(await screen.findByRole("combobox", { name: "Mascota" }));
  await userEvent.click(await screen.findByRole("option", { name: mascota.name }));
}

/** Completa servicio, cliente, mascota, fecha y hora para el camino sin profesional. */
async function completarCamposBasicos(
  servicio: Servicio,
  cliente: Cliente,
  mascota: Mascota,
  hora: string,
) {
  await elegirServicio(servicio);
  await elegirCliente(cliente);
  await elegirMascota(mascota);
  fireEvent.change(screen.getByLabelText("Fecha *"), { target: { value: FECHA_FUTURA } });
  await userEvent.type(screen.getByLabelText("Hora inicio"), hora);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListarServicios.mockResolvedValue({ items: [makeServicio()], meta: { page: 1, limit: 1, total: 1 } });
  mockListarClientes.mockResolvedValue({ items: [], meta: { page: 1, limit: 15, total: 0 } });
  mockListarDoctores.mockResolvedValue({ items: [], meta: { page: 1, limit: 15, total: 0 } });
});

describe("AgendarTurnoPage", () => {
  it("muestra estado vacío si no hay servicios activos configurados", async () => {
    mockListarServicios.mockResolvedValue({ items: [], meta: { page: 1, limit: 1, total: 0 } });

    renderPage();

    expect(await screen.findByText(/no hay servicios activos configurados/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Configurar servicios/i })).toHaveAttribute("href", "/servicios");
  });

  it("agenda un turno para un servicio que no requiere profesional", async () => {
    const servicio = makeServicio({ requiereProfesional: false });
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearTurno.mockResolvedValue(makeTurno());

    renderPage();
    await screen.findByRole("combobox", { name: "Servicio" });

    await completarCamposBasicos(servicio, cliente, mascota, "10:00");
    await userEvent.type(screen.getByLabelText("Motivo *"), "Baño y corte");

    await userEvent.click(screen.getByRole("button", { name: "Agendar y Confirmar" }));

    await waitFor(() =>
      expect(mockCrearTurno).toHaveBeenCalledWith({
        servicioId: "s1",
        clientId: "c1",
        petId: "m1",
        doctorId: undefined,
        date: FECHA_FUTURA,
        startTime: "10:00",
        reason: "Baño y corte",
        notes: undefined,
      }),
    );

    expect(await screen.findByText("Agenda de turnos")).toBeInTheDocument();
  });

  it("con un servicio que requiere profesional, arma la grilla de horarios y completa Hora fin con el slot elegido", async () => {
    const servicio = makeServicio({ id: "s2", nombre: "Consulta general", requiereProfesional: true });
    const cliente = makeCliente();
    const mascota = makeMascota();
    const doctor = makeDoctor();
    mockListarServicios.mockResolvedValue({ items: [servicio], meta: { page: 1, limit: 1, total: 1 } });
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockSlots.mockResolvedValue([
      { startTime: "09:00", endTime: "09:30" },
      { startTime: "09:30", endTime: "10:00" },
    ]);
    mockCrearTurno.mockResolvedValue(makeTurno({ doctor: { id: "d1", name: doctor.name } }));

    renderPage();
    await screen.findByRole("combobox", { name: "Servicio" });

    await elegirServicio(servicio);
    expect(await screen.findByText(/Requerido por este servicio/i)).toBeInTheDocument();

    await elegirCliente(cliente);
    await elegirMascota(mascota);
    await elegirDoctor(doctor);
    fireEvent.change(screen.getByLabelText("Fecha *"), { target: { value: FECHA_FUTURA } });

    await waitFor(() =>
      expect(mockSlots).toHaveBeenCalledWith({ doctorId: "d1", date: FECHA_FUTURA, servicioId: "s2" }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "09:00" }));
    expect(screen.getByDisplayValue("09:30")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Motivo *"), "Control anual");
    await userEvent.click(screen.getByRole("button", { name: "Agendar y Confirmar" }));

    await waitFor(() =>
      expect(mockCrearTurno).toHaveBeenCalledWith({
        servicioId: "s2",
        clientId: "c1",
        petId: "m1",
        doctorId: "d1",
        date: FECHA_FUTURA,
        startTime: "09:00",
        reason: "Control anual",
        notes: undefined,
      }),
    );
  });

  it("mapea SERVICE_NOT_FOUND al campo Servicio", async () => {
    const servicio = makeServicio();
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearTurno.mockRejectedValue(
      new ApiError("SERVICE_NOT_FOUND", 422, "El servicio no existe o no está activo en este tenant"),
    );

    renderPage();
    await screen.findByRole("combobox", { name: "Servicio" });
    await completarCamposBasicos(servicio, cliente, mascota, "10:00");
    await userEvent.type(screen.getByLabelText("Motivo *"), "Control");

    await userEvent.click(screen.getByRole("button", { name: "Agendar y Confirmar" }));

    expect(
      await screen.findByText("El servicio no existe o no está activo en este tenant"),
    ).toBeInTheDocument();
  });

  it("mapea PAST_DATE al campo Fecha", async () => {
    const servicio = makeServicio();
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearTurno.mockRejectedValue(
      new ApiError("PAST_DATE", 422, "No se puede agendar en una fecha pasada"),
    );

    renderPage();
    await screen.findByRole("combobox", { name: "Servicio" });
    await completarCamposBasicos(servicio, cliente, mascota, "10:00");
    await userEvent.type(screen.getByLabelText("Motivo *"), "Control");

    await userEvent.click(screen.getByRole("button", { name: "Agendar y Confirmar" }));

    expect(await screen.findByText("No se puede agendar en una fecha pasada")).toBeInTheDocument();
  });

  it("mapea TURNO_SOLAPADO al campo Hora inicio", async () => {
    const servicio = makeServicio();
    const cliente = makeCliente();
    const mascota = makeMascota();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockCrearTurno.mockRejectedValue(
      new ApiError("TURNO_SOLAPADO", 409, "El profesional ya tiene un turno que se solapa con este horario"),
    );

    renderPage();
    await screen.findByRole("combobox", { name: "Servicio" });
    await completarCamposBasicos(servicio, cliente, mascota, "10:00");
    await userEvent.type(screen.getByLabelText("Motivo *"), "Control");

    await userEvent.click(screen.getByRole("button", { name: "Agendar y Confirmar" }));

    expect(
      await screen.findByText("El profesional ya tiene un turno que se solapa con este horario"),
    ).toBeInTheDocument();
  });

  it("mapea VALIDATION_ERROR de doctorId (RN-TU10) al campo Profesional", async () => {
    const servicio = makeServicio({ id: "s2", nombre: "Consulta general", requiereProfesional: true });
    const cliente = makeCliente();
    const mascota = makeMascota();
    const doctor = makeDoctor();
    mockListarServicios.mockResolvedValue({ items: [servicio], meta: { page: 1, limit: 1, total: 1 } });
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockSlots.mockResolvedValue([{ startTime: "09:00", endTime: "09:30" }]);
    mockCrearTurno.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", 422, "Datos del turno inválidos", [
        { field: "doctorId", message: "doctorId es obligatorio para este servicio" },
      ]),
    );

    renderPage();
    await screen.findByRole("combobox", { name: "Servicio" });
    await elegirServicio(servicio);
    await elegirCliente(cliente);
    await elegirMascota(mascota);
    await elegirDoctor(doctor);
    fireEvent.change(screen.getByLabelText("Fecha *"), { target: { value: FECHA_FUTURA } });
    await userEvent.click(await screen.findByRole("button", { name: "09:00" }));
    await userEvent.type(screen.getByLabelText("Motivo *"), "Control anual");

    await userEvent.click(screen.getByRole("button", { name: "Agendar y Confirmar" }));

    expect(
      await screen.findByText("doctorId es obligatorio para este servicio"),
    ).toBeInTheDocument();
  });

  describe("modo edición", () => {
    it("prefila el formulario desde el turno y guarda con PUT (modificarTurno)", async () => {
      const cliente = makeCliente();
      const mascota = makeMascota();
      mockObtenerTurno.mockResolvedValue(makeTurno({ reason: "Control", notes: "Traer estudios" }));
      mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
      mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
      mockModificarTurno.mockResolvedValue(makeTurno({ reason: "Control post-op" }));

      renderEditPage();

      // Header propio del modo edición y campo prellenado.
      expect(await screen.findByRole("heading", { name: /Modificar Turno/i })).toBeInTheDocument();
      expect(await screen.findByDisplayValue("Control")).toBeInTheDocument();
      expect(mockObtenerTurno).toHaveBeenCalledWith("t1");

      const motivo = screen.getByLabelText("Motivo *");
      await userEvent.clear(motivo);
      await userEvent.type(motivo, "Control post-op");
      await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() =>
        expect(mockModificarTurno).toHaveBeenCalledWith("t1", {
          servicioId: "s1",
          clientId: "c1",
          petId: "m1",
          doctorId: null,
          date: FECHA_FUTURA,
          startTime: "10:00",
          reason: "Control post-op",
          notes: "Traer estudios",
        }),
      );
      expect(mockCrearTurno).not.toHaveBeenCalled();
      expect(await screen.findByText("Agenda de turnos")).toBeInTheDocument();
    });

    it("muestra APPOINTMENT_LOCKED como toast al modificar un turno bloqueado", async () => {
      const cliente = makeCliente();
      const mascota = makeMascota();
      mockObtenerTurno.mockResolvedValue(makeTurno());
      mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
      mockListarMascotas.mockResolvedValue({ items: [mascota], meta: { page: 1, limit: 100, total: 1 } });
      mockModificarTurno.mockRejectedValue(
        new ApiError("APPOINTMENT_LOCKED", 422, "El turno ya no puede modificarse"),
      );

      renderEditPage();
      await screen.findByDisplayValue("Control");
      await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

      const { toast } = await import("sonner");
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("El turno ya no puede modificarse"),
      );
    });

    it("muestra un error si no se puede cargar el turno a editar", async () => {
      mockObtenerTurno.mockRejectedValue(new ApiError("TURNO_NOT_FOUND", 404, "Turno no encontrado"));

      renderEditPage();

      expect(await screen.findByText("Turno no encontrado")).toBeInTheDocument();
    });
  });
});
