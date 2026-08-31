// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Flat config mínimo para que `npm run lint` corra (ESLint 10 exige este
 * formato; no había ningún eslint.config.js ni .eslintrc en el repo).
 *
 * Deliberadamente austero: solo `recommended` de ESLint y typescript-eslint,
 * sin reglas type-aware (no configura `parserOptions.project`) — el backend
 * (Deno/TS, importa con extensión `.ts`) y el frontend (Vite/React) tienen
 * cada uno su propio tsconfig con paths distintos, y sumar lint type-aware acá
 * es un esfuerzo de configuración aparte, no "el minimo que hace correr el
 * script". El typecheck real ya lo hace `npm run typecheck` contra ambos
 * tsconfig.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "web/src/components/ui/**", // kit heredado (CLAUDE.md): no se reescribe
    ],
  },

  // ─── Backend: supabase/functions/api/src (Deno, vía Edge Functions) ────────
  {
    files: ["supabase/functions/api/src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // El código existente usa `any` en varios puntos de paso por Supabase
      // (respuestas sin tipar de PostgREST/RPC). Bajarlo a warn en vez de
      // reescribir esos tipos ahora, que es un refactor aparte de "hacer
      // correr el lint" — 23 ocurrencias, todas en auditoria/historial/vacunacion.
      "@typescript-eslint/no-explicit-any": "warn",
      // Un solo caso (jwt.ts): un `let x = false` reescrito en las tres ramas
      // de un if/else — inofensivo, no un bug. Se reporta en vez de tocarlo acá.
      "no-useless-assignment": "warn",
    },
  },

  // ─── Frontend: web/src (Vite + React) ───────────────────────────────────────
  {
    files: ["web/src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Solo las dos reglas clásicas del plugin (rules-of-hooks / exhaustive-deps):
      // su "recommended" desde la v7 suma el linter completo de React Compiler
      // (set-state-in-effect, purity, immutability, ...), que el código existente
      // no fue escrito para cumplir — eso es un refactor de estilo, no el mínimo
      // para que el script corra.
      "react-hooks/rules-of-hooks":  "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
