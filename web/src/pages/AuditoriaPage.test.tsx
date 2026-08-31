import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { ApiError, type RegistroAuditoria, type Usuario } from "../types/index.ts";

vi.mock("../api/auditoria.ts", () => ({
  listarAuditoria:     vi.fn(),
  exportarAuditoriaCsv: vi.fn(),
}));

vi.mock("../api/usuarios.ts", () => ({
  listarUsuarios: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { AuditoriaPage } from "./AuditoriaPage.tsx";
import { exportarAuditoriaCsv, listarAuditoria } from "../api/auditoria.ts";
import { listarUsuarios } from "../api/usuarios.ts";
import { toast } from "sonner";

const mockListar   = vi.mocked(listarAuditoria);
const mockExportar = vi.mocked(exportarAuditoriaCsv);
const mockUsuarios = vi.mocked(listarUsuarios);

function makeRegistro(over: Partial<RegistroAuditoria> = {}): RegistroAuditoria {
  return {
    id: "a1",
    timestamp: "2026-07-20T10:00:00Z",
    module: "clients",
    action: "CREATE",
    userId: "u1",
    userName: "Ana Pérez",
    userRole: "admin",
    entityId: "c1",
    oldValues: null,
    newValues: { fullName: "Ana Pérez" },
    details: null,
    ipAddress: "127.0.0.1",
    ...over,
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <AuditoriaPage />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUsuarios.mockResolvedValue({
    items: [{ id: "u1", username: "ana", email: "a@x.com", fullName: "Ana Pérez", phone: null, active: true, rolId: "r1", rolName: "Administrador", createdAt: "2026-01-01" } satisfies Usuario],
    meta: { page: 1, limit: 100, total: 1 },
  });

  // JSDOM no implementa createObjectURL/revokeObjectURL para Blob.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

describe("AuditoriaPage", () => {
  it("muestra el listado de auditoría (usuario, módulo, acción) tras cargar", async () => {
    mockListar.mockResolvedValue({
      items: [makeRegistro()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("Creación")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay registros", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay registros de auditoría/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeRegistro()], meta: { page: 1, limit: 20, total: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
  });

  it("pagina: 'Siguiente' solicita la página 2", async () => {
    mockListar.mockResolvedValue({
      items: [makeRegistro()],
      meta: { page: 1, limit: 20, total: 40 },
    });

    renderPage();
    await screen.findByText("Ana Pérez");

    // La página arranca un debounce de búsqueda al montarse que, al vencer,
    // hace `setPage(1)` incondicional. Si el click cae dentro de esa ventana, la
    // paginación se deshace sola y el caso falla por timing en vez de por lo que
    // mide. Bajo carga (suite completa) pasaba de verdad. Se lo deja vencer.
    await new Promise((resolve) => setTimeout(resolve, 350));

    await userEvent.click(screen.getByRole("button", { name: /Siguiente/i }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it("busca con debounce por nombre de usuario y resetea a la página 1", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay registros/i);

    await userEvent.type(screen.getByLabelText(/Buscar por usuario/i), "Ana");

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Ana", page: 1 })),
    );
  });

  it("filtra por módulo seleccionado", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay registros/i);

    await userEvent.click(screen.getByLabelText("Módulo"));
    await userEvent.click(await screen.findByText("Mascotas"));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ module: "pets", page: 1 })),
    );
  });

  it("exporta CSV sin truncar: descarga el blob y avisa con toast de éxito", async () => {
    mockListar.mockResolvedValue({ items: [makeRegistro()], meta: { page: 1, limit: 20, total: 1 } });
    mockExportar.mockResolvedValue({
      blob: new Blob(["csv"]),
      filename: "auditoria_2026-07-24.csv",
      truncated: false,
      totalMatching: null,
      rowsExported: null,
    });

    renderPage();
    await screen.findByText("Ana Pérez");

    await userEvent.click(screen.getByRole("button", { name: /Exportar CSV/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Exportación de auditoría descargada"));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("exporta CSV truncado: avisa con toast de warning y NUNCA falla silenciosamente", async () => {
    mockListar.mockResolvedValue({ items: [makeRegistro()], meta: { page: 1, limit: 20, total: 1 } });
    mockExportar.mockResolvedValue({
      blob: new Blob(["csv"]),
      filename: "auditoria_2026-07-24.csv",
      truncated: true,
      totalMatching: 15000,
      rowsExported: 10000,
    });

    renderPage();
    await screen.findByText("Ana Pérez");

    await userEvent.click(screen.getByRole("button", { name: /Exportar CSV/i }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("10000")),
    );
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("15000"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un error al exportar muestra toast de error", async () => {
    mockListar.mockResolvedValue({ items: [makeRegistro()], meta: { page: 1, limit: 20, total: 1 } });
    mockExportar.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500, "No se pudo generar el CSV"));

    renderPage();
    await screen.findByText("Ana Pérez");

    await userEvent.click(screen.getByRole("button", { name: /Exportar CSV/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo generar el CSV"));
  });

  it("abre el detalle de un asiento al click en 'Ver detalle'", async () => {
    mockListar.mockResolvedValue({
      items: [makeRegistro({ oldValues: null, newValues: { fullName: "Ana Pérez" } })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();
    await screen.findByText("Ana Pérez");

    await userEvent.click(screen.getByRole("button", { name: /Ver detalle del asiento de Ana Pérez/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("fullName")).toBeInTheDocument();
  });
});
