import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, ErrorCode, type Rol, type Usuario } from "../../types/index.ts";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UsuarioFormSheet } from "./UsuarioFormSheet.tsx";

const roles: Rol[] = [
  { id: "r-admin", name: "admin", displayName: "Administrador", description: null },
  { id: "r-vet", name: "veterinario", displayName: "Veterinario", description: null },
];

function makeUsuario(over: Partial<Usuario> = {}): Usuario {
  return {
    id: "u1",
    username: "ana",
    email: "ana@x.com",
    fullName: "Ana Pérez",
    phone: null,
    active: true,
    rolId: "r-admin",
    rolName: "Administrador",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof UsuarioFormSheet>> = {}) {
  const crear = vi.fn();
  const editar = vi.fn();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <UsuarioFormSheet
      open
      onOpenChange={onOpenChange}
      roles={roles}
      crear={crear}
      editar={editar}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { crear, editar, onSaved, onOpenChange };
}

beforeEach(() => vi.clearAllMocks());

describe("UsuarioFormSheet — alta", () => {
  it("valida los requeridos y no envía si faltan campos", async () => {
    const { crear } = setup();

    await userEvent.click(screen.getByRole("button", { name: /Crear usuario/i }));

    expect(await screen.findByText("El nombre completo es requerido")).toBeInTheDocument();
    expect(screen.getByText("El usuario es requerido")).toBeInTheDocument();
    expect(screen.getByText("El email es requerido")).toBeInTheDocument();
    expect(screen.getByText("La contraseña es requerida")).toBeInTheDocument();
    expect(screen.getByText("El rol es requerido")).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("rechaza un usuario de menos de 3 caracteres (espejo de CrearUsuarioSchema)", async () => {
    setup();

    await userEvent.type(screen.getByLabelText(/Usuario/), "ab");
    await userEvent.click(screen.getByRole("button", { name: /Crear usuario/i }));

    expect(await screen.findByText("El usuario debe tener al menos 3 caracteres")).toBeInTheDocument();
  });

  it("rechaza una contraseña de menos de 8 caracteres", async () => {
    setup();

    await userEvent.type(screen.getByLabelText(/Contraseña/), "corta");
    await userEvent.click(screen.getByRole("button", { name: /Crear usuario/i }));

    expect(await screen.findByText("La contraseña debe tener al menos 8 caracteres")).toBeInTheDocument();
  });

  it("rechaza un teléfono con letras (espejo de la validación del backend)", async () => {
    const { crear } = setup();

    await userEvent.type(screen.getByLabelText(/Nombre completo/), "Nuevo Usuario");
    await userEvent.type(screen.getByLabelText(/Usuario/), "nuevo");
    await userEvent.type(screen.getByLabelText(/Email/), "n@x.com");
    await userEvent.type(screen.getByLabelText(/Contraseña/), "12345678");
    await userEvent.type(screen.getByLabelText(/Teléfono/), "no-es-tel");
    await userEvent.click(screen.getByRole("combobox", { name: /Rol/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Administrador" }));

    await userEvent.click(screen.getByRole("button", { name: /Crear usuario/i }));

    expect(
      await screen.findByText("El teléfono solo admite números y los símbolos + - ( ) y espacios"),
    ).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("acepta un teléfono con formato válido y lo envía en el payload", async () => {
    const { crear } = setup();
    crear.mockResolvedValue(makeUsuario({ id: "u9", username: "nuevo" }));

    await userEvent.type(screen.getByLabelText(/Nombre completo/), "Nuevo Usuario");
    await userEvent.type(screen.getByLabelText(/Usuario/), "nuevo");
    await userEvent.type(screen.getByLabelText(/Email/), "n@x.com");
    await userEvent.type(screen.getByLabelText(/Contraseña/), "12345678");
    await userEvent.type(screen.getByLabelText(/Teléfono/), "+54 11 5555-0001");
    await userEvent.click(screen.getByRole("combobox", { name: /Rol/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Administrador" }));

    await userEvent.click(screen.getByRole("button", { name: /Crear usuario/i }));

    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "+54 11 5555-0001" }),
      ),
    );
  });

  it("envía crearUsuario con el payload esperado y cierra al guardar", async () => {
    const { crear, onSaved, onOpenChange } = setup();
    crear.mockResolvedValue(makeUsuario({ id: "u9", username: "nuevo" }));

    await userEvent.type(screen.getByLabelText(/Nombre completo/), "Nuevo Usuario");
    await userEvent.type(screen.getByLabelText(/Usuario/), "nuevo");
    await userEvent.type(screen.getByLabelText(/Email/), "n@x.com");
    await userEvent.type(screen.getByLabelText(/Contraseña/), "12345678");

    await userEvent.click(screen.getByRole("combobox", { name: /Rol/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Veterinario" }));

    await userEvent.click(screen.getByRole("button", { name: /Crear usuario/i }));

    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith({
        username: "nuevo",
        password: "12345678",
        fullName: "Nuevo Usuario",
        email: "n@x.com",
        phone: undefined,
        roleId: "r-vet",
        active: true,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("un DUPLICATE_USER de email marca el campo email", async () => {
    const { crear } = setup();
    crear.mockRejectedValue(new ApiError(ErrorCode.DUPLICATE_USER, 409, "El email ya está registrado"));

    await userEvent.type(screen.getByLabelText(/Nombre completo/), "Nuevo Usuario");
    await userEvent.type(screen.getByLabelText(/Usuario/), "nuevo");
    await userEvent.type(screen.getByLabelText(/Email/), "dup@x.com");
    await userEvent.type(screen.getByLabelText(/Contraseña/), "12345678");
    await userEvent.click(screen.getByRole("combobox", { name: /Rol/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Administrador" }));

    await userEvent.click(screen.getByRole("button", { name: /Crear usuario/i }));

    expect(await screen.findByText("El email ya está registrado")).toBeInTheDocument();
  });
});

describe("UsuarioFormSheet — edición", () => {
  it("no muestra el campo contraseña y envía editarUsuario sin password", async () => {
    const usuario = makeUsuario();
    const { editar, onSaved } = setup({ usuario });
    editar.mockResolvedValue(usuario);

    expect(screen.getByRole("heading", { name: /Editar usuario/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Contraseña/)).not.toBeInTheDocument();

    const nombre = screen.getByLabelText(/Nombre completo/);
    await userEvent.clear(nombre);
    await userEvent.type(nombre, "Ana García");

    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() =>
      expect(editar).toHaveBeenCalledWith("u1", {
        username: "ana",
        fullName: "Ana García",
        email: "ana@x.com",
        phone: undefined,
        roleId: "r-admin",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
