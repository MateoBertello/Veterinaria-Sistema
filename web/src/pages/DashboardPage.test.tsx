/**
 * DashboardPage — panel de inicio (ruta "/").
 *
 * Cubre los tres estados obligatorios (cargando / error / vacío), el gate de las
 * tarjetas por permiso y módulo (que el backend expresa con `null`), los accesos
 * rápidos por rol y que cada tarjeta navegue a una pantalla real del repo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiError, type AuthUser, type ModuloContratado, type ResumenDashboard } from "../types/index.ts";

vi.mock("../api/dashboard.ts", () => ({ obtenerResumenDashboard: vi.fn() }));
vi.mock("../api/modulos.ts", () => ({ fetchModulosHabilitados: vi.fn() }));
vi.mock("../api/turnos.ts", () => ({ listarTurnos: vi.fn() }));
vi.mock("../api/estadias.ts", () => ({ obtenerCupo: vi.fn() }));

// La identidad de plataforma sale del JWT; acá se controla explícitamente.
vi.mock("../lib/platform.ts", () => ({ isSuperAdmin: vi.fn(() => false) }));

let usuario: AuthUser | null = null;
vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => ({ status: "authenticated", user: usuario, login: vi.fn(), logout: vi.fn() }),
}));

import { DashboardPage } from "./DashboardPage.tsx";
import { obtenerResumenDashboard } from "../api/dashboard.ts";
import { fetchModulosHabilitados } from "../api/modulos.ts";
import { listarTurnos } from "../api/turnos.ts";
import { obtenerCupo } from "../api/estadias.ts";
import { isSuperAdmin } from "../lib/platform.ts";

const mockResumen  = vi.mocked(obtenerResumenDashboard);
const mockModulos  = vi.mocked(fetchModulosHabilitados);
const mockTurnos   = vi.mocked(listarTurnos);
const mockCupo     = vi.mocked(obtenerCupo);
const mockSuperAdm = vi.mocked(isSuperAdmin);

const MODULOS: ModuloContratado[] = [
  { modulo: "historial_clinico", habilitado: true, fechaAlta: "2026-01-01" },
  { modulo: "turnos",            habilitado: true, fechaAlta: "2026-01-01" },
  { modulo: "guarderia",         habilitado: true, fechaAlta: "2026-01-01" },
];

function resumen(over: Partial<ResumenDashboard> = {}): ResumenDashboard {
  return {
    fecha:              "2026-07-25",
    clientes:           12,
    mascotasActivas:    30,
    turnosHoy:          4,
    estadiasHoy:        2,
    vacunasProximas30d: 7,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usuario = {
    id: "u1",
    username: "ana",
    fullName: "Ana Pérez",
    roleName: "admin",
    permissions: ["manage_clients", "manage_pets", "manage_appointments", "manage_daycare", "view_medical_history", "manage_users", "view_audit"],
  };
  mockSuperAdm.mockReturnValue(false);
  mockModulos.mockResolvedValue(MODULOS);
  mockResumen.mockResolvedValue(resumen());
  mockTurnos.mockResolvedValue([]);
  mockCupo.mockResolvedValue([]);
});

describe("DashboardPage — estados", () => {
  it("muestra el esqueleto de carga mientras resuelve el resumen", async () => {
    mockResumen.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getAllByLabelText("Cargando métricas").length).toBeGreaterThan(0);
    // Deja asentar la carga de módulos (paralela) para no dejar un setState suelto.
    await waitFor(() => expect(mockModulos).toHaveBeenCalled());
  });

  it("muestra el error con opción de reintentar y vuelve a pedir el resumen", async () => {
    mockResumen.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló el panel"));

    renderPage();

    expect(await screen.findByText("Falló el panel")).toBeInTheDocument();

    mockResumen.mockResolvedValueOnce(resumen());
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(mockResumen).toHaveBeenCalledTimes(2);
  });

  it("con todas las métricas en null muestra el vacío explicativo, no tarjetas en cero", async () => {
    mockResumen.mockResolvedValue(
      resumen({ clientes: null, mascotasActivas: null, turnosHoy: null, estadiasHoy: null, vacunasProximas30d: null }),
    );

    renderPage();

    expect(await screen.findByText(/Tu rol no tiene métricas asignadas/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Clientes:/ })).not.toBeInTheDocument();
  });
});

describe("DashboardPage — tarjetas de métrica", () => {
  it("dibuja una tarjeta por métrica visible, con su valor y su destino real", async () => {
    renderPage();

    const clientes = await screen.findByRole("link", { name: /^Clientes: 12/ });
    expect(clientes).toHaveAttribute("href", "/clientes");
    expect(screen.getByRole("link", { name: /^Mascotas activas: 30/ })).toHaveAttribute("href", "/mascotas");
    expect(screen.getByRole("link", { name: /^Turnos de hoy: 4/ })).toHaveAttribute("href", "/turnos");
    expect(screen.getByRole("link", { name: /^Guardería hoy: 2/ })).toHaveAttribute("href", "/guarderia");
    expect(screen.getByRole("link", { name: /^Vacunas próximas: 7/ })).toHaveAttribute("href", "/historial");
  });

  it("oculta las métricas que el backend devolvió en null (sin permiso o módulo no licenciado)", async () => {
    mockResumen.mockResolvedValue(resumen({ turnosHoy: null, estadiasHoy: null }));

    renderPage();

    await screen.findByRole("link", { name: /^Clientes: 12/ });
    expect(screen.queryByRole("link", { name: /^Turnos de hoy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Guardería hoy/ })).not.toBeInTheDocument();
  });

  it("muestra la métrica en 0 (es un dato, no ausencia)", async () => {
    mockResumen.mockResolvedValue(resumen({ turnosHoy: 0 }));

    renderPage();

    expect(await screen.findByRole("link", { name: /^Turnos de hoy: 0/ })).toBeInTheDocument();
  });
});

describe("DashboardPage — paneles de detalle", () => {
  it("pide los turnos del día solo si la métrica de turnos es visible", async () => {
    renderPage();

    await waitFor(() => expect(mockTurnos).toHaveBeenCalledWith({ date: "2026-07-25" }));
    expect(await screen.findByText(/No hay turnos agendados para hoy/i)).toBeInTheDocument();
  });

  it("NO pide turnos ni ocupación cuando esas métricas vienen en null", async () => {
    mockResumen.mockResolvedValue(resumen({ turnosHoy: null, estadiasHoy: null }));

    renderPage();

    await screen.findByRole("link", { name: /^Clientes: 12/ });
    expect(mockTurnos).not.toHaveBeenCalled();
    expect(mockCupo).not.toHaveBeenCalled();
  });

  it("pide la ocupación de guardería de 7 días en UNA sola consulta", async () => {
    renderPage();

    await waitFor(() =>
      expect(mockCupo).toHaveBeenCalledWith({ dateFrom: "2026-07-25", dateTo: "2026-07-31" }),
    );
    expect(mockCupo).toHaveBeenCalledTimes(1);
  });
});

describe("DashboardPage — accesos rápidos", () => {
  it("muestra los accesos del rol, con sus destinos reales", async () => {
    renderPage();

    const nav = await screen.findByRole("navigation", { name: "Accesos rápidos" });
    expect(within(nav).getByRole("link", { name: "Agendar turno" })).toHaveAttribute("href", "/turnos/nuevo");
    expect(within(nav).getByRole("link", { name: "Nueva estadía" })).toHaveAttribute("href", "/guarderia/nuevo");
    expect(within(nav).getByRole("link", { name: "Auditoría" })).toHaveAttribute("href", "/auditoria");
  });

  it("un rol acotado solo ve los accesos de sus permisos", async () => {
    usuario = { ...usuario!, roleName: "veterinario", permissions: ["manage_pets", "view_medical_history"] };

    renderPage();

    const nav = await screen.findByRole("navigation", { name: "Accesos rápidos" });
    expect(within(nav).getByRole("link", { name: "Mascotas" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Historial clínico" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Auditoría" })).not.toBeInTheDocument();
  });

  it("oculta el acceso de un módulo no habilitado aunque el rol tenga el permiso", async () => {
    mockModulos.mockResolvedValue(
      MODULOS.map((m) => (m.modulo === "guarderia" ? { ...m, habilitado: false } : m)),
    );

    renderPage();

    const nav = await screen.findByRole("navigation", { name: "Accesos rápidos" });
    await waitFor(() =>
      expect(within(nav).queryByRole("link", { name: "Nueva estadía" })).not.toBeInTheDocument(),
    );
    expect(within(nav).getByRole("link", { name: "Agendar turno" })).toBeInTheDocument();
  });

  it("con sesión de super admin agrega el acceso a la consola de plataforma", async () => {
    mockSuperAdm.mockReturnValue(true);

    renderPage();

    const nav = await screen.findByRole("navigation", { name: "Accesos rápidos" });
    expect(within(nav).getByRole("link", { name: "Consola de plataforma" })).toHaveAttribute("href", "/admin");
  });

  it("si falla la carga de módulos, el panel sigue vivo con los accesos core", async () => {
    mockModulos.mockRejectedValue(new ApiError("NETWORK_ERROR", 0, "sin red"));

    renderPage();

    const nav = await screen.findByRole("navigation", { name: "Accesos rápidos" });
    expect(within(nav).getByRole("link", { name: "Clientes" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Agendar turno" })).not.toBeInTheDocument();
  });
});

describe("DashboardPage — bienvenida", () => {
  it("saluda por el nombre de pila, muestra el rol y la fecha del resumen", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Bienvenido, Ana" })).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText(/25 de julio de 2026/i)).toBeInTheDocument();
  });
});
