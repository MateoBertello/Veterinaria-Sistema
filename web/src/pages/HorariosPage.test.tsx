import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { ApiError, type Doctor, type Franja } from "../types/index.ts";

vi.mock("../api/doctores.ts", () => ({
  listarDoctores: vi.fn(),
}));

vi.mock("../api/horarios.ts", () => ({
  listarHorariosDeDoctor: vi.fn(),
  crearFranja: vi.fn(),
  alternarFranja: vi.fn(),
  eliminarFranja: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// La pantalla distingue quién administra la clínica (RN-HOR7): por defecto, admin.
const mockAuth = {
  status: "authenticated" as const,
  user: {
    id: "u-admin",
    username: "admin_leo",
    fullName: "Admin Leo",
    roleName: "Administrador",
    permissions: ["manage_schedules", "manage_users"],
  },
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
};

vi.mock("../auth/AuthContext.tsx", () => ({ useAuth: () => mockAuth }));

/** Sesión de un veterinario: `manage_schedules` sin `manage_users`. */
function sesionVeterinario(userId = "u1") {
  mockAuth.user = {
    id: userId,
    username: "vet_leo",
    fullName: "Dra. Ana Gómez",
    roleName: "Veterinario",
    permissions: ["manage_schedules", "manage_medical_history"],
  };
}

function sesionAdmin() {
  mockAuth.user = {
    id: "u-admin",
    username: "admin_leo",
    fullName: "Admin Leo",
    roleName: "Administrador",
    permissions: ["manage_schedules", "manage_users"],
  };
}

import { HorariosPage } from "./HorariosPage.tsx";
import { listarDoctores } from "../api/doctores.ts";
import { alternarFranja, eliminarFranja, listarHorariosDeDoctor } from "../api/horarios.ts";

const mockListarDoctores = vi.mocked(listarDoctores);
const mockListarHorarios = vi.mocked(listarHorariosDeDoctor);
const mockAlternar = vi.mocked(alternarFranja);
const mockEliminar = vi.mocked(eliminarFranja);

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

function makeFranja(over: Partial<Franja> = {}): Franja {
  return {
    id: "f1",
    doctorId: "d1",
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "13:00",
    active: true,
    ...over,
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <HorariosPage />
    </TooltipProvider>,
  );
}

async function elegirDoctor(doctor: Doctor) {
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(await screen.findByText(doctor.name));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListarDoctores.mockResolvedValue({ items: [], meta: { page: 1, limit: 15, total: 0 } });
});

describe("HorariosPage", () => {
  it("muestra el estado vacío antes de elegir un doctor", () => {
    renderPage();
    expect(screen.getByText(/Elegí un doctor para ver y gestionar sus horarios/i)).toBeInTheDocument();
  });

  it("al elegir un doctor, carga y muestra sus franjas agrupadas por día", async () => {
    const doctor = makeDoctor();
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockListarHorarios.mockResolvedValue([makeFranja()]);

    renderPage();
    await elegirDoctor(doctor);

    expect(await screen.findByText("Lunes")).toBeInTheDocument();
    expect(screen.getByText("09:00 – 13:00")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
  });

  it("muestra estado vacío por doctor sin franjas", async () => {
    const doctor = makeDoctor();
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockListarHorarios.mockResolvedValue([]);

    renderPage();
    await elegirDoctor(doctor);

    expect(await screen.findByText(/todavía no tiene franjas configuradas/i)).toBeInTheDocument();
  });

  it("muestra error con reintentar si falla la carga de franjas", async () => {
    const doctor = makeDoctor();
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockListarHorarios.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();
    await elegirDoctor(doctor);

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListarHorarios.mockResolvedValue([makeFranja()]);
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("Lunes")).toBeInTheDocument();
  });

  it("togglea una franja activa a inactiva", async () => {
    const doctor = makeDoctor();
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockListarHorarios.mockResolvedValue([makeFranja()]);
    mockAlternar.mockResolvedValue(makeFranja({ active: false }));

    renderPage();
    await elegirDoctor(doctor);
    await screen.findByText("Lunes");

    await userEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(mockAlternar).toHaveBeenCalledWith("f1", false));
    expect(await screen.findByText("Inactiva")).toBeInTheDocument();
  });

  it("RN-HOR2: si el toggle responde SCHEDULE_OVERLAP, muestra el error", async () => {
    const doctor = makeDoctor();
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockListarHorarios.mockResolvedValue([makeFranja({ active: false })]);
    mockAlternar.mockRejectedValue(
      new ApiError("SCHEDULE_OVERLAP", 409, "La franja se solapa con otra franja activa"),
    );

    renderPage();
    await elegirDoctor(doctor);
    await screen.findByText("Lunes");

    await userEvent.click(screen.getByRole("switch"));

    expect(await screen.findByText(/La franja se solapa con otra franja activa/i)).toBeInTheDocument();
  });

  it("abre el diálogo de eliminar y confirma el borrado", async () => {
    const doctor = makeDoctor();
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockListarHorarios.mockResolvedValue([makeFranja()]);
    mockEliminar.mockResolvedValue({ deleted: true });

    renderPage();
    await elegirDoctor(doctor);
    await screen.findByText("Lunes");

    await userEvent.click(screen.getByRole("button", { name: /Eliminar franja 09:00 a 13:00/i }));
    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(mockEliminar).toHaveBeenCalledWith("f1"));
  });

  it("abre el formulario de alta al pulsar 'Agregar franja'", async () => {
    const doctor = makeDoctor();
    mockListarDoctores.mockResolvedValue({ items: [doctor], meta: { page: 1, limit: 15, total: 1 } });
    mockListarHorarios.mockResolvedValue([]);

    renderPage();
    await elegirDoctor(doctor);
    await screen.findByText(/todavía no tiene franjas configuradas/i);

    await userEvent.click(screen.getByRole("button", { name: /Agregar franja/i }));

    expect(await screen.findByRole("heading", { name: /Agregar franja/i })).toBeInTheDocument();
  });
});

// ─── RN-HOR7: el profesional gestiona solo su propio horario ──────────────────

describe("HorariosPage — RN-HOR7 (veterinario)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sesionVeterinario("u1");
  });

  it("no muestra el selector de doctor: precarga su propio perfil", async () => {
    mockListarDoctores.mockResolvedValue({
      items: [makeDoctor({ id: "d1", userId: "u1" }), makeDoctor({ id: "d2", userId: "u2", name: "Dr. Otro" })],
      meta: { page: 1, limit: 100, total: 2 },
    });
    mockListarHorarios.mockResolvedValue([makeFranja()]);

    render(
      <TooltipProvider>
        <HorariosPage />
      </TooltipProvider>,
    );

    // Carga las franjas de SU perfil, sin pedirle que elija.
    await waitFor(() => expect(mockListarHorarios).toHaveBeenCalledWith("d1"));
    expect(screen.queryByText("Doctor")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Agregar franja/i })).toBeInTheDocument();
  });

  it("si su usuario no tiene perfil profesional, lo explica en vez de dejar la pantalla vacía", async () => {
    mockListarDoctores.mockResolvedValue({
      items: [makeDoctor({ id: "d2", userId: "u2", name: "Dr. Otro" })],
      meta: { page: 1, limit: 100, total: 1 },
    });

    render(
      <TooltipProvider>
        <HorariosPage />
      </TooltipProvider>,
    );

    expect(await screen.findByText(/no tiene un perfil profesional asociado/i)).toBeInTheDocument();
    expect(mockListarHorarios).not.toHaveBeenCalled();
  });

  it("el administrador sí elige profesional", async () => {
    sesionAdmin();
    mockListarDoctores.mockResolvedValue({
      items: [makeDoctor()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    render(
      <TooltipProvider>
        <HorariosPage />
      </TooltipProvider>,
    );

    expect(await screen.findByText("Doctor")).toBeInTheDocument();
    expect(mockListarHorarios).not.toHaveBeenCalled();
  });
});
