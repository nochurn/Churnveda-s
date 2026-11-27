import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as import('net').AddressInfo;
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('Churnveda — Admin Panel Identity Privacy & Owner-Only Access Security Suite', () => {
  let serverProc: ChildProcess;
  let testPort: number;
  let testBaseUrl: string;
  let tempDataDir: string;

  const TEST_CRON_SECRET = 'test_cron_secret_admin_sec_123';
  const OWNER_EMAIL = 'nageshsharat@gmail.com';
  const CUSTOMER_EMAIL_1 = 'customer.one@example.com';
  const CUSTOMER_EMAIL_2 = 'customer.two@example.com';

  let ownerToken = '';
  let customer1Token = '';
  let customer2Token = '';

  before(async () => {
    testPort = await getFreePort();
    testBaseUrl = `http://127.0.0.1:${testPort}`;
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'churnveda-admin-sec-'));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(testPort),
      NODE_ENV: 'development',
      CHURNVEDA_DATA_DIR: tempDataDir,
      DATABASE_URL: '',
      POSTGRES_URL: '',
      CRON_SECRET: TEST_CRON_SECRET,
      ADMIN_EMAIL: OWNER_EMAIL,
      ADMIN_BOOTSTRAP_PASSWORD: 'TestOwnerPassword!123'
    };

    const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    serverProc = spawn(tsxBin, ['server.ts'], {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${testBaseUrl}/api/razorpay/config`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) {
      throw new Error('Test server failed to start within timeout');
    }

    // 1. Log in as Owner (usr-admin-001 / nageshsharat@gmail.com)
    const ownerLogin = await fetch(`${testBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, password: 'TestOwnerPassword!123' })
    }).then(r => r.json());
    ownerToken = ownerLogin.token;

    // 2. Sign up Customer 1
    const cust1Signup = await fetch(`${testBaseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.0.1' },
      body: JSON.stringify({
        fullName: 'Customer One',
        companyName: 'Company One',
        email: CUSTOMER_EMAIL_1,
        password: 'StrongPassword!1',
        confirmPassword: 'StrongPassword!1',
        agreedToTerms: true,
        selectedPlan: 'starter',
        billingCycle: 'monthly'
      })
    }).then(r => r.json());
    customer1Token = cust1Signup.token;

    // 3. Sign up Customer 2
    const cust2Signup = await fetch(`${testBaseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.0.2' },
      body: JSON.stringify({
        fullName: 'Customer Two',
        companyName: 'Company Two',
        email: CUSTOMER_EMAIL_2,
        password: 'StrongPassword!2',
        confirmPassword: 'StrongPassword!2',
        agreedToTerms: true,
        selectedPlan: 'growth',
        billingCycle: 'annual'
      })
    }).then(r => r.json());
    customer2Token = cust2Signup.token;
  });

  after(async () => {
    if (serverProc && serverProc.pid) {
      try { process.kill(-serverProc.pid, 'SIGTERM'); } catch { try { serverProc.kill('SIGTERM'); } catch {} }
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('Account A (Owner): Can access admin overview & audit logs, sees owner identity', async () => {
    assert.ok(ownerToken, 'Owner token must be present');
    const adminOverview = await fetch(`${testBaseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(adminOverview.status, 200);
    const data = await adminOverview.json();
    assert.equal(data.success, true);
    assert.equal(data.isPlatformAdmin, true);

    const auditLogs = await fetch(`${testBaseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(auditLogs.status, 200);
  });

  test('Account B (Normal Customer 1): Cannot access admin panel or admin APIs (returns 403 Forbidden)', async () => {
    assert.ok(customer1Token, 'Customer 1 token must be present');

    const adminOverview = await fetch(`${testBaseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${customer1Token}` }
    });
    assert.equal(adminOverview.status, 403);
    const body = await adminOverview.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'FORBIDDEN');

    const auditLogs = await fetch(`${testBaseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${customer1Token}` }
    });
    assert.equal(auditLogs.status, 403);

    const platformOverview = await fetch(`${testBaseUrl}/api/admin/platform/overview`, {
      headers: { Authorization: `Bearer ${customer1Token}` }
    });
    assert.equal(platformOverview.status, 403);
  });

  test('Account C (Normal Customer 2): Isolated from Customer 1 data and has zero admin rights', async () => {
    assert.ok(customer2Token, 'Customer 2 token must be present');

    const adminOverview = await fetch(`${testBaseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${customer2Token}` }
    });
    assert.equal(adminOverview.status, 403);

    // Customer 2 can fetch their own auth/me without exposing owner info
    const meRes = await fetch(`${testBaseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${customer2Token}` }
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.email, CUSTOMER_EMAIL_2);
    assert.notEqual(meData.user.email, OWNER_EMAIL);
    assert.notEqual(meData.user.role, 'Admin');
    assert.equal(meData.user.isPlatformAdmin, false);
    assert.equal(meData.user.isOwner, false);
  });

  test('Direct API requests without authorization and forged headers are rejected', async () => {
    const unauthRes = await fetch(`${testBaseUrl}/api/admin/overview`);
    assert.equal(unauthRes.status, 401);

    const forgedRes = await fetch(`${testBaseUrl}/api/admin/overview`, {
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'x-user-role': 'Admin',
        'x-admin-override': 'true'
      }
    });
    assert.equal(forgedRes.status, 403);
  });

  test('Logout and session invalidation correctly revokes access', async () => {
    const logoutRes = await fetch(`${testBaseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer1Token}` }
    });
    assert.equal(logoutRes.status, 200);

    const postLogoutRes = await fetch(`${testBaseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${customer1Token}` }
    });
    assert.equal(postLogoutRes.status, 401);
  });
});
