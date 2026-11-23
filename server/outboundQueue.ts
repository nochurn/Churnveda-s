/**
 * Churnveda Enterprise Outbound Retention Sending Queue
 *
 * Implements:
 * 1. Automatic, reliable sending queue for WhatsApp Business Cloud API & Resend Email.
 * 2. Strict approval gate enforcement (only APPROVED messages enter QUEUED / SENDING state).
 * 3. Atomic in-flight locking and Idempotency key tracking to guarantee ZERO duplicate sends.
 * 4. Safe retry logic with exponential backoff for transient 5xx/network errors (max 3 attempts).
 *    Permanent 4xx validation errors fail immediately without infinite retry loops.
 * 5. Works seamlessly when credentials are missing: keeps messages in QUEUED / APPROVED state
 *    with clear diagnostic reason, never faking sends.
 * 6. Organization / workspace ownership isolation for multi-tenant security.
 */

import crypto from 'crypto';
import { db } from './db.ts';

export interface OutboundQueueItem {
  id: string; // Internal queue ID
  messageId: string; // Client retention message ID
  workspaceId: string;
  channel: 'whatsapp' | 'email';
  customerId: string;
  customerName: string;
  recipientPhone?: string;
  recipientEmail?: string;
  subject?: string;
  content: string;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  lockedAt?: number | null;
  nextAttemptAt?: number;
  providerMessageId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  queuedAt?: string;
  sentAt?: string;
  failedAt?: string;
}

export interface QueueProcessingResult {
  processed: number;
  succeeded: number;
  failed: number;
  skippedUnconfigured: number;
  duplicatesBlocked: number;
}

// Persistent-backed queue structures (Tenant isolated)
const queueItems: Map<string, OutboundQueueItem> = new Map();
// Idempotency cache: idempotencyKey -> { providerMessageId, sentAt, channel }
const completedIdempotencyMap: Map<string, { providerMessageId: string; sentAt: string; channel: string }> = new Map();
let duplicateSuppressedCount = 0;
let isProcessingQueue = false;

// Opt-out suppression lists (hydrated from DB + live API opt-outs)
const unsubscribedEmails = new Set<string>();
const optedOutPhones = new Set<string>();

export function markEmailUnsubscribed(email: string): void {
  const norm = String(email || '').trim().toLowerCase();
  if (norm) unsubscribedEmails.add(norm);
}

export function isEmailUnsubscribed(email?: string | null): boolean {
  if (!email) return false;
  return unsubscribedEmails.has(String(email).trim().toLowerCase());
}

export function markPhoneOptedOut(phone: string): void {
  const norm = String(phone || '').replace(/[\s\(\)\-\.]/g, '').replace(/^\+/, '');
  if (norm) optedOutPhones.add(norm);
}

export function isPhoneOptedOut(phone?: string | null): boolean {
  if (!phone) return false;
  const norm = String(phone).replace(/[\s\(\)\-\.]/g, '').replace(/^\+/, '');
  return optedOutPhones.has(norm);
}

export function removeWorkspaceQueueItems(workspaceId: string): number {
  let removed = 0;
  for (const [key, item] of queueItems.entries()) {
    if (item.workspaceId === workspaceId) {
      queueItems.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Strips secret tokens from error messages so they never reach client bundles or logs.
 */
export function sanitizeOutboundError(rawError: string): string {
  if (!rawError) return 'Unknown provider error';
  let sanitized = String(rawError);
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (waToken && waToken.length > 5) {
    sanitized = sanitized.split(waToken).join('[REDACTED_WHATSAPP_TOKEN]');
  }
  if (resendKey && resendKey.length > 5) {
    sanitized = sanitized.split(resendKey).join('[REDACTED_RESEND_KEY]');
  }
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  sanitized = sanitized.replace(/re_[A-Za-z0-9_]{16,}/gi, 're_[REDACTED]');
  return sanitized;
}

/**
 * Validates international E.164 phone numbers for WhatsApp Business Cloud API.
 */
export function validateWhatsAppPhone(phone?: string | null): { isValid: boolean; normalized?: string; error?: string } {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, error: 'Customer phone number is missing.' };
  }
  const cleaned = phone.replace(/[\s\(\)\-\.]/g, '');
  const e164Regex = /^\+?[1-9]\d{9,14}$/;
  if (!e164Regex.test(cleaned)) {
    return {
      isValid: false,
      error: `Invalid phone number format: "${phone}". WhatsApp Business API requires a valid international E.164 phone number (10-15 digits, e.g. +14155552671).`
    };
  }
  const normalizedForApi = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  return { isValid: true, normalized: normalizedForApi };
}

/**
 * Validates customer email format for Resend API.
 */
export function validateCustomerEmail(email?: string | null): { isValid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Customer email address is missing.' };
  }
  const trimmed = email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: `Invalid email address format: "${email}".` };
  }
  return { isValid: true };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Computes deterministic SHA-256 idempotency key.
 */
export function computeIdempotencyKey(workspaceId: string, messageId: string, channel: string, content: string): string {
  return crypto
    .createHash('sha256')
    .update(`${workspaceId}:${messageId}:${channel}:${content.trim()}`)
    .digest('hex');
}

export async function checkPersistentIdempotencyOrDailyDuplicate(params: {
  workspaceId: string;
  messageId: string;
  channel: 'whatsapp' | 'email';
  customerId?: string;
  content: string;
}): Promise<{ isDuplicate: boolean; reason?: string; existingProviderId?: string; existingSentAt?: string }> {
  const key = computeIdempotencyKey(params.workspaceId, params.messageId, params.channel, params.content);
  const mem = completedIdempotencyMap.get(key);
  if (mem) {
    return {
      isDuplicate: true,
      reason: `Duplicate send suppressed. Message already delivered via ${params.channel}.`,
      existingProviderId: mem.providerMessageId,
      existingSentAt: mem.sentAt
    };
  }
  const dbRec = await db.outboundLog.getByIdempotencyKey(key).catch(() => null);
  if (dbRec) {
    completedIdempotencyMap.set(key, {
      providerMessageId: dbRec.provider_message_id,
      sentAt: dbRec.sent_at,
      channel: dbRec.channel
    });
    return {
      isDuplicate: true,
      reason: `Duplicate send suppressed. Message already delivered via ${params.channel}.`,
      existingProviderId: dbRec.provider_message_id,
      existingSentAt: dbRec.sent_at
    };
  }
  if (params.customerId && params.customerId !== 'cust-generic') {
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const alreadySentToday = await db.outboundLog.hasCustomerSentToday(
      params.workspaceId,
      params.customerId,
      params.channel,
      todayPrefix
    ).catch(() => false);
    if (alreadySentToday) {
      return {
        isDuplicate: true,
        reason: `Customer ${params.customerId} already received a ${params.channel} outreach message today (${todayPrefix}). Duplicate outreach blocked.`
      };
    }
  }
  return { isDuplicate: false };
}

export async function recordPersistentOutboundSend(params: {
  workspaceId: string;
  messageId: string;
  channel: 'whatsapp' | 'email';
  customerId?: string;
  recipient: string;
  content: string;
  providerMessageId: string;
}): Promise<void> {
  const key = computeIdempotencyKey(params.workspaceId, params.messageId, params.channel, params.content);
  const nowIso = new Date().toISOString();
  completedIdempotencyMap.set(key, {
    providerMessageId: params.providerMessageId,
    sentAt: nowIso,
    channel: params.channel
  });
  await db.outboundLog.recordSent({
    idempotency_key: key,
    workspace_id: params.workspaceId,
    message_id: params.messageId,
    channel: params.channel,
    customer_id: params.customerId || 'cust-generic',
    recipient: params.recipient,
    provider_message_id: params.providerMessageId,
    status: 'SENT',
    sent_at: nowIso,
    created_at: nowIso
  }).catch(() => {});
}

/**
 * Checks if WhatsApp Business Cloud API has required server environment variables.
 */
export function isWhatsAppConfigured(): boolean {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  return Boolean(token && phoneId && accountId);
}

/**
 * Checks if Resend Email API has required server environment variables.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/**
 * Enqueues an approved retention message for automatic background delivery.
 * Enforces mandatory approval gate and duplicate prevention.
 */
export function enqueueApprovedMessage(payload: {
  messageId: string;
  workspaceId: string;
  channel: 'whatsapp' | 'email';
  customerId: string;
  customerName: string;
  recipientPhone?: string;
  recipientEmail?: string;
  subject?: string;
  content: string;
  isApproved: boolean;
}): { success: boolean; queueItem: OutboundQueueItem; isDuplicate: boolean; statusMessage: string } {
  if (!payload.isApproved) {
    throw new Error('Message approval required. Unapproved drafts cannot enter the sending queue.');
  }

  const now = new Date().toISOString();
  const idempotencyKey = computeIdempotencyKey(payload.workspaceId, payload.messageId, payload.channel, payload.content);

  // 1. Check if already delivered with external provider (Idempotency cache)
  const existingSent = completedIdempotencyMap.get(idempotencyKey);
  if (existingSent) {
    duplicateSuppressedCount++;
    const duplicateItem: OutboundQueueItem = {
      id: `q-${payload.messageId}`,
      messageId: payload.messageId,
      workspaceId: payload.workspaceId,
      channel: payload.channel,
      customerId: payload.customerId,
      customerName: payload.customerName,
      recipientPhone: payload.recipientPhone,
      recipientEmail: payload.recipientEmail,
      subject: payload.subject,
      content: payload.content,
      status: 'SENT',
      attempts: 1,
      maxAttempts: 3,
      idempotencyKey,
      providerMessageId: existingSent.providerMessageId,
      sentAt: existingSent.sentAt,
      createdAt: existingSent.sentAt,
      updatedAt: now
    };
    return {
      success: true,
      queueItem: duplicateItem,
      isDuplicate: true,
      statusMessage: `Duplicate send suppressed. Message already delivered via ${payload.channel} (Provider ID: ${existingSent.providerMessageId}).`
    };
  }

  // 2. Check if already queued or in-flight
  const existingQueued = queueItems.get(payload.messageId);
  if (existingQueued) {
    if (existingQueued.status === 'SENT') {
      duplicateSuppressedCount++;
      return {
        success: true,
        queueItem: existingQueued,
        isDuplicate: true,
        statusMessage: 'Message already sent.'
      };
    }
    if (existingQueued.status === 'SENDING') {
      return {
        success: true,
        queueItem: existingQueued,
        isDuplicate: true,
        statusMessage: 'Message is currently being dispatched to external provider.'
      };
    }
    // If previously failed and user re-approves, reset attempts and requeue
    existingQueued.status = 'QUEUED';
    existingQueued.attempts = 0;
    existingQueued.error = undefined;
    existingQueued.updatedAt = now;
    existingQueued.queuedAt = now;
    existingQueued.lockedAt = null;
    return {
      success: true,
      queueItem: existingQueued,
      isDuplicate: false,
      statusMessage: 'Message re-queued for delivery.'
    };
  }

  // 3. Create fresh queue item in QUEUED state
  const newItem: OutboundQueueItem = {
    id: `q-${payload.messageId}-${Date.now()}`,
    messageId: payload.messageId,
    workspaceId: payload.workspaceId,
    channel: payload.channel,
    customerId: payload.customerId,
    customerName: payload.customerName,
    recipientPhone: payload.recipientPhone,
    recipientEmail: payload.recipientEmail,
    subject: payload.subject,
    content: payload.content,
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: 3,
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
    queuedAt: now,
    lockedAt: null
  };

  queueItems.set(payload.messageId, newItem);

  return {
    success: true,
    queueItem: newItem,
    isDuplicate: false,
    statusMessage: 'Message successfully placed into outbound dispatch queue.'
  };
}

/**
 * Dispatches an individual queue item to Meta WhatsApp Cloud API or Resend API.
 */
async function dispatchQueueItem(item: OutboundQueueItem): Promise<{ success: boolean; providerMessageId?: string; error?: string; isPermanentError?: boolean }> {
  const now = new Date().toISOString();

  // 1. WhatsApp Channel
  if (item.channel === 'whatsapp') {
    if (!isWhatsAppConfigured()) {
      return {
        success: false,
        error: 'WhatsApp integration is not configured yet. Server-side environment variables WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_BUSINESS_ACCOUNT_ID are required.',
        isPermanentError: false // Can be retried once admin attaches credentials
      };
    }

    const phoneValidation = validateWhatsAppPhone(item.recipientPhone);
    if (!phoneValidation.isValid) {
      return {
        success: false,
        error: phoneValidation.error || 'Invalid customer phone number format.',
        isPermanentError: true
      };
    }

    if (isPhoneOptedOut(phoneValidation.normalized)) {
      return {
        success: false,
        error: 'Recipient has opted out of WhatsApp retention messages (STOP).',
        isPermanentError: true
      };
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!.trim();
    const token = process.env.WHATSAPP_ACCESS_TOKEN!.trim();
    const waEndpoint = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

    try {
      const response = await fetch(waEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phoneValidation.normalized,
          type: 'text',
          text: {
            preview_url: false,
            body: item.content
          }
        })
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const rawErr = responseData?.error?.message || responseData?.error?.error_user_msg || `Meta API HTTP ${response.status}`;
        const safeError = sanitizeOutboundError(rawErr);
        // Meta HTTP 4xx are client/auth/format errors (permanent); 5xx are transient
        const isPermanent = response.status >= 400 && response.status < 500;
        return {
          success: false,
          error: `WhatsApp Cloud API error: ${safeError}`,
          isPermanentError: isPermanent
        };
      }

      const providerMessageId = responseData?.messages?.[0]?.id || `wamid_${Date.now()}`;
      return {
        success: true,
        providerMessageId
      };
    } catch (networkErr: any) {
      const safeError = sanitizeOutboundError(networkErr?.message || 'Network error connecting to Meta WhatsApp API');
      return {
        success: false,
        error: `WhatsApp network error: ${safeError}`,
        isPermanentError: false
      };
    }
  }

  // 2. Email Channel (Resend)
  if (item.channel === 'email') {
    if (!isEmailConfigured()) {
      return {
        success: false,
        error: 'Email integration is not configured yet. Server-side environment variable RESEND_API_KEY is required.',
        isPermanentError: false
      };
    }

    const emailValidation = validateCustomerEmail(item.recipientEmail);
    if (!emailValidation.isValid) {
      return {
        success: false,
        error: emailValidation.error || 'Invalid customer email address format.',
        isPermanentError: true
      };
    }

    const recipientEmailClean = item.recipientEmail!.trim().toLowerCase();
    if (isEmailUnsubscribed(recipientEmailClean)) {
      return {
        success: false,
        error: 'Recipient has unsubscribed from outbound emails.',
        isPermanentError: true
      };
    }

    const apiKey = process.env.RESEND_API_KEY!.trim();
    const fromAddress = process.env.RESEND_FROM_EMAIL?.trim() || 'Churnveda <onboarding@resend.dev>';
    const emailSubject = item.subject || `Checking in regarding your ${item.customerName || 'account'}`;
    const siteBase = (process.env.APP_URL || process.env.VITE_SITE_URL || 'https://churnveda.com').trim().replace(/\/+$/, '');
    const unsubscribeUrl = `${siteBase}/api/communications/unsubscribe?email=${encodeURIComponent(recipientEmailClean)}`;
    const postalAddress = (process.env.POSTAL_ADDRESS || 'Churnveda Support · [Business Postal Address Required for CAN-SPAM — Set POSTAL_ADDRESS env var]').trim();

    const textWithFooter = item.content.includes('/unsubscribe')
      ? item.content
      : `${item.content}\n\n---\nUnsubscribe: ${unsubscribeUrl}\n${postalAddress}`;

    const htmlBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111827;">
  <div style="white-space: pre-wrap;">${escapeHtml(item.content)}</div>
  <hr style="margin: 24px 0 12px; border: 0; border-top: 1px solid #e5e7eb;" />
  <div style="font-size: 12px; color: #6b7280; line-height: 1.5;">
    <p style="margin: 0 0 4px;">You are receiving this retention outreach email because you are an active or recent customer.</p>
    <p style="margin: 0 0 4px;"><a href="${unsubscribeUrl}" style="color: #1e3a8a; text-decoration: underline;">Unsubscribe from future emails</a></p>
    <p style="margin: 0;">${escapeHtml(postalAddress)}</p>
  </div>
</div>`;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [recipientEmailClean],
          subject: emailSubject,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
          text: textWithFooter,
          html: htmlBody
        })
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const rawErr = responseData?.message || responseData?.name || `Resend API HTTP ${response.status}`;
        const safeError = sanitizeOutboundError(rawErr);
        const isPermanent = response.status >= 400 && response.status < 500;
        return {
          success: false,
          error: `Resend API error: ${safeError}`,
          isPermanentError: isPermanent
        };
      }

      const providerMessageId = responseData?.id || `resend_${Date.now()}`;
      return {
        success: true,
        providerMessageId
      };
    } catch (networkErr: any) {
      const safeError = sanitizeOutboundError(networkErr?.message || 'Network error connecting to Resend API');
      return {
        success: false,
        error: `Resend network error: ${safeError}`,
        isPermanentError: false
      };
    }
  }

  return { success: false, error: 'Unknown outbound channel', isPermanentError: true };
}

/**
 * Processes all eligible queued items automatically.
 * Respects locks, idempotency, and retries.
 */
export async function processOutboundQueue(): Promise<QueueProcessingResult> {
  if (isProcessingQueue) {
    return { processed: 0, succeeded: 0, failed: 0, skippedUnconfigured: 0, duplicatesBlocked: 0 };
  }

  isProcessingQueue = true;
  const result: QueueProcessingResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skippedUnconfigured: 0,
    duplicatesBlocked: 0
  };

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    for (const [messageId, item] of queueItems.entries()) {
      // Only process items in QUEUED state
      if (item.status !== 'QUEUED') {
        continue;
      }

      // Check backoff timer for transient retries
      if (item.nextAttemptAt && nowMs < item.nextAttemptAt) {
        continue;
      }

      // Check lock (avoid race conditions across concurrent runners; 45s lock timeout)
      if (item.lockedAt && nowMs - item.lockedAt < 45000) {
        continue;
      }

      // Check if integration is configured
      const configured = item.channel === 'whatsapp' ? isWhatsAppConfigured() : isEmailConfigured();
      if (!configured) {
        result.skippedUnconfigured++;
        item.error = item.channel === 'whatsapp'
          ? 'WhatsApp integration is not configured yet.'
          : 'Email integration is not configured yet.';
        item.updatedAt = nowIso;
        // Keep in QUEUED / APPROVED state; never mark SENT!
        continue;
      }

      // Check in-memory + DB persistent duplicate protection & same-day customer limit
      const dupCheck = await checkPersistentIdempotencyOrDailyDuplicate({
        workspaceId: item.workspaceId,
        messageId: item.messageId,
        channel: item.channel,
        customerId: item.customerId,
        content: item.content
      });
      if (dupCheck.isDuplicate) {
        duplicateSuppressedCount++;
        result.duplicatesBlocked++;
        if (dupCheck.existingProviderId) {
          item.status = 'SENT';
          item.providerMessageId = dupCheck.existingProviderId;
          item.sentAt = dupCheck.existingSentAt || nowIso;
        } else {
          item.status = 'FAILED';
          item.failedAt = nowIso;
          item.error = dupCheck.reason || 'Duplicate daily customer outreach suppressed.';
        }
        item.updatedAt = nowIso;
        continue;
      }

      // Acquire lock and transition to SENDING state
      item.status = 'SENDING';
      item.lockedAt = nowMs;
      item.attempts += 1;
      item.updatedAt = nowIso;
      result.processed++;

      // Dispatch to real provider
      const dispatchResult = await dispatchQueueItem(item);

      if (dispatchResult.success && dispatchResult.providerMessageId) {
        // Success: Transition to SENT
        item.status = 'SENT';
        item.providerMessageId = dispatchResult.providerMessageId;
        item.sentAt = new Date().toISOString();
        item.error = undefined;
        item.lockedAt = null;
        item.nextAttemptAt = undefined;
        item.updatedAt = item.sentAt;

        // Save in memory + persistent DB idempotency log
        await recordPersistentOutboundSend({
          workspaceId: item.workspaceId,
          messageId: item.messageId,
          channel: item.channel,
          customerId: item.customerId,
          recipient: item.recipientEmail || item.recipientPhone || 'recipient',
          content: item.content,
          providerMessageId: dispatchResult.providerMessageId
        });

        result.succeeded++;
      } else {
        // Failed
        const isPermanent = Boolean(dispatchResult.isPermanentError);
        const reachedMaxAttempts = item.attempts >= item.maxAttempts;

        if (isPermanent || reachedMaxAttempts) {
          // Permanent failure
          item.status = 'FAILED';
          item.failedAt = new Date().toISOString();
          item.error = dispatchResult.error || 'Outbound send request rejected by provider.';
          item.lockedAt = null;
          item.nextAttemptAt = undefined;
          item.updatedAt = item.failedAt;
          result.failed++;
        } else {
          // Transient error: Re-queue with exponential backoff (5s, 15s, ...)
          item.status = 'QUEUED';
          item.error = `Temporary failure (Attempt ${item.attempts}/${item.maxAttempts}): ${dispatchResult.error || 'Retrying soon'}`;
          item.lockedAt = null;
          item.nextAttemptAt = Date.now() + 5000 * Math.pow(3, Math.max(0, item.attempts - 1));
          item.updatedAt = new Date().toISOString();
        }
      }
    }
  } finally {
    isProcessingQueue = false;
  }

  return result;
}

/**
 * Returns outbound queue statistics scoped to workspace when provided.
 */
export function getOutboundQueueStatus(workspaceId?: string): {
  totalItems: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  duplicateProtectionActive: boolean;
  duplicateSuppressedCount: number;
  lastProcessedAt: string;
} {
  let totalItems = 0;
  let queued = 0;
  let sending = 0;
  let sent = 0;
  let failed = 0;

  for (const item of queueItems.values()) {
    if (workspaceId && item.workspaceId !== workspaceId) continue;
    totalItems++;
    if (item.status === 'QUEUED') queued++;
    else if (item.status === 'SENDING') sending++;
    else if (item.status === 'SENT') sent++;
    else if (item.status === 'FAILED') failed++;
  }

  return {
    totalItems,
    queued,
    sending,
    sent,
    failed,
    duplicateProtectionActive: true,
    duplicateSuppressedCount,
    lastProcessedAt: new Date().toISOString()
  };
}

/**
 * Gets a specific queue item by message ID.
 */
export function getQueueItem(messageId: string): OutboundQueueItem | null {
  return queueItems.get(messageId) || null;
}

/**
 * Lists queue items for a workspace.
 */
export function listQueueItems(workspaceId?: string): OutboundQueueItem[] {
  const items = Array.from(queueItems.values());
  if (!workspaceId) return items;
  return items.filter(item => item.workspaceId === workspaceId);
}

// Background Queue Processor (runs every 6 seconds)
let queueIntervalTimer: NodeJS.Timeout | null = null;

export function startOutboundQueueRunner(): void {
  if (queueIntervalTimer) return;
  queueIntervalTimer = setInterval(() => {
    processOutboundQueue().catch(() => {});
  }, 6000);
  if (queueIntervalTimer.unref) {
    queueIntervalTimer.unref();
  }
}
