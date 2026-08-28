-- =====================================================================
-- MIGRACIÓN 004: Seed Global (Nivel 1) — Idempotente
-- Se puede ejecutar múltiples veces sin duplicar datos.
-- =====================================================================
-- Acá solo queda lo REALMENTE global: `permisos`, que define el sistema y
-- referencia `rol_permiso`.
--
-- El catálogo clínico (especies, razas, tipos de vacuna) vivía acá y se movió a
-- `seed_catalogos_tenant()`, que corre por clínica desde `on_tenant_created`
-- (ver 20260827000001_catalogos_por_tenant.sql): esas tres tablas dejaron de ser
-- globales y hoy llevan `tenant_id NOT NULL`, así que un INSERT sin tenant acá
-- ni siquiera compilaría.
-- =====================================================================

-- =====================================================================
-- PERMISOS DEL SISTEMA
-- =====================================================================
INSERT INTO permisos (name, display_name, module) VALUES
  ('manage_users',            'Gestionar usuarios',        'security'),
  ('manage_clients',          'Gestionar clientes',        'clients'),
  ('manage_pets',             'Gestionar mascotas',        'pets'),
  ('view_medical_history',    'Ver historial clínico',     'medical_records'),
  ('manage_medical_history',  'Gestionar historial clínico', 'medical_records'),
  ('manage_appointments',     'Gestionar turnos',          'appointments'),
  ('manage_daycare',          'Gestionar guardería',       'daycare'),
  ('manage_schedules',        'Gestionar horarios',        'security'),
  ('view_audit',              'Consultar auditoría',       'security'),
  ('manage_services',         'Gestionar servicios',       'services'),
  ('manage_tenant_settings',  'Configurar la clínica',     'system')
ON CONFLICT (name) DO NOTHING;
