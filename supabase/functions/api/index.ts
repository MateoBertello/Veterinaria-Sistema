// Edge Function entrypoint (Supabase/Deno runtime)
// SONDA TEMPORAL DE LATENCIA — quitar cuando termine la medición.
// Va PRIMERO a propósito: en ESM los imports se evalúan en orden, así que T0
// queda tomado antes de que se evalúe el grafo de main.ts.
import "./src/shared/boot.ts";
import app from "./src/main.ts";

Deno.serve(app.fetch);
