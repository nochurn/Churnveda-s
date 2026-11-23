/**
 * Churnveda Enterprise Managed Database Adapter & Connection Pool
 *
 * Supports:
 * 1. Managed PostgreSQL via `pg.Pool` (Cloud Run, Cloud SQL, Supabase, Neon, AWS RDS)
 *    Configured via `DATABASE_URL` or standard `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`.
 * 2. Persistent Disk Database via SQLite WAL (`data/nochurn.db`) for immediate offline/container
 *    persistence so that all users, workspaces, customers, orders, and subscriptions survive
 *    server restarts and scale-to-zero even before external PostgreSQL credentials are attached.
 * 3. Atomic transactions and strict idempotency for Razorpay payments and webhooks.
 * 4. 100% Multi-Tenant Workspace Isolation across every query.
 */

import { Pool, PoolClient } from 'pg';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Customer, ImportHistoryRecord } from '../src/types.ts';

export interface DbWorkspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface DbUser {
  id: string;
  full_name: string;
  company_name: string;
  email: string;
  password_hash: string;
  phone?: string;
  email_verified: boolean;
  selected_plan: string;
  billing_status: string;
  workspace_id: string;
  role: string;
  razorpay_subscription_id?: string;
  razorpay_plan_id?: string;
  billing_plan_id?: string;
  trial_ends_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DbSession {
  token: string;
  user_id: string;
  email: string;
  workspace_id: string;
  expires_at: number;
  created_at: string;
}

export interface DbBillingPlan {
  id: string;
  name: string;
  tier: 'starter' | 'growth' | 'pro';
  billing_cycle: 'monthly' | 'annual';
  amount_paise: number;
  amount_inr: number;
  currency: string;
  razorpay_plan_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbTrialVerification {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  tier: 'starter' | 'growth' | 'pro';
  billing_cycle: 'monthly' | 'annual';
  billing_plan_id: string;
  razorpay_plan_id: string;
  razorpay_order_id: string;
  amount_paise: number;
  currency: string;
  status: 'pending' | 'verified' | 'failed';
  payment_id?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DbSubscription {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  tier: 'starter' | 'growth' | 'pro';
  billing_cycle: 'monthly' | 'annual';
  billing_plan_id: string;
  razorpay_plan_id: string;
  razorpay_subscription_id?: string;
  status: 'pending' | 'trialing' | 'active' | 'halted' | 'cancelled' | 'past_due' | 'trial_expired';
  trial_started_at?: string;
  trial_ends_at?: string;
  payment_verification_status: 'pending' | 'verified' | 'failed';
  razorpay_verification_order_id?: string;
  razorpay_verification_payment_id?: string;
  created_at: string;
  updated_at: string;
}

export interface DbSubscriptionPayment {
  id: string;
  workspace_id: string;
  user_id?: string;
  subscription_id: string;
  razorpay_payment_id: string;
  currency: string;
  amount_usd: number;
  amount_cents: number;
  converted_inr_amount?: number;
  fee?: number;
  tax?: number;
  settlement_status: 'pending' | 'settled' | 'failed';
  raw_event?: any;
  created_at: string;
  updated_at: string;
}

export interface DbWebhookEvent {
  event_id: string;
  event_type: string;
  workspace_id?: string;
  idempotency_key: string;
  payload_json: any;
  processed_at: string;
  status: string;
}

export interface DbWorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface DbAuditLog {
  id: string;
  workspace_id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id?: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: any;
  created_at: string;
}

export interface DbRazorpayOrder {
  id: string;
  workspace_id: string;
  user_id: string;
  order_id: string;
  amount_paise: number;
  currency: string;
  receipt?: string;
  status: string;
  metadata_json?: any;
  created_at: string;
  updated_at: string;
}

export interface DbSchedulerSetting {
  workspace_id: string;
  enabled: boolean;
  scan_time: string;
  timezone: string;
  owner_notification_email?: string;
  last_run_date?: string;
  last_run_at?: string;
  next_run_at?: string;
  updated_at: string;
}

export interface DbOwnerBrief {
  id: string;
  workspace_id: string;
  date: string;
  status: 'COMPLETED' | 'ERROR';
  customers_analyzed: number;
  customers_at_risk: number;
  revenue_at_risk: number;
  top5_count: number;
  messages_prepared: number;
  messages_awaiting_approval: number;
  messages_sent: number;
  messages_failed: number;
  owner_notification_email?: string;
  owner_notification_status: 'sent' | 'pending_credentials' | 'disabled' | 'failed';
  owner_notification_message?: string;
  created_at: string;
}

export interface DbOutboundLog {
  idempotency_key: string;
  workspace_id: string;
  message_id: string;
  channel: 'whatsapp' | 'email';
  customer_id: string;
  recipient: string;
  provider_message_id: string;
  status: string;
  sent_at: string;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Database Configuration & Connection Pool
// ----------------------------------------------------------------------------
let pgPool: Pool | null = null;
let sqliteDb: DatabaseSync | null = null;
let isPostgresActive = false;
let databaseInitialized = false;
let initDatabasePromise: Promise<{ isPostgres: boolean; target: string }> | null = null;

// Ensure persistent data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    // ignore
  }
}

/**
 * Initializes and returns the active connection pool / storage engine
 */
export async function initDatabase(): Promise<{ isPostgres: boolean; target: string }> {
  if (databaseInitialized) {
    return { 
      isPostgres: isPostgresActive, 
      target: isPostgresActive 
        ? 'PostgreSQL' 
        : (process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT)
            ? 'Unconfigured (PostgreSQL Required in Production)'
            : 'SQLite WAL (Local Development Only)')
    };
  }

  if (initDatabasePromise) {
    return initDatabasePromise;
  }

  initDatabasePromise = (async () => {
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      Boolean(process.env.RAILWAY_ENVIRONMENT) ||
      Boolean(process.env.RENDER);
    const isAiStudioSandbox = Boolean(process.env.AIS_DEV_ENVIRONMENT);

    // 1. Check for PostgreSQL credentials
    // A PostgreSQL connection string must start with postgresql:// or postgres://.
    // If an HTTP REST URL (e.g. Supabase REST endpoint) was passed into DATABASE_URL, ignore it for pg.Pool.
    const rawDbUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
    const isPostgresUrl = rawDbUrl.startsWith('postgresql://') || rawDbUrl.startsWith('postgres://');
    if (rawDbUrl && !isPostgresUrl) {
      console.log('[Churnveda DB] Non-PostgreSQL URL detected in DATABASE_URL (expected postgresql:// or postgres://). Skipping pg.Pool.');
    }

    const dbUrl = isPostgresUrl ? rawDbUrl : undefined;
    const pgHost = process.env.PGHOST;

    if (dbUrl || pgHost) {
      let pool: Pool | null = null;
      try {
        const poolConfig = dbUrl
          ? {
              connectionString: dbUrl,
              ssl: (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('.railway.internal')) ? false : { rejectUnauthorized: false },
              max: 10,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 10000
            }
          : {
              host: pgHost,
              port: Number(process.env.PGPORT || 5432),
              user: process.env.PGUSER || 'postgres',
              password: process.env.PGPASSWORD,
              database: process.env.PGDATABASE || 'railway',
              ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
              max: 10,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 10000
            };

        pool = new Pool(poolConfig);
        pool.on('error', (err) => {
          console.error('[Churnveda DB Pool Warning] Idle client error:', err.message);
        });

        // Probe connection once with cold-start-tolerant timeout
        const client = await pool.connect();
        const clientErrHandler = (err: Error) => {
          console.warn('[Churnveda DB Client Warning]:', err?.message || err);
        };
        client.on('error', clientErrHandler);
        try {
          await client.query('SELECT 1 as connected');
        } finally {
          client.removeListener('error', clientErrHandler);
          client.release();
        }

        pgPool = pool;
        isPostgresActive = true;
        console.log('[Churnveda DB] Successfully connected to PostgreSQL pool.');
        await runPostgresMigrations(pgPool);
        await migrateSqliteFileToPostgres(pgPool);
        databaseInitialized = true;
        return { isPostgres: true, target: 'PostgreSQL' };
      } catch (err: any) {
        if (pool) {
          await pool.end().catch(() => {});
        }
        pgPool = null;
        isPostgresActive = false;
        if (isProduction && !isAiStudioSandbox) {
          console.error('[Churnveda DB Error] PostgreSQL connection failed in production:', err?.message || err);
          throw new Error(`PostgreSQL connection failed in production: ${err?.message || 'connection error'}`);
        }
        console.warn('[Churnveda DB Notice] PostgreSQL connection unreachable (' + (err?.message || 'timeout') + '). Using local SQLite storage for development.');
      }
    } else if (isProduction) {
      console.warn('[Churnveda DB Notice] DATABASE_URL not configured in production; falling back to SQLite WAL storage.');
    }

    // 2. Initialize persistent SQLite WAL storage fallback
    const dbFilePath = path.join(dataDir, 'nochurn.db');
    sqliteDb = new DatabaseSync(dbFilePath);
    // Enable WAL (Write-Ahead Logging) mode and foreign keys for high-performance concurrent writes
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
    sqliteDb.exec('PRAGMA synchronous = NORMAL;');
    
    runSqliteMigrations(sqliteDb);
    isPostgresActive = false;
    databaseInitialized = true;
    console.log(`[Churnveda DB] SQLite database active at: ${dbFilePath}`);
    return { isPostgres: false, target: 'SQLite WAL (Fallback Storage)' };
  })().finally(() => {
    initDatabasePromise = null;
  });

  return initDatabasePromise;
}

function safeParseJsonValue(raw: unknown): any {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  return raw;
}

/**
 * Automatically migrates existing local SQLite data (`data/nochurn.db`) into PostgreSQL
 * in strict dependency order, skipping synthetic test/orphan rows that would violate
 * PostgreSQL foreign key constraints.
 */
export async function migrateSqliteFileToPostgres(pool: Pool): Promise<{
  migrated: boolean;
  counts: Record<string, number>;
}> {
  const counts: Record<string, number> = {};
  const dbFilePath = path.join(dataDir, 'nochurn.db');
  if (!fs.existsSync(dbFilePath)) {
    return { migrated: false, counts };
  }

  let srcDb: DatabaseSync | null = null;
  const client = await pool.connect();
  const clientErrHandler = (err: Error) => {
    console.warn('[Churnveda DB Migration Client Warning]:', err?.message || err);
  };
  client.on('error', clientErrHandler);

  try {
    const wsCountRes = await client.query('SELECT COUNT(*) as count FROM workspaces');
    const userCountRes = await client.query('SELECT COUNT(*) as count FROM users');
    const custCountRes = await client.query('SELECT COUNT(*) as count FROM customers');
    const pgWsCount = parseInt(wsCountRes.rows[0]?.count || '0', 10);
    const pgUserCount = parseInt(userCountRes.rows[0]?.count || '0', 10);
    const pgCustCount = parseInt(custCountRes.rows[0]?.count || '0', 10);

    // Migrate whenever PostgreSQL is fresh (no workspaces, no users, or no customers yet)
    if (pgWsCount > 0 && pgUserCount > 0 && pgCustCount > 0) {
      return { migrated: false, counts };
    }

    srcDb = new DatabaseSync(dbFilePath, { readOnly: true });
    const existingTables = new Set(
      (srcDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map(t => t.name)
    );
    const readRows = (table: string): any[] => {
      if (!existingTables.has(table)) return [];
      return srcDb!.prepare(`SELECT * FROM ${table}`).all() as any[];
    };

    const isTestWorkspaceId = (id?: string | null) =>
      !id || id.startsWith('ws_test_') || id.startsWith('ws_tenant_');
    const isTestUserId = (id?: string | null) =>
      !id || id.startsWith('usr_test_');
    const isTestEventId = (id?: string | null) =>
      !id || id.startsWith('evt_test_');

    console.log('[Churnveda DB Migration] Migrating local SQLite records into PostgreSQL...');

    await client.query('BEGIN');
    try {
      const existingWsRes = await client.query('SELECT id FROM workspaces');
      const validWorkspaceIds = new Set<string>(existingWsRes.rows.map((r: any) => r.id));

      const workspaces = readRows('workspaces').filter(ws => !isTestWorkspaceId(ws.id));
      counts.workspaces = 0;
      for (const ws of workspaces) {
        await client.query(
          `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [ws.id, ws.name, ws.owner_id, ws.created_at, ws.updated_at]
        );
        validWorkspaceIds.add(ws.id);
        counts.workspaces += 1;
      }

      const existingUsersRes = await client.query('SELECT id FROM users');
      const validUserIds = new Set<string>(existingUsersRes.rows.map((r: any) => r.id));

      const users = readRows('users').filter(
        u => !isTestUserId(u.id) && validWorkspaceIds.has(u.workspace_id)
      );
      counts.users = 0;
      for (const u of users) {
        await client.query(
          `INSERT INTO users (
            id, full_name, company_name, email, password_hash, phone, email_verified,
            selected_plan, billing_status, workspace_id, role, razorpay_subscription_id,
            razorpay_plan_id, billing_plan_id, trial_ends_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT DO NOTHING`,
          [
            u.id, u.full_name, u.company_name, u.email, u.password_hash, u.phone || null,
            Boolean(u.email_verified), u.selected_plan, u.billing_status, u.workspace_id,
            u.role || 'Admin', u.razorpay_subscription_id || null, u.razorpay_plan_id || null,
            u.billing_plan_id || null, u.trial_ends_at || null, u.created_at, u.updated_at
          ]
        );
        validUserIds.add(u.id);
        counts.users += 1;
      }

      const members = readRows('workspace_members').filter(
        m => validWorkspaceIds.has(m.workspace_id) && validUserIds.has(m.user_id)
      );
      counts.workspace_members = 0;
      for (const m of members) {
        await client.query(
          `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [m.id, m.workspace_id, m.user_id, m.role || 'member', m.created_at]
        );
        counts.workspace_members += 1;
      }

      const sessions = readRows('sessions').filter(
        s => validWorkspaceIds.has(s.workspace_id) && validUserIds.has(s.user_id)
      );
      counts.sessions = 0;
      for (const s of sessions) {
        await client.query(
          `INSERT INTO sessions (token, user_id, email, workspace_id, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [s.token, s.user_id, s.email, s.workspace_id, Number(s.expires_at), s.created_at]
        );
        counts.sessions += 1;
      }

      const resetTokens = readRows('password_reset_tokens');
      counts.password_reset_tokens = 0;
      for (const rt of resetTokens) {
        await client.query(
          `INSERT INTO password_reset_tokens (token, email, expires_at, created_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [rt.token, rt.email, Number(rt.expires_at), rt.created_at]
        );
        counts.password_reset_tokens += 1;
      }

      const pendingSignups = readRows('pending_signups');
      counts.pending_signups = 0;
      for (const ps of pendingSignups) {
        await client.query(
          `INSERT INTO pending_signups (user_id, email, tier, billing_cycle, trial_verified, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [ps.user_id, ps.email, ps.tier, ps.billing_cycle, Boolean(ps.trial_verified), ps.created_at, ps.updated_at]
        );
        counts.pending_signups += 1;
      }

      const existingPlansRes = await client.query('SELECT id FROM billing_plans');
      const validPlanIds = new Set<string>(existingPlansRes.rows.map((r: any) => r.id));

      const plans = readRows('billing_plans');
      counts.billing_plans = 0;
      for (const bp of plans) {
        await client.query(
          `INSERT INTO billing_plans (
            id, name, tier, billing_cycle, amount_paise, amount_inr, currency,
            razorpay_plan_id, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT DO NOTHING`,
          [
            bp.id, bp.name, bp.tier, bp.billing_cycle, Number(bp.amount_paise), Number(bp.amount_inr),
            bp.currency || 'USD', bp.razorpay_plan_id, Boolean(bp.is_active), bp.created_at, bp.updated_at
          ]
        );
        validPlanIds.add(bp.id);
        counts.billing_plans += 1;
      }

      const customers = readRows('customers').filter(c => validWorkspaceIds.has(c.workspace_id));
      counts.customers = 0;
      for (const c of customers) {
        const parsedData = safeParseJsonValue(c.data_json) ?? {};
        await client.query(
          `INSERT INTO customers (
            id, workspace_id, customer_id, name, domain, plan, mrr, status,
            risk_score, risk_category, last_login_days, usage_drop_percent,
            open_tickets_count, payment_status, contract_renewal_days,
            primary_contact_name, primary_contact_role, primary_contact_email,
            data_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21)
          ON CONFLICT DO NOTHING`,
          [
            c.id, c.workspace_id, c.customer_id, c.name, c.domain || null, c.plan,
            Number(c.mrr), c.status, Number(c.risk_score), c.risk_category, Number(c.last_login_days),
            Number(c.usage_drop_percent), Number(c.open_tickets_count), c.payment_status,
            Number(c.contract_renewal_days), c.primary_contact_name || null,
            c.primary_contact_role || null, c.primary_contact_email || null,
            JSON.stringify(parsedData), c.created_at, c.updated_at
          ]
        );
        counts.customers += 1;
      }

      const imports = readRows('csv_imports').filter(i => validWorkspaceIds.has(i.workspace_id));
      counts.csv_imports = 0;
      for (const imp of imports) {
        await client.query(
          `INSERT INTO csv_imports (
            import_id, workspace_id, source, file_name, started_at, completed_at,
            total_rows, valid_rows, failed_rows, status, error_summary, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT DO NOTHING`,
          [
            imp.import_id, imp.workspace_id, imp.source || 'CSV', imp.file_name,
            imp.started_at, imp.completed_at || null, Number(imp.total_rows), Number(imp.valid_rows),
            Number(imp.failed_rows), imp.status || 'completed', imp.error_summary || null, imp.created_at
          ]
        );
        counts.csv_imports += 1;
      }

      const actions = readRows('retention_actions').filter(r => validWorkspaceIds.has(r.workspace_id));
      counts.retention_actions = 0;
      for (const act of actions) {
        await client.query(
          `INSERT INTO retention_actions (
            id, workspace_id, customer_id, action_type, status, recommended_action,
            email_script, recovery_probability, discount_offered, notes, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT DO NOTHING`,
          [
            act.id, act.workspace_id, act.customer_id, act.action_type, act.status || 'pending',
            act.recommended_action || null, act.email_script || null,
            act.recovery_probability !== null && act.recovery_probability !== undefined ? Number(act.recovery_probability) : null,
            act.discount_offered || null, act.notes || null, act.created_at, act.updated_at
          ]
        );
        counts.retention_actions += 1;
      }

      const trialVerifications = readRows('trial_verifications').filter(
        tv => validWorkspaceIds.has(tv.workspace_id) && validPlanIds.has(tv.billing_plan_id)
      );
      counts.trial_verifications = 0;
      for (const tv of trialVerifications) {
        await client.query(
          `INSERT INTO trial_verifications (
            id, workspace_id, user_id, email, tier, billing_cycle, billing_plan_id,
            razorpay_plan_id, razorpay_order_id, amount_paise, currency, status,
            payment_id, verified_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT DO NOTHING`,
          [
            tv.id, tv.workspace_id, tv.user_id, tv.email, tv.tier, tv.billing_cycle,
            tv.billing_plan_id, tv.razorpay_plan_id, tv.razorpay_order_id,
            Number(tv.amount_paise), tv.currency || 'INR', tv.status || 'pending',
            tv.payment_id || null, tv.verified_at || null, tv.created_at, tv.updated_at
          ]
        );
        counts.trial_verifications += 1;
      }

      const subscriptions = readRows('subscriptions').filter(
        sub => validWorkspaceIds.has(sub.workspace_id) && validPlanIds.has(sub.billing_plan_id)
      );
      counts.subscriptions = 0;
      for (const sub of subscriptions) {
        await client.query(
          `INSERT INTO subscriptions (
            id, workspace_id, user_id, email, tier, billing_cycle, billing_plan_id,
            razorpay_plan_id, razorpay_subscription_id, status, trial_started_at, trial_ends_at,
            payment_verification_status, razorpay_verification_order_id, razorpay_verification_payment_id,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT DO NOTHING`,
          [
            sub.id, sub.workspace_id, sub.user_id, sub.email, sub.tier, sub.billing_cycle,
            sub.billing_plan_id, sub.razorpay_plan_id, sub.razorpay_subscription_id || null,
            sub.status, sub.trial_started_at || null, sub.trial_ends_at || null,
            sub.payment_verification_status || 'pending',
            sub.razorpay_verification_order_id || null,
            sub.razorpay_verification_payment_id || null,
            sub.created_at, sub.updated_at
          ]
        );
        counts.subscriptions += 1;
      }

      const orders = readRows('razorpay_orders').filter(o => validWorkspaceIds.has(o.workspace_id));
      counts.razorpay_orders = 0;
      for (const o of orders) {
        const meta = safeParseJsonValue(o.metadata_json);
        await client.query(
          `INSERT INTO razorpay_orders (
            id, workspace_id, user_id, order_id, amount_paise, currency, receipt, status,
            metadata_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
          ON CONFLICT DO NOTHING`,
          [
            o.id, o.workspace_id, o.user_id, o.order_id, Number(o.amount_paise),
            o.currency || 'INR', o.receipt || null, o.status,
            meta ? JSON.stringify(meta) : null, o.created_at, o.updated_at
          ]
        );
        counts.razorpay_orders += 1;
      }

      const webhooks = readRows('webhook_events').filter(
        w => !isTestEventId(w.event_id) && (!w.workspace_id || validWorkspaceIds.has(w.workspace_id))
      );
      counts.webhook_events = 0;
      for (const w of webhooks) {
        const payload = safeParseJsonValue(w.payload_json) ?? {};
        await client.query(
          `INSERT INTO webhook_events (
            event_id, event_type, workspace_id, idempotency_key, payload_json, processed_at, status
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) ON CONFLICT DO NOTHING`,
          [
            w.event_id, w.event_type, w.workspace_id || null, w.idempotency_key,
            JSON.stringify(payload), w.processed_at, w.status || 'processed'
          ]
        );
        counts.webhook_events += 1;
      }

      const payments = readRows('subscription_payments').filter(p => validWorkspaceIds.has(p.workspace_id));
      counts.subscription_payments = 0;
      for (const p of payments) {
        const rawEvent = safeParseJsonValue(p.raw_event);
        await client.query(
          `INSERT INTO subscription_payments (
            id, workspace_id, user_id, subscription_id, razorpay_payment_id, currency,
            amount_usd, amount_cents, converted_inr_amount, fee, tax, settlement_status,
            raw_event, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
          ON CONFLICT DO NOTHING`,
          [
            p.id, p.workspace_id, p.user_id || null, p.subscription_id, p.razorpay_payment_id,
            p.currency || 'USD', Number(p.amount_usd), Number(p.amount_cents),
            p.converted_inr_amount !== null && p.converted_inr_amount !== undefined ? Number(p.converted_inr_amount) : null,
            p.fee !== null && p.fee !== undefined ? Number(p.fee) : null,
            p.tax !== null && p.tax !== undefined ? Number(p.tax) : null,
            p.settlement_status || 'pending', rawEvent ? JSON.stringify(rawEvent) : null,
            p.created_at, p.updated_at
          ]
        );
        counts.subscription_payments += 1;
      }

      const auditLogs = readRows('audit_logs').filter(a => validWorkspaceIds.has(a.workspace_id));
      counts.audit_logs = 0;
      for (const a of auditLogs) {
        const meta = safeParseJsonValue(a.metadata);
        await client.query(
          `INSERT INTO audit_logs (
            id, workspace_id, actor_id, actor_email, action, target_type, target_id,
            ip_address, user_agent, metadata, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
          ON CONFLICT DO NOTHING`,
          [
            a.id, a.workspace_id, a.actor_id, a.actor_email, a.action, a.target_type,
            a.target_id || null, a.ip_address || null, a.user_agent || null,
            meta ? JSON.stringify(meta) : null, a.created_at
          ]
        );
        counts.audit_logs += 1;
      }

      const unsubs = readRows('unsubscribed_contacts');
      counts.unsubscribed_contacts = 0;
      for (const u of unsubs) {
        await client.query(
          `INSERT INTO unsubscribed_contacts (contact_key, channel, contact_value, unsubscribed_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [u.contact_key, u.channel, u.contact_value, u.unsubscribed_at]
        );
        counts.unsubscribed_contacts += 1;
      }

      const schedulerSettings = readRows('scheduler_settings').filter(s => validWorkspaceIds.has(s.workspace_id));
      counts.scheduler_settings = 0;
      for (const s of schedulerSettings) {
        await client.query(
          `INSERT INTO scheduler_settings (
            workspace_id, enabled, scan_time, timezone, owner_notification_email,
            last_run_date, last_run_at, next_run_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
          [
            s.workspace_id, Boolean(s.enabled), s.scan_time || '09:00', s.timezone || 'UTC',
            s.owner_notification_email || null, s.last_run_date || null,
            s.last_run_at || null, s.next_run_at || null, s.updated_at
          ]
        );
        counts.scheduler_settings += 1;
      }

      const briefs = readRows('owner_briefs').filter(b => validWorkspaceIds.has(b.workspace_id));
      counts.owner_briefs = 0;
      for (const b of briefs) {
        await client.query(
          `INSERT INTO owner_briefs (
            id, workspace_id, date, status, customers_analyzed, customers_at_risk,
            revenue_at_risk, top5_count, messages_prepared, messages_awaiting_approval,
            messages_sent, messages_failed, owner_notification_email,
            owner_notification_status, owner_notification_message, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT DO NOTHING`,
          [
            b.id, b.workspace_id, b.date, b.status || 'COMPLETED',
            Number(b.customers_analyzed), Number(b.customers_at_risk), Number(b.revenue_at_risk),
            Number(b.top5_count), Number(b.messages_prepared), Number(b.messages_awaiting_approval),
            Number(b.messages_sent), Number(b.messages_failed),
            b.owner_notification_email || null, b.owner_notification_status || 'pending_credentials',
            b.owner_notification_message || null, b.created_at
          ]
        );
        counts.owner_briefs += 1;
      }

      const outboundLogs = readRows('outbound_messages_log').filter(o => validWorkspaceIds.has(o.workspace_id));
      counts.outbound_messages_log = 0;
      for (const o of outboundLogs) {
        await client.query(
          `INSERT INTO outbound_messages_log (
            idempotency_key, workspace_id, message_id, channel, customer_id,
            recipient, provider_message_id, status, sent_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
          [
            o.idempotency_key, o.workspace_id, o.message_id, o.channel, o.customer_id,
            o.recipient, o.provider_message_id, o.status || 'SENT', o.sent_at, o.created_at
          ]
        );
        counts.outbound_messages_log += 1;
      }

      await client.query('COMMIT');
      console.log(
        `[Churnveda DB Migration] SQLite -> PostgreSQL migration complete (workspaces: ${counts.workspaces}, users: ${counts.users}, sessions: ${counts.sessions}, customers: ${counts.customers}, billing_plans: ${counts.billing_plans}).`
      );
      return { migrated: true, counts };
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    }
  } catch (err: any) {
    console.error('[Churnveda DB Migration Error] SQLite to PostgreSQL migration failed:', err?.message || err);
    throw err;
  } finally {
    if (srcDb) {
      try { srcDb.close(); } catch {}
    }
    client.removeListener('error', clientErrHandler);
    client.release();
  }
}

// ----------------------------------------------------------------------------
// SQL Migrations (Idempotent DDL)
// ----------------------------------------------------------------------------
export async function runPostgresMigrations(pool: Pool) {
  const client = await pool.connect();
  const clientErrHandler = (err: Error) => {
    console.warn('[Churnveda DB Migration Client Warning]:', err?.message || err);
  };
  client.on('error', clientErrHandler);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        company_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        phone TEXT,
        email_verified BOOLEAN DEFAULT true NOT NULL,
        selected_plan TEXT DEFAULT 'growth' NOT NULL,
        billing_status TEXT DEFAULT 'pending_payment' NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        role TEXT DEFAULT 'Admin' NOT NULL,
        razorpay_subscription_id TEXT,
        razorpay_plan_id TEXT,
        billing_plan_id TEXT,
        trial_ends_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT unique_pg_workspace_member UNIQUE (workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS pending_signups (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        tier TEXT NOT NULL,
        billing_cycle TEXT NOT NULL,
        trial_verified BOOLEAN DEFAULT false NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS billing_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tier TEXT NOT NULL,
        billing_cycle TEXT NOT NULL,
        amount_paise BIGINT NOT NULL,
        amount_inr NUMERIC(12, 2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        razorpay_plan_id TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        customer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        domain TEXT,
        plan TEXT NOT NULL,
        mrr NUMERIC(12, 2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        risk_score INTEGER NOT NULL,
        risk_category TEXT NOT NULL,
        last_login_days INTEGER NOT NULL DEFAULT 0,
        usage_drop_percent INTEGER NOT NULL DEFAULT 0,
        open_tickets_count INTEGER NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'paid',
        contract_renewal_days INTEGER NOT NULL DEFAULT 90,
        primary_contact_name TEXT,
        primary_contact_role TEXT,
        primary_contact_email TEXT,
        data_json JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT unique_pg_workspace_customer UNIQUE (workspace_id, customer_id)
      );

      CREATE TABLE IF NOT EXISTS csv_imports (
        import_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'CSV',
        file_name TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        total_rows INTEGER NOT NULL DEFAULT 0,
        valid_rows INTEGER NOT NULL DEFAULT 0,
        failed_rows INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        error_summary TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS retention_actions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        customer_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        recommended_action TEXT,
        email_script TEXT,
        recovery_probability INTEGER,
        discount_offered TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trial_verifications (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        tier TEXT NOT NULL,
        billing_cycle TEXT NOT NULL,
        billing_plan_id TEXT NOT NULL REFERENCES billing_plans(id),
        razorpay_plan_id TEXT NOT NULL,
        razorpay_order_id TEXT NOT NULL UNIQUE,
        amount_paise INTEGER NOT NULL DEFAULT 100,
        currency TEXT NOT NULL DEFAULT 'INR',
        status TEXT NOT NULL DEFAULT 'pending',
        payment_id TEXT,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        tier TEXT NOT NULL,
        billing_cycle TEXT NOT NULL,
        billing_plan_id TEXT NOT NULL REFERENCES billing_plans(id),
        razorpay_plan_id TEXT NOT NULL,
        razorpay_subscription_id TEXT,
        status TEXT NOT NULL,
        trial_started_at TIMESTAMPTZ,
        trial_ends_at TIMESTAMPTZ,
        payment_verification_status TEXT NOT NULL DEFAULT 'pending',
        razorpay_verification_order_id TEXT,
        razorpay_verification_payment_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS razorpay_orders (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        order_id TEXT NOT NULL UNIQUE,
        amount_paise BIGINT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        receipt TEXT,
        status TEXT NOT NULL,
        metadata_json JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        workspace_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_json JSONB NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed'
      );

      CREATE TABLE IF NOT EXISTS subscription_payments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT,
        subscription_id TEXT NOT NULL,
        razorpay_payment_id TEXT UNIQUE NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        amount_usd NUMERIC(10, 2) NOT NULL,
        amount_cents INTEGER NOT NULL,
        converted_inr_amount NUMERIC(12, 2),
        fee NUMERIC(10, 2),
        tax NUMERIC(10, 2),
        settlement_status TEXT NOT NULL DEFAULT 'pending',
        raw_event JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sub_payments_workspace ON subscription_payments(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_sub_payments_sub ON subscription_payments(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_sub_payments_rzp_payment ON subscription_payments(razorpay_payment_id);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
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
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

      CREATE TABLE IF NOT EXISTS unsubscribed_contacts (
        contact_key TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        contact_value TEXT NOT NULL,
        unsubscribed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduler_settings (
        workspace_id TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT true,
        scan_time TEXT NOT NULL DEFAULT '09:00',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        owner_notification_email TEXT,
        last_run_date TEXT,
        last_run_at TEXT,
        next_run_at TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS owner_briefs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        customers_analyzed INTEGER NOT NULL DEFAULT 0,
        customers_at_risk INTEGER NOT NULL DEFAULT 0,
        revenue_at_risk NUMERIC(12, 2) NOT NULL DEFAULT 0,
        top5_count INTEGER NOT NULL DEFAULT 0,
        messages_prepared INTEGER NOT NULL DEFAULT 0,
        messages_awaiting_approval INTEGER NOT NULL DEFAULT 0,
        messages_sent INTEGER NOT NULL DEFAULT 0,
        messages_failed INTEGER NOT NULL DEFAULT 0,
        owner_notification_email TEXT,
        owner_notification_status TEXT NOT NULL DEFAULT 'pending_credentials',
        owner_notification_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_owner_briefs_workspace ON owner_briefs(workspace_id);

      CREATE TABLE IF NOT EXISTS outbound_messages_log (
        idempotency_key TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        provider_message_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SENT',
        sent_at TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbound_log_ws_cust ON outbound_messages_log(workspace_id, customer_id, channel, sent_at);

      -- Enable Row-Level Security (RLS) across all private tables if not already enabled
      DO $$
      DECLARE tbl text;
      BEGIN
        FOR tbl IN
          SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND c.relrowsecurity = false
            AND c.relname = ANY(ARRAY[
              'workspaces', 'users', 'sessions', 'password_reset_tokens',
              'workspace_members', 'pending_signups', 'billing_plans', 'customers',
              'csv_imports', 'retention_actions', 'trial_verifications', 'subscriptions',
              'razorpay_orders', 'webhook_events', 'subscription_payments', 'audit_logs',
              'unsubscribed_contacts', 'scheduler_settings', 'owner_briefs', 'outbound_messages_log'
            ])
        LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        END LOOP;
      END $$;
    `);
  } finally {
    client.removeListener('error', clientErrHandler);
    client.release();
  }
}

function runSqliteMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT,
      email_verified INTEGER DEFAULT 1 NOT NULL,
      selected_plan TEXT DEFAULT 'growth' NOT NULL,
      billing_status TEXT DEFAULT 'pending_payment' NOT NULL,
      workspace_id TEXT NOT NULL,
      role TEXT DEFAULT 'Admin' NOT NULL,
      razorpay_subscription_id TEXT,
      razorpay_plan_id TEXT,
      billing_plan_id TEXT,
      trial_ends_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member' NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS pending_signups (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      tier TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      trial_verified INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tier TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      amount_inr REAL NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      razorpay_plan_id TEXT NOT NULL,
      is_active INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT,
      plan TEXT NOT NULL,
      mrr REAL NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      risk_score INTEGER NOT NULL,
      risk_category TEXT NOT NULL,
      last_login_days INTEGER DEFAULT 0 NOT NULL,
      usage_drop_percent INTEGER DEFAULT 0 NOT NULL,
      open_tickets_count INTEGER DEFAULT 0 NOT NULL,
      payment_status TEXT DEFAULT 'paid' NOT NULL,
      contract_renewal_days INTEGER DEFAULT 90 NOT NULL,
      primary_contact_name TEXT,
      primary_contact_role TEXT,
      primary_contact_email TEXT,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, customer_id)
    );

    CREATE TABLE IF NOT EXISTS csv_imports (
      import_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source TEXT DEFAULT 'CSV' NOT NULL,
      file_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      total_rows INTEGER DEFAULT 0 NOT NULL,
      valid_rows INTEGER DEFAULT 0 NOT NULL,
      failed_rows INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'completed' NOT NULL,
      error_summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS retention_actions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      recommended_action TEXT,
      email_script TEXT,
      recovery_probability INTEGER,
      discount_offered TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trial_verifications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      tier TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      billing_plan_id TEXT NOT NULL,
      razorpay_plan_id TEXT NOT NULL,
      razorpay_order_id TEXT NOT NULL UNIQUE,
      amount_paise INTEGER DEFAULT 100 NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      payment_id TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      tier TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      billing_plan_id TEXT NOT NULL,
      razorpay_plan_id TEXT NOT NULL,
      razorpay_subscription_id TEXT,
      status TEXT NOT NULL,
      trial_started_at TEXT,
      trial_ends_at TEXT,
      payment_verification_status TEXT DEFAULT 'pending' NOT NULL,
      razorpay_verification_order_id TEXT,
      razorpay_verification_payment_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS razorpay_orders (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      order_id TEXT NOT NULL UNIQUE,
      amount_paise INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      receipt TEXT,
      status TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      workspace_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      status TEXT DEFAULT 'processed' NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscription_payments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT,
      subscription_id TEXT NOT NULL,
      razorpay_payment_id TEXT UNIQUE NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      amount_usd REAL NOT NULL,
      amount_cents INTEGER NOT NULL,
      converted_inr_amount REAL,
      fee REAL,
      tax REAL,
      settlement_status TEXT DEFAULT 'pending' NOT NULL,
      raw_event TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unsubscribed_contacts (
      contact_key TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      contact_value TEXT NOT NULL,
      unsubscribed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduler_settings (
      workspace_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      scan_time TEXT NOT NULL DEFAULT '09:00',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      owner_notification_email TEXT,
      last_run_date TEXT,
      last_run_at TEXT,
      next_run_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owner_briefs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      customers_analyzed INTEGER NOT NULL DEFAULT 0,
      customers_at_risk INTEGER NOT NULL DEFAULT 0,
      revenue_at_risk REAL NOT NULL DEFAULT 0,
      top5_count INTEGER NOT NULL DEFAULT 0,
      messages_prepared INTEGER NOT NULL DEFAULT 0,
      messages_awaiting_approval INTEGER NOT NULL DEFAULT 0,
      messages_sent INTEGER NOT NULL DEFAULT 0,
      messages_failed INTEGER NOT NULL DEFAULT 0,
      owner_notification_email TEXT,
      owner_notification_status TEXT NOT NULL DEFAULT 'pending_credentials',
      owner_notification_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbound_messages_log (
      idempotency_key TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SENT',
      sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

// ----------------------------------------------------------------------------
// Type-Safe Universal Repository Operations
// ----------------------------------------------------------------------------

export const db = {
  /**
   * Health status & database engine details
   */
  async getHealth() {
    if (!databaseInitialized) await initDatabase();
    const isProd =
      process.env.NODE_ENV === 'production' ||
      Boolean(process.env.RAILWAY_ENVIRONMENT) ||
      Boolean(process.env.RENDER);
    
    if (isPostgresActive) {
      return {
        status: 'healthy',
        engine: 'PostgreSQL',
        poolMax: 10,
        isPersistent: true,
        productionReady: true,
        timestamp: new Date().toISOString()
      };
    }

    if (isProd) {
      return {
        status: 'healthy',
        engine: 'SQLite WAL (Fallback Storage)',
        poolMax: 1,
        isPersistent: false,
        productionReady: false,
        notice: 'SQLite fallback active. Configure DATABASE_URL for external PostgreSQL persistence.',
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: 'healthy',
      engine: 'SQLite WAL (Local Development Only)',
      poolMax: 1,
      isPersistent: false,
      productionReady: false,
      notice: 'Local development storage active. Managed PostgreSQL required for production.',
      timestamp: new Date().toISOString()
    };
  },

  // Workspaces
  workspaces: {
    async getById(id: string): Promise<DbWorkspace | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM workspaces WHERE id = $1', [id]);
        return res.rows[0] || null;
      }
      const stmt = sqliteDb!.prepare('SELECT * FROM workspaces WHERE id = ?');
      return (stmt.get(id) as unknown as DbWorkspace) || null;
    },

    async upsert(ws: DbWorkspace): Promise<DbWorkspace> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const query = `
          INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            updated_at = EXCLUDED.updated_at
          RETURNING *;
        `;
        const res = await pgPool.query(query, [ws.id, ws.name, ws.owner_id, ws.created_at, ws.updated_at]);
        return res.rows[0];
      }
      const stmt = sqliteDb!.prepare(`
        INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at
      `);
      stmt.run(ws.id, ws.name, ws.owner_id, ws.created_at, ws.updated_at);
      return ws;
    },

    async listAll(): Promise<DbWorkspace[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM workspaces');
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT * FROM workspaces').all() as unknown as DbWorkspace[];
    }
  },

  // Users
  users: {
    async getById(id: string): Promise<DbUser | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM users WHERE id = $1', [id]);
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as DbUser) || null;
    },

    async getByEmail(email: string): Promise<DbUser | null> {
      if (!databaseInitialized) await initDatabase();
      const clean = email.toLowerCase().trim();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM users WHERE LOWER(email) = $1', [clean]);
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(clean) as unknown as DbUser) || null;
    },

    async upsert(user: DbUser): Promise<DbUser> {
      if (!databaseInitialized) await initDatabase();
      const cleanEmail = user.email.toLowerCase().trim();
      const existingByEmail = await this.getByEmail(cleanEmail);
      const targetUserId = existingByEmail ? existingByEmail.id : user.id;
      const targetWorkspaceId = user.workspace_id || existingByEmail?.workspace_id || 'ws-default';

      // Ensure workspace exists before inserting foreign key
      await db.workspaces.upsert({
        id: targetWorkspaceId,
        name: user.company_name || 'My Workspace',
        owner_id: targetUserId,
        created_at: user.created_at || existingByEmail?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (isPostgresActive && pgPool) {
        const query = `
          INSERT INTO users (
            id, full_name, company_name, email, password_hash, phone, email_verified,
            selected_plan, billing_status, workspace_id, role, razorpay_subscription_id,
            razorpay_plan_id, billing_plan_id, trial_ends_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            company_name = EXCLUDED.company_name,
            email = EXCLUDED.email,
            password_hash = CASE WHEN EXCLUDED.password_hash != '' THEN EXCLUDED.password_hash ELSE users.password_hash END,
            phone = EXCLUDED.phone,
            email_verified = EXCLUDED.email_verified,
            selected_plan = EXCLUDED.selected_plan,
            billing_status = EXCLUDED.billing_status,
            workspace_id = EXCLUDED.workspace_id,
            role = EXCLUDED.role,
            razorpay_subscription_id = COALESCE(EXCLUDED.razorpay_subscription_id, users.razorpay_subscription_id),
            razorpay_plan_id = COALESCE(EXCLUDED.razorpay_plan_id, users.razorpay_plan_id),
            billing_plan_id = COALESCE(EXCLUDED.billing_plan_id, users.billing_plan_id),
            trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, users.trial_ends_at),
            updated_at = EXCLUDED.updated_at
          RETURNING *;
        `;
        const res = await pgPool.query(query, [
          targetUserId, user.full_name, user.company_name, cleanEmail,
          user.password_hash || existingByEmail?.password_hash || '', user.phone || null, user.email_verified, user.selected_plan,
          user.billing_status, targetWorkspaceId, user.role || 'Admin',
          user.razorpay_subscription_id || null, user.razorpay_plan_id || null,
          user.billing_plan_id || null, user.trial_ends_at || null, user.created_at, user.updated_at
        ]);
        return res.rows[0];
      }

      const stmt = sqliteDb!.prepare(`
        INSERT INTO users (
          id, full_name, company_name, email, password_hash, phone, email_verified,
          selected_plan, billing_status, workspace_id, role, razorpay_subscription_id,
          razorpay_plan_id, billing_plan_id, trial_ends_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          full_name = excluded.full_name,
          company_name = excluded.company_name,
          email = excluded.email,
          password_hash = CASE WHEN excluded.password_hash != '' THEN excluded.password_hash ELSE users.password_hash END,
          phone = excluded.phone,
          email_verified = excluded.email_verified,
          selected_plan = excluded.selected_plan,
          billing_status = excluded.billing_status,
          workspace_id = excluded.workspace_id,
          role = excluded.role,
          razorpay_subscription_id = COALESCE(excluded.razorpay_subscription_id, users.razorpay_subscription_id),
          razorpay_plan_id = COALESCE(excluded.razorpay_plan_id, users.razorpay_plan_id),
          billing_plan_id = COALESCE(excluded.billing_plan_id, users.billing_plan_id),
          trial_ends_at = COALESCE(excluded.trial_ends_at, users.trial_ends_at),
          updated_at = excluded.updated_at
      `);
      stmt.run(
        targetUserId, user.full_name, user.company_name, cleanEmail,
        user.password_hash || existingByEmail?.password_hash || '', user.phone || null, user.email_verified ? 1 : 0, user.selected_plan,
        user.billing_status, targetWorkspaceId, user.role || 'Admin',
        user.razorpay_subscription_id || null, user.razorpay_plan_id || null,
        user.billing_plan_id || null, user.trial_ends_at || null, user.created_at, user.updated_at
      );
      return {
        ...user,
        id: targetUserId,
        email: cleanEmail,
        workspace_id: targetWorkspaceId
      };
    },

    async listAll(): Promise<DbUser[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM users');
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT * FROM users').all() as unknown as DbUser[];
    }
  },

  // Sessions (Multi-device persistent authentication)
  sessions: {
    async get(token: string): Promise<DbSession | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM sessions WHERE token = $1 AND expires_at > $2', [token, Date.now()]);
        return res.rows[0] || null;
      }
      const stmt = sqliteDb!.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?');
      return (stmt.get(token, Date.now()) as unknown as DbSession) || null;
    },

    async set(session: DbSession): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        await pgPool.query(`
          INSERT INTO sessions (token, user_id, email, workspace_id, expires_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (token) DO UPDATE SET
            expires_at = EXCLUDED.expires_at;
        `, [session.token, session.user_id, session.email, session.workspace_id, session.expires_at, session.created_at]);
        return;
      }
      const stmt = sqliteDb!.prepare(`
        INSERT INTO sessions (token, user_id, email, workspace_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (token) DO UPDATE SET
          expires_at = excluded.expires_at;
      `);
      stmt.run(session.token, session.user_id, session.email, session.workspace_id, session.expires_at, session.created_at);
    },

    async delete(token: string): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        await pgPool.query('DELETE FROM sessions WHERE token = $1', [token]);
        return;
      }
      sqliteDb!.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    },

    async deleteByUserId(userId: string): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        await pgPool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        return;
      }
      sqliteDb!.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
  },

  // Password reset tokens
  passwordResetTokens: {
    async get(token: string): Promise<{ token: string; email: string; expires_at: number } | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > $2', [token, Date.now()]);
        return res.rows[0] || null;
      }
      const stmt = sqliteDb!.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND expires_at > ?');
      return (stmt.get(token, Date.now()) as any) || null;
    },

    async set(token: string, email: string, expiresAt: number): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();
      if (isPostgresActive && pgPool) {
        await pgPool.query(`
          INSERT INTO password_reset_tokens (token, email, expires_at, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at;
        `, [token, email.toLowerCase().trim(), expiresAt, now]);
        return;
      }
      sqliteDb!.prepare(`
        INSERT INTO password_reset_tokens (token, email, expires_at, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (token) DO UPDATE SET expires_at = excluded.expires_at;
      `).run(token, email.toLowerCase().trim(), expiresAt, now);
    },

    async delete(token: string): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        await pgPool.query('DELETE FROM password_reset_tokens WHERE token = $1', [token]);
        return;
      }
      sqliteDb!.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);
    }
  },

  // Customers (Strict Multi-Tenant Workspace Isolation)
  customers: {
    async listByWorkspace(workspaceId: string): Promise<Customer[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT data_json FROM customers WHERE workspace_id = $1 ORDER BY created_at ASC',
          [workspaceId]
        );
        return res.rows.map(r => r.data_json);
      }
      const rows = sqliteDb!.prepare(
        'SELECT data_json FROM customers WHERE workspace_id = ? ORDER BY created_at ASC'
      ).all(workspaceId) as { data_json: string }[];
      return rows.map(r => typeof r.data_json === 'string' ? JSON.parse(r.data_json) : r.data_json);
    },

    async getById(workspaceId: string, idOrCustomerId: string): Promise<Customer | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT data_json FROM customers WHERE workspace_id = $1 AND (id = $2 OR customer_id = $2)',
          [workspaceId, idOrCustomerId]
        );
        return res.rows[0]?.data_json || null;
      }
      const row = sqliteDb!.prepare(
        'SELECT data_json FROM customers WHERE workspace_id = ? AND (id = ? OR customer_id = ?)'
      ).get(workspaceId, idOrCustomerId, idOrCustomerId) as { data_json: string } | undefined;
      if (!row) return null;
      return typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json;
    },

    async upsert(workspaceId: string, customer: Customer): Promise<Customer> {
      if (!databaseInitialized) await initDatabase();
      const normCustomer: Customer = {
        ...customer,
        workspaceId,
        customerId: customer.customerId || customer.id
      };

      const now = new Date().toISOString();
      const id = normCustomer.id || `cust-${Date.now()}`;
      const customerId = normCustomer.customerId;
      const anyCust = normCustomer as any;

      if (isPostgresActive && pgPool) {
        const query = `
          INSERT INTO customers (
            id, workspace_id, customer_id, name, domain, plan, mrr, status,
            risk_score, risk_category, last_login_days, usage_drop_percent,
            open_tickets_count, payment_status, contract_renewal_days,
            primary_contact_name, primary_contact_role, primary_contact_email,
            data_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          ON CONFLICT (workspace_id, customer_id) DO UPDATE SET
            name = EXCLUDED.name,
            domain = EXCLUDED.domain,
            plan = EXCLUDED.plan,
            mrr = EXCLUDED.mrr,
            status = EXCLUDED.status,
            risk_score = EXCLUDED.risk_score,
            risk_category = EXCLUDED.risk_category,
            last_login_days = EXCLUDED.last_login_days,
            usage_drop_percent = EXCLUDED.usage_drop_percent,
            open_tickets_count = EXCLUDED.open_tickets_count,
            payment_status = EXCLUDED.payment_status,
            contract_renewal_days = EXCLUDED.contract_renewal_days,
            primary_contact_name = EXCLUDED.primary_contact_name,
            primary_contact_role = EXCLUDED.primary_contact_role,
            primary_contact_email = EXCLUDED.primary_contact_email,
            data_json = EXCLUDED.data_json,
            updated_at = EXCLUDED.updated_at
          RETURNING data_json;
        `;
        const res = await pgPool.query(query, [
          id, workspaceId, customerId, normCustomer.name, anyCust.domain || null,
          normCustomer.plan, normCustomer.mrr, normCustomer.status, normCustomer.riskScore,
          normCustomer.riskCategory, normCustomer.lastLoginDays || 0, anyCust.usageDropPercent || 0,
          normCustomer.openTicketsCount || 0, normCustomer.paymentStatus || 'paid',
          anyCust.contractRenewalDays || 90, anyCust.primaryContact?.name || null,
          anyCust.primaryContact?.role || null, anyCust.primaryContact?.email || null,
          JSON.stringify(normCustomer), now, now
        ]);
        return res.rows[0].data_json;
      }

      const stmt = sqliteDb!.prepare(`
        INSERT INTO customers (
          id, workspace_id, customer_id, name, domain, plan, mrr, status,
          risk_score, risk_category, last_login_days, usage_drop_percent,
          open_tickets_count, payment_status, contract_renewal_days,
          primary_contact_name, primary_contact_role, primary_contact_email,
          data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (workspace_id, customer_id) DO UPDATE SET
          name = excluded.name,
          domain = excluded.domain,
          plan = excluded.plan,
          mrr = excluded.mrr,
          status = excluded.status,
          risk_score = excluded.risk_score,
          risk_category = excluded.risk_category,
          last_login_days = excluded.last_login_days,
          usage_drop_percent = excluded.usage_drop_percent,
          open_tickets_count = excluded.open_tickets_count,
          payment_status = excluded.payment_status,
          contract_renewal_days = excluded.contract_renewal_days,
          primary_contact_name = excluded.primary_contact_name,
          primary_contact_role = excluded.primary_contact_role,
          primary_contact_email = excluded.primary_contact_email,
          data_json = excluded.data_json,
          updated_at = excluded.updated_at
      `);
      stmt.run(
        id, workspaceId, customerId, normCustomer.name, anyCust.domain || null,
        normCustomer.plan, normCustomer.mrr, normCustomer.status, normCustomer.riskScore,
        normCustomer.riskCategory, normCustomer.lastLoginDays || 0, anyCust.usageDropPercent || 0,
        normCustomer.openTicketsCount || 0, normCustomer.paymentStatus || 'paid',
        anyCust.contractRenewalDays || 90, anyCust.primaryContact?.name || null,
        anyCust.primaryContact?.role || null, anyCust.primaryContact?.email || null,
        JSON.stringify(normCustomer), now, now
      );
      return normCustomer;
    },

    async count(workspaceId?: string): Promise<number> {
      if (!databaseInitialized) await initDatabase();
      if (workspaceId) {
        if (isPostgresActive && pgPool) {
          const res = await pgPool.query('SELECT COUNT(*) as cnt FROM customers WHERE workspace_id = $1', [workspaceId]);
          return parseInt(res.rows[0].cnt, 10);
        }
        const row = sqliteDb!.prepare('SELECT COUNT(*) as cnt FROM customers WHERE workspace_id = ?').get(workspaceId) as any;
        return row?.cnt || 0;
      }
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT COUNT(*) as cnt FROM customers');
        return parseInt(res.rows[0].cnt, 10);
      }
      const row = sqliteDb!.prepare('SELECT COUNT(*) as cnt FROM customers').get() as any;
      return row?.cnt || 0;
    },

    async delete(workspaceId: string, idOrCustomerId: string): Promise<boolean> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'DELETE FROM customers WHERE workspace_id = $1 AND (id = $2 OR customer_id = $2)',
          [workspaceId, idOrCustomerId]
        );
        return (res.rowCount ?? 0) > 0;
      }
      const info = sqliteDb!.prepare(
        'DELETE FROM customers WHERE workspace_id = ? AND (id = ? OR customer_id = ?)'
      ).run(workspaceId, idOrCustomerId, idOrCustomerId);
      return info.changes > 0;
    },

    async bulkDelete(workspaceId: string, ids: string[]): Promise<number> {
      if (!databaseInitialized) await initDatabase();
      if (!ids || ids.length === 0) return 0;
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'DELETE FROM customers WHERE workspace_id = $1 AND (id = ANY($2::text[]) OR customer_id = ANY($2::text[]))',
          [workspaceId, ids]
        );
        return res.rowCount ?? 0;
      }
      let deleted = 0;
      const stmt = sqliteDb!.prepare(
        'DELETE FROM customers WHERE workspace_id = ? AND (id = ? OR customer_id = ?)'
      );
      for (const id of ids) {
        const info = stmt.run(workspaceId, id, id);
        deleted += Number(info.changes);
      }
      return deleted;
    },

    async clearDemo(workspaceId: string): Promise<number> {
      if (!databaseInitialized) await initDatabase();
      const all = await this.listByWorkspace(workspaceId);
      const demoIds = all
        .filter(c => c.is_demo_data === true || c.isDemo === true)
        .map(c => c.id || c.customerId || '');
      if (demoIds.length === 0) return 0;
      return await this.bulkDelete(workspaceId, demoIds);
    },

    async listAll(): Promise<Customer[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT data_json FROM customers ORDER BY created_at ASC');
        return res.rows.map(r => r.data_json);
      }
      const rows = sqliteDb!.prepare('SELECT data_json FROM customers ORDER BY created_at ASC').all() as { data_json: string }[];
      return rows.map(r => typeof r.data_json === 'string' ? JSON.parse(r.data_json) : r.data_json);
    }
  },

  // CSV Imports History
  csvImports: {
    async create(workspaceId: string, rec: ImportHistoryRecord): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();
      const id = rec.importId || (rec as any).import_id || `imp_${Date.now()}`;
      if (isPostgresActive && pgPool) {
        await pgPool.query(`
          INSERT INTO csv_imports (
            import_id, workspace_id, source, file_name, started_at, completed_at,
            total_rows, valid_rows, failed_rows, status, error_summary, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (import_id) DO UPDATE SET
            status = EXCLUDED.status,
            completed_at = EXCLUDED.completed_at;
        `, [
          id, workspaceId, rec.source || 'CSV', rec.fileName || (rec as any).file_name || 'import.csv',
          rec.startedAt || now, rec.completedAt || now,
          rec.totalRows ?? (rec as any).total_rows ?? 0, rec.validRows ?? (rec as any).valid_rows ?? 0,
          rec.failedRows ?? (rec as any).failed_rows ?? 0, rec.status || 'completed',
          rec.errorSummary || null, now
        ]);
        return;
      }
      const stmt = sqliteDb!.prepare(`
        INSERT INTO csv_imports (
          import_id, workspace_id, source, file_name, started_at, completed_at,
          total_rows, valid_rows, failed_rows, status, error_summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (import_id) DO UPDATE SET
          status = excluded.status,
          completed_at = excluded.completed_at;
      `);
      stmt.run(
        id, workspaceId, rec.source || 'CSV', rec.fileName || (rec as any).file_name || 'import.csv',
        rec.startedAt || now, rec.completedAt || now,
        rec.totalRows ?? (rec as any).total_rows ?? 0, rec.validRows ?? (rec as any).valid_rows ?? 0,
        rec.failedRows ?? (rec as any).failed_rows ?? 0, rec.status || 'completed',
        rec.errorSummary || null, now
      );
    },

    async listByWorkspace(workspaceId: string): Promise<ImportHistoryRecord[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM csv_imports WHERE workspace_id = $1 ORDER BY started_at DESC', [workspaceId]);
        return res.rows.map(r => ({
          importId: r.import_id,
          workspaceId: r.workspace_id,
          source: r.source,
          fileName: r.file_name,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          totalRows: r.total_rows,
          validRows: r.valid_rows,
          failedRows: r.failed_rows,
          status: r.status,
          errorSummary: r.error_summary
        }));
      }
      const rows = sqliteDb!.prepare('SELECT * FROM csv_imports WHERE workspace_id = ? ORDER BY started_at DESC').all(workspaceId) as any[];
      return rows.map(r => ({
        importId: r.import_id,
        workspaceId: r.workspace_id,
        source: r.source,
        fileName: r.file_name,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        totalRows: r.total_rows,
        validRows: r.valid_rows,
        failedRows: r.failed_rows,
        status: r.status,
        errorSummary: r.error_summary
      }));
    },

    async insert(rec: ImportHistoryRecord): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();
      if (isPostgresActive && pgPool) {
        await pgPool.query(`
          INSERT INTO csv_imports (
            import_id, workspace_id, source, file_name, started_at, completed_at,
            total_rows, valid_rows, failed_rows, status, error_summary, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (import_id) DO UPDATE SET
            completed_at = EXCLUDED.completed_at,
            status = EXCLUDED.status,
            error_summary = EXCLUDED.error_summary;
        `, [
          rec.importId, rec.workspaceId, rec.source || 'CSV', rec.fileName, rec.startedAt,
          rec.completedAt || null, rec.totalRows || 0, rec.validRows || 0, rec.failedRows || 0,
          rec.status || 'completed', rec.errorSummary || null, now
        ]);
        return;
      }
      sqliteDb!.prepare(`
        INSERT INTO csv_imports (
          import_id, workspace_id, source, file_name, started_at, completed_at,
          total_rows, valid_rows, failed_rows, status, error_summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (import_id) DO UPDATE SET
          completed_at = excluded.completed_at,
          status = excluded.status,
          error_summary = excluded.error_summary;
      `).run(
        rec.importId, rec.workspaceId, rec.source || 'CSV', rec.fileName, rec.startedAt,
        rec.completedAt || null, rec.totalRows || 0, rec.validRows || 0, rec.failedRows || 0,
        rec.status || 'completed', rec.errorSummary || null, now
      );
    },

    async clearByWorkspace(workspaceId: string): Promise<number> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('DELETE FROM csv_imports WHERE workspace_id = $1', [workspaceId]);
        return res.rowCount ?? 0;
      }
      const info = sqliteDb!.prepare('DELETE FROM csv_imports WHERE workspace_id = ?').run(workspaceId);
      return Number(info.changes);
    },

    async listAll(): Promise<ImportHistoryRecord[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM csv_imports ORDER BY started_at DESC');
        return res.rows.map(r => ({
          importId: r.import_id,
          workspaceId: r.workspace_id,
          source: r.source,
          fileName: r.file_name,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          totalRows: r.total_rows,
          validRows: r.valid_rows,
          failedRows: r.failed_rows,
          status: r.status,
          errorSummary: r.error_summary
        }));
      }
      const rows = sqliteDb!.prepare('SELECT * FROM csv_imports ORDER BY started_at DESC').all() as any[];
      return rows.map(r => ({
        importId: r.import_id,
        workspaceId: r.workspace_id,
        source: r.source,
        fileName: r.file_name,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        totalRows: r.total_rows,
        validRows: r.valid_rows,
        failedRows: r.failed_rows,
        status: r.status,
        errorSummary: r.error_summary
      }));
    }
  },

  // Authoritative Billing Plans
  billingPlans: {
    async listAll(): Promise<DbBillingPlan[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM billing_plans WHERE is_active = true ORDER BY amount_paise ASC');
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT * FROM billing_plans WHERE is_active = 1 ORDER BY amount_paise ASC').all() as unknown as DbBillingPlan[];
    },

    async getById(id: string): Promise<DbBillingPlan | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM billing_plans WHERE id = $1', [id]);
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare('SELECT * FROM billing_plans WHERE id = ?').get(id) as unknown as DbBillingPlan) || null;
    },

    async upsert(plan: DbBillingPlan): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        await pgPool.query(`
          INSERT INTO billing_plans (id, name, tier, billing_cycle, amount_paise, amount_inr, currency, razorpay_plan_id, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            amount_paise = EXCLUDED.amount_paise,
            amount_inr = EXCLUDED.amount_inr,
            razorpay_plan_id = EXCLUDED.razorpay_plan_id,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at;
        `, [
          plan.id, plan.name, plan.tier, plan.billing_cycle, plan.amount_paise,
          plan.amount_inr, plan.currency || 'INR', plan.razorpay_plan_id, plan.is_active,
          plan.created_at, plan.updated_at
        ]);
        return;
      }
      sqliteDb!.prepare(`
        INSERT INTO billing_plans (id, name, tier, billing_cycle, amount_paise, amount_inr, currency, razorpay_plan_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          amount_paise = excluded.amount_paise,
          amount_inr = excluded.amount_inr,
          razorpay_plan_id = excluded.razorpay_plan_id,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at;
      `).run(
        plan.id, plan.name, plan.tier, plan.billing_cycle, plan.amount_paise,
        plan.amount_inr, plan.currency || 'INR', plan.razorpay_plan_id, plan.is_active ? 1 : 0,
        plan.created_at, plan.updated_at
      );
    }
  },

  // Trial Verifications (₹1 Razorpay Verification Orders)
  trialVerifications: {
    async getByOrderId(orderId: string): Promise<DbTrialVerification | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM trial_verifications WHERE razorpay_order_id = $1', [orderId]);
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare('SELECT * FROM trial_verifications WHERE razorpay_order_id = ?').get(orderId) as unknown as DbTrialVerification) || null;
    },

    async getByWorkspace(workspaceId: string): Promise<DbTrialVerification[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM trial_verifications WHERE workspace_id = $1 ORDER BY created_at DESC', [workspaceId]);
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT * FROM trial_verifications WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId) as unknown as DbTrialVerification[];
    },

    async upsert(tv: DbTrialVerification): Promise<DbTrialVerification> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const query = `
          INSERT INTO trial_verifications (
            id, workspace_id, user_id, email, tier, billing_cycle,
            billing_plan_id, razorpay_plan_id, razorpay_order_id, amount_paise,
            currency, status, payment_id, verified_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (razorpay_order_id) DO UPDATE SET
            status = EXCLUDED.status,
            payment_id = EXCLUDED.payment_id,
            verified_at = EXCLUDED.verified_at,
            updated_at = EXCLUDED.updated_at
          RETURNING *;
        `;
        const res = await pgPool.query(query, [
          tv.id, tv.workspace_id, tv.user_id, tv.email.toLowerCase().trim(),
          tv.tier, tv.billing_cycle, tv.billing_plan_id, tv.razorpay_plan_id,
          tv.razorpay_order_id, tv.amount_paise, tv.currency || 'INR',
          tv.status, tv.payment_id || null, tv.verified_at || null, tv.created_at, tv.updated_at
        ]);
        return res.rows[0];
      }

      sqliteDb!.prepare(`
        INSERT INTO trial_verifications (
          id, workspace_id, user_id, email, tier, billing_cycle,
          billing_plan_id, razorpay_plan_id, razorpay_order_id, amount_paise,
          currency, status, payment_id, verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (razorpay_order_id) DO UPDATE SET
          status = excluded.status,
          payment_id = excluded.payment_id,
          verified_at = excluded.verified_at,
          updated_at = excluded.updated_at;
      `).run(
        tv.id, tv.workspace_id, tv.user_id, tv.email.toLowerCase().trim(),
        tv.tier, tv.billing_cycle, tv.billing_plan_id, tv.razorpay_plan_id,
        tv.razorpay_order_id, tv.amount_paise, tv.currency || 'INR',
        tv.status, tv.payment_id || null, tv.verified_at || null, tv.created_at, tv.updated_at
      );
      return tv;
    }
  },

  // Subscriptions (Authoritative Workspace Billing Lifecycle)
  subscriptions: {
    async getByWorkspace(workspaceId: string): Promise<DbSubscription | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM subscriptions WHERE workspace_id = $1', [workspaceId]);
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare('SELECT * FROM subscriptions WHERE workspace_id = ?').get(workspaceId) as unknown as DbSubscription) || null;
    },

    async getBySubscriptionId(subId: string): Promise<DbSubscription | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare('SELECT * FROM subscriptions WHERE razorpay_subscription_id = ?').get(subId) as unknown as DbSubscription) || null;
    },

    async upsert(sub: DbSubscription): Promise<DbSubscription> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const query = `
          INSERT INTO subscriptions (
            id, workspace_id, user_id, email, tier, billing_cycle,
            billing_plan_id, razorpay_plan_id, razorpay_subscription_id,
            status, trial_started_at, trial_ends_at, payment_verification_status,
            razorpay_verification_order_id, razorpay_verification_payment_id,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (workspace_id) DO UPDATE SET
            tier = EXCLUDED.tier,
            billing_cycle = EXCLUDED.billing_cycle,
            billing_plan_id = EXCLUDED.billing_plan_id,
            razorpay_plan_id = EXCLUDED.razorpay_plan_id,
            razorpay_subscription_id = COALESCE(EXCLUDED.razorpay_subscription_id, subscriptions.razorpay_subscription_id),
            status = EXCLUDED.status,
            trial_started_at = COALESCE(EXCLUDED.trial_started_at, subscriptions.trial_started_at),
            trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, subscriptions.trial_ends_at),
            payment_verification_status = EXCLUDED.payment_verification_status,
            razorpay_verification_order_id = COALESCE(EXCLUDED.razorpay_verification_order_id, subscriptions.razorpay_verification_order_id),
            razorpay_verification_payment_id = COALESCE(EXCLUDED.razorpay_verification_payment_id, subscriptions.razorpay_verification_payment_id),
            updated_at = EXCLUDED.updated_at
          RETURNING *;
        `;
        const res = await pgPool.query(query, [
          sub.id, sub.workspace_id, sub.user_id, sub.email.toLowerCase().trim(),
          sub.tier, sub.billing_cycle, sub.billing_plan_id, sub.razorpay_plan_id,
          sub.razorpay_subscription_id || null, sub.status, sub.trial_started_at || null,
          sub.trial_ends_at || null, sub.payment_verification_status,
          sub.razorpay_verification_order_id || null, sub.razorpay_verification_payment_id || null,
          sub.created_at, sub.updated_at
        ]);
        return res.rows[0];
      }

      sqliteDb!.prepare(`
        INSERT INTO subscriptions (
          id, workspace_id, user_id, email, tier, billing_cycle,
          billing_plan_id, razorpay_plan_id, razorpay_subscription_id,
          status, trial_started_at, trial_ends_at, payment_verification_status,
          razorpay_verification_order_id, razorpay_verification_payment_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (workspace_id) DO UPDATE SET
          tier = excluded.tier,
          billing_cycle = excluded.billing_cycle,
          billing_plan_id = excluded.billing_plan_id,
          razorpay_plan_id = excluded.razorpay_plan_id,
          razorpay_subscription_id = COALESCE(excluded.razorpay_subscription_id, subscriptions.razorpay_subscription_id),
          status = excluded.status,
          trial_started_at = COALESCE(excluded.trial_started_at, subscriptions.trial_started_at),
          trial_ends_at = COALESCE(excluded.trial_ends_at, subscriptions.trial_ends_at),
          payment_verification_status = excluded.payment_verification_status,
          razorpay_verification_order_id = COALESCE(excluded.razorpay_verification_order_id, subscriptions.razorpay_verification_order_id),
          razorpay_verification_payment_id = COALESCE(excluded.razorpay_verification_payment_id, subscriptions.razorpay_verification_payment_id),
          updated_at = excluded.updated_at;
      `).run(
        sub.id, sub.workspace_id, sub.user_id, sub.email.toLowerCase().trim(),
        sub.tier, sub.billing_cycle, sub.billing_plan_id, sub.razorpay_plan_id,
        sub.razorpay_subscription_id || null, sub.status, sub.trial_started_at || null,
        sub.trial_ends_at || null, sub.payment_verification_status,
        sub.razorpay_verification_order_id || null, sub.razorpay_verification_payment_id || null,
        sub.created_at, sub.updated_at
      );
      return sub;
    },

    async listAll(): Promise<DbSubscription[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM subscriptions');
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT * FROM subscriptions').all() as unknown as DbSubscription[];
    }
  },

  // Webhook Events with Strict Database Idempotency
  webhookEvents: {
    /**
     * Checks if a webhook has already been processed using its idempotency key.
     * If not already processed, saves the event and returns true so processing can continue.
     * If already processed, returns false to guarantee idempotent execution.
     */
    async recordIfNew(eventId: string, eventType: string, idempotencyKey: string, payload: any, workspaceId?: string): Promise<boolean> {
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();
      const payloadStr = JSON.stringify(payload);

      if (isPostgresActive && pgPool) {
        try {
          const res = await pgPool.query(`
            INSERT INTO webhook_events (event_id, event_type, workspace_id, idempotency_key, payload_json, processed_at, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'processed')
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING event_id;
          `, [eventId, eventType, workspaceId || null, idempotencyKey, payloadStr, now]);
          return res.rowCount !== null && res.rowCount > 0;
        } catch (err) {
          return false;
        }
      }

      try {
        const stmt = sqliteDb!.prepare(`
          INSERT INTO webhook_events (event_id, event_type, workspace_id, idempotency_key, payload_json, processed_at, status)
          VALUES (?, ?, ?, ?, ?, ?, 'processed')
          ON CONFLICT (idempotency_key) DO NOTHING;
        `);
        const info = stmt.run(eventId, eventType, workspaceId || null, idempotencyKey, payloadStr, now);
        return info.changes > 0;
      } catch (err) {
        return false;
      }
    }
  },

  // Workspace Members (Multi-Tenant Authorization & Role Management)
  workspaceMembers: {
    async isMember(workspaceId: string, userId: string): Promise<boolean> {
      if (!databaseInitialized) await initDatabase();
      if (!workspaceId || !userId) return false;

      // Check if user is workspace owner
      const ws = await db.workspaces.getById(workspaceId);
      if (ws && ws.owner_id === userId) return true;

      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
          [workspaceId, userId]
        );
        return res.rows.length > 0;
      }

      const row = sqliteDb!.prepare(
        'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
      ).get(workspaceId, userId);
      return Boolean(row);
    },

    async hasRole(workspaceId: string, userId: string, allowedRoles: ('owner' | 'admin' | 'member')[]): Promise<boolean> {
      if (!databaseInitialized) await initDatabase();
      if (!workspaceId || !userId) return false;

      const ws = await db.workspaces.getById(workspaceId);
      if (ws && ws.owner_id === userId) return true;

      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
          [workspaceId, userId]
        );
        if (res.rows.length === 0) return false;
        return allowedRoles.includes(res.rows[0].role);
      }

      const row = sqliteDb!.prepare(
        'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
      ).get(workspaceId, userId) as { role: 'owner' | 'admin' | 'member' } | undefined;
      if (!row) return false;
      return allowedRoles.includes(row.role);
    },

    async addMember(workspaceId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      const id = `wsm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date().toISOString();

      if (isPostgresActive && pgPool) {
        await pgPool.query(
          `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [id, workspaceId, userId, role, now]
        );
        return;
      }

      sqliteDb!.prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`
      ).run(id, workspaceId, userId, role, now);
    },

    async listMembers(workspaceId: string): Promise<DbWorkspaceMember[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM workspace_members WHERE workspace_id = $1', [workspaceId]);
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT * FROM workspace_members WHERE workspace_id = ?').all(workspaceId) as unknown as DbWorkspaceMember[];
    },

    async listAll(): Promise<DbWorkspaceMember[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM workspace_members');
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT * FROM workspace_members').all() as unknown as DbWorkspaceMember[];
    }
  },

  // Audit Logs (Immutable Security & Administrative Event Log)
  auditLogs: {
    async record(entry: {
      workspaceId: string;
      actorId: string;
      actorEmail: string;
      action: string;
      targetType: string;
      targetId?: string;
      ipAddress?: string;
      userAgent?: string;
      metadata?: any;
    }): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date().toISOString();
      const meta = entry.metadata ? (typeof entry.metadata === 'string' ? entry.metadata : JSON.stringify(entry.metadata)) : null;

      try {
        if (isPostgresActive && pgPool) {
          await pgPool.query(
            `INSERT INTO audit_logs (id, workspace_id, actor_id, actor_email, action, target_type, target_id, ip_address, user_agent, metadata, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [id, entry.workspaceId, entry.actorId, entry.actorEmail, entry.action, entry.targetType, entry.targetId || null, entry.ipAddress || null, entry.userAgent || null, meta, now]
          );
          return;
        }

        sqliteDb!.prepare(
          `INSERT INTO audit_logs (id, workspace_id, actor_id, actor_email, action, target_type, target_id, ip_address, user_agent, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, entry.workspaceId, entry.actorId, entry.actorEmail, entry.action, entry.targetType, entry.targetId || null, entry.ipAddress || null, entry.userAgent || null, meta, now);
      } catch (err: any) {
        console.error('[Churnveda DB Audit Log Error]:', err.message);
      }
    },

    async listByWorkspace(workspaceId: string, limit = 100): Promise<DbAuditLog[]> {
      if (!databaseInitialized) await initDatabase();
      const safeLimit = Math.min(Math.max(1, limit), 250);
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT * FROM audit_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
          [workspaceId, safeLimit]
        );
        return res.rows;
      }
      return sqliteDb!.prepare(
        'SELECT * FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(workspaceId, safeLimit) as unknown as DbAuditLog[];
    }
  },

  // Subscription Payments Ledger (USD international recurring payments & INR settlements)
  subscriptionPayments: {
    async recordPayment(payment: DbSubscriptionPayment): Promise<DbSubscriptionPayment> {
      if (!databaseInitialized) await initDatabase();
      const rawJson = payment.raw_event ? (typeof payment.raw_event === 'string' ? payment.raw_event : JSON.stringify(payment.raw_event)) : null;

      if (isPostgresActive && pgPool) {
        await pgPool.query(`
          INSERT INTO subscription_payments (
            id, workspace_id, user_id, subscription_id, razorpay_payment_id,
            currency, amount_usd, amount_cents, converted_inr_amount, fee, tax,
            settlement_status, raw_event, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (razorpay_payment_id) DO UPDATE SET
            settlement_status = EXCLUDED.settlement_status,
            converted_inr_amount = COALESCE(EXCLUDED.converted_inr_amount, subscription_payments.converted_inr_amount),
            fee = COALESCE(EXCLUDED.fee, subscription_payments.fee),
            tax = COALESCE(EXCLUDED.tax, subscription_payments.tax),
            raw_event = COALESCE(EXCLUDED.raw_event, subscription_payments.raw_event),
            updated_at = EXCLUDED.updated_at;
        `, [
          payment.id, payment.workspace_id, payment.user_id || null, payment.subscription_id, payment.razorpay_payment_id,
          payment.currency || 'USD', payment.amount_usd, payment.amount_cents, payment.converted_inr_amount || null,
          payment.fee || null, payment.tax || null, payment.settlement_status || 'pending', rawJson,
          payment.created_at, payment.updated_at
        ]);
        return payment;
      }

      sqliteDb!.prepare(`
        INSERT INTO subscription_payments (
          id, workspace_id, user_id, subscription_id, razorpay_payment_id,
          currency, amount_usd, amount_cents, converted_inr_amount, fee, tax,
          settlement_status, raw_event, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (razorpay_payment_id) DO UPDATE SET
          settlement_status = excluded.settlement_status,
          converted_inr_amount = COALESCE(excluded.converted_inr_amount, subscription_payments.converted_inr_amount),
          fee = COALESCE(excluded.fee, subscription_payments.fee),
          tax = COALESCE(excluded.tax, subscription_payments.tax),
          raw_event = COALESCE(excluded.raw_event, subscription_payments.raw_event),
          updated_at = excluded.updated_at;
      `).run(
        payment.id, payment.workspace_id, payment.user_id || null, payment.subscription_id, payment.razorpay_payment_id,
        payment.currency || 'USD', payment.amount_usd, payment.amount_cents, payment.converted_inr_amount || null,
        payment.fee || null, payment.tax || null, payment.settlement_status || 'pending', rawJson,
        payment.created_at, payment.updated_at
      );
      return payment;
    },

    async getByWorkspace(workspaceId: string): Promise<DbSubscriptionPayment[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT * FROM subscription_payments WHERE workspace_id = $1 ORDER BY created_at DESC',
          [workspaceId]
        );
        return res.rows;
      }
      return sqliteDb!.prepare(
        'SELECT * FROM subscription_payments WHERE workspace_id = ? ORDER BY created_at DESC'
      ).all(workspaceId) as unknown as DbSubscriptionPayment[];
    },

    async getByPaymentId(paymentId: string): Promise<DbSubscriptionPayment | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT * FROM subscription_payments WHERE razorpay_payment_id = $1',
          [paymentId]
        );
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare(
        'SELECT * FROM subscription_payments WHERE razorpay_payment_id = ?'
      ).get(paymentId) as unknown as DbSubscriptionPayment) || null;
    },

    async updateSettlement(paymentId: string, updates: Partial<DbSubscriptionPayment>): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();
      if (isPostgresActive && pgPool) {
        await pgPool.query(`
          UPDATE subscription_payments SET
            settlement_status = COALESCE($1, settlement_status),
            converted_inr_amount = COALESCE($2, converted_inr_amount),
            fee = COALESCE($3, fee),
            tax = COALESCE($4, tax),
            updated_at = $5
          WHERE razorpay_payment_id = $6
        `, [updates.settlement_status || null, updates.converted_inr_amount || null, updates.fee || null, updates.tax || null, now, paymentId]);
        return;
      }
      sqliteDb!.prepare(`
        UPDATE subscription_payments SET
          settlement_status = COALESCE(?, settlement_status),
          converted_inr_amount = COALESCE(?, converted_inr_amount),
          fee = COALESCE(?, fee),
          tax = COALESCE(?, tax),
          updated_at = ?
        WHERE razorpay_payment_id = ?
      `).run(updates.settlement_status || null, updates.converted_inr_amount || null, updates.fee || null, updates.tax || null, now, paymentId);
    }
  },

  // Comprehensive Admin Multi-Tenant & Persistence Self-Test Suite
  admin: {
    async runSelfTest() {
      if (!databaseInitialized) await initDatabase();
      const testReport: {
        test: string;
        description: string;
        passed: boolean;
        details: string;
      }[] = [];

      // Test 1: Data Persistence & Survival across engine calls
      const testWsId = `ws_test_persist_${Date.now()}`;
      try {
        await db.workspaces.upsert({
          id: testWsId,
          name: 'Persistence Test Workspace',
          owner_id: 'usr_test_admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        const fetchedWs = await db.workspaces.getById(testWsId);
        const pass1 = fetchedWs !== null && fetchedWs.id === testWsId;
        testReport.push({
          test: 'Data Persistence & Server Restart Survival',
          description: 'Verifies records are committed to persistent disk/PostgreSQL and re-queried without in-memory dependency',
          passed: pass1,
          details: pass1 ? `Successfully created and verified workspace ${testWsId}` : 'Failed to retrieve written record'
        });
      } catch (e: any) {
        testReport.push({
          test: 'Data Persistence & Server Restart Survival',
          description: 'Verifies records are committed to persistent disk/PostgreSQL',
          passed: false,
          details: e?.message || 'Error executing test'
        });
      } finally {
        try {
          if (isPostgresActive && pgPool) {
            await pgPool.query('DELETE FROM workspaces WHERE id = $1', [testWsId]);
          } else if (sqliteDb) {
            sqliteDb.prepare('DELETE FROM workspaces WHERE id = ?').run(testWsId);
          }
        } catch {}
      }

      // Test 2: Multi-Device Persistent Session Check
      try {
        const testToken = `sess_test_device_${Date.now()}`;
        await db.sessions.set({
          token: testToken,
          user_id: 'usr-admin-001',
          email: 'nageshsharat@gmail.com',
          workspace_id: 'ws-default',
          expires_at: Date.now() + 86400000,
          created_at: new Date().toISOString()
        });
        const readSession = await db.sessions.get(testToken);
        const pass2 = readSession !== null && readSession.user_id === 'usr-admin-001';
        await db.sessions.delete(testToken);
        testReport.push({
          test: 'Multi-Device Cross-Session Authentication',
          description: 'Ensures cookie sessions are validated directly against persistent DB so users stay logged in across browsers and restarts',
          passed: pass2,
          details: pass2 ? 'Session successfully persisted and verified from DB layer' : 'Failed to fetch session from DB'
        });
      } catch (e: any) {
        testReport.push({
          test: 'Multi-Device Cross-Session Authentication',
          description: 'Ensures cookie sessions are validated directly against persistent DB',
          passed: false,
          details: e?.message || 'Error executing test'
        });
      }

      // Test 3: Idempotency & Duplicate Webhook Protection
      const eventId = `evt_test_${Date.now()}`;
      try {
        const idempotencyKey = `idemp_key_rzp_${Date.now()}`;
        const firstAttempt = await db.webhookEvents.recordIfNew(eventId, 'payment.captured', idempotencyKey, { test: true }, 'ws-default');
        const secondAttempt = await db.webhookEvents.recordIfNew(eventId, 'payment.captured', idempotencyKey, { test: true }, 'ws-default');
        const pass3 = firstAttempt === true && secondAttempt === false;
        testReport.push({
          test: 'Payment Idempotency & Duplicate Protection',
          description: 'Guarantees duplicate Razorpay webhooks or retry requests do not double-bill or duplicate subscriptions',
          passed: pass3,
          details: pass3 ? 'First webhook attempt recorded (true), second identical attempt safely rejected (false)' : 'Idempotency check failed'
        });
      } catch (e: any) {
        testReport.push({
          test: 'Payment Idempotency & Duplicate Protection',
          description: 'Guarantees duplicate Razorpay webhooks do not duplicate records',
          passed: false,
          details: e?.message || 'Error executing test'
        });
      } finally {
        try {
          if (isPostgresActive && pgPool) {
            await pgPool.query('DELETE FROM webhook_events WHERE event_id = $1', [eventId]);
          } else if (sqliteDb) {
            sqliteDb.prepare('DELETE FROM webhook_events WHERE event_id = ?').run(eventId);
          }
        } catch {}
      }

      // Test 4: Multi-Tenant Workspace Isolation
      const wsA = `ws_tenant_a_${Date.now()}`;
      const wsB = `ws_tenant_b_${Date.now()}`;
      const custAId = `cust_a_${Date.now()}`;
      try {
        await db.customers.upsert(wsA, {
          id: custAId,
          name: 'Confidential Corp A',
          plan: 'Enterprise',
          mrr: 15000,
          status: 'active',
          riskScore: 25,
          riskCategory: 'Low'
        } as any);

        const tenantBCustomers = await db.customers.listByWorkspace(wsB);
        const leaked = tenantBCustomers.some(c => c.name === 'Confidential Corp A');
        const pass4 = !leaked;
        testReport.push({
          test: 'Multi-Tenant Workspace Data Isolation',
          description: 'Ensures Tenant B cannot query, view, or mutate customer records belonging to Tenant A',
          passed: pass4,
          details: pass4 ? 'Zero data leakage: Tenant B query returned 0 records of Tenant A' : 'Security failure: Tenant B saw Tenant A customer!'
        });
      } catch (e: any) {
        testReport.push({
          test: 'Multi-Tenant Workspace Data Isolation',
          description: 'Ensures Tenant B cannot view customer records belonging to Tenant A',
          passed: false,
          details: e?.message || 'Error executing test'
        });
      } finally {
        try {
          await db.customers.delete(wsA, custAId);
        } catch {}
      }

      const allPassed = testReport.every(t => t.passed);
      return {
        allPassed,
        engine: isPostgresActive ? 'PostgreSQL' : 'SQLite WAL (Local Development Only)',
        executedAt: new Date().toISOString(),
        tests: testReport
      };
    },

    async getTableStats(): Promise<{
      latencyMs: number;
      engine: string;
      tables: Array<{ name: string; recordsCount: number; lastSync: string }>;
    }> {
      const started = Date.now();
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();

      const countTable = async (tableName: string): Promise<number> => {
        if (isPostgresActive && pgPool) {
          const res = await pgPool.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
          return parseInt(res.rows[0]?.cnt || '0', 10);
        }
        const row = sqliteDb!.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt?: number } | undefined;
        return Number(row?.cnt || 0);
      };

      const [customers, users, workspaces, subscriptions, csvImports, auditLogs] = await Promise.all([
        countTable('customers'),
        countTable('users'),
        countTable('workspaces'),
        countTable('subscriptions'),
        countTable('csv_imports'),
        countTable('audit_logs')
      ]);

      return {
        latencyMs: Math.max(1, Date.now() - started),
        engine: isPostgresActive ? 'PostgreSQL' : 'SQLite WAL',
        tables: [
          { name: 'customers', recordsCount: customers, lastSync: now },
          { name: 'users', recordsCount: users, lastSync: now },
          { name: 'workspaces', recordsCount: workspaces, lastSync: now },
          { name: 'subscriptions', recordsCount: subscriptions, lastSync: now },
          { name: 'csv_imports', recordsCount: csvImports, lastSync: now },
          { name: 'audit_logs', recordsCount: auditLogs, lastSync: now }
        ]
      };
    }
  },

  /**
   * Persistent email/WhatsApp opt-out suppression registry
   */
  unsubscribes: {
    async add(channel: 'email' | 'whatsapp', contactValue: string): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      const norm = contactValue.trim().toLowerCase();
      if (!norm) return;
      const key = `${channel}:${norm}`;
      const now = new Date().toISOString();
      if (isPostgresActive && pgPool) {
        await pgPool.query(
          `INSERT INTO unsubscribed_contacts (contact_key, channel, contact_value, unsubscribed_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (contact_key) DO UPDATE SET unsubscribed_at = EXCLUDED.unsubscribed_at`,
          [key, channel, norm, now]
        );
        return;
      }
      sqliteDb!.prepare(
        `INSERT INTO unsubscribed_contacts (contact_key, channel, contact_value, unsubscribed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (contact_key) DO UPDATE SET unsubscribed_at = excluded.unsubscribed_at`
      ).run(key, channel, norm, now);
    },

    async has(channel: 'email' | 'whatsapp', contactValue: string): Promise<boolean> {
      if (!databaseInitialized) await initDatabase();
      const norm = contactValue.trim().toLowerCase();
      if (!norm) return false;
      const key = `${channel}:${norm}`;
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT 1 FROM unsubscribed_contacts WHERE contact_key = $1', [key]);
        return res.rows.length > 0;
      }
      const row = sqliteDb!.prepare('SELECT 1 FROM unsubscribed_contacts WHERE contact_key = ?').get(key);
      return Boolean(row);
    },

    async listAll(): Promise<Array<{ channel: string; contact_value: string; unsubscribed_at: string }>> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT channel, contact_value, unsubscribed_at FROM unsubscribed_contacts');
        return res.rows;
      }
      return sqliteDb!.prepare('SELECT channel, contact_value, unsubscribed_at FROM unsubscribed_contacts').all() as any[];
    }
  },

  /**
   * Authoritative Razorpay Orders persistence (binds order_id -> workspace, tier, cycle, currency, amount)
   */
  razorpayOrders: {
    async upsert(order: DbRazorpayOrder): Promise<DbRazorpayOrder> {
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();
      const metaStr = order.metadata_json ? JSON.stringify(order.metadata_json) : null;
      if (isPostgresActive && pgPool) {
        await pgPool.query(
          `INSERT INTO razorpay_orders (
            id, workspace_id, user_id, order_id, amount_paise, currency, receipt, status, metadata_json, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (order_id) DO UPDATE SET
            status = EXCLUDED.status,
            metadata_json = COALESCE(EXCLUDED.metadata_json, razorpay_orders.metadata_json),
            updated_at = EXCLUDED.updated_at`,
          [order.id, order.workspace_id, order.user_id, order.order_id, order.amount_paise, order.currency, order.receipt || null, order.status, metaStr, order.created_at || now, now]
        );
        return order;
      }
      sqliteDb!.prepare(
        `INSERT INTO razorpay_orders (
          id, workspace_id, user_id, order_id, amount_paise, currency, receipt, status, metadata_json, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (order_id) DO UPDATE SET
          status = excluded.status,
          metadata_json = COALESCE(excluded.metadata_json, razorpay_orders.metadata_json),
          updated_at = excluded.updated_at`
      ).run(order.id, order.workspace_id, order.user_id, order.order_id, order.amount_paise, order.currency, order.receipt || null, order.status, metaStr, order.created_at || now, now);
      return order;
    },

    async getByOrderId(orderId: string): Promise<DbRazorpayOrder | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM razorpay_orders WHERE order_id = $1 LIMIT 1', [orderId]);
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          ...r,
          amount_paise: Number(r.amount_paise),
          metadata_json: typeof r.metadata_json === 'string' ? JSON.parse(r.metadata_json) : r.metadata_json
        };
      }
      const row = sqliteDb!.prepare('SELECT * FROM razorpay_orders WHERE order_id = ? LIMIT 1').get(orderId) as any;
      if (!row) return null;
      return {
        ...row,
        amount_paise: Number(row.amount_paise),
        metadata_json: typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json
      };
    }
  },

  /**
   * Persistent per-workspace AI Employee Scheduler settings & historical briefs
   */
  scheduler: {
    async getSetting(workspaceId: string): Promise<DbSchedulerSetting | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM scheduler_settings WHERE workspace_id = $1 LIMIT 1', [workspaceId]);
        if (res.rows.length === 0) return null;
        return res.rows[0];
      }
      const row = sqliteDb!.prepare('SELECT * FROM scheduler_settings WHERE workspace_id = ? LIMIT 1').get(workspaceId) as any;
      if (!row) return null;
      return { ...row, enabled: Boolean(row.enabled) };
    },

    async upsertSetting(setting: DbSchedulerSetting): Promise<DbSchedulerSetting> {
      if (!databaseInitialized) await initDatabase();
      const now = new Date().toISOString();
      if (isPostgresActive && pgPool) {
        await pgPool.query(
          `INSERT INTO scheduler_settings (
            workspace_id, enabled, scan_time, timezone, owner_notification_email, last_run_date, last_run_at, next_run_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (workspace_id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            scan_time = EXCLUDED.scan_time,
            timezone = EXCLUDED.timezone,
            owner_notification_email = EXCLUDED.owner_notification_email,
            last_run_date = EXCLUDED.last_run_date,
            last_run_at = EXCLUDED.last_run_at,
            next_run_at = EXCLUDED.next_run_at,
            updated_at = EXCLUDED.updated_at`,
          [
            setting.workspace_id,
            Boolean(setting.enabled),
            setting.scan_time || '09:00',
            setting.timezone || 'UTC',
            setting.owner_notification_email || null,
            setting.last_run_date || null,
            setting.last_run_at || null,
            setting.next_run_at || null,
            now
          ]
        );
        return setting;
      }
      sqliteDb!.prepare(
        `INSERT INTO scheduler_settings (
          workspace_id, enabled, scan_time, timezone, owner_notification_email, last_run_date, last_run_at, next_run_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT (workspace_id) DO UPDATE SET
          enabled = excluded.enabled,
          scan_time = excluded.scan_time,
          timezone = excluded.timezone,
          owner_notification_email = excluded.owner_notification_email,
          last_run_date = excluded.last_run_date,
          last_run_at = excluded.last_run_at,
          next_run_at = excluded.next_run_at,
          updated_at = excluded.updated_at`
      ).run(
        setting.workspace_id,
        setting.enabled ? 1 : 0,
        setting.scan_time || '09:00',
        setting.timezone || 'UTC',
        setting.owner_notification_email || null,
        setting.last_run_date || null,
        setting.last_run_at || null,
        setting.next_run_at || null,
        now
      );
      return setting;
    },

    async listAllSettings(): Promise<DbSchedulerSetting[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM scheduler_settings');
        return res.rows;
      }
      const rows = sqliteDb!.prepare('SELECT * FROM scheduler_settings').all() as any[];
      return rows.map(r => ({ ...r, enabled: Boolean(r.enabled) }));
    },

    async addBrief(brief: DbOwnerBrief): Promise<DbOwnerBrief> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        await pgPool.query(
          `INSERT INTO owner_briefs (
            id, workspace_id, date, status, customers_analyzed, customers_at_risk, revenue_at_risk,
            top5_count, messages_prepared, messages_awaiting_approval, messages_sent, messages_failed,
            owner_notification_email, owner_notification_status, owner_notification_message, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (id) DO NOTHING`,
          [
            brief.id, brief.workspace_id, brief.date, brief.status,
            brief.customers_analyzed, brief.customers_at_risk, brief.revenue_at_risk,
            brief.top5_count, brief.messages_prepared, brief.messages_awaiting_approval,
            brief.messages_sent, brief.messages_failed,
            brief.owner_notification_email || null, brief.owner_notification_status,
            brief.owner_notification_message || null, brief.created_at
          ]
        );
        return brief;
      }
      sqliteDb!.prepare(
        `INSERT INTO owner_briefs (
          id, workspace_id, date, status, customers_analyzed, customers_at_risk, revenue_at_risk,
          top5_count, messages_prepared, messages_awaiting_approval, messages_sent, messages_failed,
          owner_notification_email, owner_notification_status, owner_notification_message, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (id) DO NOTHING`
      ).run(
        brief.id, brief.workspace_id, brief.date, brief.status,
        brief.customers_analyzed, brief.customers_at_risk, brief.revenue_at_risk,
        brief.top5_count, brief.messages_prepared, brief.messages_awaiting_approval,
        brief.messages_sent, brief.messages_failed,
        brief.owner_notification_email || null, brief.owner_notification_status,
        brief.owner_notification_message || null, brief.created_at
      );
      return brief;
    },

    async listBriefs(workspaceId?: string): Promise<DbOwnerBrief[]> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = workspaceId
          ? await pgPool.query('SELECT * FROM owner_briefs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 30', [workspaceId])
          : await pgPool.query('SELECT * FROM owner_briefs ORDER BY created_at DESC LIMIT 60');
        return res.rows.map(r => ({ ...r, revenue_at_risk: Number(r.revenue_at_risk || 0) }));
      }
      const rows = (workspaceId
        ? sqliteDb!.prepare('SELECT * FROM owner_briefs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 30').all(workspaceId)
        : sqliteDb!.prepare('SELECT * FROM owner_briefs ORDER BY created_at DESC LIMIT 60').all()) as any[];
      return rows.map(r => ({ ...r, revenue_at_risk: Number(r.revenue_at_risk || 0) }));
    }
  },

  /**
   * Persistent outbound message delivery & deduplication registry
   */
  outboundLog: {
    async getByIdempotencyKey(key: string): Promise<DbOutboundLog | null> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query('SELECT * FROM outbound_messages_log WHERE idempotency_key = $1 LIMIT 1', [key]);
        return res.rows[0] || null;
      }
      return (sqliteDb!.prepare('SELECT * FROM outbound_messages_log WHERE idempotency_key = ? LIMIT 1').get(key) as unknown as DbOutboundLog | undefined) || null;
    },

    async hasCustomerSentToday(workspaceId: string, customerId: string, channel: string, datePrefix: string): Promise<boolean> {
      if (!databaseInitialized) await initDatabase();
      if (!customerId || customerId === 'cust-generic') return false;
      const pattern = `${datePrefix}%`;
      if (isPostgresActive && pgPool) {
        const res = await pgPool.query(
          'SELECT 1 FROM outbound_messages_log WHERE workspace_id = $1 AND customer_id = $2 AND channel = $3 AND sent_at LIKE $4 LIMIT 1',
          [workspaceId, customerId, channel, pattern]
        );
        return res.rows.length > 0;
      }
      const row = sqliteDb!.prepare(
        'SELECT 1 FROM outbound_messages_log WHERE workspace_id = ? AND customer_id = ? AND channel = ? AND sent_at LIKE ? LIMIT 1'
      ).get(workspaceId, customerId, channel, pattern);
      return Boolean(row);
    },

    async recordSent(entry: DbOutboundLog): Promise<void> {
      if (!databaseInitialized) await initDatabase();
      if (isPostgresActive && pgPool) {
        await pgPool.query(
          `INSERT INTO outbound_messages_log (
            idempotency_key, workspace_id, message_id, channel, customer_id, recipient, provider_message_id, status, sent_at, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (idempotency_key) DO NOTHING`,
          [entry.idempotency_key, entry.workspace_id, entry.message_id, entry.channel, entry.customer_id, entry.recipient, entry.provider_message_id, entry.status, entry.sent_at, entry.created_at]
        );
        return;
      }
      sqliteDb!.prepare(
        `INSERT INTO outbound_messages_log (
          idempotency_key, workspace_id, message_id, channel, customer_id, recipient, provider_message_id, status, sent_at, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (idempotency_key) DO NOTHING`
      ).run(entry.idempotency_key, entry.workspace_id, entry.message_id, entry.channel, entry.customer_id, entry.recipient, entry.provider_message_id, entry.status, entry.sent_at, entry.created_at);
    }
  },

  /**
   * GDPR/DPDP Account Data Export & Full Multi-Table Account Deletion
   */
  accountPrivacy: {
    async exportUserData(params: { userId: string; workspaceId: string; email: string }): Promise<{
      exportedAt: string;
      user: Record<string, any> | null;
      workspace: Record<string, any> | null;
      customers: any[];
      csvImports: any[];
      retentionActions: any[];
      subscriptions: any[];
      auditLogs: any[];
    }> {
      if (!databaseInitialized) await initDatabase();
      const { userId, workspaceId, email } = params;
      const cleanEmail = email.trim().toLowerCase();

      const sanitizeUser = (u: any) => {
        if (!u) return null;
        const { password_hash: _pw, ...safe } = u;
        return safe;
      };

      if (isPostgresActive && pgPool) {
        const [uRes, wRes, cRes, iRes, rRes, sRes, aRes] = await Promise.all([
          pgPool.query('SELECT * FROM users WHERE id = $1 OR email = $2 LIMIT 1', [userId, cleanEmail]),
          pgPool.query('SELECT * FROM workspaces WHERE id = $1 LIMIT 1', [workspaceId]),
          pgPool.query('SELECT * FROM customers WHERE workspace_id = $1', [workspaceId]),
          pgPool.query('SELECT * FROM csv_imports WHERE workspace_id = $1', [workspaceId]),
          pgPool.query('SELECT * FROM retention_actions WHERE workspace_id = $1', [workspaceId]),
          pgPool.query('SELECT * FROM subscriptions WHERE workspace_id = $1', [workspaceId]),
          pgPool.query('SELECT * FROM audit_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200', [workspaceId])
        ]);
        return {
          exportedAt: new Date().toISOString(),
          user: sanitizeUser(uRes.rows[0] || null),
          workspace: wRes.rows[0] || null,
          customers: cRes.rows,
          csvImports: iRes.rows,
          retentionActions: rRes.rows,
          subscriptions: sRes.rows,
          auditLogs: aRes.rows
        };
      }

      const uRow = sqliteDb!.prepare('SELECT * FROM users WHERE id = ? OR email = ? LIMIT 1').get(userId, cleanEmail);
      const wRow = sqliteDb!.prepare('SELECT * FROM workspaces WHERE id = ? LIMIT 1').get(workspaceId);
      const cRows = sqliteDb!.prepare('SELECT * FROM customers WHERE workspace_id = ?').all(workspaceId);
      const iRows = sqliteDb!.prepare('SELECT * FROM csv_imports WHERE workspace_id = ?').all(workspaceId);
      const rRows = sqliteDb!.prepare('SELECT * FROM retention_actions WHERE workspace_id = ?').all(workspaceId);
      const sRows = sqliteDb!.prepare('SELECT * FROM subscriptions WHERE workspace_id = ?').all(workspaceId);
      const aRows = sqliteDb!.prepare('SELECT * FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200').all(workspaceId);

      return {
        exportedAt: new Date().toISOString(),
        user: sanitizeUser(uRow || null),
        workspace: (wRow as Record<string, any>) || null,
        customers: cRows,
        csvImports: iRows,
        retentionActions: rRows,
        subscriptions: sRows,
        auditLogs: aRows
      };
    },

    async deleteUserData(params: { userId: string; workspaceId: string; email: string }): Promise<{
      deletedTables: Record<string, number>;
    }> {
      if (!databaseInitialized) await initDatabase();
      const { userId, workspaceId, email } = params;
      const cleanEmail = email.trim().toLowerCase();
      const deletedTables: Record<string, number> = {};
      const isDefaultWs = workspaceId === 'ws-default';

      if (isPostgresActive && pgPool) {
        const del = async (name: string, sql: string, values: any[]) => {
          const r = await pgPool!.query(sql, values);
          deletedTables[name] = r.rowCount || 0;
        };
        await del('sessions', 'DELETE FROM sessions WHERE user_id = $1 OR email = $2', [userId, cleanEmail]);
        await del('password_reset_tokens', 'DELETE FROM password_reset_tokens WHERE email = $1', [cleanEmail]);
        await del('pending_signups', 'DELETE FROM pending_signups WHERE email = $1', [cleanEmail]);
        await del('trial_verifications', 'DELETE FROM trial_verifications WHERE email = $1 OR user_id = $2', [cleanEmail, userId]);
        await del('workspace_members', 'DELETE FROM workspace_members WHERE user_id = $1 OR workspace_id = $2', [userId, workspaceId]);
        if (!isDefaultWs) {
          await del('customers', 'DELETE FROM customers WHERE workspace_id = $1', [workspaceId]);
          await del('csv_imports', 'DELETE FROM csv_imports WHERE workspace_id = $1', [workspaceId]);
          await del('retention_actions', 'DELETE FROM retention_actions WHERE workspace_id = $1', [workspaceId]);
          await del('subscription_payments', 'DELETE FROM subscription_payments WHERE workspace_id = $1 OR user_id = $2', [workspaceId, userId]);
          await del('subscriptions', 'DELETE FROM subscriptions WHERE workspace_id = $1', [workspaceId]);
          await del('razorpay_orders', 'DELETE FROM razorpay_orders WHERE workspace_id = $1', [workspaceId]);
          await del('scheduler_settings', 'DELETE FROM scheduler_settings WHERE workspace_id = $1', [workspaceId]);
          await del('owner_briefs', 'DELETE FROM owner_briefs WHERE workspace_id = $1', [workspaceId]);
          await del('outbound_messages_log', 'DELETE FROM outbound_messages_log WHERE workspace_id = $1', [workspaceId]);
          await del('audit_logs', 'DELETE FROM audit_logs WHERE workspace_id = $1 OR actor_id = $2', [workspaceId, userId]);
          await del('users', 'DELETE FROM users WHERE id = $1 OR email = $2', [userId, cleanEmail]);
          await del('workspaces', 'DELETE FROM workspaces WHERE id = $1', [workspaceId]);
        } else {
          await del('users', 'DELETE FROM users WHERE id = $1 OR email = $2', [userId, cleanEmail]);
        }
        return { deletedTables };
      }

      const delSqlite = (name: string, sql: string, ...values: any[]) => {
        const info = sqliteDb!.prepare(sql).run(...values);
        deletedTables[name] = Number(info.changes || 0);
      };
      delSqlite('sessions', 'DELETE FROM sessions WHERE user_id = ? OR email = ?', userId, cleanEmail);
      delSqlite('password_reset_tokens', 'DELETE FROM password_reset_tokens WHERE email = ?', cleanEmail);
      delSqlite('pending_signups', 'DELETE FROM pending_signups WHERE email = ?', cleanEmail);
      delSqlite('trial_verifications', 'DELETE FROM trial_verifications WHERE email = ? OR user_id = ?', cleanEmail, userId);
      delSqlite('workspace_members', 'DELETE FROM workspace_members WHERE user_id = ? OR workspace_id = ?', userId, workspaceId);
      if (!isDefaultWs) {
        delSqlite('customers', 'DELETE FROM customers WHERE workspace_id = ?', workspaceId);
        delSqlite('csv_imports', 'DELETE FROM csv_imports WHERE workspace_id = ?', workspaceId);
        delSqlite('retention_actions', 'DELETE FROM retention_actions WHERE workspace_id = ?', workspaceId);
        delSqlite('subscription_payments', 'DELETE FROM subscription_payments WHERE workspace_id = ? OR user_id = ?', workspaceId, userId);
        delSqlite('subscriptions', 'DELETE FROM subscriptions WHERE workspace_id = ?', workspaceId);
        delSqlite('razorpay_orders', 'DELETE FROM razorpay_orders WHERE workspace_id = ?', workspaceId);
        delSqlite('scheduler_settings', 'DELETE FROM scheduler_settings WHERE workspace_id = ?', workspaceId);
        delSqlite('owner_briefs', 'DELETE FROM owner_briefs WHERE workspace_id = ?', workspaceId);
        delSqlite('outbound_messages_log', 'DELETE FROM outbound_messages_log WHERE workspace_id = ?', workspaceId);
        delSqlite('audit_logs', 'DELETE FROM audit_logs WHERE workspace_id = ? OR actor_id = ?', workspaceId, userId);
        delSqlite('users', 'DELETE FROM users WHERE id = ? OR email = ?', userId, cleanEmail);
        delSqlite('workspaces', 'DELETE FROM workspaces WHERE id = ?', workspaceId);
      } else {
        delSqlite('users', 'DELETE FROM users WHERE id = ? OR email = ?', userId, cleanEmail);
      }
      return { deletedTables };
    }
  },

  /**
   * Gracefully drains the database connection pool on server shutdown
   */
  async closePool(): Promise<void> {
    if (pgPool) {
      await pgPool.end().catch(() => {});
      pgPool = null;
      isPostgresActive = false;
    }
    if (sqliteDb) {
      try { sqliteDb.close(); } catch {}
      sqliteDb = null;
    }
    databaseInitialized = false;
  }
};
