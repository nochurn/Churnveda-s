import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let testPort = 0;
let baseUrl = '';
const TEST_RZP_SECRET = 'audit_secret_not_real';
const TEST_RZP_WEBHOOK_SECRET = 'audit_webhook_secret_not_real';
const TEST_CRON_SECRET = 'audit_cron_secret_123';

let tempDataDir = '';
let serverProc: ChildProcess | null = null;
const serverLogs: string[] = [];

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForServerReady(timeoutMs = 25000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        if (data?.status === 'ok') {
          // Ensure bootReadyPromise (DB init + Vite/static middleware) has completed
          const cfgRes = await fetch(`${baseUrl}/api/razorpay/config`);
          if (cfgRes.ok) return;
        }
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Isolated test server failed to start within ${timeoutMs}ms.\nLogs:\n${serverLogs.join('')}`);
}

async function apiJson(
  endpoint: string,
  options: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; data: any; rawText: string; elapsedMs: number }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {})
  };
  const started = performance.now();
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const elapsedMs = performance.now() - started;
  const rawText = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = rawText;
  }
  return { status: res.status, data, rawText, elapsedMs };
}

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('Churnveda End-to-End QA, Security, Billing & Feature Audit Suite', () => {
  let tokenA = '';
  let workspaceA = '';
  let userAId = '';
  let tokenB = '';
  let workspaceB = '';
  let userBId = '';

  before(async () => {
    testPort = await getFreePort();
    baseUrl = `http://127.0.0.1:${testPort}`;
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'churnveda-audit-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(testPort),
      NODE_ENV: 'development',
      CHURNVEDA_DATA_DIR: tempDataDir,
      DATABASE_URL: '',
      POSTGRES_URL: '',
      DATABASE_URL_UNPOOLED: '',
      RESEND_API_KEY: '',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_PHONE_NUMBER_ID: '',
      WHATSAPP_BUSINESS_ACCOUNT_ID: '',
      GEMINI_API_KEY: '',
      CRON_SECRET: TEST_CRON_SECRET,
      RAZORPAY_KEY_ID: 'rzp_test_audit_only',
      RAZORPAY_KEY_SECRET: TEST_RZP_SECRET,
      RAZORPAY_WEBHOOK_SECRET: TEST_RZP_WEBHOOK_SECRET,
      ALLOW_IN_MEMORY_BILLING_TEST: 'false',
      TURNSTILE_SECRET_KEY: '',
      RECAPTCHA_SECRET_KEY: '',
      HCAPTCHA_SECRET_KEY: ''
    };

    const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    serverProc = spawn(tsxBin, ['server.ts'], {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProc.stdout?.on('data', (d) => serverLogs.push(d.toString()));
    serverProc.stderr?.on('data', (d) => serverLogs.push(d.toString()));

    await waitForServerReady();
  });

  after(async () => {
    if (serverProc && serverProc.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGTERM');
      } catch {
        try {
          serverProc.kill('SIGTERM');
        } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch {}
      serverProc.stdout?.destroy();
      serverProc.stderr?.destroy();
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('Section A: Authentication, validation, token rejection, forgot-password & logout invalidation', async () => {
    // 1. Unauthenticated protected route must return 401
    const unauth = await apiJson('/api/customers');
    assert.equal(unauth.status, 401);

    // 2. Weak password / validation failure on signup returns 400
    const badSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      body: {
        fullName: 'Test Weak',
        companyName: 'Weak Co',
        email: 'weak@example.com',
        password: 'short',
        confirmPassword: 'short',
        agreedToTerms: true
      }
    });
    assert.equal(badSignup.status, 400);

    // 3. Register User A (Starter plan) and User B (Growth plan)
    const signupA = await apiJson('/api/auth/signup', {
      method: 'POST',
      body: {
        fullName: 'Alice Founder',
        companyName: 'Alice SaaS',
        email: 'alice.audit@example.com',
        password: 'StrongPassword!1',
        confirmPassword: 'StrongPassword!1',
        agreedToTerms: true,
        selectedPlan: 'starter',
        billingCycle: 'monthly'
      }
    });
    assert.equal(signupA.status, 201);
    assert.ok(signupA.data.token);
    tokenA = signupA.data.token;
    workspaceA = signupA.data.user.workspaceId;
    userAId = signupA.data.user.id;

    const signupB = await apiJson('/api/auth/signup', {
      method: 'POST',
      body: {
        fullName: 'Bob Operator',
        companyName: 'Bob Cloud',
        email: 'bob.audit@example.com',
        password: 'StrongPassword!2',
        confirmPassword: 'StrongPassword!2',
        agreedToTerms: true,
        selectedPlan: 'growth',
        billingCycle: 'monthly'
      }
    });
    assert.equal(signupB.status, 201);
    assert.ok(signupB.data.token);
    tokenB = signupB.data.token;
    workspaceB = signupB.data.user.workspaceId;
    userBId = signupB.data.user.id;
    assert.notEqual(workspaceA, workspaceB);

    // 4. Duplicate email signup returns 409
    const dupSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      body: {
        fullName: 'Alice Dup',
        companyName: 'Dup Co',
        email: 'alice.audit@example.com',
        password: 'StrongPassword!1',
        confirmPassword: 'StrongPassword!1',
        agreedToTerms: true
      }
    });
    assert.equal(dupSignup.status, 409);

    // 5. Wrong password returns 401
    const badLogin = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice.audit@example.com', password: 'WrongPassword!9' }
    });
    assert.equal(badLogin.status, 401);

    // 6. Query parameter ?token= MUST NOT authenticate requests
    const queryTokenAttempt = await apiJson(`/api/customers?token=${encodeURIComponent(tokenA)}`);
    assert.equal(queryTokenAttempt.status, 401);

    // 7. Forgot password returns generic 200 for existing and non-existing email (no enumeration)
    const fpExisting = await apiJson('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'alice.audit@example.com' }
    });
    const fpMissing = await apiJson('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'nonexistent.user@example.com' }
    });
    assert.equal(fpExisting.status, 200);
    assert.equal(fpMissing.status, 200);
    assert.equal(fpExisting.data.message, fpMissing.data.message);

    // 8. Ephemeral login + logout invalidation check
    const tempLogin = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice.audit@example.com', password: 'StrongPassword!1' }
    });
    assert.equal(tempLogin.status, 200);
    const tempToken = tempLogin.data.token;
    assert.ok(tempToken);

    const meBeforeLogout = await apiJson('/api/auth/me', { token: tempToken });
    assert.equal(meBeforeLogout.status, 200);

    const logoutRes = await apiJson('/api/auth/logout', { method: 'POST', token: tempToken });
    assert.equal(logoutRes.status, 200);

    const meAfterLogout = await apiJson('/api/auth/me', { token: tempToken });
    assert.equal(meAfterLogout.status, 401);
  });

  test('Security Audit: Multi-tenant IDOR enforcement (403), cross-tenant data/storage/admin isolation, and secret hygiene', async () => {
    // Seed a customer in Workspace B
    const addB = await apiJson('/api/customers/manual', {
      method: 'POST',
      token: tokenB,
      body: {
        customerId: 'bob_cust_001',
        customerName: 'Bob Private Client',
        email: 'private@bobclient.io',
        plan: 'Growth',
        mrr: 1200,
        ticketsLast30Days: 4,
        paymentStatus: 'Failed',
        failedPaymentsCount: 2
      }
    });
    assert.equal(addB.status, 200);

    // 1. User A attempting to target User B's workspace via header or query gets 403 FORBIDDEN (not silent fallback)
    const idorHeader = await apiJson('/api/customers', {
      token: tokenA,
      headers: { 'x-workspace-id': workspaceB }
    });
    assert.equal(idorHeader.status, 403);

    const idorQuery = await apiJson(`/api/customers?workspaceId=${encodeURIComponent(workspaceB)}`, {
      token: tokenA
    });
    assert.equal(idorQuery.status, 403);

    // 2. Direct object access across tenants
    const crossGet = await apiJson('/api/customers/bob_cust_001', { token: tokenA });
    assert.equal(crossGet.status, 404);

    const crossPatch = await apiJson('/api/customers/bob_cust_001', {
      method: 'PATCH',
      token: tokenA,
      body: { status: 'saved' }
    });
    assert.equal(crossPatch.status, 404);

    const crossDelete = await apiJson('/api/customers/bob_cust_001', {
      method: 'DELETE',
      token: tokenA
    });
    assert.equal(crossDelete.status, 404);

    const crossBulkDelete = await apiJson('/api/customers/bulk-delete', {
      method: 'POST',
      token: tokenA,
      body: { ids: ['bob_cust_001'] }
    });
    assert.equal(crossBulkDelete.status, 200);
    assert.equal(crossBulkDelete.data.deletedCount, 0);

    // Confirm Bob's customer is intact
    const bobCheck = await apiJson('/api/customers/bob_cust_001', { token: tokenB });
    assert.equal(bobCheck.status, 200);
    assert.equal(bobCheck.data.email, 'private@bobclient.io');

    // 3. Storage upload & cross-tenant file isolation
    const uploadB = await apiJson('/api/storage/upload', {
      method: 'POST',
      token: tokenB,
      body: {
        bucket: 'user-uploads',
        fileName: 'bob-secret.csv',
        mimeType: 'text/csv',
        contentText: 'email,mrr,signup_date\nsecret@bob.io,500,2025-01-01\n'
      }
    });
    assert.equal(uploadB.status, 201);
    const bobPath = uploadB.data.path;
    assert.ok(bobPath);

    const filesA = await apiJson('/api/storage/files?bucket=user-uploads', { token: tokenA });
    assert.equal(filesA.status, 200);
    assert.equal(
      (filesA.data.files || []).some((f: any) => f.path === bobPath),
      false
    );

    const crossSignedUrl = await apiJson(
      `/api/storage/signed-url?bucket=user-uploads&path=${encodeURIComponent(bobPath)}`,
      { token: tokenA }
    );
    assert.equal(crossSignedUrl.status, 403);

    const crossDownloadForeignWs = await apiJson(
      `/api/storage/download?bucket=user-uploads&path=${encodeURIComponent(bobPath)}&workspaceId=${encodeURIComponent(workspaceB)}`,
      { token: tokenA }
    );
    assert.equal(crossDownloadForeignWs.status, 403);

    // 4. Platform admin endpoints reject normal workspace owners
    const platformAttempt = await apiJson('/api/admin/platform/overview', { token: tokenA });
    assert.equal(platformAttempt.status, 403);

    // 5. Public config endpoint must never leak secrets
    const rzpConfig = await apiJson('/api/razorpay/config');
    assert.equal(rzpConfig.status, 200);
    assert.equal(rzpConfig.rawText.includes(TEST_RZP_SECRET), false);
    assert.equal(rzpConfig.rawText.includes(TEST_RZP_WEBHOOK_SECRET), false);
  });

  test('Section C & D: Customer CRUD, CSV strict validation (no fake rows), PDF validation, deduplication & CSV formula injection defense', async () => {
    // 1. Empty CSV rejected 400
    const emptyCsv = await apiJson('/api/customers/import', {
      method: 'POST',
      token: tokenA,
      body: { rawCsv: '   ', fileName: 'empty.csv' }
    });
    assert.equal(emptyCsv.status, 400);

    // 2. Header-only CSV rejected 400
    const headerOnlyCsv = await apiJson('/api/customers/import', {
      method: 'POST',
      token: tokenA,
      body: { rawCsv: 'email,mrr,signup_date\n', fileName: 'headers-only.csv' }
    });
    assert.equal(headerOnlyCsv.status, 400);

    // 3. Missing required columns rejected 400
    const missingColCsv = await apiJson('/api/customers/import', {
      method: 'POST',
      token: tokenA,
      body: { rawCsv: 'name,plan\nAcme,Growth\n', fileName: 'missing-cols.csv' }
    });
    assert.equal(missingColCsv.status, 400);

    // 4. CSV with valid + invalid rows (bad email, missing email, negative MRR, invalid date, plus formula injection name)
    const mixedCsv = [
      'customer_id,customer_name,email,plan,mrr,signup_date,health_score,support_tickets_30d',
      'a_01,"=CMD|\' /C calc\'!A0",ops@acme-valid.com,Pro,2500,2025-02-01,20,5',
      'a_02,Good LowRisk,hello@lowrisk-valid.io,Starter,200,2025-04-10,92,0',
      'a_03,Missing Email,,Growth,500,2025-03-01,70,0',
      'a_04,Bad Email,not-an-email,Growth,500,2025-03-01,70,0',
      'a_05,Negative MRR,neg@valid.io,Growth,-100,2025-03-01,70,0',
      'a_06,Bad Date,date@valid.io,Growth,450,not-a-date,70,0'
    ].join('\n');

    const csvImportRes = await apiJson('/api/customers/import', {
      method: 'POST',
      token: tokenA,
      body: { rawCsv: mixedCsv, fileName: 'mixed.csv', deduplicationMode: 'skip' }
    });
    assert.equal(csvImportRes.status, 200);
    assert.equal(csvImportRes.data.totalRows, 6);
    assert.equal(csvImportRes.data.validRowsCount, 2);
    assert.equal(csvImportRes.data.failedRowsCount, 4);
    assert.equal(csvImportRes.data.errors.length, 4);

    // Confirm zero fabricated @example.com customers exist in Workspace A
    const listA = await apiJson('/api/customers', { token: tokenA });
    assert.equal(listA.status, 200);
    assert.equal(listA.data.total, 2);
    assert.equal(
      listA.data.customers.some((c: any) => String(c.email).includes('@example.com')),
      false
    );

    // 5. Deduplication test: skip vs overwrite
    const dupSkipRes = await apiJson('/api/customers/import', {
      method: 'POST',
      token: tokenA,
      body: {
        rawCsv: 'customer_id,customer_name,email,plan,mrr,signup_date\na_02,Changed Name,hello@lowrisk-valid.io,Growth,999,2025-04-10',
        fileName: 'dup-skip.csv',
        deduplicationMode: 'skip'
      }
    });
    assert.equal(dupSkipRes.status, 200);
    assert.equal(dupSkipRes.data.skippedCount, 1);
    assert.equal(dupSkipRes.data.importedCount, 0);

    const dupOverwriteRes = await apiJson('/api/customers/import', {
      method: 'POST',
      token: tokenA,
      body: {
        rawCsv: 'customer_id,customer_name,email,plan,mrr,signup_date\na_02,Updated Name,hello@lowrisk-valid.io,Growth,999,2025-04-10',
        fileName: 'dup-overwrite.csv',
        deduplicationMode: 'overwrite'
      }
    });
    assert.equal(dupOverwriteRes.status, 200);
    assert.equal(dupOverwriteRes.data.overwrittenCount, 1);

    // 6. PDF with no email/customer records must fail 400 and NEVER fabricate Apex Vantage Corp
    const fakePdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'utf8').toString('base64');
    const badPdfRes = await apiJson('/api/customers/import', {
      method: 'POST',
      token: tokenA,
      body: { rawPdfBase64: fakePdfBytes, fileName: 'empty-report.pdf' }
    });
    assert.equal(badPdfRes.status, 400);

    // 7. CSV Export: tenant isolated AND formula injection escaped with leading single quote
    const exportCsvRes = await apiJson('/api/export?format=csv', { token: tokenA });
    assert.equal(exportCsvRes.status, 200);
    assert.equal(exportCsvRes.rawText.includes('private@bobclient.io'), false);
    assert.equal(exportCsvRes.rawText.includes("\"'=CMD|"), true);
  });

  test('Section E, F, G: AI Churn Risk Analysis, Daily Top 10 sorted ranking, and Cron Scan limits', async () => {
    // Seed 11 more high-risk customers into Workspace A (Standard Starter default limit topAtRiskCustomers = 10)
    for (let i = 1; i <= 11; i++) {
      const res = await apiJson('/api/customers/manual', {
        method: 'POST',
        token: tokenA,
        body: {
          customerId: `risk_a_${i}`,
          customerName: `Risk Account ${i}`,
          email: `risk${i}@acme.test`,
          plan: 'Growth',
          mrr: 100 * i,
          paymentStatus: i >= 8 ? 'Failed' : 'Current',
          failedPaymentsCount: i >= 8 ? 3 : 0,
          ticketsLast30Days: i >= 4 ? 5 : 4,
          satisfactionScore: i >= 10 ? 2 : 5
        }
      });
      assert.equal(res.status, 200);
    }

    // 1. Single predict & recommend
    const predictRes = await apiJson('/api/churn/predict', {
      method: 'POST',
      token: tokenA,
      body: { customerId: 'a_01' }
    });
    assert.equal(predictRes.status, 200);
    const analysis = predictRes.data.analysis;
    assert.ok(typeof analysis?.riskScore === 'number' && analysis.riskScore >= 0 && analysis.riskScore <= 100);
    assert.ok(Array.isArray(analysis?.topFactors) && analysis.topFactors.length > 0);

    const recRes = await apiJson('/api/churn/recommend', {
      method: 'POST',
      token: tokenA,
      body: { customerId: 'a_01' }
    });
    assert.equal(recRes.status, 200);
    assert.ok(recRes.data.recommendation?.action);
    assert.ok(recRes.data.recommendation?.emailScript);

    // 2. Daily Top N digest respects Standard Starter plan limit (10) and sorts highest riskScore first
    const alertRes = await apiJson('/api/alerts/trigger-daily', {
      method: 'POST',
      token: tokenA,
      body: {}
    });
    assert.equal(alertRes.status, 200);
    const ranked = alertRes.data.alert.customers;
    assert.equal(ranked.length, 10);
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(
        ranked[i - 1].score >= ranked[i].score,
        `Expected descending risk scores, got ${ranked[i - 1].score} before ${ranked[i].score}`
      );
    }

    // 3. Cron Daily Scan unauthorized without secret/auth returns 401; authorized with CRON_SECRET runs & deduplicates same-day
    const cronUnauth = await apiJson('/api/cron/daily-scan', { method: 'POST', body: {} });
    assert.equal(cronUnauth.status, 401);

    const cronRun1 = await apiJson('/api/cron/daily-scan', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_CRON_SECRET}`,
        'x-workspace-id': workspaceA
      },
      body: { ownerEmail: 'alice.audit@example.com' }
    });
    assert.equal(cronRun1.status, 200);
    assert.ok(cronRun1.data.brief);
    assert.equal(cronRun1.data.brief.top5Count, 10);

    const cronRun2 = await apiJson('/api/cron/daily-scan', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_CRON_SECRET}`,
        'x-workspace-id': workspaceA
      },
      body: { ownerEmail: 'alice.audit@example.com' }
    });
    assert.equal(cronRun2.status, 200);
    assert.equal(cronRun2.data.deduplicated, true);
  });

  test('Section H: Messages approval gate, queue processing without faking delivery, and duplicate suppression', async () => {
    // 1. Unapproved draft MUST be rejected
    const unapprovedEnqueue = await apiJson('/api/queue/enqueue', {
      method: 'POST',
      token: tokenA,
      body: {
        messages: [
          {
            messageId: 'msg-unapproved-1',
            channel: 'email',
            customerId: 'a_01',
            customerName: 'Acme',
            recipientEmail: 'ops@acme-valid.com',
            content: 'Hello',
            isApproved: false
          }
        ]
      }
    });
    assert.equal(unapprovedEnqueue.status, 400);

    // 2. Approved draft enters queue and does NOT fake SENT when Resend/WhatsApp credentials are absent
    const approvedEnqueue = await apiJson('/api/queue/enqueue', {
      method: 'POST',
      token: tokenA,
      body: {
        messages: [
          {
            messageId: 'msg-approved-1',
            channel: 'email',
            customerId: 'a_01',
            customerName: 'Acme',
            recipientEmail: 'ops@acme-valid.com',
            subject: 'Checking in',
            content: 'Would love to schedule a quick call.',
            isApproved: true
          }
        ]
      }
    });
    assert.equal(approvedEnqueue.status, 200);
    assert.equal(approvedEnqueue.data.enqueuedCount, 1);
    assert.notEqual(approvedEnqueue.data.items[0].status, 'SENT');

    // 3. Duplicate message suppression
    const dupEnqueue = await apiJson('/api/queue/enqueue', {
      method: 'POST',
      token: tokenA,
      body: {
        messages: [
          {
            messageId: 'msg-approved-1',
            channel: 'email',
            customerId: 'a_01',
            customerName: 'Acme',
            recipientEmail: 'ops@acme-valid.com',
            subject: 'Checking in',
            content: 'Would love to schedule a quick call.',
            isApproved: true
          }
        ]
      }
    });
    assert.equal(dupEnqueue.status, 200);
    assert.equal(dupEnqueue.data.duplicatesBlocked, 1);

    // 4. Direct /api/messages/send refuses to fake send when providers are unconfigured
    const directSend = await apiJson('/api/messages/send', {
      method: 'POST',
      token: tokenA,
      body: {
        messageId: 'msg-direct-unconfigured',
        channel: 'whatsapp',
        customerId: 'a_01',
        recipientPhone: '+14155551234',
        content: 'Test outreach',
        isApproved: true
      }
    });
    assert.equal(directSend.status, 400);
    assert.equal(directSend.data.status, 'FAILED');
  });

  test('Section L: Razorpay $1 trial verification, USD/INR handling, HMAC verification, idempotency, order integrity & webhook replay protection', async () => {
    // 0. Requesting Founding Member Edition without RAZORPAY_FOUNDING_STARTER_MONTHLY_PLAN_ID fails cleanly (never reuses $29 Plan ID)
    const missingFoundingPlan = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token: tokenA,
      body: { tier: 'starter', billing_cycle: 'monthly', plan_edition: 'founding', currency: 'USD' }
    });
    assert.equal(missingFoundingPlan.status, 400);
    assert.equal(missingFoundingPlan.data.code, 'RAZORPAY_PLAN_NOT_CONFIGURED');

    // 1. Create $1 USD trial verification order for User A on Standard ($29/mo)
    const trialOrderUsd = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token: tokenA,
      body: { tier: 'starter', billing_cycle: 'monthly', plan_edition: 'standard', currency: 'USD' }
    });
    assert.equal(trialOrderUsd.status, 200);
    assert.equal(trialOrderUsd.data.amount, 100);
    assert.equal(trialOrderUsd.data.currency, 'USD');
    const orderIdUsd = trialOrderUsd.data.orderId;

    // 2. Reject invalid HMAC signature
    const badSig = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token: tokenA,
      body: {
        razorpay_order_id: orderIdUsd,
        razorpay_payment_id: 'pay_test_trial_1',
        razorpay_signature: 'invalid_forged_sig'
      }
    });
    assert.equal(badSig.status, 400);

    // 3. Cross-tenant user B CANNOT verify User A's order (403)
    const validSigA = hmacHex(TEST_RZP_SECRET, `${orderIdUsd}|pay_test_trial_1`);
    const crossVerify = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token: tokenB,
      body: {
        razorpay_order_id: orderIdUsd,
        razorpay_payment_id: 'pay_test_trial_1',
        razorpay_signature: validSigA
      }
    });
    assert.equal(crossVerify.status, 403);

    // 4. User A verifies with valid HMAC
    const verify1 = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token: tokenA,
      body: {
        razorpay_order_id: orderIdUsd,
        razorpay_payment_id: 'pay_test_trial_1',
        razorpay_signature: validSigA
      }
    });
    assert.equal(verify1.status, 200);
    assert.equal(verify1.data.trial_started, true);
    const firstTrialEndsAt = verify1.data.trial_ends_at;

    // 5. Idempotent replay preserves exact stored trial_ends_at without extending 14 days again
    await new Promise((r) => setTimeout(r, 25));
    const verifyReplay = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token: tokenA,
      body: {
        razorpay_order_id: orderIdUsd,
        razorpay_payment_id: 'pay_test_trial_1',
        razorpay_signature: validSigA
      }
    });
    assert.equal(verifyReplay.status, 200);
    assert.equal(verifyReplay.data.already_verified, true);
    assert.equal(verifyReplay.data.trial_ends_at, firstTrialEndsAt);

    // 6. Guest INR trial order succeeds (FK workspace created cleanly)
    const guestInrOrder = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      body: { tier: 'growth', billing_cycle: 'monthly', currency: 'INR', email: 'indian.founder@example.com' }
    });
    assert.equal(guestInrOrder.status, 200);
    assert.equal(guestInrOrder.data.currency, 'INR');
    assert.ok(guestInrOrder.data.amount >= 5000);

    // 7. Create Checkout Order ignores client price tampering and enforces Standard Growth = $79
    const checkoutOrder = await apiJson('/api/razorpay/create-order', {
      method: 'POST',
      token: tokenA,
      body: {
        plan: 'growth',
        billingCycle: 'monthly',
        planEdition: 'standard',
        amount: 1, // tampered client field must be ignored
        price: 1
      }
    });
    assert.equal(checkoutOrder.status, 200);
    assert.equal(checkoutOrder.data.amountUsd, 79);
    assert.equal(checkoutOrder.data.currency, 'INR');

    const checkoutSig = hmacHex(TEST_RZP_SECRET, `${checkoutOrder.data.orderId}|pay_test_upgrade_1`);
    const verifyCheckout = await apiJson('/api/razorpay/verify-payment', {
      method: 'POST',
      token: tokenA,
      body: {
        razorpay_order_id: checkoutOrder.data.orderId,
        razorpay_payment_id: 'pay_test_upgrade_1',
        razorpay_signature: checkoutSig
      }
    });
    assert.equal(verifyCheckout.status, 200);
    assert.equal(verifyCheckout.data.plan, 'growth');
    assert.equal(verifyCheckout.data.billingStatus, 'active');

    // 8. Webhook security & idempotency
    const missingSigWh = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      body: { event: 'payment.captured', payload: {} }
    });
    assert.equal(missingSigWh.status, 401);

    const forgedSigWh = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'deadbeef' },
      body: { event: 'payment.captured', payload: {} }
    });
    assert.equal(forgedSigWh.status, 400);

    const whPayload = {
      id: 'evt_audit_cancel_001',
      event: 'subscription.cancelled',
      payload: {
        subscription: {
          entity: {
            id: 'sub_rzp_audit_001',
            notes: {
              workspaceId: workspaceA,
              customerEmail: 'alice.audit@example.com'
            }
          }
        }
      }
    };
    const whRaw = JSON.stringify(whPayload);
    const whSig = hmacHex(TEST_RZP_WEBHOOK_SECRET, whRaw);

    const whFirst = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': whSig, 'x-razorpay-event-id': 'evt_audit_cancel_001' },
      body: whPayload
    });
    assert.equal(whFirst.status, 200);

    // Replay same webhook event ID -> idempotent skip
    const whReplay = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': whSig, 'x-razorpay-event-id': 'evt_audit_cancel_001' },
      body: whPayload
    });
    assert.equal(whReplay.status, 200);
    assert.equal(whReplay.data.message, 'Event already processed');

    // Confirm User A's billing_status is now cancelled
    const meAfterCancel = await apiJson('/api/auth/me', { token: tokenA });
    assert.equal(meAfterCancel.status, 200);
    assert.equal(meAfterCancel.data.user.billingStatus, 'cancelled');
  });

  test('Post-QA Task 3: Server-backed active sessions without fabricated metadata or raw token leakage', async () => {
    const sessSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.10.0.3' },
      body: {
        fullName: 'Session Tester',
        companyName: 'Session Co',
        email: 'sessions.audit@example.com',
        password: 'StrongPassword!5',
        confirmPassword: 'StrongPassword!5',
        agreedToTerms: true,
        selectedPlan: 'growth',
        billingCycle: 'monthly'
      }
    });
    assert.equal(sessSignup.status, 201);
    const sessToken1 = sessSignup.data.token;

    const login2 = await apiJson('/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.10.0.3' },
      body: { email: 'sessions.audit@example.com', password: 'StrongPassword!5' }
    });
    assert.equal(login2.status, 200);
    const sessToken2 = login2.data.token;

    const sessionsRes = await apiJson('/api/auth/sessions', { token: sessToken2 });
    assert.equal(sessionsRes.status, 200);
    assert.equal(sessionsRes.data.success, true);
    assert.ok(Array.isArray(sessionsRes.data.sessions));
    assert.ok(sessionsRes.data.sessions.length >= 2);
    // Raw session tokens must NEVER appear in response payload
    assert.equal(sessionsRes.rawText.includes(sessToken1), false);
    assert.equal(sessionsRes.rawText.includes(sessToken2), false);
    for (const s of sessionsRes.data.sessions) {
      assert.ok(String(s.id).startsWith('sess_'));
      assert.equal(s.device, undefined);
      assert.equal(s.ipAddress, undefined);
      assert.equal(s.location, undefined);
    }

    const currentSess = sessionsRes.data.sessions.find((s: any) => s.isCurrent);
    assert.ok(currentSess);

    // Revoke other sessions and verify sessToken1 is invalidated while sessToken2 remains valid
    const revokeOthers = await apiJson('/api/auth/sessions/revoke-others', {
      method: 'POST',
      token: sessToken2
    });
    assert.equal(revokeOthers.status, 200);
    assert.ok(revokeOthers.data.revokedCount >= 1);

    const checkRevoked = await apiJson('/api/auth/me', { token: sessToken1 });
    assert.equal(checkRevoked.status, 401);
    const checkCurrent = await apiJson('/api/auth/me', { token: sessToken2 });
    assert.equal(checkCurrent.status, 200);

    // Clean up sessToken2 via single-session DELETE
    const deleteSelf = await apiJson(`/api/auth/sessions/${encodeURIComponent(currentSess.id)}`, {
      method: 'DELETE',
      token: sessToken2
    });
    assert.equal(deleteSelf.status, 200);
    const checkSelfAfterDelete = await apiJson('/api/auth/me', { token: sessToken2 });
    assert.equal(checkSelfAfterDelete.status, 401);
  });

  test('Post-QA Task 4 & 5: Canonical risk scoring thresholds and tier-accurate ROI defaults', async () => {
    const { getCanonicalRiskCategory, isAtRiskScore, isCriticalRiskScore } = await import('../src/config/riskThresholds.ts');
    const { getRiskLevel, getHighRiskCustomers, getMediumRiskCustomers, getLowRiskCustomers, getROIInsights } = await import('../src/utils/customerSelectors.ts');
    const { identifyTop5Priorities } = await import('../src/utils/aiEmployeeEngine.ts');

    // Canonical boundary checks: Low 0-30, Medium 31-60, High 61-85, Critical 86-100
    assert.equal(getCanonicalRiskCategory(30), 'Low');
    assert.equal(getCanonicalRiskCategory(31), 'Medium');
    assert.equal(getCanonicalRiskCategory(60), 'Medium');
    assert.equal(getCanonicalRiskCategory(61), 'High');
    assert.equal(getCanonicalRiskCategory(85), 'High');
    assert.equal(getCanonicalRiskCategory(86), 'Critical');

    assert.equal(isAtRiskScore(60), false);
    assert.equal(isAtRiskScore(61), true);
    assert.equal(isCriticalRiskScore(85), false);
    assert.equal(isCriticalRiskScore(86), true);

    assert.equal(getRiskLevel(30), 'Low');
    assert.equal(getRiskLevel(31), 'Medium');
    assert.equal(getRiskLevel(60), 'Medium');
    assert.equal(getRiskLevel(61), 'High');
    assert.equal(getRiskLevel(85), 'High');
    assert.equal(getRiskLevel(86), 'Critical');

    const sample = [
      { id: 'c1', name: 'C1', email: 'c1@test.io', mrr: 100, riskScore: 30, risk_score: 30, riskCategory: 'Low', status: 'active' },
      { id: 'c2', name: 'C2', email: 'c2@test.io', mrr: 200, riskScore: 60, risk_score: 60, riskCategory: 'Medium', status: 'active' },
      { id: 'c3', name: 'C3', email: 'c3@test.io', mrr: 300, riskScore: 61, risk_score: 61, riskCategory: 'High', status: 'active' },
      { id: 'c4', name: 'C4', email: 'c4@test.io', mrr: 400, riskScore: 86, risk_score: 86, riskCategory: 'Critical', status: 'active' }
    ] as any[];

    assert.equal(getLowRiskCustomers(sample).length, 1);
    assert.equal(getMediumRiskCustomers(sample).length, 1);
    assert.equal(getHighRiskCustomers(sample).length, 2); // >= 61 covers High + Critical

    const priorities10 = identifyTop5Priorities(sample, 'Empathetic', [], 10);
    assert.equal(priorities10.find((p) => p.customer.id === 'c2')?.riskLevel, 'Medium');
    assert.equal(priorities10.find((p) => p.customer.id === 'c3')?.riskLevel, 'High');
    assert.equal(priorities10.find((p) => p.customer.id === 'c4')?.riskLevel, 'Critical');

    // Default ROI insight cost must be Growth $79 (never legacy $4999 or $299)
    const roiDefault = getROIInsights(sample);
    assert.equal(roiDefault.productCost, 79);

    // Backend /api/roi for Bob (Growth $79)
    const roiApi = await apiJson('/api/roi', { token: tokenB });
    assert.equal(roiApi.status, 200);
    assert.equal(roiApi.data.subscriptionCost, 79);
  });

  test('Post-QA Task 8: Plan limits enforcement (Standard default: Starter $29, Growth $79, Enterprise $349)', async () => {
    // 1. Fresh Starter account verification (new signups default to Standard Regular Pricing)
    const starterSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.10.0.4' },
      body: {
        fullName: 'Starter Tester',
        companyName: 'Starter Co',
        email: 'starter.limits@example.com',
        password: 'StrongPassword!3',
        confirmPassword: 'StrongPassword!3',
        agreedToTerms: true,
        selectedPlan: 'starter',
        billingCycle: 'monthly'
      }
    });
    assert.equal(starterSignup.status, 201);
    assert.equal(starterSignup.data.user.planEdition, 'standard');
    const starterToken = starterSignup.data.token;

    const starterLimits = await apiJson('/api/billing/limits', { token: starterToken });
    assert.equal(starterLimits.status, 200);
    assert.equal(starterLimits.data.tier, 'starter');
    assert.equal(starterLimits.data.edition, 'standard');
    assert.equal(starterLimits.data.usage.customersLimit, 250);
    assert.equal(starterLimits.data.usage.scansDailyLimit, 2);
    assert.equal(starterLimits.data.usage.topAtRiskCustomers, 10);
    assert.equal(starterLimits.data.usage.messagesMonthlyLimit, 150);
    assert.equal(starterLimits.data.usage.customerHistoryDays, 180);

    // Starter ROI cost = $29 (Standard Regular Pricing)
    const starterRoi = await apiJson('/api/roi', { token: starterToken });
    assert.equal(starterRoi.status, 200);
    assert.equal(starterRoi.data.subscriptionCost, 29);

    // Starter history window on /api/scheduler/briefs = 180 days (Standard)
    const starterBriefs = await apiJson('/api/scheduler/briefs', { token: starterToken });
    assert.equal(starterBriefs.status, 200);
    assert.equal(starterBriefs.data.historyWindowDays, 180);

    // Starter Standard daily scan limit = 2/day on manual calls (3rd scan blocked)
    const manualScan1 = await apiJson('/api/cron/daily-scan', {
      method: 'POST',
      token: starterToken,
      body: {}
    });
    assert.equal(manualScan1.status, 200);

    const manualScan2 = await apiJson('/api/cron/daily-scan', {
      method: 'POST',
      token: starterToken,
      body: {}
    });
    assert.equal(manualScan2.status, 200);

    const manualScan3 = await apiJson('/api/cron/daily-scan', {
      method: 'POST',
      token: starterToken,
      body: {}
    });
    assert.equal(manualScan3.status, 403);

    // Starter Standard combined monthly message cap = 150 total across WhatsApp + Email
    const batchMessages = Array.from({ length: 150 }, (_, idx) => ({
      messageId: `starter-msg-${idx}`,
      channel: idx % 2 === 0 ? 'whatsapp' : 'email',
      customerId: `cust_s_${idx}`,
      customerName: `Cust ${idx}`,
      recipientPhone: '+14155550100',
      recipientEmail: `cust${idx}@starter.test`,
      subject: 'Check in',
      content: 'Hello from Starter Standard',
      isApproved: true
    }));
    const enqueue150 = await apiJson('/api/queue/enqueue', {
      method: 'POST',
      token: starterToken,
      body: { messages: batchMessages }
    });
    assert.equal(enqueue150.status, 200);
    assert.equal(enqueue150.data.enqueuedCount, 150);

    const enqueue151 = await apiJson('/api/queue/enqueue', {
      method: 'POST',
      token: starterToken,
      body: {
        messages: [
          {
            messageId: 'starter-msg-150-overflow',
            channel: 'email',
            customerId: 'cust_s_150',
            customerName: 'Cust 150',
            recipientEmail: 'cust150@starter.test',
            subject: 'Check in',
            content: 'Should exceed 150 combined cap',
            isApproved: true
          }
        ]
      }
    });
    assert.equal(enqueue151.status, 403);

    // Starter Standard customer cap = 250
    const bulkCsvRows = ['customer_id,customer_name,email,plan,mrr,signup_date'];
    for (let i = 1; i <= 250; i++) {
      bulkCsvRows.push(`s_cust_${i},Starter User ${i},u${i}_unique@starter-cap.test,Starter,50,2026-01-01`);
    }
    const import250 = await apiJson('/api/customers/import', {
      method: 'POST',
      token: starterToken,
      headers: { 'x-forwarded-for': '10.10.0.99' },
      body: { rawCsv: bulkCsvRows.join('\n'), fileName: 'cap250.csv', deduplicationMode: 'skip' }
    });
    assert.equal(import250.status, 200);
    assert.equal(import250.data.importedCount, 250);

    const customer251 = await apiJson('/api/customers/manual', {
      method: 'POST',
      token: starterToken,
      body: {
        customerId: 's_cust_251',
        customerName: 'Overflow Customer',
        email: 'u251@starter-cap.test',
        plan: 'Starter',
        mrr: 50
      }
    });
    assert.equal(customer251.status, 403);

    // 2. Growth Standard plan limits verification (User B)
    const growthLimits = await apiJson('/api/billing/limits', { token: tokenB });
    assert.equal(growthLimits.status, 200);
    assert.equal(growthLimits.data.tier, 'growth');
    assert.equal(growthLimits.data.edition, 'standard');
    assert.equal(growthLimits.data.usage.customersLimit, 2500);
    assert.equal(growthLimits.data.usage.scansDailyLimit, 5);
    assert.equal(growthLimits.data.usage.topAtRiskCustomers, 15);
    assert.equal(growthLimits.data.usage.messagesMonthlyLimit, 1000);
    assert.equal(growthLimits.data.usage.customerHistoryDays, 730);

    // 3. Enterprise ($349 / pro) plan limits verification
    const proSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.10.0.5' },
      body: {
        fullName: 'Enterprise Lead',
        companyName: 'Enterprise Corp',
        email: 'enterprise.limits@example.com',
        password: 'StrongPassword!4',
        confirmPassword: 'StrongPassword!4',
        agreedToTerms: true,
        selectedPlan: 'enterprise',
        billingCycle: 'monthly'
      }
    });
    assert.equal(proSignup.status, 201);
    const proToken = proSignup.data.token;

    const proLimits = await apiJson('/api/billing/limits', { token: proToken });
    assert.equal(proLimits.status, 200);
    assert.equal(proLimits.data.tier, 'pro');
    assert.equal(proLimits.data.usage.customersLimit, null); // Infinity serializes to null
    assert.equal(proLimits.data.usage.scansDailyLimit, null);
    assert.equal(proLimits.data.usage.topAtRiskCustomers, 50);
    assert.equal(proLimits.data.usage.messagesMonthlyLimit, 5000);
    assert.equal(proLimits.data.usage.customerHistoryDays, 'unlimited');

    const proRoi = await apiJson('/api/roi', { token: proToken });
    assert.equal(proRoi.status, 200);
    assert.equal(proRoi.data.subscriptionCost, 349);
  });

  test('Section N & Performance: Core API latency check (p50 / p95)', async () => {
    const samples: number[] = [];
    const endpoints = ['/api/health', '/api/customers', '/api/roi', '/api/billing/limits'];
    for (let i = 0; i < 3; i++) {
      for (const ep of endpoints) {
        const res = await apiJson(ep, { token: tokenB });
        assert.equal(res.status, 200);
        samples.push(res.elapsedMs);
      }
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    console.log(`[Audit Perf] Core API latency over ${samples.length} calls -> p50=${p50.toFixed(1)}ms, p95=${p95.toFixed(1)}ms`);
    assert.ok(p95 < 1000, `Expected p95 < 1000ms, got ${p95}`);
  });
});
