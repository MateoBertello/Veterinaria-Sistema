import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Excluir tests de integración del run unitario por defecto
    exclude: ["tests/integration/**"],
  },
  resolve: {
    // Permite imports con extensión .ts explícita (estilo Deno/ESM)
    extensions: [".ts", ".js"],
  },
});
