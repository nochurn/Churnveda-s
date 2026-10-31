-- ==============================================================================
-- NoChurn SaaS Enterprise Security Hardening Migration
-- Migration: 20261014000001_security_hardening_rls_and_audit.sql
-- 
-- 1. Creates immutable audit_logs table for administrative and security events.
-- 2. Enables Row-Level Security (RLS) on all 15 private and multi-tenant tables.
-- 3. Creates strict tenant-isolated policies for SELECT, INSERT, UPDATE, DELETE.
-- 4. Prevents cross-tenant and cross-user data leakage.
-- ==============================================================================

-- 1. Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 2. Enable Row-Level Security on all private tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE razorpay_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is member of a workspace
CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = check_workspace_id
      AND user_id = auth.uid()::text
  ) OR EXISTS (
    SELECT 1 FROM workspaces
    WHERE id = check_workspace_id
      AND owner_id = auth.uid()::text
  );
$$;

-- Helper function to check if current user is admin/owner of a workspace
CREATE OR REPLACE FUNCTION public.is_workspace_admin(check_workspace_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = check_workspace_id
      AND user_id = auth.uid()::text
      AND role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM workspaces
    WHERE id = check_workspace_id
      AND owner_id = auth.uid()::text
  );
$$;

-- ------------------------------------------------------------------------------
-- RLS POLICIES
-- ------------------------------------------------------------------------------

-- Workspaces: Members can view their own workspace; owners can update
DO $$ BEGIN
  DROP POLICY IF EXISTS "workspaces_select_member" ON workspaces;
  CREATE POLICY "workspaces_select_member" ON workspaces
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(id));

  DROP POLICY IF EXISTS "workspaces_update_admin" ON workspaces;
  CREATE POLICY "workspaces_update_admin" ON workspaces
    FOR UPDATE TO authenticated
    USING (public.is_workspace_admin(id))
    WITH CHECK (public.is_workspace_admin(id));
END $$;

-- Workspace Members: Members can view team; admins can manage
DO $$ BEGIN
  DROP POLICY IF EXISTS "workspace_members_select" ON workspace_members;
  CREATE POLICY "workspace_members_select" ON workspace_members
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));

  DROP POLICY IF EXISTS "workspace_members_modify" ON workspace_members;
  CREATE POLICY "workspace_members_modify" ON workspace_members
    FOR ALL TO authenticated
    USING (public.is_workspace_admin(workspace_id))
    WITH CHECK (public.is_workspace_admin(workspace_id));
END $$;

-- Users: Users can view and update their own profile; admins can view workspace users
DO $$ BEGIN
  DROP POLICY IF EXISTS "users_select_self" ON users;
  CREATE POLICY "users_select_self" ON users
    FOR SELECT TO authenticated
    USING (id = auth.uid()::text OR public.is_workspace_member(workspace_id));

  DROP POLICY IF EXISTS "users_update_self" ON users;
  CREATE POLICY "users_update_self" ON users
    FOR UPDATE TO authenticated
    USING (id = auth.uid()::text)
    WITH CHECK (id = auth.uid()::text);
END $$;

-- Customers: Strictly isolated to authenticated members of the workspace
DO $$ BEGIN
  DROP POLICY IF EXISTS "customers_select_member" ON customers;
  CREATE POLICY "customers_select_member" ON customers
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));

  DROP POLICY IF EXISTS "customers_insert_member" ON customers;
  CREATE POLICY "customers_insert_member" ON customers
    FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_member(workspace_id));

  DROP POLICY IF EXISTS "customers_update_member" ON customers;
  CREATE POLICY "customers_update_member" ON customers
    FOR UPDATE TO authenticated
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

  DROP POLICY IF EXISTS "customers_delete_admin" ON customers;
  CREATE POLICY "customers_delete_admin" ON customers
    FOR DELETE TO authenticated
    USING (public.is_workspace_admin(workspace_id));
END $$;

-- CSV Imports: Scoped to workspace members
DO $$ BEGIN
  DROP POLICY IF EXISTS "csv_imports_workspace" ON csv_imports;
  CREATE POLICY "csv_imports_workspace" ON csv_imports
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));
END $$;

-- Retention Actions: Scoped to workspace members
DO $$ BEGIN
  DROP POLICY IF EXISTS "retention_actions_workspace" ON retention_actions;
  CREATE POLICY "retention_actions_workspace" ON retention_actions
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));
END $$;

-- Subscriptions & Trial Verifications: Scoped to workspace members
DO $$ BEGIN
  DROP POLICY IF EXISTS "subscriptions_select_member" ON subscriptions;
  CREATE POLICY "subscriptions_select_member" ON subscriptions
    FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));

  DROP POLICY IF EXISTS "trial_verifications_workspace" ON trial_verifications;
  CREATE POLICY "trial_verifications_workspace" ON trial_verifications
    FOR ALL TO authenticated
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));
END $$;

-- Billing Plans: Publicly readable by all; writable only by service role
DO $$ BEGIN
  DROP POLICY IF EXISTS "billing_plans_read_all" ON billing_plans;
  CREATE POLICY "billing_plans_read_all" ON billing_plans
    FOR SELECT TO public
    USING (true);
END $$;

-- Webhook Events & Sessions: Service role only (prevent direct client tampering)
DO $$ BEGIN
  DROP POLICY IF EXISTS "webhook_events_service_only" ON webhook_events;
  CREATE POLICY "webhook_events_service_only" ON webhook_events
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
END $$;

-- Audit Logs: Workspace admins can read; append-only for authenticated actions; updates/deletions blocked
DO $$ BEGIN
  DROP POLICY IF EXISTS "audit_logs_select_admin" ON audit_logs;
  CREATE POLICY "audit_logs_select_admin" ON audit_logs
    FOR SELECT TO authenticated
    USING (public.is_workspace_admin(workspace_id));

  DROP POLICY IF EXISTS "audit_logs_insert_auth" ON audit_logs;
  CREATE POLICY "audit_logs_insert_auth" ON audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_member(workspace_id));
END $$;

-- ------------------------------------------------------------------------------
-- 5. PRIVATE STORAGE BUCKETS & POLICIES (Area 6)
-- ------------------------------------------------------------------------------
-- Create private buckets for customer CSV imports, reports, and exports
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('customer_imports', 'customer_imports', false, 10485760, ARRAY['text/csv', 'application/vnd.ms-excel', 'application/pdf']),
  ('retention_reports', 'retention_reports', false, 10485760, ARRAY['application/pdf', 'application/json']),
  ('workspace_exports', 'workspace_exports', false, 10485760, ARRAY['text/csv', 'application/json'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760;

-- Storage Objects: Restrict access to authenticated workspace members only
-- Folders must be named after the workspace ID to prevent guessing paths across tenants
DO $$ BEGIN
  DROP POLICY IF EXISTS "tenant_storage_read" ON storage.objects;
  CREATE POLICY "tenant_storage_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id IN ('customer_imports', 'retention_reports', 'workspace_exports')
      AND public.is_workspace_member((storage.foldername(name))[1])
    );

  DROP POLICY IF EXISTS "tenant_storage_insert" ON storage.objects;
  CREATE POLICY "tenant_storage_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id IN ('customer_imports', 'retention_reports', 'workspace_exports')
      AND public.is_workspace_member((storage.foldername(name))[1])
    );

  DROP POLICY IF EXISTS "tenant_storage_delete" ON storage.objects;
  CREATE POLICY "tenant_storage_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id IN ('customer_imports', 'retention_reports', 'workspace_exports')
      AND public.is_workspace_admin((storage.foldername(name))[1])
    );
END $$;
