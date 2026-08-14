import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlujoEstadosHelp } from "./FlujoEstadosHelp.tsx";

describe("FlujoEstadosHelp", () => {
  it("el trigger tiene nombre accesible y abre la ayuda del flujo", async () => {
    render(<FlujoEstadosHelp />);

    const trigger = screen.getByRole("button", { name: /Ayuda: flujo de estados/ });
    await userEvent.click(trigger);

    expect(await screen.findByText("Flujo de estados")).toBeInTheDocument();
    expect(screen.getByText(/La atención se realizó/)).toBeInTheDocument();
  });
});
