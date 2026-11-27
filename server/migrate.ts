import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from 'pg';
import crypto from 'crypto';
import { SAMPLE_CUSTOMERS } from '../src/data/sampleCustomers.ts';
import { runPostgresMigrations, migrateSqliteFileToPostgres } from './db.ts';

async function migrate() {
  const rawDbUrl = (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ''
  ).trim();
  const isPostgresUrl = rawDbUrl.startsWith('postgresql://') || rawDbUrl.startsWith('postgres://');

  if (!rawDbUrl || !isPostgresUrl) {
    console.error('❌ [Churnveda Migration Error] A valid postgresql:// DATABASE_URL environment variable is required.');
    if (rawDbUrl && rawDbUrl.startsWith('http')) {
      console.error(`Received HTTP REST URL instead of PostgreSQL connection string: ${rawDbUrl}`);
    } else {
      console.error('Expected format: postgresql://user:password@host:port/database');
    }
    process.exit(1);
  }

  const dbUrl = rawDbUrl;

  console.log('🔄 [Churnveda Migration] Connecting to PostgreSQL...');

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('.railway.internal'))
      ? false
      : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.warn('[Churnveda Migration Pool Warning]:', err?.message || err);
  });

  try {
    const client = await pool.connect();
    const clientErrHandler = (err: Error) => {
      console.warn('[Churnveda Migration Client Warning]:', err?.message || err);
    };
    client.on('error', clientErrHandler);
    console.log('✅ [Churnveda Migration] Connected to PostgreSQL. Running database DDL migrations...');
    client.removeListener('error', clientErrHandler);
    client.release();

    // 1. Run core schema DDL migrations (workspaces, users, sessions, subscriptions, customers, etc.)
    await runPostgresMigrations(pool);
    console.log('✅ [Churnveda Migration] Schema DDL tables and constraints verified.');

    // 1b. Migrate any existing local SQLite data before default/demo seeding
    const sqliteMigration = await migrateSqliteFileToPostgres(pool);
    if (sqliteMigration.migrated) {
      console.log('✅ [Churnveda Migration] Local SQLite data migrated into PostgreSQL:', sqliteMigration.counts);
    }

    // 2. Seed default workspace if absent
    const wsRes = await pool.query("SELECT id FROM workspaces WHERE id = 'ws-default'");
    if (wsRes.rowCount === 0) {
      await pool.query(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES ('ws-default', 'AcquiredSaaS Inc', 'usr-admin-001', NOW(), NOW())"
      );
      console.log('✅ [Churnveda Migration] Seeded default workspace (ws-default).');
    }

    // 3. Seed default admin user if absent (random/env password; uses Firebase Google Auth)
    const userRes = await pool.query("SELECT id FROM users WHERE id = 'usr-admin-001'");
    if (userRes.rowCount === 0) {
      const defaultSalt = crypto.randomBytes(16).toString('hex');
      const bootstrapPass = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() || crypto.randomBytes(32).toString('hex');
      const defaultHash = crypto.scryptSync(bootstrapPass, defaultSalt, 64).toString('hex');
      const defaultPasswordCombined = `${defaultSalt}:${defaultHash}`;

      await pool.query(
        `INSERT INTO users (
          id, full_name, company_name, email, password_hash, phone, email_verified,
          selected_plan, billing_status, workspace_id, role, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
        [
          'usr-admin-001',
          'Nagesh Sharat',
          'AcquiredSaaS Inc',
          'nageshsharat@gmail.com',
          defaultPasswordCombined,
          '+1 (415) 890-2144',
          true,
          'growth',
          'active',
          'ws-default',
          'Admin'
        ]
      );
      console.log('✅ [Churnveda Migration] Seeded default admin user (nageshsharat@gmail.com).');
    }

    // 4. Remove any legacy demo admin session token if present
    await pool.query("DELETE FROM sessions WHERE token = 'sess_admin_default'");

    // 5. Seed authoritative billing plans if absent (Standard, Founding Member Edition, Enterprise)
    const { buildAuthoritativeBillingPlans } = await import('./billingPlans.ts');
    const plansToSeed = buildAuthoritativeBillingPlans();

    for (const plan of plansToSeed) {
      await pool.query(
        `INSERT INTO billing_plans (
          id, name, tier, billing_cycle, amount_paise, amount_inr, currency, razorpay_plan_id, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          amount_paise = EXCLUDED.amount_paise,
          amount_inr = EXCLUDED.amount_inr,
          razorpay_plan_id = EXCLUDED.razorpay_plan_id,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()`,
        [plan.id, plan.name, plan.tier, plan.billing_cycle, plan.amount_paise, plan.amount_inr, plan.currency, plan.razorpay_plan_id]
      );
    }
    console.log(`✅ [Churnveda Migration] Seeded/updated ${plansToSeed.length} authoritative billing plans.`);

    // 6. Safe demo customer seeding: Only if table is empty
    const custCountRes = await pool.query("SELECT COUNT(*) as count FROM customers WHERE workspace_id = 'ws-default'");
    const currentCustCount = parseInt(custCountRes.rows[0]?.count || '0', 10);

    if (currentCustCount === 0) {
      console.log(`📦 [Churnveda Migration] Seeding ${SAMPLE_CUSTOMERS.length} initial demo customers into PostgreSQL...`);
      for (const c of SAMPLE_CUSTOMERS) {
        const anyCust = c as any;
        await pool.query(
          `INSERT INTO customers (
            id, workspace_id, customer_id, name, domain, plan, mrr, status,
            risk_score, risk_category, last_login_days, usage_drop_percent,
            open_tickets_count, payment_status, contract_renewal_days,
            primary_contact_name, primary_contact_role, primary_contact_email,
            data_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
          ON CONFLICT (workspace_id, customer_id) DO NOTHING`,
          [
            c.id,
            'ws-default',
            c.id,
            c.name,
            c.companyDomain || null,
            c.plan,
            c.mrr,
            c.status,
            c.riskScore,
            c.riskCategory,
            c.lastLoginDays,
            Math.abs(c.usageTrendPercentage),
            c.openTicketsCount,
            c.paymentStatus,
            anyCust.contractRenewalDays || anyCust.daysUntilRenewal || 90,
            anyCust.primaryContact?.name || null,
            anyCust.primaryContact?.role || null,
            anyCust.primaryContact?.email || null,
            JSON.stringify(c)
          ]
        );
      }
      console.log(`✅ [Churnveda Migration] Successfully seeded ${SAMPLE_CUSTOMERS.length} initial customers.`);
    } else {
      console.log(`ℹ️ [Churnveda Migration] Customers table already contains ${currentCustCount} records. Skipping demo seed.`);
    }

    await pool.end();
    console.log('🎉 [Churnveda Migration] Database migration completed successfully on PostgreSQL.');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ [Churnveda Migration Failed]:', err?.message || err);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

migrate();
