import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Doctor, type EventoCreado } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("../../api/historial-clinico.ts", () => ({
  crearEvento:  vi.fn(),
  subirAdjunto: vi.fn(),
}));

vi.mock("../../api/doctores.ts", () => ({
  listarDoctores: vi.fn(),
}));

import { EventoClinicoFormDialog } from "./EventoClinicoFormDialog.tsx";
import { crearEvento, subirAdjunto } from "../../api/historial-clinico.ts";
import { listarDoctores } from "../../api/doctores.ts";

const mockCrear = vi.mocked(crearEvento);
const mockSubir = vi.mocked(subirAdjunto);
const mockDoctores = vi.mocked(listarDoctores);

function makeDoctor(over: Partial<Doctor> = {}): Doctor {
  return {
    id: "d1", userId: "u1", name: "Dra. García", specialty: null,
    licenseNumber: null, available: true, createdAt: "2026-01-01T00:00:00Z", usuario: null,
    ...over,
  };
}

function makeEventoCreado(over: Partial<EventoCreado> = {}): EventoCreado {
  return {
    id: "e1", petId: "pet1", date: "2026-06-01", eventType: "Consulta",
    clientNameAtTime: "Juan Pérez", attachmentsCount: 0, emailSent: false,
    planVacunacionId: null,
    ...over,
  };
}

function setup() {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <EventoClinicoFormDialog open petId="pet1" onOpenChange={onOpenChange} onSaved={onSaved} />,
  );
  return { onSaved, onOpenChange };
}

async function completarCamposMinimos() {
  fireEvent.change(screen.getByLabelText(/Fecha \*/i), { target: { value: "2026-06-01" } });

  await userEvent.click(screen.getByLabelText(/Tipo de evento \*/i));
  await userEvent.click(await screen.findByRole("option", { name: "Consulta" }));

  await userEvent.click(screen.getByLabelText(/Profesional \*/i));
  await userEvent.click(await screen.findByRole("option", { name: "Dra. García" }));

  await userEvent.type(screen.getByLabelText(/Descripción \*/i), "Control anual, buen estado");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDoctores.mockResolvedValue({ items: [makeDoctor()], meta: { page: 1, limit: 100, total: 1 } });
});

describe("EventoClinicoFormDialog", () => {
  it("DT-3: pide al backend solo doctores seleccionables como profesional (professional=true)", async () => {
    setup();

    await waitFor(() => expect(mockDoctores).toHaveBeenCalledTimes(1));
    expect(mockDoctores).toHaveBeenCalledWith(
      expect.objectContaining({ available: true, professional: true }),
    );
  });

  it("RN-EC1: campos obligatorios vacíos bloquean el envío", async () => {
    setup();

    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText("La descripción es requerida")).toBeInTheDocument();
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("RN-EC1: envía el evento con los campos mínimos y cierra el diálogo", async () => {
    const { onSaved, onOpenChange } = setup();
    mockCrear.mockResolvedValue(makeEventoCreado());

    await completarCamposMinimos();
    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    await waitFor(() => expect(mockCrear).toHaveBeenCalledTimes(1));
    expect(mockCrear).toHaveBeenCalledWith(
      "pet1",
      expect.objectContaining({
        date: "2026-06-01",
        eventType: "Consulta",
        professionalId: "u1",
        description: "Control anual, buen estado",
        weightKg: undefined,
        temperatureC: undefined,
      }),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("RN-EC6: peso fuera de rango (0-200 kg) bloquea el envío", async () => {
    setup();
    await completarCamposMinimos();
    await userEvent.type(screen.getByLabelText(/Peso \(kg\)/i), "300");

    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText("Debe estar entre 0 y 200 kg")).toBeInTheDocument();
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("RN-EC6: temperatura fuera de rango (30-45 °C) bloquea el envío", async () => {
    setup();
    await completarCamposMinimos();
    await userEvent.type(screen.getByLabelText(/Temperatura \(°C\)/i), "10");

    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText("Debe estar entre 30 y 45 °C")).toBeInTheDocument();
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("rechaza en el cliente un adjunto de tipo no permitido", async () => {
    setup();
    const archivo = new File(["hola"], "notas.txt", { type: "text/plain" });

    // userEvent.upload respeta el atributo `accept` del input y rechazaría el
    // archivo antes de disparar onChange; fireEvent.change lo evita para poder
    // ejercitar la validación propia del componente (defensa ante bypass del
    // filtro nativo, ej. seleccionando "Todos los archivos" en el picker).
    fireEvent.change(screen.getByLabelText(/Adjuntos/i), { target: { files: [archivo] } });

    expect(await screen.findByText(/tipo de archivo no permitido/i)).toBeInTheDocument();
    expect(screen.queryByText("notas.txt")).not.toBeInTheDocument();
  });

  it("rechaza en el cliente un adjunto que supera 10 MB", async () => {
    setup();
    const contenidoGrande = new Uint8Array(10 * 1024 * 1024 + 1);
    const archivo = new File([contenidoGrande], "rx.pdf", { type: "application/pdf" });

    await userEvent.upload(screen.getByLabelText(/Adjuntos/i), archivo);

    expect(await screen.findByText(/supera el tamaño máximo de 10 MB/i)).toBeInTheDocument();
  });

  it("mapea INVALID_FILE_TYPE/FILE_TOO_LARGE del backend al subir el adjunto tras crear el evento", async () => {
    setup();
    mockCrear.mockResolvedValue(makeEventoCreado());
    mockSubir.mockRejectedValue(new ApiError("INVALID_FILE_TYPE", 422, "Tipo de archivo no permitido"));

    const archivo = new File(["%PDF-1.4"], "rx.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Adjuntos/i), archivo);

    await completarCamposMinimos();
    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    await waitFor(() => expect(mockSubir).toHaveBeenCalledWith("e1", archivo));
    expect(await screen.findByText("Tipo de archivo no permitido")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Reintentar/i })).toBeInTheDocument();
  });
});
