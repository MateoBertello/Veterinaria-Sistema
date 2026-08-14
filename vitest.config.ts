import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

// Cargar las variables de entorno del archivo .env
dotenv.config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // exclude: ["tests/integration/**"],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});