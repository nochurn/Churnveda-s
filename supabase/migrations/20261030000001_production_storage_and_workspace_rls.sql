-- ==============================================================================
-- Churnveda Production Storage & Workspace RLS Migration
-- Migration: 20261030000001_production_storage_and_workspace_rls.sql
--
-- 1. Provisions private Supabase Storage buckets for customer imports, exports,
--    generated reports, and user uploads.
-- 2. Restricts bucket access to private (no public reads).
-- 3. Enforces 10MB file size limit and strict MIME type whitelisting.
-- 4. Establishes Row-Level Security (RLS) on storage.objects scoped strictly
--    by workspace ID: `{workspace_id}/*`.
-- ==============================================================================

-- 1. Ensure storage schema and tables exist before configuring buckets
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    
    -- Insert/Update Private Storage Buckets
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES 
      -- Customer telemetry imports (CSV, Excel, PDF)
      ('customer-imports', 'customer-imports', false, 10485760, ARRAY['text/csv', 'application/vnd.ms-excel', 'application/pdf', 'text/plain']),
      ('customer_imports', 'customer_imports', false, 10485760, ARRAY['text/csv', 'application/vnd.ms-excel', 'application/pdf', 'text/plain']),
      
      -- Workspace customer exports (CSV, JSON)
      ('customer-exports', 'customer-exports', false, 10485760, ARRAY['text/csv', 'application/json']),
      ('workspace_exports', 'workspace_exports', false, 10485760, ARRAY['text/csv', 'application/json']),
      
      -- Retention briefs and generated reports (PDF, JSON)
      ('generated-reports', 'generated-reports', false, 10485760, ARRAY['application/pdf', 'application/json', 'text/plain']),
      ('retention_reports', 'retention_reports', false, 10485760, ARRAY['application/pdf', 'application/json', 'text/plain']),
      
      -- User uploads & logos (PNG, JPEG, WebP, CSV)
      ('user-uploads', 'user-uploads', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'text/csv', 'application/pdf'])
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

  END IF;
END $$;

-- 2. Storage Objects RLS Policies (Tenant Workspace Isolation)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN

    -- Enable RLS on storage.objects
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    -- Policy A: Workspace Members can read files within their workspace folder
    DROP POLICY IF EXISTS "churnveda_storage_select" ON storage.objects;
    CREATE POLICY "churnveda_storage_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id IN ('customer-imports', 'customer_imports', 'customer-exports', 'workspace_exports', 'generated-reports', 'retention_reports', 'user-uploads')
        AND (
          public.is_workspace_member((storage.foldername(name))[1])
          OR (storage.foldername(name))[1] = auth.uid()::text
        )
      );

    -- Policy B: Workspace Members can upload files within their workspace folder
    DROP POLICY IF EXISTS "churnveda_storage_insert" ON storage.objects;
    CREATE POLICY "churnveda_storage_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id IN ('customer-imports', 'customer_imports', 'customer-exports', 'workspace_exports', 'generated-reports', 'retention_reports', 'user-uploads')
        AND (
          public.is_workspace_member((storage.foldername(name))[1])
          OR (storage.foldername(name))[1] = auth.uid()::text
        )
      );

    -- Policy C: Workspace Admins can delete files within their workspace folder
    DROP POLICY IF EXISTS "churnveda_storage_delete" ON storage.objects;
    CREATE POLICY "churnveda_storage_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id IN ('customer-imports', 'customer_imports', 'customer-exports', 'workspace_exports', 'generated-reports', 'retention_reports', 'user-uploads')
        AND (
          public.is_workspace_admin((storage.foldername(name))[1])
          OR (storage.foldername(name))[1] = auth.uid()::text
        )
      );

  END IF;
END $$;
