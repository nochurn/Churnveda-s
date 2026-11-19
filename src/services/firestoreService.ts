import { onAuthStateChanged, type User as FbUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebaseClient';
import type { ChurnReasonType, Customer, ImportHistoryRecord, UserProfile } from '../types';

const ALLOWED_PLANS = ['starter', 'growth', 'pro'] as const;
const ALLOWED_BILLING_CYCLES = ['monthly', 'annual'] as const;
const ALLOWED_BILLING_STATUSES = [
  'trialing',
  'pending_payment',
  'active',
  'cancelled',
  'trial_expired',
  'halted'
] as const;

const ALLOWED_CUSTOMER_PLANS = ['Starter', 'Growth', 'Enterprise', 'Pro'] as const;
const ALLOWED_PAYMENT_STATUSES = ['Current', 'Retried', 'Failed', 'Disputed'] as const;
const ALLOWED_CUSTOMER_STATUSES = ['active', 'saved', 'churned'] as const;
const ALLOWED_IMPORT_SOURCES = ['CSV', 'PDF', 'Razorpay', 'Mixpanel', 'Intercom', 'Manual'] as const;
const ALLOWED_IMPORT_STATUSES = ['completed', 'failed', 'processing', 'partial success', 'success'] as const;

export function sanitizeId(raw: string | undefined | null, fallbackPrefix = 'id'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  if (cleaned.length >= 1) return cleaned;
  return `${fallbackPrefix}_${Date.now()}`.slice(0, 128);
}

function sanitizeString(raw: unknown, fallback: string, minLen: number, maxLen: number): string {
  const trimmed = String(raw ?? '').trim().slice(0, maxLen);
  if (trimmed.length >= minLen) return trimmed;
  return fallback.slice(0, maxLen);
}

function sanitizeEmail(raw: unknown, fallback = 'unknown@churnveda.app'): string {
  const candidate = String(raw ?? '').trim().slice(0, 255);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
    return candidate;
  }
  return fallback;
}

function clampNumber(raw: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeWorkspacePlan(raw: unknown): 'starter' | 'growth' | 'pro' {
  const lower = String(raw || 'growth').trim().toLowerCase();
  if (lower === 'enterprise') return 'pro';
  if ((ALLOWED_PLANS as readonly string[]).includes(lower)) {
    return lower as 'starter' | 'growth' | 'pro';
  }
  return 'growth';
}

function normalizeBillingCycle(raw: unknown): 'monthly' | 'annual' {
  const lower = String(raw || 'monthly').trim().toLowerCase();
  return (ALLOWED_BILLING_CYCLES as readonly string[]).includes(lower)
    ? (lower as 'monthly' | 'annual')
    : 'monthly';
}

function normalizeBillingStatus(
  raw: unknown
): 'trialing' | 'pending_payment' | 'active' | 'cancelled' | 'trial_expired' | 'halted' {
  const lower = String(raw || 'trialing').trim().toLowerCase();
  return (ALLOWED_BILLING_STATUSES as readonly string[]).includes(lower)
    ? (lower as 'trialing' | 'pending_payment' | 'active' | 'cancelled' | 'trial_expired' | 'halted')
    : 'trialing';
}

function normalizeCustomerPlan(raw: unknown): 'Starter' | 'Growth' | 'Enterprise' | 'Pro' {
  const lower = String(raw || 'Growth').trim().toLowerCase();
  if (lower === 'starter') return 'Starter';
  if (lower === 'enterprise') return 'Enterprise';
  if (lower === 'pro') return 'Pro';
  return (ALLOWED_CUSTOMER_PLANS.find((p) => p.toLowerCase() === lower) || 'Growth') as
    | 'Starter'
    | 'Growth'
    | 'Enterprise'
    | 'Pro';
}

function normalizePaymentStatus(raw: unknown): 'Current' | 'Retried' | 'Failed' | 'Disputed' {
  const lower = String(raw || 'Current').trim().toLowerCase();
  const matched = ALLOWED_PAYMENT_STATUSES.find((s) => s.toLowerCase() === lower);
  return matched || 'Current';
}

function normalizeCustomerStatus(raw: unknown): 'active' | 'saved' | 'churned' {
  const lower = String(raw || 'active').trim().toLowerCase();
  const matched = ALLOWED_CUSTOMER_STATUSES.find((s) => s === lower);
  return matched || 'active';
}

function normalizeImportSource(
  raw: unknown
): 'CSV' | 'PDF' | 'Razorpay' | 'Mixpanel' | 'Intercom' | 'Manual' {
  const str = String(raw || 'CSV').trim();
  const matched = ALLOWED_IMPORT_SOURCES.find((s) => s.toLowerCase() === str.toLowerCase());
  return matched || 'CSV';
}

function normalizeImportStatus(
  raw: unknown
): 'completed' | 'failed' | 'processing' | 'partial success' | 'success' {
  const lower = String(raw || 'completed').trim().toLowerCase();
  const matched = ALLOWED_IMPORT_STATUSES.find((s) => s === lower);
  return matched || 'completed';
}

const USER_PROFILE_KEYS = [
  'id',
  'email',
  'fullName',
  'companyName',
  'role',
  'workspaceId',
  'selectedPlan',
  'billingCycle',
  'billingStatus',
  'createdAt',
  'updatedAt'
] as const;

const WORKSPACE_KEYS = [
  'id',
  'name',
  'ownerId',
  'plan',
  'billingStatus',
  'createdAt',
  'updatedAt'
] as const;

const WORKSPACE_MEMBER_KEYS = [
  'id',
  'workspaceId',
  'userId',
  'role',
  'email',
  'createdAt'
] as const;

const CUSTOMER_REQUIRED_KEYS = [
  'id',
  'workspaceId',
  'ownerId',
  'name',
  'email',
  'companyDomain',
  'plan',
  'mrr',
  'ltv',
  'lastLoginDays',
  'openTicketsCount',
  'paymentStatus',
  'usageTrendPercentage',
  'emailOpenRate',
  'riskScore',
  'riskCategory',
  'recommendedAction',
  'status',
  'createdAt',
  'updatedAt'
] as const;

const CUSTOMER_ALLOWED_KEYS = [
  ...CUSTOMER_REQUIRED_KEYS,
  'savedNotes',
  'outcomeStatus',
  'churnReason',
  'rescuePlaybookUsed',
  'mrrProtected',
  'isDemo'
] as const;

const IMPORT_HISTORY_KEYS = [
  'id',
  'workspaceId',
  'ownerId',
  'source',
  'fileName',
  'totalRows',
  'validRows',
  'failedRows',
  'status',
  'errorSummary',
  'createdAt',
  'updatedAt'
] as const;

function isFirestoreTimestamp(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { toDate?: unknown }).toDate === 'function' &&
      typeof (value as { seconds?: unknown }).seconds === 'number'
  );
}

function hasRequiredAndAllowedKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  allowed: readonly string[]
): boolean {
  const keys = Object.keys(obj);
  return (
    required.every((k) => Object.prototype.hasOwnProperty.call(obj, k)) &&
    keys.every((k) => allowed.includes(k))
  );
}

const pendingWorkspaceSyncs = new Map<string, Promise<{ workspaceId: string } | null>>();
const syncedWorkspaces = new Set<string>();
let authSessionGeneration = 0;
let lastObservedUid: string | null = auth.currentUser?.uid ?? null;

if (typeof window !== 'undefined') {
  try {
    onAuthStateChanged(auth, (user) => {
      const nextUid = user?.uid ?? null;
      if (nextUid !== lastObservedUid) {
        authSessionGeneration += 1;
        syncedWorkspaces.clear();
        pendingWorkspaceSyncs.clear();
        lastObservedUid = nextUid;
      }
    });
  } catch {
    // ignore listener initialization errors in non-browser contexts
  }
}

export function isFirebaseFirestoreReady(): boolean {
  return Boolean(auth.currentUser && auth.currentUser.emailVerified && auth.currentUser.email);
}

function isSessionStillActive(runGeneration: number, runUid: string): boolean {
  return (
    runGeneration === authSessionGeneration &&
    isFirebaseFirestoreReady() &&
    auth.currentUser?.uid === runUid
  );
}

export function clearFirestoreSyncCache(): void {
  authSessionGeneration += 1;
  syncedWorkspaces.clear();
  pendingWorkspaceSyncs.clear();
}

export async function ensureWorkspaceSynced(
  workspaceIdRaw: string,
  profile?: Partial<UserProfile> | null
): Promise<void> {
  if (!isFirebaseFirestoreReady() || !auth.currentUser) return;
  const uid = sanitizeId(auth.currentUser.uid, 'usr');
  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');
  const syncKey = `${uid}:${workspaceId}`;

  if (syncedWorkspaces.has(syncKey)) {
    return;
  }

  const inFlight = pendingWorkspaceSyncs.get(syncKey);
  if (inFlight) {
    await inFlight;
    return;
  }

  await syncUserAndWorkspaceToFirestore(auth.currentUser, {
    ...profile,
    workspaceId
  });
}

/**
 * Synchronizes the authenticated Firebase user, workspace, and owner membership
 * to Cloud Firestore in strict dependency order so Eight Pillars security rules pass.
 * Deduplicates concurrent in-flight syncs and safely normalizes legacy documents.
 */
export async function syncUserAndWorkspaceToFirestore(
  fbUser: FbUser | null,
  profile?: Partial<UserProfile> | null
): Promise<{ workspaceId: string } | null> {
  if (!fbUser || !fbUser.emailVerified || !fbUser.email) {
    return null;
  }

  const uid = sanitizeId(fbUser.uid, 'usr');
  const workspaceId = sanitizeId(profile?.workspaceId || `ws_${uid.slice(0, 12)}`, 'ws');
  const syncKey = `${uid}:${workspaceId}`;

  const existingInFlight = pendingWorkspaceSyncs.get(syncKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const runGeneration = authSessionGeneration;
  const runRawUid = fbUser.uid;

  const runSync = (async (): Promise<{ workspaceId: string } | null> => {
    if (!isSessionStillActive(runGeneration, runRawUid)) {
      return null;
    }
    const email = sanitizeEmail(fbUser.email);
    const fullName = sanitizeString(profile?.name || fbUser.displayName || email.split('@')[0], 'User', 1, 128);
    const companyName = sanitizeString(profile?.company || 'My Company', 'My Company', 1, 128);
    const selectedPlan = normalizeWorkspacePlan(profile?.selectedPlan || profile?.plan);
    const billingCycle = normalizeBillingCycle(profile?.billingCycle);
    const billingStatus = normalizeBillingStatus(profile?.billingStatus);
    const isBootstrapAdmin = email.toLowerCase() === 'nageshsharat@gmail.com';
    const createRole: 'Admin' | 'Analyst' | 'Viewer' = isBootstrapAdmin ? 'Admin' : 'Viewer';

    // 1. Sync /users/{uid}
    const userPath = `users/${uid}`;
    const userRef = doc(db, 'users', uid);
    try {
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          id: uid,
          email,
          fullName,
          companyName,
          role: createRole,
          workspaceId,
          selectedPlan,
          billingCycle,
          billingStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } else {
        const existing = (userSnap.data() || {}) as Record<string, unknown>;
        const isConformingUser =
          hasRequiredAndAllowedKeys(existing, USER_PROFILE_KEYS, USER_PROFILE_KEYS) &&
          existing.id === uid &&
          typeof existing.email === 'string' &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(existing.email) &&
          typeof existing.fullName === 'string' &&
          existing.fullName.length >= 1 &&
          typeof existing.companyName === 'string' &&
          existing.companyName.length >= 1 &&
          ['Admin', 'Analyst', 'Viewer'].includes(String(existing.role)) &&
          typeof existing.workspaceId === 'string' &&
          (ALLOWED_PLANS as readonly string[]).includes(String(existing.selectedPlan)) &&
          (ALLOWED_BILLING_CYCLES as readonly string[]).includes(String(existing.billingCycle)) &&
          (ALLOWED_BILLING_STATUSES as readonly string[]).includes(String(existing.billingStatus)) &&
          isFirestoreTimestamp(existing.createdAt) &&
          isFirestoreTimestamp(existing.updatedAt);

        if (!isConformingUser) {
          const existingEmail =
            typeof existing.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(existing.email.trim())
              ? existing.email.trim().slice(0, 255)
              : email;
          const existingRole =
            typeof existing.role === 'string' && ['Admin', 'Analyst', 'Viewer'].includes(existing.role)
              ? existing.role
              : createRole;
          const preservedRole = isBootstrapAdmin ? 'Admin' : existingRole;

          await setDoc(userRef, {
            id: uid,
            email: existingEmail,
            fullName,
            companyName,
            role: preservedRole,
            workspaceId,
            selectedPlan,
            billingCycle,
            billingStatus,
            createdAt: isFirestoreTimestamp(existing.createdAt) ? existing.createdAt : serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } else {
          if (
            existing.fullName !== fullName ||
            existing.companyName !== companyName ||
            existing.workspaceId !== workspaceId
          ) {
            await updateDoc(userRef, {
              fullName,
              companyName,
              workspaceId,
              updatedAt: serverTimestamp()
            });
          }
          if (
            existing.selectedPlan !== selectedPlan ||
            existing.billingCycle !== billingCycle ||
            existing.billingStatus !== billingStatus
          ) {
            await updateDoc(userRef, {
              selectedPlan,
              billingCycle,
              billingStatus,
              updatedAt: serverTimestamp()
            });
          }
        }
      }
    } catch (error) {
      if (!isSessionStillActive(runGeneration, runRawUid)) return null;
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }

    if (!isSessionStillActive(runGeneration, runRawUid)) return null;

    // 2. Sync /workspaces/{workspaceId} BEFORE /workspaces/{workspaceId}/members/{uid}
    const wsPath = `workspaces/${workspaceId}`;
    const wsRef = doc(db, 'workspaces', workspaceId);
    try {
      const wsSnap = await getDoc(wsRef);
      if (!isSessionStillActive(runGeneration, runRawUid)) return null;
      if (!wsSnap.exists()) {
        await setDoc(wsRef, {
          id: workspaceId,
          name: companyName,
          ownerId: uid,
          plan: selectedPlan,
          billingStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } else {
        const existingWs = (wsSnap.data() || {}) as Record<string, unknown>;
        const canMutateWorkspace = existingWs.ownerId === uid || isBootstrapAdmin || !existingWs.ownerId;
        if (canMutateWorkspace) {
          const isConformingWs =
            hasRequiredAndAllowedKeys(existingWs, WORKSPACE_KEYS, WORKSPACE_KEYS) &&
            existingWs.id === workspaceId &&
            typeof existingWs.name === 'string' &&
            existingWs.name.length >= 1 &&
            typeof existingWs.ownerId === 'string' &&
            (!isBootstrapAdmin || existingWs.ownerId === uid) &&
            (ALLOWED_PLANS as readonly string[]).includes(String(existingWs.plan)) &&
            (ALLOWED_BILLING_STATUSES as readonly string[]).includes(String(existingWs.billingStatus)) &&
            isFirestoreTimestamp(existingWs.createdAt) &&
            isFirestoreTimestamp(existingWs.updatedAt);

          if (!isConformingWs) {
            const ownerIdToWrite = isBootstrapAdmin
              ? uid
              : typeof existingWs.ownerId === 'string' && existingWs.ownerId.trim().length > 0
                ? sanitizeId(existingWs.ownerId, 'usr')
                : uid;
            await setDoc(wsRef, {
              id: workspaceId,
              name: companyName,
              ownerId: ownerIdToWrite,
              plan: selectedPlan,
              billingStatus,
              createdAt: isFirestoreTimestamp(existingWs.createdAt) ? existingWs.createdAt : serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          } else {
            if (existingWs.name !== companyName) {
              await updateDoc(wsRef, {
                name: companyName,
                updatedAt: serverTimestamp()
              });
            }
            if (existingWs.plan !== selectedPlan || existingWs.billingStatus !== billingStatus) {
              await updateDoc(wsRef, {
                plan: selectedPlan,
                billingStatus,
                updatedAt: serverTimestamp()
              });
            }
          }
        }
      }
    } catch (error) {
      if (!isSessionStillActive(runGeneration, runRawUid)) return null;
      handleFirestoreError(error, OperationType.WRITE, wsPath);
    }

    if (!isSessionStillActive(runGeneration, runRawUid)) return null;

    // 3. Sync /workspaces/{workspaceId}/members/{uid}
    const memberPath = `workspaces/${workspaceId}/members/${uid}`;
    const memberRef = doc(db, 'workspaces', workspaceId, 'members', uid);
    try {
      const memberSnap = await getDoc(memberRef);
      if (!isSessionStillActive(runGeneration, runRawUid)) return null;
      const existingMember = memberSnap.exists() ? ((memberSnap.data() || {}) as Record<string, unknown>) : null;
      const isConformingMember =
        existingMember !== null &&
        hasRequiredAndAllowedKeys(existingMember, WORKSPACE_MEMBER_KEYS, WORKSPACE_MEMBER_KEYS) &&
        existingMember.id === uid &&
        existingMember.workspaceId === workspaceId &&
        existingMember.userId === uid &&
        ['owner', 'admin', 'member'].includes(String(existingMember.role)) &&
        typeof existingMember.email === 'string' &&
        isFirestoreTimestamp(existingMember.createdAt);

      if (!memberSnap.exists() || !isConformingMember) {
        await setDoc(memberRef, {
          id: uid,
          workspaceId,
          userId: uid,
          role: 'owner',
          email,
          createdAt:
            existingMember && isFirestoreTimestamp(existingMember.createdAt)
              ? existingMember.createdAt
              : serverTimestamp()
        });
      }
    } catch (error) {
      if (!isSessionStillActive(runGeneration, runRawUid)) return null;
      handleFirestoreError(error, OperationType.WRITE, memberPath);
    }

    if (!isSessionStillActive(runGeneration, runRawUid)) return null;
    syncedWorkspaces.add(syncKey);
    return { workspaceId };
  })();

  pendingWorkspaceSyncs.set(syncKey, runSync);
  try {
    return await runSync;
  } finally {
    pendingWorkspaceSyncs.delete(syncKey);
  }
}

function buildCustomerCreatePayload(
  customer: Partial<Customer>,
  workspaceId: string,
  ownerId: string,
  preservedCreatedAt?: unknown
): Record<string, unknown> {
  const id = sanitizeId(customer.id || customer.customerId || customer.customer_id, 'cust');
  const email = sanitizeEmail(customer.email, `${id}@customer.churnveda.app`);
  const domainFallback = email.includes('@') ? email.split('@')[1] : 'company.com';
  const companyDomain = sanitizeString(customer.companyDomain || customer.company_name || domainFallback, 'company.com', 1, 255);
  const name = sanitizeString(customer.name || customer.company_name, 'Customer Account', 1, 255);

  const payload: Record<string, unknown> = {
    id,
    workspaceId,
    ownerId,
    name,
    email,
    companyDomain,
    plan: normalizeCustomerPlan(customer.plan),
    mrr: clampNumber(customer.mrr, 0, 10000000, 0),
    ltv: clampNumber(customer.ltv, 0, 100000000, clampNumber(customer.mrr, 0, 10000000, 0) * 12),
    lastLoginDays: clampNumber(customer.lastLoginDays ?? customer.last_login_days_ago, 0, 36500, 0),
    openTicketsCount: clampNumber(customer.openTicketsCount ?? customer.open_support_tickets, 0, 10000, 0),
    paymentStatus: normalizePaymentStatus(customer.paymentStatus || customer.payment_status),
    usageTrendPercentage: clampNumber(customer.usageTrendPercentage, -100, 10000, 0),
    emailOpenRate: clampNumber(customer.emailOpenRate, 0, 100, 0),
    riskScore: clampNumber(customer.riskScore ?? customer.risk_score, 0, 100, 0),
    riskCategory: sanitizeString(customer.riskCategory || customer.risk_level, 'Low', 1, 32),
    recommendedAction: sanitizeString(customer.recommendedAction || customer.recommended_action, '', 0, 1000),
    status: normalizeCustomerStatus(customer.status),
    createdAt: isFirestoreTimestamp(preservedCreatedAt) ? preservedCreatedAt : serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (typeof customer.savedNotes === 'string' && customer.savedNotes.trim().length > 0) {
    payload.savedNotes = customer.savedNotes.trim().slice(0, 1000);
  }
  if (customer.outcomeStatus === 'recovered' || customer.outcomeStatus === 'churned') {
    payload.outcomeStatus = customer.outcomeStatus;
  }
  if (typeof customer.churnReason === 'string' && customer.churnReason.trim().length > 0) {
    payload.churnReason = customer.churnReason.trim().slice(0, 64);
  }
  if (typeof customer.rescuePlaybookUsed === 'string' && customer.rescuePlaybookUsed.trim().length > 0) {
    payload.rescuePlaybookUsed = customer.rescuePlaybookUsed.trim().slice(0, 255);
  }
  if (customer.mrrProtected !== undefined && customer.mrrProtected !== null) {
    payload.mrrProtected = clampNumber(customer.mrrProtected, 0, 10000000, 0);
  }
  if (typeof customer.isDemo === 'boolean' || typeof customer.is_demo_data === 'boolean') {
    payload.isDemo = Boolean(customer.isDemo ?? customer.is_demo_data);
  }

  return payload;
}

function buildCustomerTelemetryUpdatePayload(customer: Partial<Customer>): Record<string, unknown> {
  const email = sanitizeEmail(customer.email, 'customer@churnveda.app');
  const domainFallback = email.includes('@') ? email.split('@')[1] : 'company.com';
  return {
    name: sanitizeString(customer.name || customer.company_name, 'Customer Account', 1, 255),
    email,
    companyDomain: sanitizeString(customer.companyDomain || customer.company_name || domainFallback, 'company.com', 1, 255),
    plan: normalizeCustomerPlan(customer.plan),
    mrr: clampNumber(customer.mrr, 0, 10000000, 0),
    ltv: clampNumber(customer.ltv, 0, 100000000, clampNumber(customer.mrr, 0, 10000000, 0) * 12),
    lastLoginDays: clampNumber(customer.lastLoginDays ?? customer.last_login_days_ago, 0, 36500, 0),
    openTicketsCount: clampNumber(customer.openTicketsCount ?? customer.open_support_tickets, 0, 10000, 0),
    paymentStatus: normalizePaymentStatus(customer.paymentStatus || customer.payment_status),
    usageTrendPercentage: clampNumber(customer.usageTrendPercentage, -100, 10000, 0),
    emailOpenRate: clampNumber(customer.emailOpenRate, 0, 100, 0),
    riskScore: clampNumber(customer.riskScore ?? customer.risk_score, 0, 100, 0),
    riskCategory: sanitizeString(customer.riskCategory || customer.risk_level, 'Low', 1, 32),
    recommendedAction: sanitizeString(customer.recommendedAction || customer.recommended_action, '', 0, 1000),
    status: normalizeCustomerStatus(customer.status),
    isDemo: Boolean(customer.isDemo ?? customer.is_demo_data),
    updatedAt: serverTimestamp()
  };
}

function isConformingCustomerDoc(
  existing: Record<string, unknown>,
  workspaceId: string,
  customerId: string
): boolean {
  const hasValidOptionalSavedNotes =
    !Object.prototype.hasOwnProperty.call(existing, 'savedNotes') ||
    (typeof existing.savedNotes === 'string' && existing.savedNotes.length <= 1000);
  const hasValidOptionalOutcome =
    !Object.prototype.hasOwnProperty.call(existing, 'outcomeStatus') ||
    existing.outcomeStatus === 'recovered' ||
    existing.outcomeStatus === 'churned';
  const hasValidOptionalChurnReason =
    !Object.prototype.hasOwnProperty.call(existing, 'churnReason') ||
    (typeof existing.churnReason === 'string' && existing.churnReason.length <= 64);
  const hasValidOptionalPlaybook =
    !Object.prototype.hasOwnProperty.call(existing, 'rescuePlaybookUsed') ||
    (typeof existing.rescuePlaybookUsed === 'string' && existing.rescuePlaybookUsed.length <= 255);
  const hasValidOptionalMrrProtected =
    !Object.prototype.hasOwnProperty.call(existing, 'mrrProtected') ||
    (typeof existing.mrrProtected === 'number' &&
      Number.isFinite(existing.mrrProtected) &&
      existing.mrrProtected >= 0 &&
      existing.mrrProtected <= 10000000);
  const hasValidOptionalIsDemo =
    !Object.prototype.hasOwnProperty.call(existing, 'isDemo') ||
    typeof existing.isDemo === 'boolean';

  return (
    hasRequiredAndAllowedKeys(existing, CUSTOMER_REQUIRED_KEYS, CUSTOMER_ALLOWED_KEYS) &&
    existing.id === customerId &&
    existing.workspaceId === workspaceId &&
    typeof existing.ownerId === 'string' &&
    existing.ownerId.length >= 1 &&
    typeof existing.name === 'string' &&
    existing.name.length >= 1 &&
    typeof existing.email === 'string' &&
    typeof existing.companyDomain === 'string' &&
    existing.companyDomain.length >= 1 &&
    (ALLOWED_CUSTOMER_PLANS as readonly string[]).includes(String(existing.plan)) &&
    (ALLOWED_PAYMENT_STATUSES as readonly string[]).includes(String(existing.paymentStatus)) &&
    (ALLOWED_CUSTOMER_STATUSES as readonly string[]).includes(String(existing.status)) &&
    hasValidOptionalSavedNotes &&
    hasValidOptionalOutcome &&
    hasValidOptionalChurnReason &&
    hasValidOptionalPlaybook &&
    hasValidOptionalMrrProtected &&
    hasValidOptionalIsDemo &&
    isFirestoreTimestamp(existing.createdAt) &&
    isFirestoreTimestamp(existing.updatedAt)
  );
}

function doesCustomerTelemetryMatch(
  existing: Record<string, unknown>,
  updatePayload: Record<string, unknown>
): boolean {
  return (
    existing.name === updatePayload.name &&
    existing.email === updatePayload.email &&
    existing.companyDomain === updatePayload.companyDomain &&
    existing.plan === updatePayload.plan &&
    existing.mrr === updatePayload.mrr &&
    existing.ltv === updatePayload.ltv &&
    existing.lastLoginDays === updatePayload.lastLoginDays &&
    existing.openTicketsCount === updatePayload.openTicketsCount &&
    existing.paymentStatus === updatePayload.paymentStatus &&
    existing.usageTrendPercentage === updatePayload.usageTrendPercentage &&
    existing.emailOpenRate === updatePayload.emailOpenRate &&
    existing.riskScore === updatePayload.riskScore &&
    existing.riskCategory === updatePayload.riskCategory &&
    existing.recommendedAction === updatePayload.recommendedAction &&
    existing.status === updatePayload.status &&
    Boolean(existing.isDemo) === Boolean(updatePayload.isDemo)
  );
}

function mapFirestoreDocToCustomer(docData: Record<string, any>, fallbackId: string): Customer {
  const id = String(docData.id || fallbackId);
  const riskScore = clampNumber(docData.riskScore, 0, 100, 0);
  const createdAtIso =
    typeof docData.createdAt?.toDate === 'function'
      ? docData.createdAt.toDate().toISOString()
      : new Date().toISOString();
  const updatedAtIso =
    typeof docData.updatedAt?.toDate === 'function'
      ? docData.updatedAt.toDate().toISOString()
      : createdAtIso;

  return {
    id,
    customerId: id,
    workspaceId: String(docData.workspaceId || ''),
    name: String(docData.name || 'Customer'),
    email: String(docData.email || ''),
    companyDomain: String(docData.companyDomain || ''),
    plan: normalizeCustomerPlan(docData.plan),
    mrr: clampNumber(docData.mrr, 0, 10000000, 0),
    ltv: clampNumber(docData.ltv, 0, 100000000, 0),
    customerSince: createdAtIso,
    lastLoginDays: clampNumber(docData.lastLoginDays, 0, 36500, 0),
    openTicketsCount: clampNumber(docData.openTicketsCount, 0, 10000, 0),
    paymentStatus: normalizePaymentStatus(docData.paymentStatus),
    usageTrendPercentage: clampNumber(docData.usageTrendPercentage, -100, 10000, 0),
    emailOpenRate: clampNumber(docData.emailOpenRate, 0, 100, 0),
    riskScore,
    riskCategory: (docData.riskCategory || 'Low') as Customer['riskCategory'],
    topFactors: [],
    churnProbability: {
      day30: Math.min(99, Math.round(riskScore * 0.8)),
      day60: Math.min(99, Math.round(riskScore * 0.9)),
      day90: riskScore
    },
    recommendedAction: String(docData.recommendedAction || ''),
    lastAnalyzedAt: updatedAtIso,
    isAiAnalyzed: riskScore > 0,
    supportTickets: [],
    paymentHistory: [],
    loginHistory: [],
    riskTrend: [],
    status: normalizeCustomerStatus(docData.status),
    savedNotes: typeof docData.savedNotes === 'string' ? docData.savedNotes : undefined,
    outcomeStatus:
      docData.outcomeStatus === 'recovered' || docData.outcomeStatus === 'churned'
        ? docData.outcomeStatus
        : undefined,
    churnReason: typeof docData.churnReason === 'string' ? (docData.churnReason as ChurnReasonType) : undefined,
    rescuePlaybookUsed: typeof docData.rescuePlaybookUsed === 'string' ? docData.rescuePlaybookUsed : undefined,
    mrrProtected: typeof docData.mrrProtected === 'number' ? docData.mrrProtected : undefined,
    isDemo: Boolean(docData.isDemo),
    is_demo_data: Boolean(docData.isDemo),
    created_at: createdAtIso,
    updated_at: updatedAtIso
  };
}

/**
 * Subscribes to workspace customer records scoped strictly by workspaceId and ownerId
 * to match Firestore Pillar 8 list security rules without get() lookups.
 */
export function subscribeWorkspaceCustomers(
  workspaceIdRaw: string,
  ownerIdRaw: string,
  onUpdate: (customers: Customer[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!isFirebaseFirestoreReady()) {
    return () => {};
  }

  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');
  const ownerId = sanitizeId(ownerIdRaw, 'usr');
  const path = `workspaces/${workspaceId}/customers`;
  const q = query(
    collection(db, 'workspaces', workspaceId, 'customers'),
    where('workspaceId', '==', workspaceId),
    where('ownerId', '==', ownerId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const docs = snapshot.docs.map((d) => mapFirestoreDocToCustomer(d.data(), d.id));
      onUpdate(docs);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      } else {
        console.warn('[Firestore] Customer subscription error:', error.message);
      }
    }
  );
}

export async function upsertCustomerToFirestore(
  workspaceIdRaw: string,
  customer: Partial<Customer>
): Promise<void> {
  if (!isFirebaseFirestoreReady() || !auth.currentUser) return;
  const runGeneration = authSessionGeneration;
  const runRawUid = auth.currentUser.uid;
  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');
  await ensureWorkspaceSynced(workspaceId);
  if (!isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;

  const ownerId = sanitizeId(auth.currentUser.uid, 'usr');
  const customerId = sanitizeId(customer.id || customer.customerId || customer.customer_id, 'cust');
  const path = `workspaces/${workspaceId}/customers/${customerId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'customers', customerId);

  try {
    const snap = await getDoc(ref);
    if (!isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;

    if (!snap.exists()) {
      await setDoc(ref, buildCustomerCreatePayload({ ...customer, id: customerId }, workspaceId, ownerId));
      return;
    }

    const existing = (snap.data() || {}) as Record<string, unknown>;
    const isAdminEmail = auth.currentUser.email?.toLowerCase() === 'nageshsharat@gmail.com';
    if (existing.status === 'churned' && !isAdminEmail) {
      return;
    }
    if (!isAdminEmail && typeof existing.ownerId === 'string' && existing.ownerId !== ownerId) {
      return;
    }

    const needsMigration =
      !isConformingCustomerDoc(existing, workspaceId, customerId) ||
      (isAdminEmail && existing.ownerId !== ownerId);

    if (needsMigration) {
      const targetOwnerId = isAdminEmail
        ? ownerId
        : typeof existing.ownerId === 'string' && existing.ownerId.length >= 1
          ? sanitizeId(existing.ownerId, 'usr')
          : ownerId;
      await setDoc(
        ref,
        buildCustomerCreatePayload(
          {
            savedNotes: typeof existing.savedNotes === 'string' ? existing.savedNotes : undefined,
            outcomeStatus:
              existing.outcomeStatus === 'recovered' || existing.outcomeStatus === 'churned'
                ? existing.outcomeStatus
                : undefined,
            churnReason: typeof existing.churnReason === 'string' ? (existing.churnReason as ChurnReasonType) : undefined,
            rescuePlaybookUsed:
              typeof existing.rescuePlaybookUsed === 'string' ? existing.rescuePlaybookUsed : undefined,
            mrrProtected: typeof existing.mrrProtected === 'number' ? existing.mrrProtected : undefined,
            ...customer,
            id: customerId
          },
          workspaceId,
          targetOwnerId,
          existing.createdAt
        )
      );
      return;
    }

    const updatePayload = buildCustomerTelemetryUpdatePayload(customer);
    if (!doesCustomerTelemetryMatch(existing, updatePayload)) {
      await updateDoc(ref, updatePayload);
    }
  } catch (error) {
    if (!isSessionStillActive(runGeneration, runRawUid)) return;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateCustomerOutcomeInFirestore(
  workspaceIdRaw: string,
  customerIdRaw: string,
  outcome: {
    status: 'active' | 'saved' | 'churned';
    savedNotes?: string;
    outcomeStatus?: 'recovered' | 'churned';
    churnReason?: ChurnReasonType | string;
    rescuePlaybookUsed?: string;
    mrrProtected?: number;
    riskScore?: number;
    riskCategory?: string;
    recommendedAction?: string;
  }
): Promise<void> {
  if (!isFirebaseFirestoreReady() || !auth.currentUser) return;
  const runGeneration = authSessionGeneration;
  const runRawUid = auth.currentUser.uid;
  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');
  const customerId = sanitizeId(customerIdRaw, 'cust');
  const path = `workspaces/${workspaceId}/customers/${customerId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'customers', customerId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists() || !isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;

    const existing = snap.data() || {};
    const isAdminEmail = auth.currentUser.email?.toLowerCase() === 'nageshsharat@gmail.com';
    if (existing.status === 'churned' && !isAdminEmail) {
      return;
    }

    const updatePayload: Record<string, unknown> = {
      status: normalizeCustomerStatus(outcome.status),
      updatedAt: serverTimestamp()
    };

    if (typeof outcome.savedNotes === 'string') {
      updatePayload.savedNotes = outcome.savedNotes.trim().slice(0, 1000);
    }
    if (outcome.outcomeStatus === 'recovered' || outcome.outcomeStatus === 'churned') {
      updatePayload.outcomeStatus = outcome.outcomeStatus;
    }
    if (typeof outcome.churnReason === 'string' && outcome.churnReason.trim().length > 0) {
      updatePayload.churnReason = outcome.churnReason.trim().slice(0, 64);
    }
    if (typeof outcome.rescuePlaybookUsed === 'string' && outcome.rescuePlaybookUsed.trim().length > 0) {
      updatePayload.rescuePlaybookUsed = outcome.rescuePlaybookUsed.trim().slice(0, 255);
    }
    if (outcome.mrrProtected !== undefined && outcome.mrrProtected !== null) {
      updatePayload.mrrProtected = clampNumber(outcome.mrrProtected, 0, 10000000, 0);
    }
    if (outcome.riskScore !== undefined) {
      updatePayload.riskScore = clampNumber(outcome.riskScore, 0, 100, 0);
    }
    if (typeof outcome.riskCategory === 'string' && outcome.riskCategory.trim().length > 0) {
      updatePayload.riskCategory = outcome.riskCategory.trim().slice(0, 32);
    }
    if (typeof outcome.recommendedAction === 'string') {
      updatePayload.recommendedAction = outcome.recommendedAction.trim().slice(0, 1000);
    }

    await updateDoc(ref, updatePayload);
  } catch (error) {
    if (!isSessionStillActive(runGeneration, runRawUid)) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCustomerFromFirestore(
  workspaceIdRaw: string,
  customerIdRaw: string
): Promise<void> {
  if (!isFirebaseFirestoreReady() || !auth.currentUser) return;
  const runGeneration = authSessionGeneration;
  const runRawUid = auth.currentUser.uid;
  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');
  const customerId = sanitizeId(customerIdRaw, 'cust');
  const path = `workspaces/${workspaceId}/customers/${customerId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'customers', customerId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    if (!isSessionStillActive(runGeneration, runRawUid)) return;
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function batchDeleteCustomersFromFirestore(
  workspaceIdRaw: string,
  customerIds: string[]
): Promise<void> {
  if (!isFirebaseFirestoreReady() || !auth.currentUser || customerIds.length === 0) return;
  const runGeneration = authSessionGeneration;
  const runRawUid = auth.currentUser.uid;
  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');
  const path = `workspaces/${workspaceId}/customers`;

  try {
    for (let i = 0; i < customerIds.length; i += 400) {
      if (!isSessionStillActive(runGeneration, runRawUid)) return;
      const chunk = customerIds.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const rawId of chunk) {
        const customerId = sanitizeId(rawId, 'cust');
        batch.delete(doc(db, 'workspaces', workspaceId, 'customers', customerId));
      }
      await batch.commit();
    }
  } catch (error) {
    if (!isSessionStillActive(runGeneration, runRawUid)) return;
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function batchSyncCustomersToFirestore(
  workspaceIdRaw: string,
  customers: Partial<Customer>[]
): Promise<void> {
  if (!isFirebaseFirestoreReady() || !auth.currentUser || customers.length === 0) return;
  const runGeneration = authSessionGeneration;
  const runRawUid = auth.currentUser.uid;
  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');

  await ensureWorkspaceSynced(workspaceId);
  if (!isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;

  const ownerId = sanitizeId(auth.currentUser.uid, 'usr');
  const isAdminEmail = auth.currentUser.email?.toLowerCase() === 'nageshsharat@gmail.com';

  // Fetch all existing owned customer docs in one query so steady-state syncs avoid N getDoc calls
  const existingMap = new Map<string, Record<string, unknown>>();
  try {
    const ownedSnap = await getDocs(
      query(
        collection(db, 'workspaces', workspaceId, 'customers'),
        where('workspaceId', '==', workspaceId),
        where('ownerId', '==', ownerId)
      )
    );
    if (!isSessionStillActive(runGeneration, runRawUid)) return;
    ownedSnap.forEach((docSnap) => {
      existingMap.set(docSnap.id, docSnap.data() as Record<string, unknown>);
    });
  } catch {
    // Fallback to per-document lookup below if initial query fails while session stays active
  }

  for (const customer of customers) {
    if (!isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;

    const customerId = sanitizeId(customer.id || customer.customerId || customer.customer_id, 'cust');
    const path = `workspaces/${workspaceId}/customers/${customerId}`;
    const ref = doc(db, 'workspaces', workspaceId, 'customers', customerId);

    try {
      let existing: Record<string, unknown> | null = existingMap.get(customerId) || null;
      if (!existing) {
        const snap = await getDoc(ref);
        if (!isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;
        if (snap.exists()) {
          existing = (snap.data() || {}) as Record<string, unknown>;
        }
      }

      if (!existing) {
        await setDoc(ref, buildCustomerCreatePayload({ ...customer, id: customerId }, workspaceId, ownerId));
      } else {
        if (existing.status === 'churned' && !isAdminEmail) {
          continue;
        }
        if (!isAdminEmail && typeof existing.ownerId === 'string' && existing.ownerId !== ownerId) {
          continue;
        }

        const needsMigration =
          !isConformingCustomerDoc(existing, workspaceId, customerId) ||
          (isAdminEmail && existing.ownerId !== ownerId);

        if (needsMigration) {
          const targetOwnerId = isAdminEmail
            ? ownerId
            : typeof existing.ownerId === 'string' && existing.ownerId.length >= 1
              ? sanitizeId(existing.ownerId, 'usr')
              : ownerId;
          await setDoc(
            ref,
            buildCustomerCreatePayload(
              {
                savedNotes: typeof existing.savedNotes === 'string' ? existing.savedNotes : undefined,
                outcomeStatus:
                  existing.outcomeStatus === 'recovered' || existing.outcomeStatus === 'churned'
                    ? existing.outcomeStatus
                    : undefined,
                churnReason:
                  typeof existing.churnReason === 'string'
                    ? (existing.churnReason as ChurnReasonType)
                    : undefined,
                rescuePlaybookUsed:
                  typeof existing.rescuePlaybookUsed === 'string'
                    ? existing.rescuePlaybookUsed
                    : undefined,
                mrrProtected: typeof existing.mrrProtected === 'number' ? existing.mrrProtected : undefined,
                ...customer,
                id: customerId
              },
              workspaceId,
              targetOwnerId,
              existing.createdAt
            )
          );
          continue;
        }

        const updatePayload = buildCustomerTelemetryUpdatePayload(customer);
        if (!doesCustomerTelemetryMatch(existing, updatePayload)) {
          await updateDoc(ref, updatePayload);
        }
      }
    } catch (error) {
      if (!isSessionStillActive(runGeneration, runRawUid)) return;
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function recordImportHistoryToFirestore(
  workspaceIdRaw: string,
  record: Partial<ImportHistoryRecord>
): Promise<void> {
  if (!isFirebaseFirestoreReady() || !auth.currentUser) return;
  const runGeneration = authSessionGeneration;
  const runRawUid = auth.currentUser.uid;
  const workspaceId = sanitizeId(workspaceIdRaw, 'ws');
  await ensureWorkspaceSynced(workspaceId);
  if (!isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;

  const ownerId = sanitizeId(auth.currentUser.uid, 'usr');
  const importId = sanitizeId(record.importId || record.import_id, 'imp');
  const path = `workspaces/${workspaceId}/importHistory/${importId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'importHistory', importId);

  try {
    const snap = await getDoc(ref);
    if (!isSessionStillActive(runGeneration, runRawUid) || !auth.currentUser) return;
    const existing = snap.exists() ? ((snap.data() || {}) as Record<string, unknown>) : null;
    const isConforming =
      existing !== null &&
      hasRequiredAndAllowedKeys(existing, IMPORT_HISTORY_KEYS, IMPORT_HISTORY_KEYS) &&
      existing.id === importId &&
      existing.workspaceId === workspaceId &&
      typeof existing.ownerId === 'string' &&
      isFirestoreTimestamp(existing.createdAt);

    if (!snap.exists() || !isConforming) {
      await setDoc(ref, {
        id: importId,
        workspaceId,
        ownerId:
          existing && typeof existing.ownerId === 'string' && existing.ownerId.length >= 1
            ? sanitizeId(existing.ownerId, 'usr')
            : ownerId,
        source: normalizeImportSource(record.source),
        fileName: sanitizeString(record.fileName || record.file_name, 'import.csv', 1, 255),
        totalRows: clampNumber(record.totalRows ?? record.total_rows, 0, 1000000, 0),
        validRows: clampNumber(record.validRows ?? record.valid_rows, 0, 1000000, 0),
        failedRows: clampNumber(record.failedRows ?? record.invalid_rows, 0, 1000000, 0),
        status: normalizeImportStatus(record.status),
        errorSummary: sanitizeString(record.errorSummary, '', 0, 1000),
        createdAt:
          existing && isFirestoreTimestamp(existing.createdAt) ? existing.createdAt : serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      await updateDoc(ref, {
        status: normalizeImportStatus(record.status),
        validRows: clampNumber(record.validRows ?? record.valid_rows, 0, 1000000, 0),
        failedRows: clampNumber(record.failedRows ?? record.invalid_rows, 0, 1000000, 0),
        errorSummary: sanitizeString(record.errorSummary, '', 0, 1000),
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    if (!isSessionStillActive(runGeneration, runRawUid)) return;
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
