import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Servicio } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError   = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { ServicioFormSheet } from "./ServicioFormSheet.tsx";

beforeEach(() => vi.clearAllMocks());

function makeServicio(over: Partial<Servicio> = {}): Servicio {
  return {
    id: "s1",
    nombre: "Baño y Corte",
    tipo: "peluqueria",
    duracionMinutos: 60,
    requiereProfesional: false,
    descripcion: "Incluye secado",
    activo: true,
    createdAt: "2026-06-09T12:00:00Z",
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof ServicioFormSheet>> = {}) {
  const crear  = vi.fn();
  const editar = vi.fn();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ServicioFormSheet
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      crear={crear}
      editar={editar}
      {...props}
    />,
  );
  return { crear, editar, onSaved, onOpenChange };
}

describe("ServicioFormSheet — creación", () => {
  it("muestra el título 'Nuevo servicio'", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Nuevo servicio/i })).toBeInTheDocument();
  });

  it("muestra error inline si se envía el nombre vacío", async () => {
    const { crear } = setup();

    await userEvent.click(screen.getByRole("button", { name: /Crear servicio/i }));

    expect(await screen.findByText("El nombre es requerido")).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("RN-SV1: rechaza duración no múltiplo de 5", async () => {
    const { crear } = setup();

    await userEvent.type(screen.getByLabelText(/Nombre \*/i), "Consulta general");
    const duracion = screen.getByLabelText(/Duración \(minutos\)/i);
    await userEvent.clear(duracion);
    await userEvent.type(duracion, "22");

    await userEvent.click(screen.getByRole("button", { name: /Crear servicio/i }));

    expect(await screen.findByText("Debe ser múltiplo de 5")).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("crea el servicio con los valores por defecto de tipo/duración", async () => {
    const { crear, onSaved } = setup();
    const creado = makeServicio({ nombre: "Consulta general", tipo: "clinica", duracionMinutos: 30 });
    crear.mockResolvedValue(creado);

    await userEvent.type(screen.getByLabelText(/Nombre \*/i), "Consulta general");
    await userEvent.click(screen.getByRole("button", { name: /Crear servicio/i }));

    await waitFor(() => expect(crear).toHaveBeenCalledTimes(1));
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Consulta general", tipo: "clinica", duracionMinutos: 30 }),
    );
    expect(onSaved).toHaveBeenCalledWith(creado);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("RN-SV2: SERVICE_IN_USE por nombre duplicado se muestra bajo el campo nombre", async () => {
    const { crear, onSaved } = setup();
    crear.mockRejectedValue(
      new ApiError("SERVICE_IN_USE", 409, 'Ya existe un servicio activo con el nombre "Consulta general" en este tenant'),
    );

    await userEvent.type(screen.getByLabelText(/Nombre \*/i), "Consulta general");
    await userEvent.click(screen.getByRole("button", { name: /Crear servicio/i }));

    expect(
      await screen.findByText(/Ya existe un servicio activo con el nombre/i),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("ServicioFormSheet — edición", () => {
  it("muestra el título 'Editar servicio' y pre-llena los campos", () => {
    setup({ servicio: makeServicio() });
    expect(screen.getByRole("heading", { name: /Editar servicio/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Baño y Corte")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Incluye secado")).toBeInTheDocument();
  });

  it("llama a editar (no a crear) al guardar", async () => {
    const servicio = makeServicio();
    const { crear, editar, onSaved } = setup({ servicio });
    editar.mockResolvedValue(servicio);

    const nombreInput = screen.getByDisplayValue("Baño y Corte");
    await userEvent.clear(nombreInput);
    await userEvent.type(nombreInput, "Baño y Corte Premium");

    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(editar).toHaveBeenCalledTimes(1));
    expect(editar).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ nombre: "Baño y Corte Premium" }),
    );
    expect(crear).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(servicio);
  });
});
