import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../types/index.ts";

// La página consume el contexto de auth; lo mockeamos para controlar login/status.
const mockAuth = {
  status: "anonymous" as "anonymous" | "authenticated" | "loading",
  user: null,
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

import { LoginPage } from "./LoginPage.tsx";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.status = "anonymous";
});

describe("LoginPage", () => {
  it("muestra errores inline al enviar vacío y no llama a login", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    expect(await screen.findByText("El usuario es requerido")).toBeInTheDocument();
    expect(screen.getByText("La contraseña es requerida")).toBeInTheDocument();
    expect(mockAuth.login).not.toHaveBeenCalled();
  });

  it("envía username (trim) y password a login", async () => {
    mockAuth.login.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(screen.getByLabelText("Usuario o email"), "  admin_demo  ");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Demo1234!");
    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    await waitFor(() =>
      expect(mockAuth.login).toHaveBeenCalledWith({
        username: "admin_demo",
        password: "Demo1234!",
      }),
    );
  });

  it("muestra un mensaje genérico ante 401 (no revela usuario vs contraseña)", async () => {
    mockAuth.login.mockRejectedValue(
      new ApiError("UNAUTHORIZED", 401, "Credenciales inválidas"),
    );
    renderPage();

    await userEvent.type(screen.getByLabelText("Usuario o email"), "inactivo_test");
    await userEvent.type(screen.getByLabelText("Contraseña"), "loquesea");
    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    const alerta = await screen.findByText("Usuario o contraseña incorrectos.");
    expect(alerta).toBeInTheDocument();
    // El mensaje no debe distinguir el caso de usuario inactivo.
    expect(screen.queryByText(/inactiv/i)).not.toBeInTheDocument();
  });

  it("muestra el mensaje de rate limit ante 429", async () => {
    mockAuth.login.mockRejectedValue(
      new ApiError("UNAUTHORIZED", 429, "Demasiados intentos"),
    );
    renderPage();

    await userEvent.type(screen.getByLabelText("Usuario o email"), "admin_demo");
    await userEvent.type(screen.getByLabelText("Contraseña"), "x");
    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    expect(
      await screen.findByText(/Demasiados intentos\. Esperá unos minutos/i),
    ).toBeInTheDocument();
  });

  it("deshabilita el botón mientras se envía", async () => {
    let resolver: (() => void) | undefined;
    mockAuth.login.mockReturnValue(new Promise<void>((res) => (resolver = () => res())));
    renderPage();

    await userEvent.type(screen.getByLabelText("Usuario o email"), "admin_demo");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Demo1234!");
    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    const boton = screen.getByRole("button", { name: /Ingresando/i });
    expect(boton).toBeDisabled();

    resolver?.();
  });

  it("muestra el mensaje accionable ante identificador ambiguo (409)", async () => {
    // Reintentar no lo resuelve: hay que decirle al usuario que use su email.
    mockAuth.login.mockRejectedValue(
      new ApiError(
        "AMBIGUOUS_IDENTIFIER",
        409,
        "Ese nombre de usuario existe en más de una clínica. Ingresá con tu email.",
      ),
    );
    renderPage();

    await userEvent.type(screen.getByLabelText("Usuario o email"), "admin");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Demo1234!");
    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    expect(await screen.findByText(/existe en más de una clínica/i)).toBeInTheDocument();
  });

  it("muestra un mensaje accionable ante INVALID_RESPONSE (200 con HTML, no envelope)", async () => {
    // Un hosting mal configurado (sin VITE_API_URL) le devuelve el propio
    // index.html al login: client.ts lo traduce a INVALID_RESPONSE con un
    // mensaje diagnóstico. La pantalla no debe pisarlo con "error inesperado".
    mockAuth.login.mockRejectedValue(
      new ApiError("INVALID_RESPONSE", 200, "Respuesta inesperada del servidor (HTTP 200)."),
    );
    renderPage();

    await userEvent.type(screen.getByLabelText("Usuario o email"), "admin_demo");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Demo1234!");
    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    expect(await screen.findByText(/Respuesta inesperada del servidor/i)).toBeInTheDocument();
    expect(screen.queryByText("Ocurrió un error inesperado. Intentá de nuevo.")).not.toBeInTheDocument();
  });

  it("muestra un mensaje accionable si el storage del navegador lanza (defensa de segunda línea)", async () => {
    // session.ts ya blinda sus propios accesos a localStorage; este es el
    // resguardo por si algún otro código de la app deja pasar una excepción
    // de storage sin capturar.
    mockAuth.login.mockRejectedValue(new DOMException("Storage blocked", "SecurityError"));
    renderPage();

    await userEvent.type(screen.getByLabelText("Usuario o email"), "admin_demo");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Demo1234!");
    await userEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    expect(await screen.findByText(/bloqueó el almacenamiento local/i)).toBeInTheDocument();
    expect(screen.queryByText("Ocurrió un error inesperado. Intentá de nuevo.")).not.toBeInTheDocument();
  });

  it("el campo de usuario no autocapitaliza ni autocorrige", async () => {
    // En mobile la autocapitalización convierte `juanpa` en `Juanpa`; el backend
    // ya normaliza, pero el campo no debe pelear con lo que el usuario tipea.
    renderPage();

    const usuario = screen.getByLabelText("Usuario o email");
    expect(usuario).toHaveAttribute("autocapitalize", "none");
    expect(usuario).toHaveAttribute("autocorrect", "off");
    expect(usuario).toHaveAttribute("spellcheck", "false");
  });

  it("redirige si ya está autenticado", () => {
    mockAuth.status = "authenticated";
    renderPage();

    // Sin formulario: se reemplaza por <Navigate>.
    expect(screen.queryByRole("button", { name: /Iniciar sesión/i })).not.toBeInTheDocument();
  });
});
