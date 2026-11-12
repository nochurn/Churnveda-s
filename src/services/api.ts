import { Customer, IntegrationStatus, DailyAlert, RetentionRecommendation } from '../types';

const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
const rawEnvApiUrl: string = (
  metaEnv && typeof metaEnv.VITE_API_URL === 'string'
) ? metaEnv.VITE_API_URL.replace(/\/+$/, '') : '';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    // In AI Studio preview (.run.app) or local full-stack hosts, use same-origin Express backend
    if (
      host.endsWith('.run.app') ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0'
    ) {
      return '';
    }
  }
  return rawEnvApiUrl;
}

export const API_BASE_URL: string = getApiBaseUrl();

export function apiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}

// When frontend is hosted separately (e.g. Catalyst Slate / Netlify) and VITE_API_URL points to the backend,
// transparently route /api requests to the backend domain with credentials without mutating window.fetch.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const baseUrl = getApiBaseUrl();
  if (typeof input === 'string' && input.startsWith('/api')) {
    const targetUrl = apiUrl(input);
    const requestInit: RequestInit = {
      ...init,
      ...(baseUrl ? { credentials: init?.credentials || 'include' } : {})
    };
    try {
      return await nativeFetch(targetUrl, requestInit);
    } catch (err) {
      if (baseUrl) {
        // Retry once after brief delay for cross-origin backend cold-start / transient network hiccups
        await new Promise(resolve => setTimeout(resolve, 1200));
        return nativeFetch(targetUrl, requestInit);
      }
      throw err;
    }
  }
  return nativeFetch(input, init);
}

export interface SafeJsonOptions<T> {
  endpointName?: string;
  preserveAuthError?: boolean;
}

export async function safeJson<T = any>(
  res: Response,
  fallback: T,
  options?: SafeJsonOptions<T>
): Promise<T> {
  // Strip query parameters to prevent exposing tokens, user IDs, or PII in logs
  let safeEndpoint = 'unknown_endpoint';
  try {
    safeEndpoint = res.url ? new URL(res.url, 'http://localhost').pathname : 'unknown_endpoint';
  } catch {
    safeEndpoint = 'api_endpoint';
  }

  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  // 1. Handle Auth Failures (401 Unauthorized / 403 Forbidden)
  if (status === 401 || status === 403) {
    const errorCategory = status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN';
    console.warn(`[API Diagnostics] ${errorCategory} at ${safeEndpoint} (HTTP ${status})`);

    // Parse server error payload if JSON to preserve server error message/codes
    if (isJson) {
      try {
        const errorJson = await res.json();
        return errorJson as T;
      } catch {
        // malformed json in error response
      }
    }

    if (options?.preserveAuthError) {
      throw new Error(`Authentication error (HTTP ${status}) at ${safeEndpoint}`);
    }
    return fallback;
  }

  // 2. Handle Client / Server Errors (404, 500, 502, 503, etc.)
  if (!res.ok) {
    const errorCategory = status === 404 ? 'NOT_FOUND' : status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR';
    console.warn(`[API Diagnostics] ${errorCategory} at ${safeEndpoint} (HTTP ${status}, Content-Type: ${contentType || 'none'})`);

    if (isJson) {
      try {
        return await res.json();
      } catch {
        // non-json or malformed error body
      }
    }
    return fallback;
  }

  // 3. Handle Non-JSON Responses (HTML warmup pages, gateway error pages)
  if (!isJson) {
    console.warn(`[API Diagnostics] NON_JSON_RESPONSE at ${safeEndpoint} (HTTP ${status}, Content-Type: ${contentType || 'none'})`);
    return fallback;
  }

  // 4. Handle Empty Responses and Malformed JSON
  try {
    const rawText = await res.text();
    if (!rawText || rawText.trim().length === 0) {
      console.warn(`[API Diagnostics] EMPTY_BODY at ${safeEndpoint} (HTTP ${status})`);
      return fallback;
    }
    return JSON.parse(rawText) as T;
  } catch {
    console.warn(`[API Diagnostics] MALFORMED_JSON at ${safeEndpoint} (HTTP ${status})`);
    return fallback;
  }
}

export function getStoredAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return (
    localStorage.getItem('churnveda_auth_token') ||
    localStorage.getItem('cs_auth_token') ||
    localStorage.getItem('churnshield_auth_token')
  );
}

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getStoredAuthToken();
  return {
    'Accept': 'application/json',
    ...extraHeaders,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
}

export async function fetchHealth(): Promise<{ status: string; geminiConfigured: boolean; model: string; totalCustomers: number }> {
  try {
    const res = await apiFetch('/api/health', {
      headers: { 'Accept': 'application/json' }
    });
    return await safeJson(res, { status: 'error', geminiConfigured: false, model: '', totalCustomers: 0 });
  } catch {
    return { status: 'error', geminiConfigured: false, model: '', totalCustomers: 0 };
  }
}

export async function fetchCustomers(params?: {
  search?: string;
  riskLevel?: string;
  mrrRange?: string;
  plan?: string;
  factor?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}): Promise<{
  customers: Customer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.riskLevel) query.set('riskLevel', params.riskLevel);
  if (params?.mrrRange) query.set('mrrRange', params.mrrRange);
  if (params?.plan) query.set('plan', params.plan);
  if (params?.factor) query.set('factor', params.factor);
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
  if (params?.page) query.set('page', params.page.toString());
  if (params?.limit) query.set('limit', params.limit.toString());

  const res = await apiFetch(`/api/customers?${query.toString()}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    return { customers: [], total: 0, page: params?.page || 1, limit: params?.limit || 25, totalPages: 1 };
  }
  return res.json();
}

export async function fetchCustomerById(id: string): Promise<Customer> {
  const res = await apiFetch(`/api/customers/${id}`, {
    headers: getAuthHeaders()
  });
  return res.json();
}

export async function updateCustomerStatus(
  id: string,
  payload: {
    status?: 'active' | 'saved' | 'churned';
    savedNotes?: string;
    recommendedAction?: string;
    retentionRecommendation?: RetentionRecommendation;
  }
): Promise<Customer> {
  const res = await apiFetch(`/api/customers/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function predictCustomerChurn(customerId: string): Promise<{
  success: boolean;
  analysis: any;
  source: string;
  warning?: string;
}> {
  const res = await apiFetch('/api/churn/predict', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ customerId })
  });
  return res.json();
}

export async function recommendCustomerRetention(customerId: string): Promise<{
  success: boolean;
  recommendation: RetentionRecommendation;
  source: string;
}> {
  const res = await apiFetch('/api/churn/recommend', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ customerId })
  });
  return res.json();
}

export async function batchPredictChurn(customerIds?: string[]): Promise<{
  success: boolean;
  analyzedCount: number;
  message: string;
}> {
  const res = await apiFetch('/api/churn/batch-predict', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ customerIds })
  });
  return res.json();
}

export const DEFAULT_INTEGRATIONS: IntegrationStatus[] = [
  {
    id: 'razorpay',
    name: 'Razorpay Recurring Billing & Subscriptions',
    category: 'billing',
    icon: 'CreditCard',
    description: 'Sync customer subscriptions, invoices, MRR in USD, automated recurring payment webhooks, smart dunning retries, and failed payment telemetry.',
    isConnected: false,
    lastSyncAt: null,
    syncedRecordsCount: 0,
    syncFrequency: 'Every 24 Hours',
    apiKeyMasked: 'rzp_••••••••••••',
    statusText: 'Catalog Available — Not Connected',
    isFallbackCatalog: true
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel Product Analytics',
    category: 'usage',
    icon: 'Activity',
    description: 'Track active user logins, feature utilization rate, session duration, and workspace health.',
    isConnected: false,
    lastSyncAt: null,
    syncedRecordsCount: 0,
    syncFrequency: 'Every 24 Hours',
    apiKeyMasked: 'mix_••••••••••••',
    statusText: 'Catalog Available — Not Connected',
    isFallbackCatalog: true
  },
  {
    id: 'intercom',
    name: 'Intercom Support',
    category: 'support',
    icon: 'MessageSquare',
    description: 'Ingest open support conversations, ticket response times, bug reports, and CSAT sentiment.',
    isConnected: false,
    lastSyncAt: null,
    syncedRecordsCount: 0,
    syncFrequency: 'Every 24 Hours',
    apiKeyMasked: 'dck_••••••••••••',
    statusText: 'Catalog Available — Not Connected',
    isFallbackCatalog: true
  },
  {
    id: 'sendgrid',
    name: 'SendGrid / Mailchimp',
    category: 'engagement',
    icon: 'Mail',
    description: 'Monitor outbound customer email open rates, click rates, and unsubscribes.',
    isConnected: false,
    lastSyncAt: null,
    syncedRecordsCount: 0,
    syncFrequency: 'Every 24 Hours',
    apiKeyMasked: 'SG.••••••••••••',
    statusText: 'Catalog Available — Not Connected',
    isFallbackCatalog: true
  },
  {
    id: 'firebase',
    name: 'Firebase Cloud Firestore & Auth',
    category: 'database',
    icon: 'Database',
    description: 'Active persistent storage with Firebase Cloud Firestore for customer records, profiles, and enterprise security rules.',
    isConnected: false,
    lastSyncAt: null,
    syncedRecordsCount: 0,
    syncFrequency: 'Real-time',
    apiKeyMasked: 'AIza••••••••••••',
    statusText: 'Catalog Available — Not Connected',
    isFallbackCatalog: true
  }
];

export async function fetchIntegrations(): Promise<IntegrationStatus[]> {
  try {
    const res = await apiFetch('/api/integrations', {
      headers: getAuthHeaders({ 'Accept': 'application/json' })
    });
    const data = await safeJson<any>(res, null);
    if (!data) return DEFAULT_INTEGRATIONS;
    const list = Array.isArray(data) ? data : (Array.isArray(data?.integrations) ? data.integrations : []);
    return list.length > 0 ? list : DEFAULT_INTEGRATIONS;
  } catch (err) {
    console.warn('[API] Could not fetch integrations, using default catalog:', err);
    return DEFAULT_INTEGRATIONS;
  }
}

export async function syncIntegration(integrationId?: string): Promise<{ success: boolean; integrations: IntegrationStatus[] }> {
  const res = await apiFetch('/api/integrations/sync', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ integrationId })
  });
  return safeJson(res, { success: false, integrations: DEFAULT_INTEGRATIONS });
}

export async function toggleIntegration(integrationId: string, isConnected: boolean): Promise<{ success: boolean; integrations: IntegrationStatus[] }> {
  const res = await apiFetch('/api/integrations/toggle', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ integrationId, isConnected })
  });
  return safeJson(res, { success: false, integrations: DEFAULT_INTEGRATIONS });
}

export async function importCustomers(customers: any[]): Promise<{ success: boolean; importedCount: number; totalCount: number }> {
  const res = await apiFetch('/api/customers/import', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ customers })
  });
  return safeJson(res, { success: false, importedCount: 0, totalCount: 0 });
}

export async function fetchAlerts(): Promise<DailyAlert[]> {
  try {
    const res = await apiFetch('/api/alerts', {
      headers: getAuthHeaders({ 'Accept': 'application/json' })
    });
    const data = await safeJson<any>(res, null);
    if (!data) return [];
    return Array.isArray(data) ? data : (Array.isArray(data?.alerts) ? data.alerts : []);
  } catch (err) {
    console.warn('[API] Could not fetch alerts:', err);
    return [];
  }
}

export async function triggerDailyAlert(): Promise<{ success: boolean; alert: DailyAlert }> {
  const res = await apiFetch('/api/alerts/trigger-daily', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' })
  });
  return res.json();
}

export async function testSlackAlert(channel?: string): Promise<{ success: boolean; message: string; payload: any }> {
  const res = await apiFetch('/api/alerts/test-slack', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ channel })
  });
  return res.json();
}

export async function fetchRoiMetrics(): Promise<{
  savedCustomersCount: number;
  savedMrr: number;
  subscriptionCost: number;
  netGain: number;
  roiMultiplier: number;
  summaryText: string;
}> {
  const res = await apiFetch('/api/roi', {
    headers: getAuthHeaders()
  });
  return res.json();
}

export async function requestAccountDeletion(): Promise<{ success: boolean; message: string; scheduledDeletionDate: string }> {
  const res = await apiFetch('/api/auth/delete-account', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' })
  });
  return res.json();
}

// Auth API Calls
export async function signupUser(payload: {
  fullName: string;
  companyName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
  agreedToTerms: boolean;
  selectedPlan?: string;
  billingCycle?: 'monthly' | 'annual';
  isFreeTrial?: boolean;
}) {
  const res = await apiFetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    const err: any = new Error(data.error || data.message || 'Failed to sign up');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function cancelTrial(email?: string) {
  const res = await apiFetch('/api/billing/cancel-trial', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email })
  });
  return res.json();
}

export async function cancelRazorpaySubscription() {
  const res = await apiFetch('/api/razorpay/cancel-subscription', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' })
  });
  return res.json();
}

export async function upgradePlan(plan: string, email?: string) {
  const res = await apiFetch('/api/billing/upgrade', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ plan, email })
  });
  return res.json();
}

export async function addPaymentMethod(payload: {
  cardNumber: string;
  cardholderName?: string;
  expMonth?: number;
  expYear?: number;
  cvc?: string;
  zip?: string;
  email?: string;
  isDefault?: boolean;
}) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('cs_auth_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch('/api/billing/payment-method', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to add payment method');
  }
  return data;
}

export async function fetchPaymentMethods() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('cs_auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch('/api/billing/payment-methods', { headers });
  return res.json();
}

export async function deletePaymentMethod(id: string) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('cs_auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch(`/api/billing/payment-method/${id}`, {
    method: 'DELETE',
    headers
  });
  return res.json();
}

export async function setDefaultPaymentMethod(id: string) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('cs_auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch(`/api/billing/payment-method/${id}/default`, {
    method: 'POST',
    headers
  });
  return res.json();
}

export async function loginUser(payload: {
  email: string;
  password: string;
  rememberMe?: boolean;
}) {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Invalid credentials');
  }
  return data;
}

export async function fetchCurrentUser(token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch('/api/auth/me', { headers });
  if (!res.ok) return null;
  return res.json();
}

export async function logoutUser(token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch('/api/auth/logout', { method: 'POST', headers });
  return res.json();
}

export async function forgotPassword(email: string) {
  const res = await apiFetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return res.json();
}

export async function resetPassword(token: string, newPassword: string) {
  const res = await apiFetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to reset password');
  }
  return data;
}

export async function setupWorkspace(payload: {
  fullName?: string;
  companyName?: string;
  selectedPlan?: string;
  billingCycle?: string;
}) {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch('/api/auth/setup-workspace', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function setPendingPlan(payload: {
  tier: string;
  billing_cycle: string;
}) {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await apiFetch('/api/auth/pending-plan', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function resolvePostLoginRedirect(next?: string): Promise<{
  redirectTo: string;
  pendingPlan?: { tier: string; billing_cycle: string };
}> {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  const res = await apiFetch(`/api/auth/resolve-redirect${query}`, { headers });
  if (!res.ok) {
    return { redirectTo: '/dashboard' };
  }
  return res.json();
}

export async function getAuthConfig(): Promise<{
  isConfigured: boolean;
  oauthProviders: { google: boolean; microsoft: boolean };
  developerError: string | null;
  siteUrl?: string;
  diagnostic?: {
    hasUrl: boolean;
    hasAnonKey: boolean;
    source: string;
    framework: string;
    backendReachable: boolean;
  };
}> {
  let backendData: any = null;
  try {
    const res = await apiFetch('/api/auth/config');
    if (res.ok) {
      backendData = await res.json();
    }
  } catch (e) {
    // backend offline or unconfigured
  }

  if (backendData && backendData.configured === true) {
    const hasAnonKey = typeof backendData.anonKey === 'string' && backendData.anonKey.trim().length > 0;
    if (backendData.url && hasAnonKey) {
      try {
        const { isValidSupabaseUrl, normalizeSupabaseUrl, updateSupabaseClient } = await import('../lib/supabaseClient');
        const resolvedUrl = normalizeSupabaseUrl(backendData.url, backendData.anonKey);
        if (isValidSupabaseUrl(resolvedUrl)) {
          updateSupabaseClient(resolvedUrl, backendData.anonKey, {
            siteUrl: backendData.siteUrl,
            oauthProviders: backendData.oauthProviders
          });
        }
      } catch {
        // Ignore dynamic import errors in non-browser environments
      }
    }

    return {
      isConfigured: true,
      oauthProviders: backendData?.oauthProviders || { google: true, microsoft: false },
      developerError: null,
      siteUrl: backendData?.siteUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
      diagnostic: {
        hasUrl: true,
        hasAnonKey: true,
        source: 'firebase',
        framework: 'Vite React SPA',
        backendReachable: true
      }
    };
  }

  return {
    isConfigured: true,
    oauthProviders: { google: true, microsoft: false },
    developerError: null,
    siteUrl: typeof window !== 'undefined' ? window.location.origin : '',
    diagnostic: {
      hasUrl: true,
      hasAnonKey: true,
      source: 'firebase',
      framework: 'Vite React SPA',
      backendReachable: false
    }
  };
}

// Razorpay Subscriptions Checkout API Call
export async function createRazorpaySubscription(payload: {
  tier: 'starter' | 'growth' | 'pro';
  billing_cycle: 'monthly' | 'annual';
  isFoundingOffer?: boolean;
}): Promise<{
  success: boolean;
  subscriptionId: string;
  planId: string;
  keyId: string;
  tier: string;
  billing_cycle: string;
  amountPaise: number;
  amountInr: number;
  status: string;
  error?: string;
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/razorpay/create-subscription', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to initiate Razorpay subscription');
  }
  return data;
}

export interface InternationalBillingStatusResponse {
  success: boolean;
  isConfigured: boolean;
  internationalEnabled: boolean;
  domesticInrEnabled: boolean;
  liveVerified: boolean;
  currency: 'USD';
  settlementCurrency: 'INR';
  purposeCode: string;
  status: 'active_verified' | 'configured_pending_mandate_test' | 'merchant_activation_required';
  plans: Array<{ tier: string; name: string; priceUsd: number; amountCents: number; billing: string }>;
  settlementPolicy: {
    destinationBank: string;
    inrSettlementMode: string;
    dailyExchangeRateFixedInUsd: boolean;
    purposeCodeP0802Required: boolean;
  };
  checklist: {
    keysConfigured: boolean;
    webhookConfigured: boolean;
    internationalCardsApproved: boolean;
    purposeCodeP0802Configured: boolean;
    testMandateVerified: boolean;
  };
}

export interface BillingTransaction {
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
  settlement_status: string;
  created_at: string;
  updated_at: string;
}

export async function fetchInternationalBillingStatus(): Promise<InternationalBillingStatusResponse> {
  const res = await apiFetch('/api/razorpay/international-status');
  return res.json();
}

export async function fetchBillingTransactions(): Promise<{
  success: boolean;
  workspaceId: string;
  currency: string;
  settlementCurrency: string;
  count: number;
  transactions: BillingTransaction[];
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/billing/transactions', {
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  });
  return res.json();
}

// Admin Billing Plans API Calls
export async function fetchAdminBillingPlans(): Promise<{
  success: boolean;
  plans: any[];
  keyId: string;
  mode: string;
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/admin/billing/plans', {
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  });
  return res.json();
}

export async function createMissingRazorpayTestPlans(confirmationText: string): Promise<{
  success: boolean;
  message: string;
  createdCount: number;
  plans: any[];
  error?: string;
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/admin/billing/plans/create-missing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ confirmationText })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create missing Razorpay plans');
  }
  return data;
}

// CSV & Manual Data Ingestion Calls
export async function fetchImportHistory() {
  const res = await apiFetch('/api/imports/history', {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    return { history: [] };
  }
  return res.json();
}

export async function clearImportHistory(): Promise<{ success: boolean; message: string }> {
  const res = await apiFetch('/api/imports/history', {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return res.json();
}

export async function deleteCustomer(id: string): Promise<{ success: boolean; message: string; deletedCustomer?: Customer }> {
  const res = await apiFetch(`/api/customers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete customer');
  }
  return data;
}

export async function deleteCustomers(ids: string[]): Promise<{ success: boolean; deletedCount: number; message: string; deletedCustomers?: Customer[] }> {
  const res = await apiFetch('/api/customers/bulk-delete', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ids })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to bulk delete customers');
  }
  return data;
}

export async function clearDemoData(): Promise<{ success: boolean; removedCount: number; message: string }> {
  const res = await apiFetch('/api/customers/clear-demo', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to clear demo data');
  }
  return data;
}

export async function loadDemoData(): Promise<{ success: boolean; count: number; message: string }> {
  const res = await apiFetch('/api/customers/load-demo', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load demo data');
  }
  return data;
}

export async function restoreDeletedCustomers(customers: Customer[]): Promise<{ success: boolean; restoredCount: number; message: string; restored?: Customer[] }> {
  const res = await apiFetch('/api/customers/restore', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ customers })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to restore customers');
  }
  return data;
}

export async function importCustomersData(payload: {
  rawCsv?: string;
  rawPdfBase64?: string;
  fileType?: 'csv' | 'pdf';
  customers?: any[];
  fileName?: string;
  deduplicationMode?: 'overwrite' | 'skip';
  validateOnly?: boolean;
  importValidOnly?: boolean;
}) {
  let authHeaders = getAuthHeaders({ 'Content-Type': 'application/json' });

  // If Firebase client has an active authenticated user, ensure fresh ID token is attached
  if (typeof window !== 'undefined') {
    try {
      const { auth: fbAuth } = await import('../lib/firebaseClient');
      if (fbAuth?.currentUser) {
        const freshIdToken = await fbAuth.currentUser.getIdToken();
        if (freshIdToken) {
          localStorage.setItem('cs_auth_token', freshIdToken);
          authHeaders = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${freshIdToken}`
          };
        }
      }
    } catch {
      // ignore
    }
  }

  const res = await apiFetch('/api/customers/import', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(
      res.status === 401
        ? (data.error || 'Authentication required. Please sign in to import customer records.')
        : (data.error || 'Failed to import customer telemetry')
    );
    err.status = res.status;
    err.isAuthError = res.status === 401;
    err.missingColumns = data.missingColumns;
    err.errors = data.errors;
    throw err;
  }
  return data;
}

export const importCustomersCsv = importCustomersData;

export async function addCustomerManual(payload: {
  customerName: string;
  customerId: string;
  email?: string;
  plan?: string;
  mrr: number;
  lastLoginDate?: string;
  paymentStatus?: string;
  failedPaymentsCount?: number;
  ticketsLast30Days?: number;
  satisfactionScore?: number;
  emailOpenRate?: number;
}) {
  const res = await apiFetch('/api/customers/manual', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to add customer manually');
  }
  return data;
}

export async function fetchRazorpayConfig(): Promise<{
  success: boolean;
  isConfigured: boolean;
  keyId: string;
  currency: string;
  mode: string;
  plans: Record<string, { monthly: number; annual: number; currency: string; display: string }>;
}> {
  const res = await apiFetch('/api/razorpay/config');
  return res.json();
}

export async function fetchExchangeRate(): Promise<{
  success: boolean;
  base: string;
  target: string;
  rate: number;
  displayRate: string;
  source: string;
  updatedAt: string;
  error?: string;
}> {
  try {
    const res = await apiFetch('/api/billing/exchange-rate');
    return res.json();
  } catch (err: any) {
    return {
      success: false,
      base: 'USD',
      target: 'INR',
      rate: 86.85,
      displayRate: '1 USD = ₹86.85',
      source: 'offline',
      updatedAt: new Date().toISOString(),
      error: err?.message
    };
  }
}

export async function createRazorpayOrder(payload: {
  plan: string;
  billingCycle: string;
  customerName?: string;
  customerEmail?: string;
  isFoundingOffer?: boolean;
}): Promise<{
  success: boolean;
  orderId: string;
  amount: number;
  amountInr: number;
  amountUsd?: number;
  exchangeRate?: number;
  displayExchangeRate?: string;
  exchangeRateNotice?: string;
  currency: string;
  keyId: string;
  receipt: string;
  plan: string;
  planName?: string;
  billingCycle: string;
  formattedUsd?: string;
  error?: string;
}> {
  const res = await apiFetch('/api/razorpay/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function verifyRazorpayPayment(payload: {
  razorpay_order_id?: string;
  razorpay_payment_id: string;
  razorpay_signature?: string;
  razorpay_subscription_id?: string;
  plan?: string;
  tier?: string;
  billingCycle?: string;
  billing_cycle?: string;
  amount?: number;
  currency?: string;
  email?: string;
  isFoundingOffer?: boolean;
}): Promise<{
  success: boolean;
  verified: boolean;
  message: string;
  paymentId?: string;
  orderId?: string;
  subscriptionId?: string;
  plan?: string;
  billingStatus?: string;
  error?: string;
}> {
  const res = await apiFetch('/api/razorpay/verify-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function verifyRazorpaySubscription(payload: {
  razorpay_subscription_id: string;
  razorpay_payment_id: string;
  razorpay_signature?: string;
  tier?: string;
  plan?: string;
  billing_cycle?: string;
  billingCycle?: string;
  amount?: number;
  currency?: string;
  email?: string;
  isFoundingOffer?: boolean;
}): Promise<{
  success: boolean;
  verified: boolean;
  message: string;
  subscriptionId?: string;
  paymentId?: string;
  tier?: string;
  billingStatus?: string;
  error?: string;
}> {
  const res = await apiFetch('/api/razorpay/verify-subscription', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return res.json();
}

// $1 Trial Verification API Calls (Authoritative server-side flow)
export async function createTrialVerificationOrder(payload: {
  tier: 'starter' | 'growth' | 'pro';
  billing_cycle: 'monthly' | 'annual';
  isFoundingOffer?: boolean;
}): Promise<{
  success: boolean;
  keyId: string;
  orderId: string;
  amount: number;
  amountCents?: number;
  amountUsd?: number;
  currency: string;
  tier: string;
  billing_cycle: string;
  plan_name: string;
  formatted_amount: string;
  future_plan_price: number;
  trial_days: number;
  error?: string;
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/billing/trial-verification-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to initialize trial verification order');
  }
  return data;
}

export async function verifyTrialPayment(payload: {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}): Promise<{
  success: boolean;
  verified: boolean;
  message: string;
  trial_started: boolean;
  tier: string;
  billing_cycle: string;
  trial_ends_at: string;
  subscription?: any;
  error?: string;
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/billing/verify-trial-payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Trial verification payment failed to verify');
  }
  return data;
}

export async function activateSubscription(payload: {
  tier?: 'starter' | 'growth' | 'pro';
  billing_cycle?: 'monthly' | 'annual';
}): Promise<{
  success: boolean;
  message: string;
  subscriptionId?: string;
  plan?: any;
  error?: string;
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/billing/activate-subscription', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function fetchSubscriptionDetails(): Promise<{
  success: boolean;
  workspaceId: string;
  subscription: any;
  trialVerification: any;
  currentPlan: any;
  trialEndBehavior: string;
  plans: any[];
}> {
  const token = getStoredAuthToken();
  const res = await apiFetch('/api/billing/subscription-details', {
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  });
  return res.json();
}

export async function fetchSupabaseStatus(): Promise<{
  success: boolean;
  url: string;
  isConfigured: boolean;
  isConnected: boolean;
  responseCode: number;
  statusText: string;
  tables: { name: string; recordsCount: number; lastSync: string }[];
}> {
  const res = await apiFetch('/api/supabase/status');
  return res.json();
}

export async function syncSupabase(action = 'export', table = 'customers'): Promise<{
  success: boolean;
  action: string;
  table: string;
  syncedRecordsCount: number;
  timestamp: string;
  message: string;
}> {
  const res = await apiFetch('/api/supabase/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, table })
  });
  return res.json();
}

export async function testSupabase(): Promise<{
  success: boolean;
  url: string;
  status: string;
  latencyMs: number;
  message: string;
}> {
  const res = await apiFetch('/api/supabase/test', {
    method: 'POST'
  });
  return res.json();
}

// ----------------------------------------------------
// Real Outbound Integrations (WhatsApp & Resend Email)
// ----------------------------------------------------

export interface OutboundStatusResponse {
  whatsapp: {
    configured: boolean;
    status: 'connected' | 'not_configured' | 'error';
    provider: string;
    maskedIdentifier?: string | null;
    phoneNumberIdMasked?: string | null;
    businessAccountIdMasked?: string | null;
    error?: string | null;
    requiredEnvVars: string[];
    lastCheckedAt: string;
  };
  email: {
    configured: boolean;
    status: 'connected' | 'not_configured' | 'error';
    provider: string;
    maskedIdentifier?: string | null;
    fromEmail: string;
    error?: string | null;
    requiredEnvVars: string[];
    lastCheckedAt: string;
  };
}

export interface TestOutboundConfigResponse {
  channel: 'whatsapp' | 'email';
  verified: boolean;
  status: 'connected' | 'not_configured' | 'error';
  message: string;
  distinction: 'CONFIGURATION_VERIFIED_ONLY_NO_MESSAGE_SENT';
  requiredEnvVars?: string[];
  safeDetails?: string;
}

export interface SendMessagePayload {
  messageId: string;
  channel: 'whatsapp' | 'email';
  recipientEmail?: string;
  recipientPhone?: string;
  subject?: string;
  content: string;
  customerId?: string;
  customerName?: string;
  isApproved: boolean;
}

export interface SendMessageResponse {
  success: boolean;
  status: 'SENT' | 'FAILED';
  messageId?: string;
  channel?: 'whatsapp' | 'email';
  providerMessageId?: string;
  sentAt?: string;
  message?: string;
  error?: string;
  requiredEnvVars?: string[];
  providerResponse?: any;
}

export async function fetchOutboundStatus(): Promise<OutboundStatusResponse> {
  const res = await apiFetch('/api/integrations/outbound-status', {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    throw new Error('Failed to fetch outbound integrations status');
  }
  return res.json();
}

export async function testOutboundConfig(channel: 'whatsapp' | 'email'): Promise<TestOutboundConfigResponse> {
  const res = await apiFetch('/api/integrations/test-config', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ channel })
  });
  return res.json();
}

export async function sendRetentionMessage(payload: SendMessagePayload): Promise<SendMessageResponse> {
  const res = await apiFetch('/api/messages/send', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  return data;
}

// Outbound Sending Queue
export async function enqueueRetentionMessages(messages: any[]): Promise<{
  success: boolean;
  enqueuedCount: number;
  duplicatesBlocked: number;
  items: any[];
  queueStatus: any;
  message: string;
}> {
  const res = await apiFetch('/api/queue/enqueue', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messages })
  });
  return res.json();
}

export async function fetchQueueStatus(): Promise<any> {
  const res = await apiFetch('/api/queue/status', {
    headers: getAuthHeaders()
  });
  return res.json();
}

export async function processQueueNow(): Promise<any> {
  const res = await apiFetch('/api/queue/process', {
    method: 'POST',
    headers: getAuthHeaders()
  });
  return res.json();
}

export async function fetchQueueItems(): Promise<any> {
  const res = await apiFetch('/api/queue/items', {
    headers: getAuthHeaders()
  });
  return res.json();
}

// Scheduler & Daily Retention Briefs
export async function fetchSchedulerStatus(): Promise<any> {
  const res = await apiFetch('/api/scheduler/status', {
    headers: getAuthHeaders()
  });
  return res.json();
}

export async function updateSchedulerSettings(payload: any): Promise<any> {
  const res = await apiFetch('/api/scheduler/update', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function triggerDailyCronScan(ownerEmail?: string): Promise<any> {
  const res = await apiFetch('/api/cron/daily-scan', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ownerEmail })
  });
  return res.json();
}

export async function fetchRetentionBriefs(): Promise<any> {
  const res = await apiFetch('/api/scheduler/briefs', {
    headers: getAuthHeaders()
  });
  return res.json();
}

// Administrative & Security Audit Logging (Area 5, 7)
export async function fetchAdminAuditLogs(limit: number = 100): Promise<{
  success: boolean;
  workspaceId: string;
  count: number;
  logs: Array<{
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
  }>;
  error?: string;
}> {
  const res = await apiFetch(`/api/admin/audit-logs?limit=${limit}`, {
    headers: getAuthHeaders()
  });
  return res.json();
}

// Data Portability & GDPR Export (Area 2, 5, 9)
export async function exportCustomers(format: 'csv' | 'json' = 'json'): Promise<Blob> {
  const res = await apiFetch(`/api/export?format=${format}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    throw new Error('Failed to export customer dataset');
  }
  return res.blob();
}

export const apiService = {
  fetchHealth,
  fetchCustomers,
  fetchCustomerById,
  updateCustomerStatus,

  async predictChurn(customerId: string): Promise<Customer> {
    const res = await predictCustomerChurn(customerId);
    if (res.analysis?.customer) {
      return res.analysis.customer;
    }
    return fetchCustomerById(customerId);
  },

  async recommendRetention(customerId: string): Promise<Customer> {
    const res = await recommendCustomerRetention(customerId);
    return fetchCustomerById(customerId);
  },

  async markCustomerSaved(customerId: string, notes?: string): Promise<Customer> {
    const updated = await updateCustomerStatus(customerId, {
      status: 'saved',
      savedNotes: notes || 'Retained via Churnveda intervention'
    });
    return updated;
  },

  async batchAnalyze(customerIds?: string[]) {
    return batchPredictChurn(customerIds);
  },

  async fetchIntegrations(): Promise<{ integrations: IntegrationStatus[] }> {
    try {
      const integrations = await fetchIntegrations();
      return { integrations: Array.isArray(integrations) ? integrations : DEFAULT_INTEGRATIONS };
    } catch {
      return { integrations: DEFAULT_INTEGRATIONS };
    }
  },

  async syncAllIntegrations(): Promise<{ integrations: IntegrationStatus[] }> {
    return syncIntegration();
  },

  async syncIntegration(id: string): Promise<{ integration: IntegrationStatus }> {
    const res = await syncIntegration(id);
    const found = res.integrations.find((item) => item.id === id) || res.integrations[0];
    return { integration: found };
  },

  async toggleIntegration(id: string, isConnected: boolean): Promise<{ integration: IntegrationStatus }> {
    const res = await toggleIntegration(id, isConnected);
    const found = res.integrations.find((item) => item.id === id) || res.integrations[0];
    return { integration: found };
  },

  async importCustomers(customers: any[]) {
    return importCustomers(customers);
  },

  async fetchAlerts(): Promise<{ alerts: DailyAlert[] }> {
    try {
      const alerts = await fetchAlerts();
      return { alerts: Array.isArray(alerts) ? alerts : [] };
    } catch {
      return { alerts: [] };
    }
  },

  async sendTestAlert(email: string, slackWebhook?: string) {
    return testSlackAlert();
  },

  fetchRoiMetrics,
  requestAccountDeletion,
  signupUser,
  cancelTrial,
  cancelRazorpaySubscription,
  upgradePlan,
  addPaymentMethod,
  fetchPaymentMethods,
  deletePaymentMethod,
  setDefaultPaymentMethod,
  loginUser,
  fetchCurrentUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  createRazorpaySubscription,
  fetchAdminBillingPlans,
  createMissingRazorpayTestPlans,
  fetchRazorpayConfig,
  fetchExchangeRate,
  createRazorpayOrder,
  verifyRazorpayPayment,
  verifyRazorpaySubscription,
  createTrialVerificationOrder,
  verifyTrialPayment,
  activateSubscription,
  fetchSubscriptionDetails,
  fetchSupabaseStatus,
  syncSupabase,
  testSupabase,
  fetchImportHistory,
  clearImportHistory,
  deleteCustomer,
  deleteCustomers,
  clearDemoData,
  loadDemoData,
  restoreDeletedCustomers,
  importCustomersCsv,
  importCustomersData,
  addCustomerManual,
  getAuthConfig,
  setPendingPlan,
  resolvePostLoginRedirect,
  fetchOutboundStatus,
  testOutboundConfig,
  sendRetentionMessage,
  enqueueRetentionMessages,
  fetchQueueStatus,
  processQueueNow,
  fetchQueueItems,
  fetchSchedulerStatus,
  updateSchedulerSettings,
  triggerDailyCronScan,
  fetchRetentionBriefs,
  fetchAdminAuditLogs,
  exportCustomers,
  fetchInternationalBillingStatus,
  fetchBillingTransactions
};
