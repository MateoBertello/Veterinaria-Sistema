import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Doctor, type EutanasiaResultado } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("../../api/historial-clinico.ts", () => ({
  registrarEutanasia: vi.fn(),
}));

vi.mock("../../api/doctores.ts", () => ({
  listarDoctores: vi.fn(),
}));

import { EutanasiaDialog } from "./EutanasiaDialog.tsx";
import { registrarEutanasia } from "../../api/historial-clinico.ts";
import { listarDoctores } from "../../api/doctores.ts";

const mockRegistrar = vi.mocked(registrarEutanasia);
const mockDoctores = vi.mocked(listarDoctores);

function makeDoctor(over: Partial<Doctor> = {}): Doctor {
  return {
    id: "d1", userId: "u1", name: "Dra. García", specialty: null,
    licenseNumber: null, available: true, createdAt: "2026-01-01T00:00:00Z", usuario: null,
    ...over,
  };
}

function makeResultado(over: Partial<EutanasiaResultado> = {}): EutanasiaResultado {
  return {
    evento: {
      id: "e1", petId: "pet1", date: "2026-07-01", eventType: "Eutanasia",
      professionalName: "Dra. García", clientNameAtTime: "Juan Pérez",
    },
    mascota: {
      id: "pet1", name: "Firulais", estado: "Fallecida",
      deceasedDate: "2026-07-01", deceasedReason: "Eutanasia",
    },
    cancelledDoses: 0,
    ...over,
  };
}

function setup() {
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <EutanasiaDialog open petId="pet1" mascotaName="Firulais" onOpenChange={onOpenChange} onSuccess={onSuccess} />,
  );
  return { onSuccess, onOpenChange };
}

async function completarCamposClinicos() {
  await userEvent.click(screen.getByLabelText(/Profesional \*/i));
  await userEvent.click(await screen.findByRole("option", { name: "Dra. García" }));
  await userEvent.type(screen.getByLabelText(/Descripción \*/i), "Eutanasia por enfermedad terminal");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDoctores.mockResolvedValue({ items: [makeDoctor()], meta: { page: 1, limit: 100, total: 1 } });
});

describe("EutanasiaDialog", () => {
  it("DT-3: pide al backend solo doctores seleccionables como profesional (professional=true)", async () => {
    setup();

    await waitFor(() => expect(mockDoctores).toHaveBeenCalledTimes(1));
    expect(mockDoctores).toHaveBeenCalledWith(
      expect.objectContaining({ available: true, professional: true }),
    );
  });

  it("RN-EC10: el botón de confirmar está deshabilitado hasta marcar el checkbox de confirmación explícita", async () => {
    setup();
    await completarCamposClinicos();

    const boton = screen.getByRole("button", { name: /Confirmar eutanasia/i });
    expect(boton).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i));
    expect(boton).toBeEnabled();
  });

  it("campos clínicos obligatorios (profesional, descripción) bloquean el envío aunque el checkbox esté marcado", async () => {
    setup();
    await userEvent.click(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar eutanasia/i }));

    expect(await screen.findByText("El profesional es requerido")).toBeInTheDocument();
    expect(mockRegistrar).not.toHaveBeenCalled();
  });

  it("RN-EC10: envía euthanasiaConfirmed:true y cierra el diálogo al confirmar", async () => {
    const { onSuccess, onOpenChange } = setup();
    mockRegistrar.mockResolvedValue(makeResultado());

    await completarCamposClinicos();
    await userEvent.click(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar eutanasia/i }));

    await waitFor(() => expect(mockRegistrar).toHaveBeenCalledTimes(1));
    expect(mockRegistrar).toHaveBeenCalledWith(
      "pet1",
      expect.objectContaining({
        professionalId: "u1",
        description: "Eutanasia por enfermedad terminal",
        euthanasiaConfirmed: true,
      }),
    );
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ cancelledDoses: 0 }));
  });

  it("RN-EC10: EUTHANASIA_CONFIRMATION_REQUIRED del backend se muestra como error (defensa en profundidad)", async () => {
    setup();
    mockRegistrar.mockRejectedValue(
      new ApiError("EUTHANASIA_CONFIRMATION_REQUIRED", 422, "Se requiere confirmación explícita para registrar una eutanasia"),
    );

    await completarCamposClinicos();
    await userEvent.click(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar eutanasia/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "Debés confirmar explícitamente que querés registrar la eutanasia.",
    ));
  });

  it("RN-EC3: PET_DECEASED del backend se muestra como error específico", async () => {
    setup();
    mockRegistrar.mockRejectedValue(new ApiError("PET_DECEASED", 422, "La mascota ya está marcada como Fallecida"));

    await completarCamposClinicos();
    await userEvent.click(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar eutanasia/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Esta mascota ya está marcada como fallecida."));
  });

  it("RN-UX2: dispara un toast de éxito (sonner) al registrar la eutanasia", async () => {
    setup();
    mockRegistrar.mockResolvedValue(makeResultado());

    await completarCamposClinicos();
    await userEvent.click(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar eutanasia/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("Firulais"));
  });
});

describe("EutanasiaDialog — accesibilidad (WCAG AA)", () => {
  it("expone el diálogo con rol y título accesibles", async () => {
    setup();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName(/Registrar eutanasia/i);
  });

  it("todos los campos tienen nombre accesible (label asociado)", async () => {
    setup();
    // Radix hidrata los labels tras montar; esperamos a que aparezcan.
    await waitFor(() => expect(screen.getByLabelText(/Fecha \*/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/Profesional \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Peso \(kg\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Temperatura/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Descripción \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Diagnóstico/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Notas/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i)).toBeInTheDocument();
  });

  it("asocia el mensaje de error al campo vía aria-describedby (3.3.1/1.3.1)", async () => {
    setup();
    await userEvent.click(screen.getByLabelText(/Confirmo que deseo registrar la eutanasia/i));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar eutanasia/i }));

    const error = await screen.findByText("El profesional es requerido");
    expect(error).toHaveAttribute("id", "eutanasia-professionalId-error");
    expect(screen.getByLabelText(/Profesional \*/i)).toHaveAttribute(
      "aria-describedby",
      "eutanasia-professionalId-error",
    );
  });

  it("atrapa el foco dentro del diálogo al abrir (focus trap de Radix)", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Abrir</button>
          <EutanasiaDialog
            open={open}
            petId="pet1"
            mascotaName="Firulais"
            onOpenChange={setOpen}
            onSuccess={vi.fn()}
          />
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Abrir" });
    await userEvent.click(trigger);

    const dialog = await screen.findByRole("alertdialog");
    // Radix mueve el foco al interior del diálogo (no queda en el disparador),
    // condición del focus-trap: el foco de teclado no puede escaparse por detrás.
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    expect(trigger).not.toHaveFocus();
  });

  it("permite cerrar con teclado (Escape) — sin trampa de foco (WCAG 2.1.2)", async () => {
    const onOpenChange = vi.fn();
    render(
      <EutanasiaDialog open petId="pet1" mascotaName="Firulais" onOpenChange={onOpenChange} onSuccess={vi.fn()} />,
    );
    await screen.findByRole("alertdialog");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
