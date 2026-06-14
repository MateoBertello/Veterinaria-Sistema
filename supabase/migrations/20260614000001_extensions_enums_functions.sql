-- =====================================================================
-- MIGRACIÓN 001: Extensiones, Enums y Funciones Auxiliares
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =====================================================================
-- FUNCIONES AUXILIARES DE AUTENTICACIÓN
-- =====================================================================

-- Obtiene el tenant_id del JWT de Supabase Auth (app_metadata)
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF((auth.jwt() -> 'app_metadata') ->> 'tenant_id', '')::uuid
$$;

-- Verifica si el usuario autenticado es Super Admin de plataforma
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata') ->> 'platform_role', '') = 'super_admin'
         AND auth.uid() IS NOT NULL
$$;

-- =====================================================================
-- FUNCIÓN AUXILIAR PARA CONSTRAINT EXCLUDE DE TURNOS
-- Nota: PostgreSQL no tiene un tipo "timerange" built-in.
-- Convertimos TIME a int4range (segundos desde medianoche) para poder
-- usar la exclusión con btree_gist. Equivalente semántico al DDL del Apéndice.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.timerange(t1 time, t2 time)
RETURNS int4range LANGUAGE sql IMMUTABLE AS $$
  SELECT int4range(
    EXTRACT(EPOCH FROM t1)::int,
    EXTRACT(EPOCH FROM t2)::int
  )
$$;

-- =====================================================================
-- ENUMERACIONES
-- =====================================================================

CREATE TYPE plan_tenant AS ENUM ('basico', 'profesional', 'premium');
CREATE TYPE modulo_vendible AS ENUM ('historial_clinico', 'turnos', 'guarderia');
CREATE TYPE sexo_mascota AS ENUM ('Macho', 'Hembra', 'Desconocido');
CREATE TYPE tamano_mascota AS ENUM ('Pequeño', 'Mediano', 'Grande');
CREATE TYPE estado_mascota AS ENUM ('Activa', 'Fallecida');
CREATE TYPE tipo_servicio AS ENUM ('clinica', 'peluqueria', 'guarderia', 'cirugia', 'otro');
CREATE TYPE tipo_evento_clinico AS ENUM (
  'Consulta', 'Vacunación', 'Cirugía', 'Análisis', 'Radiografía',
  'Ecografía', 'Desparasitación', 'Control', 'Emergencia',
  'Internación', 'Eutanasia', 'Otro'
);
CREATE TYPE estado_turno AS ENUM ('Programado', 'Confirmado', 'Completado', 'Cancelado');
CREATE TYPE estado_estadia AS ENUM ('Reservada', 'EnCurso', 'Finalizada', 'Cancelada');
CREATE TYPE estado_vacunacion AS ENUM ('Pendiente', 'Aplicada', 'Cancelada');
CREATE TYPE origen_notificacion AS ENUM ('turno', 'vacunacion');
CREATE TYPE estado_notificacion AS ENUM ('pendiente', 'enviada', 'fallida');
CREATE TYPE accion_auditoria AS ENUM (
  'CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'LOGIN', 'LOGOUT', 'VIEW', 'EXPORT'
);
CREATE TYPE modulo_auditoria AS ENUM (
  'clients', 'pets', 'medical_records', 'appointments', 'daycare',
  'users', 'security', 'services', 'system', 'platform'
);
