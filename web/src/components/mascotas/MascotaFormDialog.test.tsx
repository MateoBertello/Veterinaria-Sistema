import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mascota } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError   = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("../../api/catalogos.ts", () => ({
  listarEspecies: vi.fn().mockResolvedValue([]),
  listarRazas:    vi.fn().mockResolvedValue([]),
}));

vi.mock("../../api/clientes.ts", () => ({
  listarClientes: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 15, total: 0 } }),
}));

import { MascotaFormDialog } from "./MascotaFormDialog.tsx";

beforeEach(() => vi.clearAllMocks());

function makeMascota(over: Partial<Mascota> = {}): Mascota {
  return {
    id:             "m1",
    name:           "Pelusa",
    clientId:       "c1",
    ownerName:      "María García",
    especieId:      "e1",
    especieName:    "Perro",
    razaId:         null,
    razaName:       null,
    sex:            "Hembra",
    tamano:         "Pequeño",
    alimentoDieta:  null,
    birthDate:      "2020-03-15",
    color:          "Blanco",
    observations:   null,
    estado:         "Activa",
    deceasedDate:   null,
    deceasedReason: null,
    ultimoPeso:     null,
    createdAt:      "2026-01-01T00:00:00Z",
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof MascotaFormDialog>> = {}) {
  const crear  = vi.fn();
  const editar = vi.fn();
  const onSaved       = vi.fn();
  const onOpenChange  = vi.fn();
  render(
    <MascotaFormDialog
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

describe("MascotaFormDialog — creación", () => {
  it("muestra el título 'Nueva mascota'", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Nueva mascota/i })).toBeInTheDocument();
  });

  it("muestra error inline si se envía el nombre vacío", async () => {
    const { crear } = setup();

    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText("El nombre es requerido")).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("muestra error si no se selecciona dueño (clientId)", async () => {
    setup();

    await userEvent.type(screen.getByLabelText(/Nombre \*/i), "Pelusa");
    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText("El dueño es requerido")).toBeInTheDocument();
  });

  it("birthDate habilitado en modo creación", () => {
    setup();
    const input = screen.getByLabelText(/Fecha de nacimiento/i) as HTMLInputElement;
    expect(input).not.toBeDisabled();
  });

  it("birthDate no acepta fechas futuras (atributo max = hoy)", () => {
    setup();
    const input = screen.getByLabelText(/Fecha de nacimiento/i) as HTMLInputElement;
    const hoy   = new Date().toISOString().slice(0, 10);
    expect(input.max).toBe(hoy);
  });
});

describe("MascotaFormDialog — edición", () => {
  it("muestra el título 'Editar mascota'", () => {
    setup({ mascota: makeMascota() });
    expect(screen.getByRole("heading", { name: /Editar mascota/i })).toBeInTheDocument();
  });

  it("RN-MA4: birthDate deshabilitado en edición", () => {
    setup({ mascota: makeMascota() });
    const input = screen.getByLabelText(/Fecha de nacimiento/i) as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it("muestra el nombre del dueño actual como campo deshabilitado", () => {
    setup({ mascota: makeMascota() });
    const dueno = screen.getByDisplayValue("María García") as HTMLInputElement;
    expect(dueno).toBeDisabled();
  });

  it("pre-llena el nombre de la mascota", () => {
    setup({ mascota: makeMascota() });
    expect(screen.getByDisplayValue("Pelusa")).toBeInTheDocument();
  });

  it("llama a editar (no a crear) al guardar", async () => {
    const mascota = makeMascota();
    const { crear, editar, onSaved } = setup({ mascota });
    editar.mockResolvedValue(mascota);

    // Cambiar nombre
    const nombreInput = screen.getByDisplayValue("Pelusa");
    await userEvent.clear(nombreInput);
    await userEvent.type(nombreInput, "Pelusa Editada");

    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(editar).toHaveBeenCalledTimes(1));
    expect(editar).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ name: "Pelusa Editada" }),
    );
    expect(crear).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(mascota);
    expect(toastSuccess).toHaveBeenCalled();
  });
});
