-- =====================================================================
-- MIGRACIÓN 011: Storage de adjuntos clínicos (Etapa 5)
-- =====================================================================
-- Bucket privado `adjuntos-clinicos` donde el módulo Historial Clínico
-- guarda radiografías, análisis y fotos (RN-EC4). El acceso de lectura del
-- cliente es siempre por SIGNED URL generada server-side; el bucket nunca es
-- público.
--
-- AISLAMIENTO POR TENANT (regla 1): el path de cada objeto empieza por el
-- tenant_id (`{tenant_id}/{record_id}/{uuid}.{ext}`, ver historial.service.ts).
-- Las políticas sobre storage.objects exigen que el primer segmento del path
-- coincida con current_tenant_id(), de modo que un tenant no pueda leer/escribir
-- adjuntos de otro ni siquiera por acceso directo a la Storage API.
--
-- El API server-side sube y firma con service_role (bypasea RLS de Storage); la
-- verificación de pertenencia al tenant la hace además el Service antes de subir
-- o firmar. Estas policies son defensa en profundidad para accesos no-service.
--
-- Idempotente: el insert del bucket usa ON CONFLICT; las policies se recrean con
-- DROP POLICY IF EXISTS previo.
-- =====================================================================

-- Bucket privado (public = false → sin URLs públicas, solo signed URLs).
INSERT INTO storage.buckets (id, name, public)
VALUES ('adjuntos-clinicos', 'adjuntos-clinicos', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas de aislamiento por tenant sobre storage.objects.
-- (storage.foldername(name))[1] = primer segmento del path = tenant_id.

DROP POLICY IF EXISTS p_adjuntos_clinicos_select ON storage.objects;
CREATE POLICY p_adjuntos_clinicos_select ON storage.objects FOR SELECT
  USING (
    bucket_id = 'adjuntos-clinicos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  );

DROP POLICY IF EXISTS p_adjuntos_clinicos_insert ON storage.objects;
CREATE POLICY p_adjuntos_clinicos_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'adjuntos-clinicos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  );

DROP POLICY IF EXISTS p_adjuntos_clinicos_update ON storage.objects;
CREATE POLICY p_adjuntos_clinicos_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'adjuntos-clinicos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  )
  WITH CHECK (
    bucket_id = 'adjuntos-clinicos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  );

DROP POLICY IF EXISTS p_adjuntos_clinicos_delete ON storage.objects;
CREATE POLICY p_adjuntos_clinicos_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'adjuntos-clinicos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  );
