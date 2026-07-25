import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RegistroAuditoria } from "../../types/index.ts";
import { AuditoriaDetalleDialog } from "./AuditoriaDetalleDialog.tsx";

function makeRegistro(over: Partial<RegistroAuditoria> = {}): RegistroAuditoria {
  return {
    id: "a1",
    timestamp: "2026-07-20T10:00:00Z",
    module: "clients",
    action: "UPDATE",
    userId: "u1",
    userName: "Ana Pérez",
    userRole: "admin",
    entityId: "c1",
    oldValues: { fullName: "Ana" },
    newValues: { fullName: "Ana Pérez" },
    details: null,
    ipAddress: "127.0.0.1",
    ...over,
  };
}

describe("AuditoriaDetalleDialog", () => {
  it("cerrado (registro null) no renderiza el diálogo", () => {
    render(<AuditoriaDetalleDialog registro={null} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Detalle del asiento")).not.toBeInTheDocument();
  });

  it("muestra el diff legible (campo, antes, después) sin volcar JSON crudo", () => {
    render(<AuditoriaDetalleDialog registro={makeRegistro()} onOpenChange={vi.fn()} />);

    expect(screen.getByText("Detalle del asiento")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez (admin)")).toBeInTheDocument();
    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("fullName")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.queryByText(/{"fullName"/)).not.toBeInTheDocument();
  });

  it("sin cambios muestra el mensaje de 'sin valores previos/nuevos'", () => {
    render(
      <AuditoriaDetalleDialog
        registro={makeRegistro({ oldValues: null, newValues: null, action: "LOGIN" })}
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Sin valores previos/nuevos registrados para este asiento."),
    ).toBeInTheDocument();
  });

  it("con details, lo muestra como texto plano", () => {
    render(
      <AuditoriaDetalleDialog
        registro={makeRegistro({ details: "Exportación de 42 filas" })}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Exportación de 42 filas")).toBeInTheDocument();
  });
});
