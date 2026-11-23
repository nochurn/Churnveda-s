/**
 * Churnveda Automatic Retention Scheduler & Owner Brief Service
 *
 * Implements:
 * 1. Per-workspace isolated scheduler configs persisted to PostgreSQL/SQLite.
 * 2. Accurate IANA timezone scheduling using Intl.DateTimeFormat (with UTC fallback).
 * 3. Daily scheduled scan runner:
 *    Scan customer accounts -> calculate risk & priority -> identify Top N
 *    -> prevent same-day duplicate scheduled/cron briefs & notifications.
 * 4. Owner Retention Brief email dispatch via Resend with exponential backoff retries.
 */

import { db } from './db.ts';
import { isEmailConfigured, sanitizeOutboundError } from './outboundQueue.ts';

export interface DailySchedulerConfig {
  workspaceId: string;
  enabled: boolean;
  scanTime: string; // HH:MM in 24hr format, e.g. "09:00"
  timezone: string; // Valid IANA timezone, e.g. "Asia/Kolkata", "America/New_York", "UTC"
  ownerNotificationEmail?: string;
  lastRunDate?: string; // YYYY-MM-DD in workspace timezone
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface OwnerRetentionBrief {
  id: string;
  workspaceId: string;
  date: string;
  status: 'COMPLETED' | 'ERROR';
  customersAnalyzed: number;
  customersAtRisk: number;
  revenueAtRisk: number;
  top5Count: number;
  messagesPrepared: number;
  messagesAwaitingApproval: number;
  messagesSent: number;
  messagesFailed: number;
  ownerNotificationEmail?: string;
  ownerNotificationStatus: 'sent' | 'pending_credentials' | 'disabled' | 'failed';
  ownerNotificationMessage?: string;
  createdAt: string;
}

const schedulerConfigs = new Map<string, DailySchedulerConfig>();
const briefHistory: OwnerRetentionBrief[] = [];
const activeWorkspaceScans = new Set<string>();
let schedulerTimer: NodeJS.Timeout | null = null;

function createDefaultConfig(workspaceId: string): DailySchedulerConfig {
  return {
    workspaceId,
    enabled: true,
    scanTime: '09:00',
    timezone: 'UTC',
    ownerNotificationEmail: '',
    nextRunAt: calculateNextRunTime('09:00', 'UTC')
  };
}

export function normalizeTimezone(tz?: string): string {
  const candidate = String(tz || 'UTC').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

export function normalizeScanTime(scanTime?: string): string {
  const raw = String(scanTime || '09:00').trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!match) return '09:00';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function getZonedDateTimeParts(date: Date, timeZone: string): {
  dateStr: string;
  timeStr: string;
  hour: number;
  minute: number;
} {
  const validTz = normalizeTimezone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = Number(map.hour ?? 0) % 24;
  const minute = Number(map.minute ?? 0) % 60;
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hour,
    minute
  };
}

function getWorkspaceConfig(workspaceId: string): DailySchedulerConfig {
  let cfg = schedulerConfigs.get(workspaceId);
  if (!cfg) {
    cfg = createDefaultConfig(workspaceId);
    schedulerConfigs.set(workspaceId, cfg);
  }
  return cfg;
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
 * Calculates next scheduled run ISO timestamp based on scanTime (HH:MM) in the workspace's IANA timezone.
 */
export function calculateNextRunTime(scanTime: string = '09:00', timezone: string = 'UTC'): string {
  const normalizedTime = normalizeScanTime(scanTime);
  const validTz = normalizeTimezone(timezone);
  const [targetHour, targetMin] = normalizedTime.split(':').map(n => parseInt(n, 10));

  const now = new Date();
  // Walk minute-aligned candidates up to 48 hours ahead (fast coarse hour/minute check handles DST accurately)
  const baseMs = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  for (let offsetMin = 0; offsetMin <= 48 * 60; offsetMin += 1) {
    const candidate = new Date(baseMs + offsetMin * 60000);
    const zoned = getZonedDateTimeParts(candidate, validTz);
    if (zoned.hour === targetHour && zoned.minute === targetMin) {
      return candidate.toISOString();
    }
  }

  const fallback = new Date(now.getTime() + 86400000);
  return fallback.toISOString();
}

export async function hydrateSchedulerFromDb(): Promise<void> {
  try {
    const [settings, briefs] = await Promise.all([
      db.scheduler.listAllSettings(),
      db.scheduler.listBriefs()
    ]);

    for (const s of settings) {
      const tz = normalizeTimezone(s.timezone);
      const scanTime = normalizeScanTime(s.scan_time);
      schedulerConfigs.set(s.workspace_id, {
        workspaceId: s.workspace_id,
        enabled: Boolean(s.enabled),
        scanTime,
        timezone: tz,
        ownerNotificationEmail: s.owner_notification_email || '',
        lastRunDate: s.last_run_date || undefined,
        lastRunAt: s.last_run_at || undefined,
        nextRunAt: s.next_run_at || calculateNextRunTime(scanTime, tz)
      });
    }

    if (!schedulerConfigs.has('ws-default')) {
      schedulerConfigs.set('ws-default', createDefaultConfig('ws-default'));
    }

    briefHistory.length = 0;
    for (const b of briefs) {
      briefHistory.push({
        id: b.id,
        workspaceId: b.workspace_id,
        date: b.date,
        status: b.status,
        customersAnalyzed: b.customers_analyzed,
        customersAtRisk: b.customers_at_risk,
        revenueAtRisk: b.revenue_at_risk,
        top5Count: b.top5_count,
        messagesPrepared: b.messages_prepared,
        messagesAwaitingApproval: b.messages_awaiting_approval,
        messagesSent: b.messages_sent,
        messagesFailed: b.messages_failed,
        ownerNotificationEmail: b.owner_notification_email || undefined,
        ownerNotificationStatus: b.owner_notification_status,
        ownerNotificationMessage: b.owner_notification_message || undefined,
        createdAt: b.created_at
      });
    }
  } catch (err: any) {
    console.warn('[Churnveda Scheduler] DB hydration warning:', err?.message || err);
  }
}

export function removeWorkspaceSchedulerData(workspaceId: string): void {
  schedulerConfigs.delete(workspaceId);
  for (let i = briefHistory.length - 1; i >= 0; i--) {
    if (briefHistory[i].workspaceId === workspaceId) {
      briefHistory.splice(i, 1);
    }
  }
}

/**
 * Sends owner's retention brief email via Resend with bounded retry on transient 5xx/network failures.
 */
async function sendOwnerBriefEmail(brief: OwnerRetentionBrief): Promise<{
  status: 'sent' | 'pending_credentials' | 'disabled' | 'failed';
  message: string;
  providerMessageId?: string;
}> {
  if (!brief.ownerNotificationEmail) {
    return {
      status: 'disabled',
      message: 'Owner notification email not configured in Settings.'
    };
  }

  if (!isEmailConfigured()) {
    return {
      status: 'pending_credentials',
      message: 'Email integration is not configured yet. Brief prepared and stored in dashboard.'
    };
  }

  const apiKey = process.env.RESEND_API_KEY!.trim();
  const fromAddress = process.env.RESEND_FROM_EMAIL?.trim() || 'Churnveda <onboarding@resend.dev>';
  const subject = `Churnveda Morning Retention Brief (${brief.date.slice(0, 10)}) - $${brief.revenueAtRisk.toLocaleString()} MRR at risk`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
      <div style="background-color: #0f172a; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Churnveda Daily Retention Brief</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">Your automated morning retention review</p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
          <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Revenue at Risk</div>
          <div style="font-size: 24px; font-weight: 800; color: #dc2626; margin-top: 4px;">$${brief.revenueAtRisk.toLocaleString()}</div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
          <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Accounts at Risk</div>
          <div style="font-size: 24px; font-weight: 800; color: #0f172a; margin-top: 4px;">${brief.customersAtRisk} / ${brief.customersAnalyzed}</div>
        </div>
      </div>

      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <strong style="color: #1e3a8a; font-size: 14px;">Messages Awaiting Your Approval</strong>
        <p style="color: #1e40af; font-size: 13px; margin: 4px 0 0 0;">
          ${brief.messagesPrepared} retention drafts were generated for your Top ${brief.top5Count} priority accounts.
          Log in to your Churnveda dashboard to review and approve messages.
        </p>
      </div>

      <div style="font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        Automated scan run at ${escapeHtml(brief.date)}. Delivery through verified Resend Email API.
      </div>
    </div>
  `;

  const maxAttempts = 3;
  let lastError = 'Unknown provider error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [brief.ownerNotificationEmail.trim().toLowerCase()],
          subject,
          html: htmlBody
        })
      });

      const resData = await res.json().catch(() => ({}));
      if (res.ok && resData.id) {
        return {
          status: 'sent',
          message: `Owner brief successfully dispatched to ${brief.ownerNotificationEmail} via Resend.`,
          providerMessageId: resData.id
        };
      }

      lastError = sanitizeOutboundError(resData?.message || `HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) {
        return {
          status: 'failed',
          message: `Resend API rejected brief: ${lastError}`
        };
      }
    } catch (err: any) {
      lastError = sanitizeOutboundError(err?.message || 'Network error');
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 400 * Math.pow(2, attempt - 1)));
    }
  }

  return {
    status: 'failed',
    message: `Failed to deliver owner brief after retries: ${lastError}`
  };
}

/**
 * Triggers the automated daily retention scan for a single workspace.
 * Enforces concurrency lock and prevents duplicate same-day automated briefs.
 */
export async function executeDailyRetentionScan(params: {
  workspaceId: string;
  customers: any[];
  ownerEmail?: string;
  triggerType?: 'scheduled' | 'manual' | 'cron_api';
  topLimit?: number;
}): Promise<{
  success: boolean;
  brief: OwnerRetentionBrief;
  message: string;
  deduplicated?: boolean;
}> {
  if (activeWorkspaceScans.has(params.workspaceId)) {
    throw new Error('A daily retention scan is already in progress for this workspace.');
  }

  activeWorkspaceScans.add(params.workspaceId);
  const wsConfig = getWorkspaceConfig(params.workspaceId);
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const zoned = getZonedDateTimeParts(nowDate, wsConfig.timezone);

  try {
    // Prevent duplicate automated daily briefs / emails for the same workspace on the same local day
    if ((params.triggerType === 'scheduled' || params.triggerType === 'cron_api') && wsConfig.lastRunDate === zoned.dateStr) {
      const existingBrief = briefHistory.find(b => b.workspaceId === params.workspaceId);
      if (existingBrief) {
        return {
          success: true,
          deduplicated: true,
          brief: existingBrief,
          message: `Daily retention scan already completed today (${zoned.dateStr} ${wsConfig.timezone}). Duplicate notification suppressed.`
        };
      }
    }

    const customers = params.customers || [];
    const atRiskList = customers.filter((c: any) => (c.risk_score ?? c.riskScore ?? 0) >= 60 && c.status !== 'saved' && c.status !== 'churned');
    const revenueAtRisk = atRiskList.reduce((sum: number, c: any) => sum + (Number(c.mrr) || 0), 0);

    const maxTop = params.topLimit && params.topLimit > 0 ? params.topLimit : 5;
    const top5Count = Math.min(maxTop, atRiskList.length);
    const messagesPrepared = top5Count * 2;

    const brief: OwnerRetentionBrief = {
      id: `brief-${params.workspaceId}-${Date.now()}`,
      workspaceId: params.workspaceId,
      date: nowIso,
      status: 'COMPLETED',
      customersAnalyzed: customers.length,
      customersAtRisk: atRiskList.length,
      revenueAtRisk,
      top5Count,
      messagesPrepared,
      messagesAwaitingApproval: messagesPrepared,
      messagesSent: 0,
      messagesFailed: 0,
      ownerNotificationEmail: params.ownerEmail || wsConfig.ownerNotificationEmail,
      ownerNotificationStatus: 'pending_credentials',
      createdAt: nowIso
    };

    const notifyRes = await sendOwnerBriefEmail(brief);
    brief.ownerNotificationStatus = notifyRes.status;
    brief.ownerNotificationMessage = notifyRes.message;

    // Update workspace scheduler state & persist
    wsConfig.lastRunDate = zoned.dateStr;
    wsConfig.lastRunAt = nowIso;
    wsConfig.nextRunAt = calculateNextRunTime(wsConfig.scanTime, wsConfig.timezone);

    await db.scheduler.upsertSetting({
      workspace_id: params.workspaceId,
      enabled: wsConfig.enabled,
      scan_time: wsConfig.scanTime,
      timezone: wsConfig.timezone,
      owner_notification_email: wsConfig.ownerNotificationEmail || undefined,
      last_run_date: wsConfig.lastRunDate,
      last_run_at: wsConfig.lastRunAt,
      next_run_at: wsConfig.nextRunAt,
      updated_at: nowIso
    }).catch(() => {});

    await db.scheduler.addBrief({
      id: brief.id,
      workspace_id: brief.workspaceId,
      date: brief.date,
      status: brief.status,
      customers_analyzed: brief.customersAnalyzed,
      customers_at_risk: brief.customersAtRisk,
      revenue_at_risk: brief.revenueAtRisk,
      top5_count: brief.top5Count,
      messages_prepared: brief.messagesPrepared,
      messages_awaiting_approval: brief.messagesAwaitingApproval,
      messages_sent: brief.messagesSent,
      messages_failed: brief.messagesFailed,
      owner_notification_email: brief.ownerNotificationEmail,
      owner_notification_status: brief.ownerNotificationStatus,
      owner_notification_message: brief.ownerNotificationMessage,
      created_at: brief.createdAt
    }).catch(() => {});

    briefHistory.unshift(brief);
    if (briefHistory.length > 100) {
      briefHistory.pop();
    }

    return {
      success: true,
      brief,
      message: `Daily retention scan completed. Analyzed ${customers.length} accounts, flagged ${atRiskList.length} at risk ($${revenueAtRisk.toLocaleString()} MRR). ${notifyRes.message}`
    };
  } finally {
    activeWorkspaceScans.delete(params.workspaceId);
  }
}

/**
 * Returns the current scheduler configuration and status for a specific workspace.
 */
export function getSchedulerStatus(workspaceId: string = 'ws-default'): {
  workspaceId: string;
  active: boolean;
  scheduledTime: string;
  timezone: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  cronEndpoint: string;
  statusMessage: string;
} {
  const cfg = getWorkspaceConfig(workspaceId);
  return {
    workspaceId,
    active: cfg.enabled,
    scheduledTime: cfg.scanTime,
    timezone: cfg.timezone,
    lastRunAt: cfg.lastRunAt || null,
    nextRunAt: cfg.nextRunAt || calculateNextRunTime(cfg.scanTime, cfg.timezone),
    cronEndpoint: '/api/cron/daily-scan',
    statusMessage: `In-process scheduler active (${cfg.timezone}). Cron trigger: /api/cron/daily-scan`
  };
}

/**
 * Updates per-workspace scheduler settings (scan time, timezone, owner email) and persists to DB.
 */
export async function updateSchedulerSettings(
  workspaceId: string,
  settings: Partial<Omit<DailySchedulerConfig, 'workspaceId'>>
): Promise<DailySchedulerConfig> {
  const existing = getWorkspaceConfig(workspaceId);
  const scanTime = settings.scanTime !== undefined ? normalizeScanTime(settings.scanTime) : existing.scanTime;
  const timezone = settings.timezone !== undefined ? normalizeTimezone(settings.timezone) : existing.timezone;

  const updated: DailySchedulerConfig = {
    ...existing,
    ...settings,
    workspaceId,
    scanTime,
    timezone,
    nextRunAt: calculateNextRunTime(scanTime, timezone)
  };
  schedulerConfigs.set(workspaceId, updated);

  await db.scheduler.upsertSetting({
    workspace_id: workspaceId,
    enabled: updated.enabled,
    scan_time: updated.scanTime,
    timezone: updated.timezone,
    owner_notification_email: updated.ownerNotificationEmail || undefined,
    last_run_date: updated.lastRunDate,
    last_run_at: updated.lastRunAt,
    next_run_at: updated.nextRunAt,
    updated_at: new Date().toISOString()
  }).catch(() => {});

  return updated;
}

/**
 * Gets historical briefs scoped by workspace.
 */
export function getBriefHistory(workspaceId?: string): OwnerRetentionBrief[] {
  if (!workspaceId) return briefHistory;
  return briefHistory.filter(b => b.workspaceId === workspaceId);
}

/**
 * Starts the multi-tenant timezone-aware in-process scheduler runner.
 */
export function startSchedulerRunner(getCustomerDataCallback: (workspaceId: string) => Promise<any[]>): void {
  if (schedulerTimer) return;

  if (!schedulerConfigs.has('ws-default')) {
    schedulerConfigs.set('ws-default', createDefaultConfig('ws-default'));
  }

  schedulerTimer = setInterval(async () => {
    const now = new Date();
    for (const [workspaceId, cfg] of schedulerConfigs.entries()) {
      if (!cfg.enabled || activeWorkspaceScans.has(workspaceId)) continue;

      const zoned = getZonedDateTimeParts(now, cfg.timezone);
      if (zoned.timeStr === cfg.scanTime && cfg.lastRunDate !== zoned.dateStr) {
        try {
          const customers = await getCustomerDataCallback(workspaceId);
          await executeDailyRetentionScan({
            workspaceId,
            customers,
            ownerEmail: cfg.ownerNotificationEmail,
            triggerType: 'scheduled'
          });
        } catch (err) {
          console.error(`[Churnveda Scheduler Error] Automated daily scan failed for ${workspaceId}:`, err);
        }
      }
    }
  }, 60000);

  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }
}
