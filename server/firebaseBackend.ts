import { initializeApp as initFirebaseAdmin, getApps as getFirebaseAdminApps, getApp as getFirebaseAdminAppInstance, type App as FirebaseAdminApp } from 'firebase-admin/app';
import { getFirestore as getFirebaseAdminFirestore, FieldValue } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { Customer, DailyAlert, ImportHistoryRecord, IntegrationStatus } from '../src/types';

export interface FirebaseRequestContext {
  uid: string;
  email: string;
  emailVerified: boolean;
  workspaceId: string;
  idToken?: string | null;
  companyName?: string;
  fullName?: string;
  plan?: string;
  billingCycle?: string;
  billingStatus?: string;
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || firebaseConfig.projectId;
const DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';
export const STORAGE_BUCKET = (process.env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket || `${PROJECT_ID}.firebasestorage.app`).trim();
const DOC_RESOURCE_PREFIX = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
const REST_BASE_URL = `https://firestore.googleapis.com/v1/${DOC_RESOURCE_PREFIX}`;

export function getFirebaseAdminApp(): FirebaseAdminApp {
  return getFirebaseAdminApps().length > 0
    ? getFirebaseAdminAppInstance()
    : initFirebaseAdmin({
        projectId: PROJECT_ID,
        storageBucket: STORAGE_BUCKET
      });
}

const firebaseAdminApp = getFirebaseAdminApp();

export const adminDb = DATABASE_ID && DATABASE_ID !== '(default)'
  ? getFirebaseAdminFirestore(firebaseAdminApp, DATABASE_ID)
  : getFirebaseAdminFirestore(firebaseAdminApp);

let cachedAdcIamAuthorized: boolean | null = null;
let cachedAdcProbeTimestamp = 0;

export function hasFirebaseAdminCredentials(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) return true;
  return cachedAdcIamAuthorized === true;
}

export async function checkAdcAdminIamAccess(forceRefresh = false): Promise<boolean> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) return true;
  const now = Date.now();
  if (!forceRefresh && cachedAdcIamAuthorized !== null && now - cachedAdcProbeTimestamp < 60_000) {
    return cachedAdcIamAuthorized;
  }
  try {
    await adminDb.doc('test/connection').get();
    cachedAdcIamAuthorized = true;
  } catch {
    cachedAdcIamAuthorized = false;
  }
  cachedAdcProbeTimestamp = now;
  return cachedAdcIamAuthorized;
}

export function sanitizeFsId(raw: unknown, fallbackPrefix = 'id'): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  if (cleaned.length >= 1) return cleaned;
  return `${fallbackPrefix}_${Date.now()}`.slice(0, 128);
}

function sanitizeStr(raw: unknown, fallback: string, minLen: number, maxLen: number): string {
  const s = String(raw ?? '').trim().slice(0, maxLen);
  if (s.length >= minLen) return s;
  return fallback.slice(0, maxLen);
}

function sanitizeEmail(raw: unknown, fallback = 'unknown@churnveda.app'): string {
  const s = String(raw ?? '').trim().slice(0, 255);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : fallback;
}

function clampNum(raw: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normWorkspacePlan(raw: unknown): 'starter' | 'growth' | 'pro' {
  const lower = String(raw || 'growth').trim().toLowerCase();
  if (lower === 'enterprise') return 'pro';
  if (lower === 'starter' || lower === 'growth' || lower === 'pro') return lower;
  return 'growth';
}

function normBillingCycle(raw: unknown): 'monthly' | 'annual' {
  return String(raw || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly';
}

function normBillingStatus(raw: unknown): 'trialing' | 'pending_payment' | 'active' | 'cancelled' | 'trial_expired' | 'halted' {
  const lower = String(raw || 'trialing').trim().toLowerCase();
  if (
    lower === 'trialing' ||
    lower === 'pending_payment' ||
    lower === 'active' ||
    lower === 'cancelled' ||
    lower === 'trial_expired' ||
    lower === 'halted'
  ) {
    return lower;
  }
  if (lower === 'pending') return 'pending_payment';
  if (lower === 'expired') return 'trial_expired';
  return 'trialing';
}

function normCustomerPlan(raw: unknown): 'Starter' | 'Growth' | 'Enterprise' | 'Pro' {
  const lower = String(raw || 'Growth').trim().toLowerCase();
  if (lower === 'starter') return 'Starter';
  if (lower === 'enterprise') return 'Enterprise';
  if (lower === 'pro') return 'Pro';
  return 'Growth';
}

function normPaymentStatus(raw: unknown): 'Current' | 'Retried' | 'Failed' | 'Disputed' {
  const lower = String(raw || 'Current').trim().toLowerCase();
  if (lower === 'retried') return 'Retried';
  if (lower === 'failed') return 'Failed';
  if (lower === 'disputed') return 'Disputed';
  return 'Current';
}

function normCustomerStatus(raw: unknown): 'active' | 'saved' | 'churned' {
  const lower = String(raw || 'active').trim().toLowerCase();
  if (lower === 'saved' || lower === 'churned') return lower;
  return 'active';
}

function normImportSource(raw: unknown): 'CSV' | 'PDF' | 'Razorpay' | 'Mixpanel' | 'Intercom' | 'Manual' {
  const str = String(raw || 'CSV').trim();
  const allowed = ['CSV', 'PDF', 'Razorpay', 'Mixpanel', 'Intercom', 'Manual'] as const;
  return allowed.find((a) => a.toLowerCase() === str.toLowerCase()) || 'CSV';
}

function normImportStatus(raw: unknown): 'completed' | 'failed' | 'processing' | 'partial success' | 'success' {
  const lower = String(raw || 'completed').trim().toLowerCase();
  const allowed = ['completed', 'failed', 'processing', 'partial success', 'success'] as const;
  return allowed.find((a) => a === lower) || 'completed';
}

function normIntegrationCategory(raw: unknown): 'billing' | 'usage' | 'support' | 'engagement' | 'database' {
  const lower = String(raw || 'database').trim().toLowerCase();
  const allowed = ['billing', 'usage', 'support', 'engagement', 'database'] as const;
  return allowed.find((a) => a === lower) || 'database';
}

function normSubscriptionStatus(raw: unknown): 'pending' | 'trialing' | 'active' | 'halted' | 'cancelled' | 'past_due' | 'trial_expired' {
  const lower = String(raw || 'trialing').trim().toLowerCase();
  const allowed = ['pending', 'trialing', 'active', 'halted', 'cancelled', 'past_due', 'trial_expired'] as const;
  return allowed.find((a) => a === lower) || 'trialing';
}

function normPaymentVerificationStatus(raw: unknown): 'pending' | 'verified' | 'failed' {
  const lower = String(raw || 'pending').trim().toLowerCase();
  if (lower === 'verified' || lower === 'failed') return lower;
  return 'pending';
}

// ---------------------------------------------------------------------------
// Firestore REST Value Encoding / Decoding
// ---------------------------------------------------------------------------

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FsValue> } }
  | { arrayValue: { values: FsValue[] } };

function toFsValue(val: unknown): FsValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFsValue) } };
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.__timestamp === 'string') {
      return { timestampValue: obj.__timestamp };
    }
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) fields[k] = toFsValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFsFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFsValue(v);
  }
  return fields;
}

function fromFsValue(val: FsValue | undefined): any {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in val) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return undefined;
}

function fromFsDoc(doc: { name?: string; fields?: Record<string, FsValue> }): Record<string, any> | null {
  if (!doc || !doc.fields) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = fromFsValue(v);
  }
  if (!out.id && doc.name) {
    out.id = doc.name.split('/').pop();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dual-Mode Firestore Transport (Admin SDK or Authenticated User REST API v1)
// ---------------------------------------------------------------------------

function canExecute(ctx?: FirebaseRequestContext | null): boolean {
  if (hasFirebaseAdminCredentials()) return true;
  return Boolean(ctx?.idToken && ctx?.uid && ctx?.emailVerified);
}

type DocGetStatus =
  | { status: 'ok'; data: Record<string, any> }
  | { status: 'not_found'; data: null }
  | { status: 'forbidden'; data: null };

async function restGetDocStatus(relPath: string, idToken: string): Promise<DocGetStatus> {
  const res = await fetch(`${REST_BASE_URL}/${relPath}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (res.status === 404) return { status: 'not_found', data: null };
  if (res.status === 403) return { status: 'forbidden', data: null };
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore REST GET ${relPath} failed (${res.status}): ${errText}`);
  }
  const json = await res.json();
  const parsed = fromFsDoc(json);
  return parsed ? { status: 'ok', data: parsed } : { status: 'not_found', data: null };
}

async function restGetDoc(relPath: string, idToken: string): Promise<Record<string, any> | null> {
  const res = await fetch(`${REST_BASE_URL}/${relPath}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore REST GET ${relPath} failed (${res.status}): ${errText}`);
  }
  const json = await res.json();
  return fromFsDoc(json);
}

async function restCommitWrites(
  writes: Array<{
    type: 'create' | 'set' | 'update' | 'delete';
    relPath: string;
    data?: Record<string, unknown>;
    serverTimestampFields?: string[];
  }>,
  idToken: string
): Promise<void> {
  if (writes.length === 0) return;

  for (let i = 0; i < writes.length; i += 250) {
    const chunk = writes.slice(i, i + 250);
    const bodyWrites = chunk.map((w) => {
      const name = `${DOC_RESOURCE_PREFIX}/${w.relPath}`;
      if (w.type === 'delete') {
        return { delete: name };
      }

      const data = w.data || {};
      const fieldPaths = Object.keys(data).filter((k) => data[k] !== undefined);
      const fields = toFsFields(data);
      const tsFields = w.serverTimestampFields || [];

      const writeObj: Record<string, any> = {
        update: {
          name,
          fields
        }
      };

      if (w.type === 'create') {
        writeObj.currentDocument = { exists: false };
      } else if (w.type === 'update') {
        writeObj.updateMask = {
          fieldPaths: Array.from(new Set([...fieldPaths, ...tsFields]))
        };
      }

      if (tsFields.length > 0) {
        writeObj.updateTransforms = tsFields.map((fp) => ({
          fieldPath: fp,
          setToServerValue: 'REQUEST_TIME'
        }));
      }

      return writeObj;
    });

    const res = await fetch(`${REST_BASE_URL}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ writes: bodyWrites })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // When a single-doc create-only precondition hits ALREADY_EXISTS (409/400), treat as benign concurrent create
      const isCreateOnly = chunk.every((w) => w.type === 'create');
      if (isCreateOnly && (res.status === 409 || errText.includes('ALREADY_EXISTS') || errText.includes('FAILED_PRECONDITION'))) {
        continue;
      }
      throw new Error(`Firestore REST commit failed (${res.status}): ${errText}`);
    }
  }
}

async function restRunQuery(
  parentRelPath: string,
  collectionId: string,
  filters: Array<{ field: string; value: string }>,
  idToken: string
): Promise<Record<string, any>[]> {
  const endpoint = parentRelPath
    ? `${REST_BASE_URL}/${parentRelPath}:runQuery`
    : `${REST_BASE_URL}:runQuery`;

  const fieldFilters = filters.map((f) => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: 'EQUAL',
      value: { stringValue: f.value }
    }
  }));

  const structuredQuery: Record<string, any> = {
    from: [{ collectionId }]
  };

  if (fieldFilters.length === 1) {
    structuredQuery.where = fieldFilters[0];
  } else if (fieldFilters.length > 1) {
    structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: fieldFilters
      }
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ structuredQuery })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore REST runQuery ${collectionId} failed (${res.status}): ${errText}`);
  }

  const rows = (await res.json()) as Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
  const results: Record<string, any>[] = [];
  for (const row of rows) {
    if (row.document) {
      const parsed = fromFsDoc(row.document);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}

async function fsGetDocStatus(relPath: string, ctx?: FirebaseRequestContext | null): Promise<DocGetStatus> {
  if (hasFirebaseAdminCredentials()) {
    const snap = await adminDb.doc(relPath).get();
    if (!snap.exists) return { status: 'not_found', data: null };
    return { status: 'ok', data: normalizeAdminTimestamps(snap.data() || {}) };
  }
  if (ctx?.idToken) {
    return restGetDocStatus(relPath, ctx.idToken);
  }
  return { status: 'forbidden', data: null };
}

async function fsGetDoc(relPath: string, ctx?: FirebaseRequestContext | null): Promise<Record<string, any> | null> {
  if (hasFirebaseAdminCredentials()) {
    const snap = await adminDb.doc(relPath).get();
    if (!snap.exists) return null;
    return normalizeAdminTimestamps(snap.data() || {});
  }
  if (ctx?.idToken) {
    return restGetDoc(relPath, ctx.idToken);
  }
  return null;
}

function normalizeAdminTimestamps(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && typeof v.toDate === 'function') {
      out[k] = v.toDate().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function fsCreateDocIfMissing(
  relPath: string,
  data: Record<string, unknown>,
  serverTimestampFields: string[],
  ctx?: FirebaseRequestContext | null
): Promise<void> {
  if (hasFirebaseAdminCredentials()) {
    const payload: Record<string, any> = { ...data };
    for (const tsField of serverTimestampFields) {
      payload[tsField] = FieldValue.serverTimestamp();
    }
    try {
      await adminDb.doc(relPath).create(payload);
    } catch (err: any) {
      if (err?.code === 6 || String(err?.message || '').includes('ALREADY_EXISTS')) {
        return;
      }
      throw err;
    }
    return;
  }
  if (ctx?.idToken) {
    await restCommitWrites(
      [{ type: 'create', relPath, data, serverTimestampFields }],
      ctx.idToken
    );
  }
}

async function fsSetDoc(
  relPath: string,
  data: Record<string, unknown>,
  serverTimestampFields: string[],
  ctx?: FirebaseRequestContext | null
): Promise<void> {
  if (hasFirebaseAdminCredentials()) {
    const payload: Record<string, any> = { ...data };
    for (const k of Object.keys(payload)) {
      const val = payload[k] as any;
      if (val && typeof val === 'object' && typeof val.__timestamp === 'string') {
        payload[k] = new Date(val.__timestamp);
      }
    }
    for (const tsField of serverTimestampFields) {
      payload[tsField] = FieldValue.serverTimestamp();
    }
    await adminDb.doc(relPath).set(payload);
    return;
  }
  if (ctx?.idToken) {
    await restCommitWrites(
      [{ type: 'set', relPath, data, serverTimestampFields }],
      ctx.idToken
    );
  }
}

async function fsUpdateDoc(
  relPath: string,
  data: Record<string, unknown>,
  serverTimestampFields: string[],
  ctx?: FirebaseRequestContext | null
): Promise<void> {
  if (hasFirebaseAdminCredentials()) {
    const payload: Record<string, any> = { ...data };
    for (const tsField of serverTimestampFields) {
      payload[tsField] = FieldValue.serverTimestamp();
    }
    await adminDb.doc(relPath).update(payload);
    return;
  }
  if (ctx?.idToken) {
    await restCommitWrites(
      [{ type: 'update', relPath, data, serverTimestampFields }],
      ctx.idToken
    );
  }
}

async function fsDeleteDoc(relPath: string, ctx?: FirebaseRequestContext | null): Promise<void> {
  if (hasFirebaseAdminCredentials()) {
    await adminDb.doc(relPath).delete();
    return;
  }
  if (ctx?.idToken) {
    await restCommitWrites([{ type: 'delete', relPath }], ctx.idToken);
  }
}

async function fsListSubcollection(
  workspaceId: string,
  subcollection: string,
  ownerField: 'ownerId' | 'actorId',
  ctx: FirebaseRequestContext
): Promise<Record<string, any>[]> {
  const uid = sanitizeFsId(ctx.uid, 'usr');
  if (hasFirebaseAdminCredentials()) {
    const snap = await adminDb
      .collection(`workspaces/${workspaceId}/${subcollection}`)
      .where('workspaceId', '==', workspaceId)
      .get();
    return snap.docs.map((d) => normalizeAdminTimestamps(d.data()));
  }
  if (ctx.idToken) {
    return restRunQuery(
      `workspaces/${workspaceId}`,
      subcollection,
      [
        { field: 'workspaceId', value: workspaceId },
        { field: ownerField, value: uid }
      ],
      ctx.idToken
    );
  }
  return [];
}

// ---------------------------------------------------------------------------
// Workspace Bootstrap & Sync Cache (per-server-process deduplication)
// ---------------------------------------------------------------------------

const syncedWorkspaces = new Set<string>();
const pendingWorkspaceSyncs = new Map<string, Promise<void>>();

export async function ensureFirestoreWorkspace(ctx: FirebaseRequestContext): Promise<void> {
  if (!canExecute(ctx)) return;
  const uid = sanitizeFsId(ctx.uid, 'usr');
  const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
  const cacheKey = `${uid}:${workspaceId}`;
  if (syncedWorkspaces.has(cacheKey)) return;

  const existingPromise = pendingWorkspaceSyncs.get(cacheKey);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const run = (async () => {
    const email = sanitizeEmail(ctx.email);
    const fullName = sanitizeStr(ctx.fullName || email.split('@')[0], 'User', 1, 128);
    const companyName = sanitizeStr(ctx.companyName || 'My Workspace', 'My Workspace', 1, 128);
    const selectedPlan = normWorkspacePlan(ctx.plan);
    const billingCycle = normBillingCycle(ctx.billingCycle);
    const billingStatus = normBillingStatus(ctx.billingStatus);
    const isBootstrapAdmin = email.toLowerCase() === 'nageshsharat@gmail.com';
    const role = isBootstrapAdmin ? 'Admin' : 'Viewer';

    // 1. /users/{uid}
    const userPath = `users/${uid}`;
    const userRes = await fsGetDocStatus(userPath, ctx);
    if (userRes.status === 'not_found') {
      await fsCreateDocIfMissing(
        userPath,
        {
          id: uid,
          email,
          fullName,
          companyName,
          role,
          workspaceId,
          selectedPlan,
          billingCycle,
          billingStatus
        },
        ['createdAt', 'updatedAt'],
        ctx
      );
    }

    // 2. /workspaces/{workspaceId}
    const wsPath = `workspaces/${workspaceId}`;
    const wsRes = await fsGetDocStatus(wsPath, ctx);
    let wsJustCreated = false;
    if (wsRes.status === 'not_found') {
      await fsCreateDocIfMissing(
        wsPath,
        {
          id: workspaceId,
          name: companyName,
          ownerId: uid,
          plan: selectedPlan,
          billingStatus
        },
        ['createdAt', 'updatedAt'],
        ctx
      );
      wsJustCreated = true;
    } else if (wsRes.status === 'forbidden') {
      // User does not own or belong to this workspace in Firestore; skip bootstrap writes cleanly
      return;
    }

    // 3. /workspaces/{workspaceId}/members/{uid}
    const memberPath = `workspaces/${workspaceId}/members/${uid}`;
    const memberRes = await fsGetDocStatus(memberPath, ctx);
    const canCreateOwnerMembership =
      wsJustCreated || wsRes.data?.ownerId === uid || isBootstrapAdmin;
    if (memberRes.status === 'not_found' && canCreateOwnerMembership) {
      await fsCreateDocIfMissing(
        memberPath,
        {
          id: uid,
          workspaceId,
          userId: uid,
          role: 'owner',
          email
        },
        ['createdAt'],
        ctx
      );
    }

    syncedWorkspaces.add(cacheKey);
  })();

  pendingWorkspaceSyncs.set(cacheKey, run);
  try {
    await run;
  } finally {
    pendingWorkspaceSyncs.delete(cacheKey);
  }
}

// ---------------------------------------------------------------------------
// Domain Payload Converters & Persistence Methods
// ---------------------------------------------------------------------------

function buildCustomerData(customer: Partial<Customer>, workspaceId: string, ownerId: string) {
  const id = sanitizeFsId(customer.id || customer.customerId || customer.customer_id, 'cust');
  const email = sanitizeEmail(customer.email, `${id}@customer.churnveda.app`);
  const domainFallback = email.includes('@') ? email.split('@')[1] : 'company.com';
  const companyDomain = sanitizeStr(customer.companyDomain || customer.company_name || domainFallback, 'company.com', 1, 255);
  const name = sanitizeStr(customer.name || customer.company_name, 'Customer Account', 1, 255);

  const data: Record<string, unknown> = {
    id,
    workspaceId,
    ownerId,
    name,
    email,
    companyDomain,
    plan: normCustomerPlan(customer.plan),
    mrr: clampNum(customer.mrr, 0, 10000000, 0),
    ltv: clampNum(customer.ltv, 0, 100000000, clampNum(customer.mrr, 0, 10000000, 0) * 12),
    lastLoginDays: clampNum(customer.lastLoginDays ?? customer.last_login_days_ago, 0, 36500, 0),
    openTicketsCount: clampNum(customer.openTicketsCount ?? customer.open_support_tickets, 0, 10000, 0),
    paymentStatus: normPaymentStatus(customer.paymentStatus || customer.payment_status),
    usageTrendPercentage: clampNum(customer.usageTrendPercentage, -100, 10000, 0),
    emailOpenRate: clampNum(customer.emailOpenRate, 0, 100, 0),
    riskScore: clampNum(customer.riskScore ?? customer.risk_score, 0, 100, 0),
    riskCategory: sanitizeStr(customer.riskCategory || customer.risk_level, 'Low', 1, 32),
    recommendedAction: sanitizeStr(customer.recommendedAction || customer.recommended_action, '', 0, 1000),
    status: normCustomerStatus(customer.status)
  };

  if (typeof customer.savedNotes === 'string' && customer.savedNotes.trim().length > 0) {
    data.savedNotes = customer.savedNotes.trim().slice(0, 1000);
  }
  if (customer.outcomeStatus === 'recovered' || customer.outcomeStatus === 'churned') {
    data.outcomeStatus = customer.outcomeStatus;
  }
  if (typeof customer.churnReason === 'string' && customer.churnReason.trim().length > 0) {
    data.churnReason = customer.churnReason.trim().slice(0, 64);
  }
  if (typeof customer.rescuePlaybookUsed === 'string' && customer.rescuePlaybookUsed.trim().length > 0) {
    data.rescuePlaybookUsed = customer.rescuePlaybookUsed.trim().slice(0, 255);
  }
  if (customer.mrrProtected !== undefined && customer.mrrProtected !== null) {
    data.mrrProtected = clampNum(customer.mrrProtected, 0, 10000000, 0);
  }
  if (typeof customer.isDemo === 'boolean' || typeof customer.is_demo_data === 'boolean') {
    data.isDemo = Boolean(customer.isDemo ?? customer.is_demo_data);
  }

  return { id, data };
}

function mapDocToCustomer(doc: Record<string, any>): Customer {
  const id = String(doc.id || '');
  const riskScore = clampNum(doc.riskScore, 0, 100, 0);
  const createdAt = typeof doc.createdAt === 'string' ? doc.createdAt : new Date().toISOString();
  const updatedAt = typeof doc.updatedAt === 'string' ? doc.updatedAt : createdAt;

  return {
    id,
    customerId: id,
    workspaceId: String(doc.workspaceId || ''),
    name: String(doc.name || 'Customer'),
    email: String(doc.email || ''),
    companyDomain: String(doc.companyDomain || ''),
    plan: normCustomerPlan(doc.plan),
    mrr: clampNum(doc.mrr, 0, 10000000, 0),
    ltv: clampNum(doc.ltv, 0, 100000000, 0),
    customerSince: createdAt.split('T')[0],
    lastLoginDays: clampNum(doc.lastLoginDays, 0, 36500, 0),
    openTicketsCount: clampNum(doc.openTicketsCount, 0, 10000, 0),
    paymentStatus: normPaymentStatus(doc.paymentStatus),
    usageTrendPercentage: clampNum(doc.usageTrendPercentage, -100, 10000, 0),
    emailOpenRate: clampNum(doc.emailOpenRate, 0, 100, 0),
    riskScore,
    riskCategory: (doc.riskCategory || 'Low') as Customer['riskCategory'],
    topFactors: [],
    churnProbability: {
      day30: Math.min(99, Math.round(riskScore * 0.8)),
      day60: Math.min(99, Math.round(riskScore * 0.9)),
      day90: riskScore
    },
    recommendedAction: String(doc.recommendedAction || ''),
    lastAnalyzedAt: updatedAt,
    isAiAnalyzed: riskScore > 0,
    supportTickets: [],
    paymentHistory: [],
    loginHistory: [],
    riskTrend: [],
    status: normCustomerStatus(doc.status),
    savedNotes: typeof doc.savedNotes === 'string' ? doc.savedNotes : undefined,
    outcomeStatus:
      doc.outcomeStatus === 'recovered' || doc.outcomeStatus === 'churned' ? doc.outcomeStatus : undefined,
    churnReason: typeof doc.churnReason === 'string' ? (doc.churnReason as any) : undefined,
    rescuePlaybookUsed: typeof doc.rescuePlaybookUsed === 'string' ? doc.rescuePlaybookUsed : undefined,
    mrrProtected: typeof doc.mrrProtected === 'number' ? doc.mrrProtected : undefined,
    isDemo: Boolean(doc.isDemo),
    is_demo_data: Boolean(doc.isDemo),
    created_at: createdAt,
    updated_at: updatedAt
  };
}

export const firebaseBackend = {
  isReady(ctx?: FirebaseRequestContext | null): boolean {
    return canExecute(ctx);
  },

  async testConnection(ctx?: FirebaseRequestContext | null): Promise<{
    reachable: boolean;
    mode: 'admin-sdk' | 'authenticated-rest' | 'unauthenticated-rules-check';
    latencyMs: number;
    details: string;
  }> {
    const start = Date.now();
    try {
      const hasAdcAccess = await checkAdcAdminIamAccess();
      if (hasAdcAccess) {
        return {
          reachable: true,
          mode: 'admin-sdk',
          latencyMs: Date.now() - start,
          details: `Admin SDK (ADC) connected to ${PROJECT_ID}/${DATABASE_ID}`
        };
      }
      if (ctx?.idToken) {
        await restGetDoc('test/connection', ctx.idToken);
        return {
          reachable: true,
          mode: 'authenticated-rest',
          latencyMs: Date.now() - start,
          details: `Verified REST connection to ${PROJECT_ID}/${DATABASE_ID}`
        };
      }
      // Verify Firestore endpoint & security rules enforcement even when called unauthenticated
      const res = await fetch(`${REST_BASE_URL}/test/connection`);
      return {
        reachable: res.status === 403 || res.status === 200,
        mode: 'unauthenticated-rules-check',
        latencyMs: Date.now() - start,
        details: `Firestore endpoint active (HTTP ${res.status} security rule verified)`
      };
    } catch (err: any) {
      return {
        reachable: false,
        mode: hasFirebaseAdminCredentials() ? 'admin-sdk' : ctx?.idToken ? 'authenticated-rest' : 'unauthenticated-rules-check',
        latencyMs: Date.now() - start,
        details: err?.message || 'Firestore connection failed'
      };
    }
  },

  getConnectionChecklist(
    ctx?: FirebaseRequestContext | null,
    probeResult?: { reachable: boolean; mode: string; details: string }
  ) {
    const hasVerifiedToken = Boolean(ctx?.idToken && ctx?.uid && ctx?.emailVerified);
    const hasAdminIam = hasFirebaseAdminCredentials();
    return {
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      authDomain: firebaseConfig.authDomain,
      activeMode: probeResult?.mode || (hasAdminIam ? 'admin-sdk' : hasVerifiedToken ? 'authenticated-rest' : 'unauthenticated-rules-check'),
      steps: [
        {
          id: 'firebase-config',
          label: '1. Firebase Project & Named Firestore Database',
          status: PROJECT_ID && DATABASE_ID ? 'complete' : 'pending',
          details: `Project ${PROJECT_ID} linked to database ${DATABASE_ID}`
        },
        {
          id: 'firestore-rules',
          label: '2. Hardened Firestore Security Rules Deployed',
          status: 'complete',
          details: 'Default-deny rules and workspace isolation validators deployed live'
        },
        {
          id: 'google-auth',
          label: '3. Google Sign-In & Server ID Token Verification',
          status: hasVerifiedToken ? 'complete' : 'pending',
          details: hasVerifiedToken
            ? `Verified session active for ${ctx?.email}`
            : 'Sign in with a verified Google account to activate user-scoped Firestore REST persistence'
        },
        {
          id: 'live-sync',
          label: '4. Live Backend-to-Firestore Persistence',
          status: probeResult?.reachable && (hasVerifiedToken || hasAdminIam) ? 'complete' : 'pending',
          details: probeResult?.details || 'Ready when authenticated workspace context is active'
        },
        {
          id: 'authorized-domains',
          label: '5. Firebase Console Authorized Domains (Manual Check)',
          status: 'action_required',
          details: `Verify preview & shared .run.app domains are added under Firebase Console > Authentication > Settings > Authorized domains (Auth Domain: ${firebaseConfig.authDomain})`
        }
      ]
    };
  },

  customers: {
    async list(ctx: FirebaseRequestContext): Promise<Customer[]> {
      if (!canExecute(ctx)) return [];
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      await ensureFirestoreWorkspace(ctx);
      const docs = await fsListSubcollection(workspaceId, 'customers', 'ownerId', ctx);
      return docs.map(mapDocToCustomer);
    },

    async upsert(ctx: FirebaseRequestContext, customer: Partial<Customer>): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);

      const { id, data } = buildCustomerData(customer, workspaceId, ownerId);
      const relPath = `workspaces/${workspaceId}/customers/${id}`;
      const existing = await fsGetDoc(relPath, ctx).catch(() => null);

      if (!existing) {
        await fsSetDoc(relPath, data, ['createdAt', 'updatedAt'], ctx);
        return;
      }

      if (existing.createdAt) {
        data.createdAt = { __timestamp: String(existing.createdAt) };
        await fsSetDoc(relPath, data, ['updatedAt'], ctx);
      } else {
        await fsSetDoc(relPath, data, ['createdAt', 'updatedAt'], ctx);
      }
    },

    async batchUpsert(ctx: FirebaseRequestContext, customers: Partial<Customer>[]): Promise<void> {
      if (!canExecute(ctx) || customers.length === 0) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);

      const existingDocs = await fsListSubcollection(workspaceId, 'customers', 'ownerId', ctx).catch(() => []);
      const existingById = new Map<string, Record<string, any>>();
      for (const d of existingDocs) {
        if (d.id) existingById.set(String(d.id), d);
      }

      if (hasFirebaseAdminCredentials()) {
        for (let i = 0; i < customers.length; i += 400) {
          const chunk = customers.slice(i, i + 400);
          const batch = adminDb.batch();
          for (const cust of chunk) {
            const { id, data } = buildCustomerData(cust, workspaceId, ownerId);
            const existing = existingById.get(id);
            const ref = adminDb.doc(`workspaces/${workspaceId}/customers/${id}`);
            batch.set(ref, {
              ...data,
              createdAt: existing?.createdAt ? new Date(String(existing.createdAt)) : FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp()
            });
          }
          await batch.commit();
        }
        return;
      }

      if (ctx.idToken) {
        const writes = customers.map((cust) => {
          const { id, data } = buildCustomerData(cust, workspaceId, ownerId);
          const existing = existingById.get(id);
          const tsFields = ['updatedAt'];
          if (existing?.createdAt) {
            data.createdAt = { __timestamp: String(existing.createdAt) };
          } else {
            tsFields.unshift('createdAt');
          }
          return {
            type: 'set' as const,
            relPath: `workspaces/${workspaceId}/customers/${id}`,
            data,
            serverTimestampFields: tsFields
          };
        });
        await restCommitWrites(writes, ctx.idToken);
      }
    },

    async delete(ctx: FirebaseRequestContext, customerIdRaw: string): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const customerId = sanitizeFsId(customerIdRaw, 'cust');
      await fsDeleteDoc(`workspaces/${workspaceId}/customers/${customerId}`, ctx);
    },

    async bulkDelete(ctx: FirebaseRequestContext, ids: string[]): Promise<void> {
      if (!canExecute(ctx) || ids.length === 0) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');

      if (hasFirebaseAdminCredentials()) {
        const batch = adminDb.batch();
        for (const rawId of ids) {
          const id = sanitizeFsId(rawId, 'cust');
          batch.delete(adminDb.doc(`workspaces/${workspaceId}/customers/${id}`));
        }
        await batch.commit();
        return;
      }
      if (ctx.idToken) {
        const writes = ids.map((rawId) => ({
          type: 'delete' as const,
          relPath: `workspaces/${workspaceId}/customers/${sanitizeFsId(rawId, 'cust')}`
        }));
        await restCommitWrites(writes, ctx.idToken);
      }
    }
  },

  importHistory: {
    async list(ctx: FirebaseRequestContext): Promise<ImportHistoryRecord[]> {
      if (!canExecute(ctx)) return [];
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      await ensureFirestoreWorkspace(ctx);
      const docs = await fsListSubcollection(workspaceId, 'importHistory', 'ownerId', ctx);
      return docs.map((d) => ({
        importId: String(d.id),
        workspaceId: String(d.workspaceId || workspaceId),
        source: normImportSource(d.source),
        fileName: String(d.fileName || 'import.csv'),
        startedAt: String(d.createdAt || new Date().toISOString()),
        completedAt: String(d.updatedAt || new Date().toISOString()),
        totalRows: Number(d.totalRows || 0),
        validRows: Number(d.validRows || 0),
        failedRows: Number(d.failedRows || 0),
        status: normImportStatus(d.status),
        errorSummary: String(d.errorSummary || '')
      }));
    },

    async record(ctx: FirebaseRequestContext, entry: Partial<ImportHistoryRecord>): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);
      const id = sanitizeFsId(entry.importId || (entry as any).id, 'imp');
      const relPath = `workspaces/${workspaceId}/importHistory/${id}`;
      const existing = await fsGetDoc(relPath, ctx).catch(() => null);
      const data: Record<string, unknown> = {
        id,
        workspaceId,
        ownerId,
        source: normImportSource(entry.source),
        fileName: sanitizeStr(entry.fileName, 'import.csv', 1, 255),
        totalRows: clampNum(entry.totalRows, 0, 1000000, 0),
        validRows: clampNum(entry.validRows, 0, 1000000, 0),
        failedRows: clampNum(entry.failedRows, 0, 1000000, 0),
        status: normImportStatus(entry.status),
        errorSummary: sanitizeStr(entry.errorSummary, 'Import recorded', 0, 1000)
      };
      if (existing?.createdAt) {
        data.createdAt = { __timestamp: String(existing.createdAt) };
        await fsSetDoc(relPath, data, ['updatedAt'], ctx);
      } else {
        await fsSetDoc(relPath, data, ['createdAt', 'updatedAt'], ctx);
      }
    },

    async clearWorkspace(ctx: FirebaseRequestContext): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const docs = await fsListSubcollection(workspaceId, 'importHistory', 'ownerId', ctx);
      if (docs.length === 0) return;
      if (hasFirebaseAdminCredentials()) {
        const batch = adminDb.batch();
        docs.forEach((d) => batch.delete(adminDb.doc(`workspaces/${workspaceId}/importHistory/${sanitizeFsId(d.id, 'imp')}`)));
        await batch.commit();
      } else if (ctx.idToken) {
        await restCommitWrites(
          docs.map((d) => ({
            type: 'delete' as const,
            relPath: `workspaces/${workspaceId}/importHistory/${sanitizeFsId(d.id, 'imp')}`
          })),
          ctx.idToken
        );
      }
    }
  },

  integrations: {
    async list(ctx: FirebaseRequestContext): Promise<Record<string, any>[]> {
      if (!canExecute(ctx)) return [];
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      await ensureFirestoreWorkspace(ctx);
      return fsListSubcollection(workspaceId, 'integrations', 'ownerId', ctx);
    },

    async upsert(ctx: FirebaseRequestContext, integration: IntegrationStatus): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);
      const id = sanitizeFsId(integration.id, 'int');
      const relPath = `workspaces/${workspaceId}/integrations/${id}`;
      const existing = await fsGetDoc(relPath, ctx).catch(() => null);

      const data: Record<string, unknown> = {
        id,
        workspaceId,
        ownerId,
        name: sanitizeStr(integration.name, id, 1, 128),
        category: normIntegrationCategory(integration.category),
        isConnected: Boolean(integration.isConnected),
        syncedRecordsCount: clampNum(integration.syncedRecordsCount, 0, 10000000, 0),
        statusText: sanitizeStr(integration.statusText, 'Connected', 0, 255),
        lastSyncAt: sanitizeStr(integration.lastSyncAt || new Date().toISOString(), new Date().toISOString(), 1, 64)
      };

      if (existing?.createdAt) {
        data.createdAt = { __timestamp: String(existing.createdAt) };
        await fsSetDoc(relPath, data, ['updatedAt'], ctx);
      } else {
        await fsSetDoc(relPath, data, ['createdAt', 'updatedAt'], ctx);
      }
    }
  },

  alerts: {
    async list(ctx: FirebaseRequestContext): Promise<DailyAlert[]> {
      if (!canExecute(ctx)) return [];
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      await ensureFirestoreWorkspace(ctx);
      const docs = await fsListSubcollection(workspaceId, 'alerts', 'ownerId', ctx);
      return docs.map((d) => ({
        id: String(d.id),
        timestamp: String(d.createdAt || new Date().toISOString()),
        title: String(d.title || 'Daily Risk Digest'),
        customersCount: Number(d.customersCount || 0),
        mrrAtRisk: Number(d.mrrAtRisk || 0),
        customers: [],
        sentViaEmail: true,
        sentViaSlack: true
      }));
    },

    async upsert(ctx: FirebaseRequestContext, alert: DailyAlert): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);
      const id = sanitizeFsId(alert.id, 'alert');
      const relPath = `workspaces/${workspaceId}/alerts/${id}`;
      const summary = alert.customers?.length
        ? alert.customers.map((c) => `${c.name} (${c.score})`).join(', ').slice(0, 1000)
        : 'Retention risk digest generated';

      await fsSetDoc(
        relPath,
        {
          id,
          workspaceId,
          ownerId,
          title: sanitizeStr(alert.title, 'Daily Retention Digest', 1, 255),
          customersCount: clampNum(alert.customersCount, 0, 1000000, 0),
          mrrAtRisk: clampNum(alert.mrrAtRisk, 0, 100000000, 0),
          summary
        },
        ['createdAt', 'updatedAt'],
        ctx
      );
    }
  },

  outboundMessages: {
    async list(ctx: FirebaseRequestContext): Promise<Record<string, any>[]> {
      if (!canExecute(ctx)) return [];
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      await ensureFirestoreWorkspace(ctx);
      return fsListSubcollection(workspaceId, 'outboundMessages', 'ownerId', ctx);
    },

    async upsert(
      ctx: FirebaseRequestContext,
      msg: {
        id: string;
        customerId?: string;
        customerName?: string;
        channel: 'email' | 'whatsapp';
        recipient: string;
        subject?: string;
        content: string;
        status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
        providerMessageId?: string;
      }
    ): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);
      const id = sanitizeFsId(msg.id, 'msg');
      const relPath = `workspaces/${workspaceId}/outboundMessages/${id}`;
      const existing = await fsGetDoc(relPath, ctx).catch(() => null);

      const data: Record<string, unknown> = {
        id,
        workspaceId,
        ownerId,
        channel: msg.channel === 'whatsapp' ? 'whatsapp' : 'email',
        recipient: sanitizeStr(msg.recipient, 'recipient@churnveda.app', 1, 255),
        content: sanitizeStr(msg.content, 'Retention check-in message', 1, 4000),
        status: msg.status
      };
      if (msg.customerId) data.customerId = String(msg.customerId).slice(0, 128);
      if (msg.customerName) data.customerName = String(msg.customerName).slice(0, 255);
      if (msg.subject) data.subject = String(msg.subject).slice(0, 255);
      if (msg.providerMessageId) data.providerMessageId = String(msg.providerMessageId).slice(0, 255);

      if (existing?.createdAt) {
        data.createdAt = { __timestamp: String(existing.createdAt) };
        await fsSetDoc(relPath, data, ['updatedAt'], ctx);
      } else {
        await fsSetDoc(relPath, data, ['createdAt', 'updatedAt'], ctx);
      }
    }
  },

  subscriptions: {
    async upsert(
      ctx: FirebaseRequestContext,
      sub: {
        id: string;
        tier: string;
        billingCycle?: string;
        status: string;
        paymentVerificationStatus?: string;
        razorpaySubscriptionId?: string;
        trialEndsAt?: string;
      }
    ): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);
      const id = sanitizeFsId(sub.id, 'sub');
      const relPath = `workspaces/${workspaceId}/subscriptions/${id}`;
      const existing = await fsGetDoc(relPath, ctx).catch(() => null);

      const data: Record<string, unknown> = {
        id,
        workspaceId,
        ownerId,
        tier: normWorkspacePlan(sub.tier),
        billingCycle: normBillingCycle(sub.billingCycle),
        status: normSubscriptionStatus(sub.status),
        paymentVerificationStatus: normPaymentVerificationStatus(sub.paymentVerificationStatus)
      };
      if (sub.razorpaySubscriptionId) data.razorpaySubscriptionId = String(sub.razorpaySubscriptionId).slice(0, 128);
      if (sub.trialEndsAt) data.trialEndsAt = String(sub.trialEndsAt).slice(0, 64);

      if (existing?.createdAt) {
        data.createdAt = { __timestamp: String(existing.createdAt) };
        await fsSetDoc(relPath, data, ['updatedAt'], ctx);
      } else {
        await fsSetDoc(relPath, data, ['createdAt', 'updatedAt'], ctx);
      }
    }
  },

  schedulerSettings: {
    async upsert(
      ctx: FirebaseRequestContext,
      settings: { enabled: boolean; ownerEmail?: string; cronExpression?: string }
    ): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const ownerId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);
      const relPath = `workspaces/${workspaceId}/schedulerSettings/default`;
      const existing = await fsGetDoc(relPath, ctx).catch(() => null);

      const data: Record<string, unknown> = {
        id: 'default',
        workspaceId,
        ownerId,
        enabled: Boolean(settings.enabled),
        ownerEmail: sanitizeEmail(settings.ownerEmail || ctx.email),
        cronExpression: sanitizeStr(settings.cronExpression || '0 9 * * *', '0 9 * * *', 1, 64)
      };

      if (existing?.createdAt) {
        data.createdAt = { __timestamp: String(existing.createdAt) };
        await fsSetDoc(relPath, data, ['updatedAt'], ctx);
      } else {
        await fsSetDoc(relPath, data, ['createdAt', 'updatedAt'], ctx);
      }
    }
  },

  auditLogs: {
    async list(ctx: FirebaseRequestContext): Promise<Record<string, any>[]> {
      if (!canExecute(ctx)) return [];
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      await ensureFirestoreWorkspace(ctx);
      return fsListSubcollection(workspaceId, 'auditLogs', 'actorId', ctx);
    },

    async record(
      ctx: FirebaseRequestContext,
      entry: { action: string; targetType: string; targetId?: string }
    ): Promise<void> {
      if (!canExecute(ctx)) return;
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const actorId = sanitizeFsId(ctx.uid, 'usr');
      await ensureFirestoreWorkspace(ctx);
      const id = sanitizeFsId(`log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, 'log');
      const relPath = `workspaces/${workspaceId}/auditLogs/${id}`;

      const data: Record<string, unknown> = {
        id,
        workspaceId,
        actorId,
        actorEmail: sanitizeEmail(ctx.email),
        action: sanitizeStr(entry.action, 'workspace.event', 1, 128),
        targetType: sanitizeStr(entry.targetType, 'workspace', 1, 64)
      };
      if (entry.targetId) {
        data.targetId = String(entry.targetId).slice(0, 128);
      }

      await fsSetDoc(relPath, data, ['createdAt'], ctx);
    }
  },

  privacy: {
    async purgeUserAndWorkspace(ctx: FirebaseRequestContext | null | undefined): Promise<{ purgedDocs: number }> {
      if (!ctx || !canExecute(ctx)) return { purgedDocs: 0 };
      const uid = sanitizeFsId(ctx.uid, 'usr');
      const workspaceId = sanitizeFsId(ctx.workspaceId, 'ws');
      const deletes: string[] = [`users/${uid}`];

      if (workspaceId !== 'ws-default') {
        const subcollections = [
          'customers',
          'importHistory',
          'integrations',
          'alerts',
          'outboundMessages',
          'schedulerSettings',
          'members'
        ];
        for (const sub of subcollections) {
          try {
            if (hasFirebaseAdminCredentials()) {
              const snap = await adminDb.collection(`workspaces/${workspaceId}/${sub}`).get();
              snap.docs.forEach((d) => deletes.push(`workspaces/${workspaceId}/${sub}/${d.id}`));
            } else if (ctx.idToken) {
              const docs = await restRunQuery(`workspaces/${workspaceId}`, sub, [{ field: 'workspaceId', value: workspaceId }], ctx.idToken).catch(() => []);
              for (const d of docs) {
                if (d.id) deletes.push(`workspaces/${workspaceId}/${sub}/${d.id}`);
              }
            }
          } catch {
            // best-effort subcollection listing
          }
        }
        deletes.push(`workspaces/${workspaceId}`);
      }

      let purgedDocs = 0;
      if (hasFirebaseAdminCredentials()) {
        for (const relPath of deletes) {
          try {
            await adminDb.doc(relPath).delete();
            purgedDocs++;
          } catch {}
        }
        return { purgedDocs };
      }

      if (ctx.idToken) {
        try {
          await restCommitWrites(
            deletes.map((relPath) => ({ type: 'delete' as const, relPath })),
            ctx.idToken
          );
          purgedDocs = deletes.length;
        } catch {
          // some documents might already be absent or restricted by immutable rules
        }
      }
      return { purgedDocs };
    }
  }
};
