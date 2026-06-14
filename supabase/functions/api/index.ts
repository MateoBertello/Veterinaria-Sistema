// Edge Function entrypoint (Supabase/Deno runtime)
import app from "./src/main.ts";

Deno.serve(app.fetch);
