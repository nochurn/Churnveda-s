import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  CENTRAL_PRICING,
  EDITION_MARKETING,
  EDITION_PLAN_LIMITS,
  EDITION_PRICING,
  getEditionLabel,
  getEditionPlanFeatures,
  getExpectedPlanAmount,
  getFoundationVsStandardComparison,
  getPlanLimits,
  getPlanPricing,
  normalizePlanEdition
} from '../src/config/pricing.ts';

let testPort = 0;
let baseUrl = '';
let mockRzpPort = 0;
let tempDataDir = '';
let serverProc: ChildProcess | null = null;
let mockRzpServer: http.Server | null = null;
const serverLogs: string[] = [];

const TEST_RZP_KEY_ID = 'rzp_test_mock_gateway_123';
const TEST_RZP_SECRET = 'billing_autopay_test_secret_xyz';
const TEST_RZP_WEBHOOK_SECRET = 'billing_autopay_webhook_secret_xyz';
const TEST_CRON_SECRET = 'billing_autopay_cron_secret';

interface MockRazorpayPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  token_id?: string;
  card?: { last4?: string; network?: string };
}

interface MockRazorpaySubscription {
  id: string;
  plan_id?: string;
  status: string;
  start_at?: number;
  charge_at?: number;
  token_id?: string;
  mandate_id?: string;
  error_description?: string;
}

const mockRzpState: {
  createdSubscriptions: Array<{ url: string; body: any; authHeader: string }>;
  payments: Map<string, MockRazorpayPayment>;
  subscriptions: Map<string, MockRazorpaySubscription>;
  nextSubSeq: number;
} = {
  createdSubscriptions: [],
  payments: new Map(),
  subscriptions: new Map(),
  nextSubSeq: 1
};

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

async function startMockRazorpayServer(): Promise<number> {
  const port = await getFreePort();
  mockRzpServer = http.createServer(async (req, res) => {
    const reqUrl = req.url || '/';
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let parsedBody: any = {};
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = {};
      }
    }

    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'POST' && reqUrl === '/v1/subscriptions') {
      const subId = `sub_rzpmock_${String(mockRzpState.nextSubSeq++).padStart(4, '0')}`;
      mockRzpState.createdSubscriptions.push({
        url: reqUrl,
        body: parsedBody,
        authHeader: String(req.headers.authorization || '')
      });
      const createdSub: MockRazorpaySubscription = {
        id: subId,
        plan_id: parsedBody.plan_id,
        status: 'created',
        start_at: parsedBody.start_at,
        charge_at: parsedBody.start_at
      };
      mockRzpState.subscriptions.set(subId, createdSub);
      res.statusCode = 200;
      res.end(JSON.stringify(createdSub));
      return;
    }

    if (req.method === 'GET' && reqUrl.startsWith('/v1/payments/')) {
      const payId = decodeURIComponent(reqUrl.slice('/v1/payments/'.length).split('?')[0]);
      const p = mockRzpState.payments.get(payId);
      if (!p) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { description: 'Payment not found' } }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify(p));
      return;
    }

    if (req.method === 'GET' && reqUrl.startsWith('/v1/subscriptions/')) {
      const subId = decodeURIComponent(reqUrl.slice('/v1/subscriptions/'.length).split('?')[0]);
      const s = mockRzpState.subscriptions.get(subId);
      if (!s) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { description: 'Subscription not found' } }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify(s));
      return;
    }

    if (req.method === 'POST' && /^\/v1\/subscriptions\/[^/]+\/cancel$/.test(reqUrl)) {
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'cancelled' }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: { description: `Unhandled mock endpoint: ${req.method} ${reqUrl}` } }));
  });

  await new Promise<void>((resolve) => {
    mockRzpServer!.listen(port, '127.0.0.1', () => resolve());
  });
  return port;
}

async function waitForServerReady(timeoutMs = 25000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        if (data?.status === 'ok') {
          const cfgRes = await fetch(`${baseUrl}/api/razorpay/config`);
          if (cfgRes.ok) return;
        }
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Test server failed to boot in ${timeoutMs}ms.\nLogs:\n${serverLogs.join('')}`);
}

async function apiJson(
  endpoint: string,
  options: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; data: any; rawText: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const rawText = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(rawBodySafe(rawText));
  } catch {
    data = rawText;
  }
  return { status: res.status, data, rawText };
}

function rawBodySafe(t: string): string {
  return t;
}

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('Churnveda Foundation vs Standard Differentiation & $1 USD Autopay Verification Suite', () => {
  before(async () => {
    mockRzpPort = await startMockRazorpayServer();
    testPort = await getFreePort();
    baseUrl = `http://127.0.0.1:${testPort}`;
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'churnveda-billing-autopay-'));

    // Preload script intercepts outbound https://api.razorpay.com calls cleanly inside the spawned server
    const preloadPath = path.join(tempDataDir, 'mock-rzp-fetch.mjs');
    fs.writeFileSync(
      preloadPath,
      `const mockBase = process.env.MOCK_RZP_BASE_URL;
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url || '';
  if (mockBase && url.startsWith('https://api.razorpay.com')) {
    const rewritten = mockBase + url.slice('https://api.razorpay.com'.length);
    return origFetch(rewritten, init);
  }
  return origFetch(input, init);
};
`,
      'utf8'
    );

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(testPort),
      NODE_ENV: 'development',
      CHURNVEDA_DATA_DIR: tempDataDir,
      MOCK_RZP_BASE_URL: `http://127.0.0.1:${mockRzpPort}`,
      DATABASE_URL: '',
      POSTGRES_URL: '',
      DATABASE_URL_UNPOOLED: '',
      RESEND_API_KEY: '',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_PHONE_NUMBER_ID: '',
      WHATSAPP_BUSINESS_ACCOUNT_ID: '',
      GEMINI_API_KEY: '',
      CRON_SECRET: TEST_CRON_SECRET,
      RAZORPAY_KEY_ID: TEST_RZP_KEY_ID,
      RAZORPAY_KEY_SECRET: TEST_RZP_SECRET,
      RAZORPAY_WEBHOOK_SECRET: TEST_RZP_WEBHOOK_SECRET,
      RAZORPAY_FOUNDING_STARTER_MONTHLY_PLAN_ID: 'plan_test_founding_starter_19m',
      RAZORPAY_FOUNDING_STARTER_ANNUAL_PLAN_ID: 'plan_test_founding_starter_190y',
      RAZORPAY_FOUNDING_GROWTH_MONTHLY_PLAN_ID: 'plan_test_founding_growth_59m',
      RAZORPAY_FOUNDING_GROWTH_ANNUAL_PLAN_ID: 'plan_test_founding_growth_590y',
      FOUNDING_MEMBER_LIMIT: '3',
      ALLOW_IN_MEMORY_BILLING_TEST: 'false',
      ENABLE_DOMESTIC_INR_PRICING: 'false',
      TURNSTILE_SECRET_KEY: '',
      RECAPTCHA_SECRET_KEY: '',
      HCAPTCHA_SECRET_KEY: ''
    };

    const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    serverProc = spawn(tsxBin, ['--import', preloadPath, 'server.ts'], {
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
      await new Promise((r) => setTimeout(r, 350));
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch {}
      serverProc.stdout?.destroy();
      serverProc.stderr?.destroy();
    }
    if (mockRzpServer) {
      await new Promise<void>((resolve) => mockRzpServer!.close(() => resolve()));
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('1 & 2 & 12: Enforces Founding ($19/$59) vs Standard ($29/$79 Regular Default), preserves Standard Razorpay Plan IDs, and differentiates entitlements', async () => {
    // Verify published pricing: Standard regular ($29/$290, $79/$790, $349/$3,490) vs Founding ($19/$190, $59/$590, Enterprise unchanged)
    assert.equal(CENTRAL_PRICING.starter.monthly.amountUsd, 29);
    assert.equal(CENTRAL_PRICING.starter.annual.totalAmountUsd, 290);
    assert.equal(CENTRAL_PRICING.growth.monthly.amountUsd, 79);
    assert.equal(CENTRAL_PRICING.growth.annual.totalAmountUsd, 790);
    assert.equal(CENTRAL_PRICING.pro.monthly.amountUsd, 349);
    assert.equal(CENTRAL_PRICING.pro.annual.totalAmountUsd, 3490);

    assert.equal(EDITION_PRICING.founding.starter.monthly.amountUsd, 19);
    assert.equal(EDITION_PRICING.founding.starter.annual.totalAmountUsd, 190);
    assert.equal(EDITION_PRICING.founding.growth.monthly.amountUsd, 59);
    assert.equal(EDITION_PRICING.founding.growth.annual.totalAmountUsd, 590);
    assert.equal(EDITION_PRICING.founding.pro.monthly.amountUsd, 349);
    assert.equal(EDITION_PRICING.founding.pro.annual.totalAmountUsd, 3490);

    assert.equal(getExpectedPlanAmount('starter', 'monthly', 'founding').amountUsd, 19);
    assert.equal(getExpectedPlanAmount('starter', 'annual', 'founding').amountUsd, 190);
    assert.equal(getExpectedPlanAmount('growth', 'monthly', 'founding').amountUsd, 59);
    assert.equal(getExpectedPlanAmount('growth', 'annual', 'founding').amountUsd, 590);
    assert.equal(getPlanPricing('starter').monthly.amountUsd, 29);
    assert.equal(normalizePlanEdition(undefined), 'standard');
    assert.equal(getEditionLabel('founding'), 'Founding Member Edition');
    assert.equal(EDITION_MARKETING.founding.badge, 'Exclusive Early Customer Pricing');
    assert.equal(EDITION_MARKETING.standard.badge, 'Regular Pricing');

    const cfgRes = await apiJson('/api/razorpay/config');
    assert.equal(cfgRes.status, 200);
    assert.equal(cfgRes.data.defaultEdition, 'standard');
    assert.equal(cfgRes.data.foundingEligibility.eligible, true);
    assert.equal(cfgRes.data.plans.starter.monthly, 29);
    assert.equal(cfgRes.data.plans.starter.annual, 290);
    assert.equal(cfgRes.data.plans.growth.monthly, 79);
    assert.equal(cfgRes.data.plans.growth.annual, 790);
    assert.equal(cfgRes.data.plans.enterprise.monthly, 349);
    assert.equal(cfgRes.data.plans.enterprise.annual, 3490);
    assert.equal(cfgRes.data.foundingPlans.starter.monthly, 19);
    assert.equal(cfgRes.data.foundingPlans.starter.annual, 190);
    assert.equal(cfgRes.data.foundingPlans.growth.monthly, 59);
    assert.equal(cfgRes.data.foundingPlans.growth.annual, 590);

    // Starter Foundation vs Standard differentiation
    assert.equal(normalizePlanEdition('founding'), 'founding');
    assert.equal(normalizePlanEdition('standard'), 'standard');
    const starterFounding = getPlanLimits('starter', 'founding');
    const starterStandard = getPlanLimits('starter', 'standard');
    assert.equal(starterFounding.customers, 100);
    assert.equal(starterStandard.customers, 250);
    assert.equal(starterFounding.aiScansPerDay, 1);
    assert.equal(starterStandard.aiScansPerDay, 2);
    assert.equal(starterFounding.topAtRiskCustomers, 5);
    assert.equal(starterStandard.topAtRiskCustomers, 10);
    assert.equal(starterFounding.aiRetentionMessagesPerMonth, 50);
    assert.equal(starterStandard.aiRetentionMessagesPerMonth, 150);
    assert.equal(starterFounding.csvImportsPerMonth, 10);
    assert.equal(starterStandard.csvImportsPerMonth, 25);
    assert.equal(starterFounding.pdfImportsPerMonth, 5);
    assert.equal(starterStandard.pdfImportsPerMonth, 10);
    assert.equal(starterFounding.customerHistoryDays, 90);
    assert.equal(starterStandard.customerHistoryDays, 180);
    assert.equal(starterFounding.teamMembers, 1);
    assert.equal(starterStandard.teamMembers, 2);
    assert.equal(starterFounding.customIntegrations, 0);
    assert.equal(starterStandard.customIntegrations, 1);
    assert.equal(starterFounding.advancedAutomation, false);
    assert.equal(starterStandard.advancedAutomation, true);
    assert.equal(starterFounding.apiAccess, false);
    assert.equal(starterStandard.apiAccess, true);

    // Growth Foundation vs Standard differentiation
    const growthFounding = EDITION_PLAN_LIMITS.founding.growth;
    const growthStandard = EDITION_PLAN_LIMITS.standard.growth;
    assert.equal(growthFounding.customers, 1000);
    assert.equal(growthStandard.customers, 2500);
    assert.equal(growthFounding.aiScansPerDay, 3);
    assert.equal(growthStandard.aiScansPerDay, 5);
    assert.equal(growthFounding.topAtRiskCustomers, 10);
    assert.equal(growthStandard.topAtRiskCustomers, 15);
    assert.equal(growthFounding.aiRetentionMessagesPerMonth, 500);
    assert.equal(growthStandard.aiRetentionMessagesPerMonth, 1000);
    assert.equal(growthFounding.teamMembers, 5);
    assert.equal(growthStandard.teamMembers, 10);
    assert.equal(growthFounding.customIntegrations, 2);
    assert.equal(growthStandard.customIntegrations, 5);
    assert.equal(growthFounding.customRiskRules, 'limited');
    assert.equal(growthStandard.customRiskRules, 'full');

    // Comparison matrix & feature strings reflect real differences
    const starterRows = getFoundationVsStandardComparison('starter');
    assert.ok(starterRows.some((r) => r.foundation.includes('100 customers') && r.standard.includes('250 customers')));
    assert.ok(starterRows.some((r) => r.foundation.includes('Manual scan only') && r.standard.includes('Automated daily schedule')));
    const foundingFeatures = getEditionPlanFeatures('starter', 'founding');
    const standardFeatures = getEditionPlanFeatures('starter', 'standard');
    assert.ok(foundingFeatures.some((f) => f.includes('100 customers')));
    assert.ok(standardFeatures.some((f) => f.includes('250 customers')));
    assert.ok(standardFeatures.includes('API access & Razorpay webhooks'));

    // New signup WITHOUT explicit planEdition defaults to Standard Regular Pricing (Slot count stays untouched)
    const defaultSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.10' },
      body: {
        fullName: 'Default Standard User',
        companyName: 'Default Co',
        email: 'default.standard@example.com',
        password: 'StrongPassword!10',
        confirmPassword: 'StrongPassword!10',
        agreedToTerms: true,
        selectedPlan: 'starter',
        billingCycle: 'monthly'
      }
    });
    assert.equal(defaultSignup.status, 201);
    assert.equal(defaultSignup.data.user.planEdition, 'standard');
    assert.equal(defaultSignup.data.user.planPrice, 29);

    // Backend enforcement comparison: Founding slot 1 of 3
    const fSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.1' },
      body: {
        fullName: 'Foundation User',
        companyName: 'Foundation Co',
        email: 'foundation.starter@example.com',
        password: 'StrongPassword!1',
        confirmPassword: 'StrongPassword!1',
        agreedToTerms: true,
        selectedPlan: 'starter',
        planEdition: 'founding',
        billingCycle: 'monthly'
      }
    });
    assert.equal(fSignup.status, 201);
    assert.equal(fSignup.data.user.planEdition, 'founding');
    assert.equal(fSignup.data.user.planEditionLabel, 'Founding Member Edition');
    assert.equal(fSignup.data.user.planPrice, 19);

    // Confirm authoritative Razorpay Plan IDs on backend subscription plans catalog (Standard preserved + Founding separate)
    const fDetails = await apiJson('/api/billing/subscription-details', { token: fSignup.data.token });
    assert.equal(fDetails.status, 200);
    assert.equal(fDetails.data.agreedPriceUsd, 19);
    const catalogPlans: Array<any> = fDetails.data.plans || [];
    const findPlanId = (tier: string, cycle: string, edition: string) =>
      catalogPlans.find((p) => p.tier === tier && p.billing_cycle === cycle && p.plan_edition === edition)?.razorpay_plan_id;
    assert.equal(findPlanId('starter', 'monthly', 'standard'), 'plan_U1vm4YhuBfkHU6');
    assert.equal(findPlanId('starter', 'annual', 'standard'), 'plan_U1vpfqbMX7PrvO');
    assert.equal(findPlanId('growth', 'monthly', 'standard'), 'plan_U1vtzGKxsZRAT2');
    assert.equal(findPlanId('growth', 'annual', 'standard'), 'plan_U1vvXZFmhM3XK2');
    assert.equal(findPlanId('pro', 'monthly', 'standard'), 'plan_U1vwty43aSFOmP');
    assert.equal(findPlanId('pro', 'annual', 'standard'), 'plan_U1w0VddfSIKKQG');

    assert.equal(findPlanId('starter', 'monthly', 'founding'), 'plan_test_founding_starter_19m');
    assert.equal(findPlanId('starter', 'annual', 'founding'), 'plan_test_founding_starter_190y');
    assert.equal(findPlanId('growth', 'monthly', 'founding'), 'plan_test_founding_growth_59m');
    assert.equal(findPlanId('growth', 'annual', 'founding'), 'plan_test_founding_growth_590y');

    const fLimits = await apiJson('/api/billing/limits', { token: fSignup.data.token });
    assert.equal(fLimits.status, 200);
    assert.equal(fLimits.data.edition, 'founding');
    assert.equal(fLimits.data.usage.customersLimit, 100);
    assert.equal(fLimits.data.usage.advancedAutomation, false);

    // Foundation Starter cannot enable automated daily scheduler (403)
    const fSched = await apiJson('/api/scheduler/update', {
      method: 'POST',
      token: fSignup.data.token,
      body: { enabled: true, scanTime: '09:00' }
    });
    assert.equal(fSched.status, 403);

    const sSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.2' },
      body: {
        fullName: 'Standard User',
        companyName: 'Standard Co',
        email: 'standard.starter@example.com',
        password: 'StrongPassword!2',
        confirmPassword: 'StrongPassword!2',
        agreedToTerms: true,
        selectedPlan: 'starter',
        planEdition: 'standard',
        billingCycle: 'monthly'
      }
    });
    assert.equal(sSignup.status, 201);
    assert.equal(sSignup.data.user.planEdition, 'standard');
    assert.equal(sSignup.data.user.planEditionLabel, 'Standard');
    assert.equal(sSignup.data.user.planPrice, 29);

    const sLimits = await apiJson('/api/billing/limits', { token: sSignup.data.token });
    assert.equal(sLimits.status, 200);
    assert.equal(sLimits.data.edition, 'standard');
    assert.equal(sLimits.data.usage.customersLimit, 250);
    assert.equal(sLimits.data.usage.scansDailyLimit, 2);
    assert.equal(sLimits.data.usage.topAtRiskCustomers, 10);
    assert.equal(sLimits.data.usage.messagesMonthlyLimit, 150);
    assert.equal(sLimits.data.usage.advancedAutomation, true);

    // Standard Starter CAN enable automated daily scheduler
    const sSched = await apiJson('/api/scheduler/update', {
      method: 'POST',
      token: sSignup.data.token,
      body: { enabled: true, scanTime: '09:00' }
    });
    assert.equal(sSched.status, 200);

    // Team member cap check: Foundation (limit 1) blocks adding 2nd member; Standard (limit 2) allows adding 2nd member
    const fAddMember = await apiJson('/api/admin/members', {
      method: 'POST',
      token: fSignup.data.token,
      body: { email: 'standard.starter@example.com', role: 'member' }
    });
    assert.equal(fAddMember.status, 403);

    const sAddMember = await apiJson('/api/admin/members', {
      method: 'POST',
      token: sSignup.data.token,
      body: { email: 'foundation.starter@example.com', role: 'member' }
    });
    assert.equal(sAddMember.status, 201);
  });

  test('3 & 4 & 9: $1.00 USD trial verification uses Razorpay Subscription Mandate (Card-only), enforces explicit consent, handles dismissal, and rejects invalid HMAC', async () => {
    const signup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.3' },
      body: {
        fullName: 'Autopay Consent User',
        companyName: 'Consent SaaS',
        email: 'consent.autopay@example.com',
        password: 'StrongPassword!3',
        confirmPassword: 'StrongPassword!3',
        agreedToTerms: true,
        selectedPlan: 'starter',
        planEdition: 'founding',
        billingCycle: 'monthly'
      }
    });
    assert.equal(signup.status, 201);
    const token = signup.data.token;

    // 1. Explicit consentAccepted: false must be rejected with 400
    const noConsent = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token,
      body: {
        tier: 'starter',
        plan_edition: 'founding',
        billing_cycle: 'monthly',
        currency: 'USD',
        consentAccepted: false
      }
    });
    assert.equal(noConsent.status, 400);

    // 2. With consentAccepted: true -> creates Razorpay Subscription Mandate for $1.00 USD (100 cents), NOT ₹1 INR
    const prevCreatedCount = mockRzpState.createdSubscriptions.length;
    const trialInit = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token,
      body: {
        tier: 'starter',
        plan_edition: 'founding',
        billing_cycle: 'monthly',
        currency: 'USD',
        consentAccepted: true
      }
    });
    assert.equal(trialInit.status, 200);
    assert.equal(trialInit.data.authMode, 'subscription_mandate');
    assert.equal(trialInit.data.amount, 100);
    assert.equal(trialInit.data.amountCents, 100);
    assert.equal(trialInit.data.amountUsd, 1);
    assert.equal(trialInit.data.currency, 'USD');
    assert.equal(trialInit.data.formatted_amount, '$1.00');
    assert.equal(trialInit.data.future_plan_price, 19);
    assert.equal(trialInit.data.planId, 'plan_test_founding_starter_19m');
    assert.deepEqual(trialInit.data.allowed_methods, ['card']);
    assert.ok(String(trialInit.data.subscriptionId).startsWith('sub_rzpmock_'));

    // Verify exact Razorpay /v1/subscriptions payload sent
    assert.equal(mockRzpState.createdSubscriptions.length, prevCreatedCount + 1);
    const lastRzpReq = mockRzpState.createdSubscriptions[mockRzpState.createdSubscriptions.length - 1];
    assert.equal(lastRzpReq.body.plan_id, 'plan_test_founding_starter_19m');
    assert.equal(lastRzpReq.body.addons?.[0]?.item?.amount, 100);
    assert.equal(lastRzpReq.body.addons?.[0]?.item?.currency, 'USD');
    const nowSec = Math.floor(Date.now() / 1000);
    assert.ok(lastRzpReq.body.start_at >= nowSec + 13 * 86400 && lastRzpReq.body.start_at <= nowSec + 15 * 86400);

    // 3. Simulating Checkout Dismissal (no verify call) -> user stays pending & Autopay not active
    const subBeforeVerify = await apiJson('/api/billing/subscription-details', { token });
    assert.equal(subBeforeVerify.status, 200);
    assert.equal(subBeforeVerify.data.autopay.status, 'pending');
    assert.notEqual(subBeforeVerify.data.subscription?.status, 'active');

    // 4. Tampered HMAC signature rejected with 400
    const badVerify = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token,
      body: {
        razorpay_subscription_id: trialInit.data.subscriptionId,
        razorpay_payment_id: 'pay_forged_001',
        razorpay_signature: 'tampered_signature_deadbeef'
      }
    });
    assert.equal(badVerify.status, 400);
  });

  test('5 & 6 & 8: $1 payment captured WITHOUT Autopay leaves Autopay pending, failed webhook marks failed, and retry-mandate waives duplicate $1 fee without extending trial', async () => {
    const signup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.4' },
      body: {
        fullName: 'Partial Mandate User',
        companyName: 'Retry SaaS',
        email: 'partial.mandate@example.com',
        password: 'StrongPassword!4',
        confirmPassword: 'StrongPassword!4',
        agreedToTerms: true,
        selectedPlan: 'growth',
        planEdition: 'founding',
        billingCycle: 'monthly'
      }
    });
    assert.equal(signup.status, 201);
    const token = signup.data.token;
    const workspaceId = signup.data.user.workspaceId;

    const trialInit = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token,
      body: {
        tier: 'growth',
        plan_edition: 'founding',
        billing_cycle: 'monthly',
        currency: 'USD',
        consentAccepted: true
      }
    });
    assert.equal(trialInit.status, 200);
    const subId1 = trialInit.data.subscriptionId;

    // Mock Razorpay: payment captured ($1 USD), BUT subscription is still 'created' (no Autopay mandate authenticated!)
    const payId1 = 'pay_live_partial_001';
    mockRzpState.payments.set(payId1, {
      id: payId1,
      amount: 100,
      currency: 'USD',
      status: 'captured',
      method: 'card',
      card: { last4: '4111', network: 'Visa' }
    });
    mockRzpState.subscriptions.set(subId1, {
      id: subId1,
      plan_id: 'plan_test_founding_growth_59m',
      status: 'created'
    });

    const sig1 = hmacHex(TEST_RZP_SECRET, `${payId1}|${subId1}`);
    const partialVerify = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token,
      body: {
        razorpay_subscription_id: subId1,
        razorpay_payment_id: payId1,
        razorpay_signature: sig1
      }
    });
    assert.equal(partialVerify.status, 200);
    assert.equal(partialVerify.data.payment_captured, true);
    assert.equal(partialVerify.data.autopay_authorized, false);
    assert.equal(partialVerify.data.autopay_status, 'pending');
    assert.equal(partialVerify.data.retry_required, true);
    const originalTrialEndsAt = partialVerify.data.trial_ends_at;

    // Simulate failed mandate via subscription.halted webhook
    const failEvent = {
      id: 'evt_halted_partial_001',
      event: 'subscription.halted',
      payload: {
        subscription: {
          entity: {
            id: subId1,
            error_description: 'Issuer declined recurring international USD mandate',
            notes: { workspace_id: workspaceId }
          }
        }
      }
    };
    const failRaw = JSON.stringify(failEvent);
    const failWh = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': hmacHex(TEST_RZP_WEBHOOK_SECRET, failRaw),
        'x-razorpay-event-id': 'evt_halted_partial_001'
      },
      body: failEvent
    });
    assert.equal(failWh.status, 200);

    const detailsAfterFail = await apiJson('/api/billing/subscription-details', { token });
    assert.equal(detailsAfterFail.data.autopay.status, 'failed');
    assert.ok(String(detailsAfterFail.data.autopay.failureReason).includes('Issuer declined'));

    // Retry Autopay Mandate -> requires consentAccepted: true, waives duplicate $1 addon, and preserves original trial_ends_at
    const retryNoConsent = await apiJson('/api/billing/retry-mandate', {
      method: 'POST',
      token,
      body: { consentAccepted: false }
    });
    assert.equal(retryNoConsent.status, 400);

    const prevSubCreateCount = mockRzpState.createdSubscriptions.length;
    const retryOk = await apiJson('/api/billing/retry-mandate', {
      method: 'POST',
      token,
      body: { tier: 'growth', plan_edition: 'founding', billing_cycle: 'monthly', consentAccepted: true }
    });
    assert.equal(retryOk.status, 200);
    assert.equal(retryOk.data.verification_fee_waived, true);
    assert.equal(retryOk.data.amountCents, 0);
    assert.deepEqual(retryOk.data.allowed_methods, ['card']);
    assert.equal(mockRzpState.createdSubscriptions.length, prevSubCreateCount + 1);
    const retryRzpBody = mockRzpState.createdSubscriptions[mockRzpState.createdSubscriptions.length - 1].body;
    assert.equal(retryRzpBody.addons, undefined, 'Must NOT add another $1 verification addon when $1 was already verified');

    // Verify retried subscription now returns 'authenticated' from Razorpay
    const subId2 = retryOk.data.subscriptionId;
    const payId2 = 'pay_live_retry_002';
    mockRzpState.payments.set(payId2, {
      id: payId2,
      amount: 100,
      currency: 'USD',
      status: 'authorized',
      method: 'card',
      token_id: 'token_card_live_888',
      card: { last4: '4111', network: 'Visa' }
    });
    mockRzpState.subscriptions.set(subId2, {
      id: subId2,
      plan_id: 'plan_test_founding_growth_59m',
      status: 'authenticated',
      token_id: 'token_card_live_888',
      mandate_id: 'mandate_card_live_999',
      start_at: Math.floor(Date.parse(originalTrialEndsAt) / 1000)
    });

    // Wait slightly so a freshly computed now+14d would differ from originalTrialEndsAt
    await new Promise((r) => setTimeout(r, 25));
    const retryVerify = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token,
      body: {
        razorpay_subscription_id: subId2,
        razorpay_payment_id: payId2,
        razorpay_signature: hmacHex(TEST_RZP_SECRET, `${payId2}|${subId2}`)
      }
    });
    assert.equal(retryVerify.status, 200);
    assert.equal(retryVerify.data.autopay_authorized, true);
    assert.equal(retryVerify.data.autopay_status, 'authenticated');
    assert.equal(retryVerify.data.mandate_id, 'mandate_card_live_999');
    assert.equal(retryVerify.data.token_id, 'token_card_live_888');
    assert.equal(retryVerify.data.trial_ends_at, originalTrialEndsAt, 'Retrying Autopay must NOT extend 14-day trial window');
  });

  test('7 & 10 & 11: Founding limit enforcement + Standard Annual Autopay & Webhook idempotency', async () => {
    // Note: At this point 3 Founding Member accounts exist (slots 1, 2, 3 = FOUNDING_MEMBER_LIMIT 3).
    // Verify a 4th new user requesting Founding Member Edition is rejected cleanly with 403, while an existing Founding user stays eligible.
    const cfgAtCap = await apiJson('/api/razorpay/config');
    assert.equal(cfgAtCap.status, 200);
    assert.equal(cfgAtCap.data.foundingEligibility.eligible, false);
    assert.equal(cfgAtCap.data.foundingEligibility.isExistingFounding, false);

    const blocked4thFoundingSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.55' },
      body: {
        fullName: 'Late Comer',
        companyName: 'Late SaaS',
        email: 'latecomer.founding@example.com',
        password: 'StrongPassword!55',
        confirmPassword: 'StrongPassword!55',
        agreedToTerms: true,
        selectedPlan: 'starter',
        planEdition: 'founding',
        billingCycle: 'monthly'
      }
    });
    assert.equal(blocked4thFoundingSignup.status, 403);
    assert.equal(blocked4thFoundingSignup.data.code, 'FOUNDING_ELIGIBILITY_UNAVAILABLE');

    // Standard signup still works seamlessly (and now a Standard user checks Founding upgrade -> also blocked by cap!)
    const lateStandardSignup = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.5' },
      body: {
        fullName: 'Webhook & Upgrade User',
        companyName: 'Upgrade Co',
        email: 'upgrade.webhook@example.com',
        password: 'StrongPassword!5',
        confirmPassword: 'StrongPassword!5',
        agreedToTerms: true,
        selectedPlan: 'starter',
        billingCycle: 'annual'
      }
    });
    assert.equal(lateStandardSignup.status, 201);
    assert.equal(lateStandardSignup.data.user.planEdition, 'standard');
    const token = lateStandardSignup.data.token;
    const workspaceId = lateStandardSignup.data.user.workspaceId;

    // Wait: let's test BOTH scenarios! Free up 1 slot temporarily OR test a Founding account from slot 1/3 upgrading vs creating a fresh verified Founding test
    // First confirm lateStandardSignup CANNOT request Founding trial checkout while at limit (403)
    const blockedFoundingOrder = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token,
      body: {
        tier: 'starter',
        plan_edition: 'founding',
        billing_cycle: 'annual',
        currency: 'USD',
        consentAccepted: true
      }
    });
    assert.equal(blockedFoundingOrder.status, 403);

    // 1. Standard unverified edition upgrade before verification returns 402
    const unverifiedUpgrade = await apiJson('/api/billing/upgrade-edition', {
      method: 'POST',
      token,
      body: { planEdition: 'standard' }
    });
    assert.equal(unverifiedUpgrade.status, 402);

    // 2. Annual subscription checkout verifies Standard annual Razorpay plan ID (plan_U1vpfqbMX7PrvO) for Standard user
    const annualTrial = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token,
      body: {
        tier: 'starter',
        plan_edition: 'standard',
        billing_cycle: 'annual',
        currency: 'USD',
        consentAccepted: true
      }
    });
    assert.equal(annualTrial.status, 200);
    assert.equal(annualTrial.data.planId, 'plan_U1vpfqbMX7PrvO');
    assert.equal(annualTrial.data.future_plan_price, 290);

    const subId = annualTrial.data.subscriptionId;
    const payId = 'pay_live_annual_003';
    mockRzpState.payments.set(payId, {
      id: payId,
      amount: 100,
      currency: 'USD',
      status: 'captured',
      method: 'card',
      token_id: 'tok_annual_111',
      card: { last4: '4444', network: 'Mastercard' }
    });
    mockRzpState.subscriptions.set(subId, {
      id: subId,
      plan_id: 'plan_U1vpfqbMX7PrvO',
      status: 'authenticated',
      token_id: 'tok_annual_111',
      mandate_id: 'mnd_annual_222'
    });

    const verifyAnnual = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token,
      body: {
        razorpay_subscription_id: subId,
        razorpay_payment_id: payId,
        razorpay_signature: hmacHex(TEST_RZP_SECRET, `${payId}|${subId}`)
      }
    });
    assert.equal(verifyAnnual.status, 200);
    assert.equal(verifyAnnual.data.autopay_authorized, true);

    // 3. Send subscription.charged webhook + verify idempotency and active renewal tracking
    const chargedEvent = {
      id: 'evt_charged_annual_001',
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: subId,
            token_id: 'tok_annual_111',
            mandate_id: 'mnd_annual_222',
            current_end: Math.floor(Date.now() / 1000) + 365 * 86400,
            notes: { workspace_id: workspaceId }
          }
        },
        payment: {
          entity: {
            id: 'pay_renewal_290usd',
            amount: 29000,
            currency: 'USD',
            status: 'captured',
            method: 'card',
            token_id: 'tok_annual_111'
          }
        }
      }
    };
    const chargedRaw = JSON.stringify(chargedEvent);
    const chargedSig = hmacHex(TEST_RZP_WEBHOOK_SECRET, chargedRaw);

    const whCharged1 = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': chargedSig,
        'x-razorpay-event-id': 'evt_charged_annual_001'
      },
      body: chargedEvent
    });
    assert.equal(whCharged1.status, 200);

    // Duplicate webhook skipped cleanly
    const whChargedReplay = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': chargedSig,
        'x-razorpay-event-id': 'evt_charged_annual_001'
      },
      body: chargedEvent
    });
    assert.equal(whChargedReplay.status, 200);
    assert.equal(whChargedReplay.data.message, 'Event already processed');

    const finalDetails = await apiJson('/api/billing/subscription-details', { token });
    assert.equal(finalDetails.status, 200);
    assert.equal(finalDetails.data.planEdition, 'standard');
    assert.equal(finalDetails.data.agreedPriceUsd, 290);
    assert.equal(finalDetails.data.subscription.status, 'active');
    assert.equal(finalDetails.data.autopay.status, 'active');
    assert.equal(finalDetails.data.autopay.mandateId, 'mnd_annual_222');
    assert.equal(finalDetails.data.autopay.tokenId, 'tok_annual_111');
  });

  test('13 & 14: Founding Grandfathering retention + Founding ($19) -> Standard ($29) upgrade gating + Unconfigured Plan ID safety check', async () => {
    // Log in as existing Founding slot 1 user (foundation.starter@example.com) and verify Founding grandfathering
    const loginFounding = await apiJson('/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.1' },
      body: { email: 'foundation.starter@example.com', password: 'StrongPassword!1' }
    });
    assert.equal(loginFounding.status, 200);
    const fToken = loginFounding.data.token;

    // Even when FOUNDING_MEMBER_LIMIT is full (3/3), existing Founding subscriber stays eligible for their Founding plan
    const fCfg = await apiJson('/api/razorpay/config', { token: fToken });
    assert.equal(fCfg.status, 200);
    assert.equal(fCfg.data.foundingEligibility.isExistingFounding, true);
    assert.equal(fCfg.data.foundingEligibility.eligible, true);

    // Founding ROI & subscription details reflect $19/mo (not overwritten to $29)
    const fRoi = await apiJson('/api/roi', { token: fToken });
    assert.equal(fRoi.status, 200);
    assert.equal(fRoi.data.subscriptionCost, 19);

    // Complete $1 verification + Founding ($19/mo) subscription mandate
    const fTrial = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token: fToken,
      headers: { 'x-forwarded-for': '10.20.0.62' },
      body: { tier: 'starter', plan_edition: 'founding', billing_cycle: 'monthly', currency: 'USD', consentAccepted: true }
    });
    assert.equal(fTrial.status, 200);
    assert.equal(fTrial.data.planId, 'plan_test_founding_starter_19m');
    assert.equal(fTrial.data.future_plan_price, 19);

    const fSubId = fTrial.data.subscriptionId;
    const fPayId = 'pay_founding_grandfathered_001';
    mockRzpState.payments.set(fPayId, {
      id: fPayId,
      amount: 100,
      currency: 'USD',
      status: 'captured',
      method: 'card',
      token_id: 'tok_founding_19',
      card: { last4: '4242', network: 'Visa' }
    });
    mockRzpState.subscriptions.set(fSubId, {
      id: fSubId,
      plan_id: 'plan_test_founding_starter_19m',
      status: 'authenticated',
      token_id: 'tok_founding_19',
      mandate_id: 'mnd_founding_19'
    });

    const fVerify = await apiJson('/api/billing/verify-trial-payment', {
      method: 'POST',
      token: fToken,
      body: {
        razorpay_subscription_id: fSubId,
        razorpay_payment_id: fPayId,
        razorpay_signature: hmacHex(TEST_RZP_SECRET, `${fPayId}|${fSubId}`)
      }
    });
    assert.equal(fVerify.status, 200);
    assert.equal(fVerify.data.autopay_authorized, true);

    // Explicitly test Founding Starter ($19) -> Standard Starter ($29) upgrade while trialing
    const fUpgradeToStd = await apiJson('/api/billing/upgrade-edition', {
      method: 'POST',
      token: fToken,
      body: { planEdition: 'standard' }
    });
    assert.equal(fUpgradeToStd.status, 200);
    assert.equal(fUpgradeToStd.data.planEdition, 'standard');
    assert.equal(fUpgradeToStd.data.agreedPriceUsd, 29);
    assert.equal(fUpgradeToStd.data.requiresMandateReauth, true);
    assert.equal(fUpgradeToStd.data.limits.customers, 250);

    // Upgrading slot 1 freed 1 founding slot! Verify a new Founding Growth Annual ($590) signup now succeeds using free slot
    const growthAnnualFounding = await apiJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.20.0.61' },
      body: {
        fullName: 'Founding Annual Growth',
        companyName: 'Growth Annual Co',
        email: 'founding.growth.annual@example.com',
        password: 'StrongPassword!60',
        confirmPassword: 'StrongPassword!60',
        agreedToTerms: true,
        selectedPlan: 'growth',
        planEdition: 'founding',
        billingCycle: 'annual'
      }
    });
    assert.equal(growthAnnualFounding.status, 201);
    assert.equal(growthAnnualFounding.data.user.planEdition, 'founding');
    assert.equal(growthAnnualFounding.data.user.planPrice, 590);

    const gToken = growthAnnualFounding.data.token;
    const gAnnualOrder = await apiJson('/api/billing/trial-verification-order', {
      method: 'POST',
      token: gToken,
      body: { tier: 'growth', plan_edition: 'founding', billing_cycle: 'annual', currency: 'USD', consentAccepted: true }
    });
    assert.equal(gAnnualOrder.status, 200);
    assert.equal(gAnnualOrder.data.planId, 'plan_test_founding_growth_590y');
    assert.equal(gAnnualOrder.data.future_plan_price, 590);

    // Activate Growth Annual Founding via subscription.charged webhook
    const gSubId = gAnnualOrder.data.subscriptionId;
    const gWorkspaceId = growthAnnualFounding.data.user.workspaceId;
    const gChargedEvt = {
      id: 'evt_founding_growth_590_active',
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: gSubId,
            token_id: 'tok_fg_590',
            mandate_id: 'mnd_fg_590',
            current_end: Math.floor(Date.now() / 1000) + 365 * 86400,
            notes: { workspace_id: gWorkspaceId }
          }
        },
        payment: {
          entity: {
            id: 'pay_fg_590usd',
            amount: 59000,
            currency: 'USD',
            status: 'captured',
            method: 'card',
            token_id: 'tok_fg_590'
          }
        }
      }
    };
    const gChargedRaw = JSON.stringify(gChargedEvt);
    const gWhRes = await apiJson('/api/razorpay/webhook', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': hmacHex(TEST_RZP_WEBHOOK_SECRET, gChargedRaw),
        'x-razorpay-event-id': 'evt_founding_growth_590_active'
      },
      body: gChargedEvt
    });
    assert.equal(gWhRes.status, 200);

    // Active paid Founding $590 subscriber retains $590 agreed rate & cannot be upgraded to $790 via free bypass (402 requiresPayment)
    const gActiveUpgrade = await apiJson('/api/billing/upgrade-edition', {
      method: 'POST',
      token: gToken,
      body: { planEdition: 'standard' }
    });
    assert.equal(gActiveUpgrade.status, 402);
    assert.equal(gActiveUpgrade.data.requiresPayment, true);
    assert.equal(gActiveUpgrade.data.currentPriceUsd, 590);
    assert.equal(gActiveUpgrade.data.targetPriceUsd, 790);

    const gDetails = await apiJson('/api/billing/subscription-details', { token: gToken });
    assert.equal(gDetails.status, 200);
    assert.equal(gDetails.data.planEdition, 'founding');
    assert.equal(gDetails.data.agreedPriceUsd, 590);

    // Verify unconfigured Founding Plan IDs fail cleanly with 400 RAZORPAY_PLAN_NOT_CONFIGURED (never reuse $29/$79 Plan IDs)
    const unconfPort = await getFreePort();
    const unconfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'churnveda-unconf-'));
    const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    const unconfProc = spawn(tsxBin, ['server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(unconfPort),
        NODE_ENV: 'development',
        CHURNVEDA_DATA_DIR: unconfDir,
        DATABASE_URL: '',
        POSTGRES_URL: '',
        DATABASE_URL_UNPOOLED: '',
        RAZORPAY_KEY_ID: 'rzp_test_audit_only',
        RAZORPAY_KEY_SECRET: TEST_RZP_SECRET,
        RAZORPAY_WEBHOOK_SECRET: TEST_RZP_WEBHOOK_SECRET,
        RAZORPAY_FOUNDING_STARTER_MONTHLY_PLAN_ID: '',
        RAZORPAY_FOUNDING_STARTER_ANNUAL_PLAN_ID: '',
        RAZORPAY_FOUNDING_GROWTH_MONTHLY_PLAN_ID: '',
        RAZORPAY_FOUNDING_GROWTH_ANNUAL_PLAN_ID: ''
      },
      detached: true,
      stdio: 'ignore'
    });
    try {
      const unconfBase = `http://127.0.0.1:${unconfPort}`;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`${unconfBase}/api/razorpay/config`);
          if (r.ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      const unconfSignup = await fetch(`${unconfBase}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Unconf Founding',
          companyName: 'Unconf Co',
          email: 'unconf.founding@example.com',
          password: 'StrongPassword!99',
          confirmPassword: 'StrongPassword!99',
          agreedToTerms: true,
          selectedPlan: 'starter',
          planEdition: 'founding',
          billingCycle: 'monthly'
        })
      }).then((r) => r.json());
      const unconfToken = unconfSignup.token;

      for (const combo of [
        { tier: 'starter', billing_cycle: 'monthly' },
        { tier: 'starter', billing_cycle: 'annual' },
        { tier: 'growth', billing_cycle: 'monthly' },
        { tier: 'growth', billing_cycle: 'annual' }
      ]) {
        const res = await fetch(`${unconfBase}/api/billing/trial-verification-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${unconfToken}` },
          body: JSON.stringify({ ...combo, plan_edition: 'founding', currency: 'USD', consentAccepted: true })
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.code, 'RAZORPAY_PLAN_NOT_CONFIGURED');
      }
    } finally {
      if (unconfProc.pid) {
        try { process.kill(-unconfProc.pid, 'SIGTERM'); } catch { try { unconfProc.kill('SIGTERM'); } catch {} }
        await new Promise((r) => setTimeout(r, 200));
        try { process.kill(-unconfProc.pid, 'SIGKILL'); } catch {}
      }
      if (fs.existsSync(unconfDir)) fs.rmSync(unconfDir, { recursive: true, force: true });
    }
  });
});
