-- =====================================================================
-- MIGRACIÓN 017: Guardería — Agregar columna cancelled_at a estadias
-- Correctiva de la 016 (20260629000003): el RPC cancelar_estadia persiste
-- la marca de tiempo de cancelación en cancelled_at, pero la tabla estadias
-- no tenía esa columna (sólo existía en turnos). Se agrega aquí.
-- =====================================================================

ALTER TABLE estadias ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
