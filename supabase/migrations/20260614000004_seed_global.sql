-- =====================================================================
-- MIGRACIÓN 004: Seed Global (Nivel 1) — Idempotente
-- Se puede ejecutar múltiples veces sin duplicar datos.
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

-- =====================================================================
-- CATÁLOGO DE ESPECIES
-- =====================================================================
INSERT INTO especies (name, description) VALUES
  ('Perro',   'Canino doméstico'),
  ('Gato',    'Felino doméstico'),
  ('Ave',     'Aves de compañía'),
  ('Conejo',  'Lagomorfo doméstico'),
  ('Roedor',  'Hámster, cobayo, etc.'),
  ('Reptil',  'Tortugas, iguanas, etc.'),
  ('Otro',    'Otras especies')
ON CONFLICT (name) DO NOTHING;

-- =====================================================================
-- CATÁLOGO DE RAZAS
-- =====================================================================
INSERT INTO razas (especie_id, name)
SELECT e.id, r.name
FROM especies e
JOIN (VALUES
  ('Perro',  'Mestizo'),
  ('Perro',  'Labrador Retriever'),
  ('Perro',  'Caniche'),
  ('Perro',  'Bulldog Francés'),
  ('Perro',  'Ovejero Alemán'),
  ('Perro',  'Golden Retriever'),
  ('Gato',   'Mestizo'),
  ('Gato',   'Siamés'),
  ('Gato',   'Persa'),
  ('Gato',   'Maine Coon'),
  ('Ave',    'Canario'),
  ('Ave',    'Loro'),
  ('Conejo', 'Enano Holandés'),
  ('Roedor', 'Hámster Sirio')
) AS r(especie, name) ON r.especie = e.name
ON CONFLICT (especie_id, name) DO NOTHING;

-- =====================================================================
-- CATÁLOGO DE TIPOS DE VACUNA
-- =====================================================================
INSERT INTO tipos_vacuna (nombre, especie_aplicable, meses_refuerzo_sugerido) VALUES
  ('Antirrábica',                        NULL,     12),
  ('Quíntuple Canina',                   'Perro',  12),
  ('Séxtuple Canina',                    'Perro',  12),
  ('Bordetella (Tos de las perreras)',   'Perro',  12),
  ('Giardia',                            'Perro',  12),
  ('Triple Felina',                      'Gato',   12),
  ('Leucemia Felina',                    'Gato',   12),
  ('Mixomatosis',                        'Conejo',  6)
ON CONFLICT (nombre) DO NOTHING;
