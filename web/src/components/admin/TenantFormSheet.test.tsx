import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Tenant } from "../../types/index.ts";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TenantFormSheet } from "./TenantFormSheet.tsx";

const crear = vi.fn();
const editar = vi.fn();
const onSaved = vi.fn();

function makeTenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: "t-1",
    nombre: "Veterinaria San Roque",
    cuitRut: "30-71234567-8",
    emailContacto: "contacto@sanroque.vet",
    plan: "profesional",
    activo: true,
    adminInvitado: true,
    createdAt: "2026-06-09T12:00:00Z",
    ...over,
  };
}

function renderForm(tenant: Tenant | null = null) {
  return render(
    <TenantFormSheet
      open
      onOpenChange={vi.fn()}
      tenant={tenant}
      crear={crear}
      editar={editar}
      onSaved={onSaved}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TenantFormSheet — alta", () => {
  it("envía el body del CrearTenantSchema (nombre, cuitRut, emailContacto, plan)", async () => {
    crear.mockResolvedValue(makeTenant({ id: "t-9" }));

    renderForm();

    await userEvent.type(screen.getByLabelText(/Nombre de la clínica/), "Veterinaria Nueva");
    await userEvent.type(screen.getByLabelText(/CUIT \/ RUT/), "30-99999999-9");
    await userEvent.type(screen.getByLabelText(/Email de contacto/), "hola@nueva.vet");
    await userEvent.click(screen.getByRole("button", { name: /Crear tenant/i }));

    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith({
        nombre: "Veterinaria Nueva",
        cuitRut: "30-99999999-9",
        emailContacto: "hola@nueva.vet",
        plan: "basico",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("valida en cliente lo mismo que el backend (nombre ≥ 3, email con formato)", async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/Nombre de la clínica/), "AB");
    await userEvent.type(screen.getByLabelText(/CUIT \/ RUT/), "30-99999999-9");
    await userEvent.type(screen.getByLabelText(/Email de contacto/), "no-es-un-email");
    await userEvent.click(screen.getByRole("button", { name: /Crear tenant/i }));

    expect(await screen.findByText(/al menos 3 caracteres/i)).toBeInTheDocument();
    expect(screen.getByText(/Formato de email inválido/i)).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("los campos requeridos no se pueden omitir", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: /Crear tenant/i }));

    expect(await screen.findByText("El nombre es requerido")).toBeInTheDocument();
    expect(screen.getByText("El CUIT/RUT es requerido")).toBeInTheDocument();
    expect(screen.getByText("El email de contacto es requerido")).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("RN-SA1: CUIT/RUT duplicado se muestra inline en el campo", async () => {
    crear.mockRejectedValue(
      new ApiError("TENANT_DUPLICATE_TAXID", 409, "Ya existe una clínica con ese CUIT/RUT"),
    );

    renderForm();

    await userEvent.type(screen.getByLabelText(/Nombre de la clínica/), "Veterinaria Dup");
    await userEvent.type(screen.getByLabelText(/CUIT \/ RUT/), "30-71234567-8");
    await userEvent.type(screen.getByLabelText(/Email de contacto/), "dup@x.vet");
    await userEvent.click(screen.getByRole("button", { name: /Crear tenant/i }));

    expect(await screen.findByText("Ya existe una clínica con ese CUIT/RUT")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("informa que el alta aprovisiona roles, configuración y módulos", () => {
    renderForm();

    expect(screen.getByText(/roles base, la configuración inicial y los módulos del plan/i))
      .toBeInTheDocument();
  });
});

describe("TenantFormSheet — edición", () => {
  it("precarga los datos y envía solo lo editable (sin cuitRut)", async () => {
    editar.mockResolvedValue(makeTenant({ nombre: "Veterinaria San Roque II" }));

    renderForm(makeTenant());

    const nombre = screen.getByLabelText(/Nombre de la clínica/);
    expect(nombre).toHaveValue("Veterinaria San Roque");

    await userEvent.clear(nombre);
    await userEvent.type(nombre, "Veterinaria San Roque II");
    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() =>
      expect(editar).toHaveBeenCalledWith("t-1", {
        nombre: "Veterinaria San Roque II",
        emailContacto: "contacto@sanroque.vet",
        plan: "profesional",
      }),
    );
  });

  it("el CUIT/RUT queda de solo lectura (RN-SA1)", () => {
    renderForm(makeTenant());

    expect(screen.getByLabelText(/CUIT \/ RUT/)).toBeDisabled();
    expect(screen.getByText(/no se puede modificar/i)).toBeInTheDocument();
  });
});
