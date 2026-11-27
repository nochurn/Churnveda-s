import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  Users,
  CreditCard,
  HardDrive,
  FileText,
  Server,
  Download,
  Trash2,
  UserPlus,
  Search,
  Lock,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import {
  AdminOverviewResponse,
  AdminStorageFile,
  PlatformAdminOverviewResponse,
  fetchAdminOverview,
  addAdminWorkspaceMember,
  updateAdminMemberRole,
  removeAdminWorkspaceMember,
  fetchWorkspaceStorageFiles,
  uploadWorkspaceStorageFile,
  getWorkspaceStorageSignedUrl,
  deleteAdminStorageFile,
  fetchAdminAuditLogs,
  fetchPlatformAdminOverview,
  updatePlatformWorkspaceSubscription,
  updatePlatformUserRole
} from '../services/api';
import { UserProfile } from '../types';

type AdminTabId = 'overview' | 'team' | 'billing' | 'storage' | 'audit' | 'platform';

interface AdminPanelViewProps {
  currentUser: UserProfile | null;
  onNavigate: (view: string, params?: Record<string, string>) => void;
  onShowToast: (text: string, type?: 'success' | 'error' | 'info') => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatUsd(amount?: number | null): string {
  const n = Number(amount || 0);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const AdminPanelView: React.FC<AdminPanelViewProps> = ({
  currentUser,
  onNavigate,
  onShowToast
}) => {
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);

  // Team management state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [pendingMemberRemoval, setPendingMemberRemoval] = useState<{
    userId: string;
    email: string;
  } | null>(null);

  // Storage management state
  const [storageFiles, setStorageFiles] = useState<AdminStorageFile[]>([]);
  const [storageBackend, setStorageBackend] = useState<'firebase' | 'local-fallback'>('local-fallback');
  const [bucketFilter, setBucketFilter] = useState<string>('all');
  const [uploadBucket, setUploadBucket] = useState<AdminStorageFile['bucketId']>('user-uploads');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [signedLinkReady, setSignedLinkReady] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const [pendingFileDelete, setPendingFileDelete] = useState<AdminStorageFile | null>(null);

  // Platform Super-Admin state
  const [platformData, setPlatformData] = useState<PlatformAdminOverviewResponse | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformSearch, setPlatformSearch] = useState('');
  const [savingWorkspaceSubId, setSavingWorkspaceSubId] = useState<string | null>(null);
  const [savingUserRoleId, setSavingUserRoleId] = useState<string | null>(null);
  const [subEdits, setSubEdits] = useState<
    Record<string, { tier: 'starter' | 'growth' | 'pro'; billingCycle: 'monthly' | 'annual'; status: string }>
  >({});

  const loadWorkspaceOverview = useCallback(async (isSilent = false) => {
    const isOwner = Boolean(
      currentUser &&
      (currentUser.id === 'usr-admin-001' || String(currentUser.email || '').trim().toLowerCase() === 'nageshsharat@gmail.com')
    );
    if (!currentUser || !isOwner) {
      setLoading(false);
      setAccessDeniedMessage('Access denied: Application owner privileges required.');
      return;
    }

    if (isSilent) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    setAccessDeniedMessage(null);

    try {
      const data = await fetchAdminOverview();
      setOverview(data);
      setStorageFiles(data.storage.files || []);
      setStorageBackend(data.storage.backend);
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        setAccessDeniedMessage(err.message || 'Administrator privileges are required to view this console.');
      } else {
        setLoadError(err?.message || 'Unable to load workspace administration data.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser]);

  const loadAuditTrail = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetchAdminAuditLogs(150);
      setAuditLogs(Array.isArray(res.logs) ? res.logs : []);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to load audit logs', 'error');
    } finally {
      setAuditLoading(false);
    }
  }, [onShowToast]);

  const loadPlatformOverview = useCallback(async () => {
    if (!overview?.isPlatformAdmin) return;
    setPlatformLoading(true);
    try {
      const data = await fetchPlatformAdminOverview();
      setPlatformData(data);
      const initialEdits: Record<
        string,
        { tier: 'starter' | 'growth' | 'pro'; billingCycle: 'monthly' | 'annual'; status: string }
      > = {};
      for (const ws of data.workspaces) {
        const sub = data.subscriptions.find((s: any) => s.workspace_id === ws.id);
        const rawTier = String(sub?.tier || 'growth').toLowerCase();
        const tier: 'starter' | 'growth' | 'pro' =
          rawTier === 'starter' || rawTier === 'pro' ? rawTier : 'growth';
        const billingCycle: 'monthly' | 'annual' =
          sub?.billing_cycle === 'annual' ? 'annual' : 'monthly';
        initialEdits[ws.id] = {
          tier,
          billingCycle,
          status: sub?.status || 'trialing'
        };
      }
      setSubEdits(initialEdits);
    } catch (err: any) {
      onShowToast(err?.message || 'Unable to load platform directory', 'error');
    } finally {
      setPlatformLoading(false);
    }
  }, [overview?.isPlatformAdmin, onShowToast]);

  useEffect(() => {
    void loadWorkspaceOverview(false);
  }, [loadWorkspaceOverview]);

  useEffect(() => {
    if (activeTab === 'audit' && !accessDeniedMessage && overview) {
      void loadAuditTrail();
    }
    if (activeTab === 'platform' && overview?.isPlatformAdmin && !platformData) {
      void loadPlatformOverview();
    }
  }, [activeTab, accessDeniedMessage, overview, platformData, loadAuditTrail, loadPlatformOverview]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail) {
      onShowToast('Enter a valid email address.', 'error');
      return;
    }
    setMemberSubmitting(true);
    try {
      const res = await addAdminWorkspaceMember(cleanEmail, inviteRole);
      onShowToast(`Added ${res.member.email} as ${res.member.workspaceRole}.`, 'success');
      setInviteEmail('');
      await loadWorkspaceOverview(true);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to add workspace member', 'error');
    } finally {
      setMemberSubmitting(false);
    }
  };

  const handleChangeMemberRole = async (userId: string, role: 'admin' | 'member') => {
    try {
      await updateAdminMemberRole(userId, role);
      onShowToast(`Updated workspace role to ${role}.`, 'success');
      await loadWorkspaceOverview(true);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to update role', 'error');
    }
  };

  const handleConfirmRemoveMember = async () => {
    if (!pendingMemberRemoval) return;
    try {
      await removeAdminWorkspaceMember(pendingMemberRemoval.userId);
      onShowToast(`Removed ${pendingMemberRemoval.email} from workspace.`, 'success');
      setPendingMemberRemoval(null);
      await loadWorkspaceOverview(true);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to remove member', 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingFile(true);
    setSignedLinkReady(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const contentBase64 = btoa(binary);

      await uploadWorkspaceStorageFile({
        bucket: uploadBucket,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64
      });
      onShowToast(`Uploaded ${file.name} to ${uploadBucket}.`, 'success');
      const freshListing = await fetchWorkspaceStorageFiles();
      setStorageFiles(freshListing.files || []);
      setStorageBackend(freshListing.storageBackend);
    } catch (err: any) {
      onShowToast(err?.message || 'File upload failed', 'error');
    } finally {
      setUploadingFile(false);
    }
  };

  const handlePrepareDownload = async (file: AdminStorageFile) => {
    try {
      const res = await getWorkspaceStorageSignedUrl(file.bucketId, file.path);
      setSignedLinkReady({ name: file.name, url: res.signedUrl });
      onShowToast(`Download link ready for ${file.name}.`, 'success');
    } catch (err: any) {
      onShowToast(err?.message || 'Could not generate download link', 'error');
    }
  };

  const handleConfirmDeleteFile = async () => {
    if (!pendingFileDelete) return;
    try {
      await deleteAdminStorageFile(pendingFileDelete.bucketId, pendingFileDelete.path);
      onShowToast(`Deleted ${pendingFileDelete.name}.`, 'success');
      setPendingFileDelete(null);
      const freshListing = await fetchWorkspaceStorageFiles();
      setStorageFiles(freshListing.files || []);
      setStorageBackend(freshListing.storageBackend);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to delete file', 'error');
    }
  };

  const handleExportAuditCsv = () => {
    if (filteredAuditLogs.length === 0) return;
    const headers = ['Timestamp', 'Actor Email', 'Action', 'Target Type', 'Target ID', 'Metadata'];
    const escapeCell = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...filteredAuditLogs.map((log) =>
        [
          log.created_at,
          log.actor_email,
          log.action,
          log.target_type,
          log.target_id || '',
          log.metadata ? (typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata)) : ''
        ]
          .map(escapeCell)
          .join(',')
      )
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `churnveda_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSavePlatformSubscription = async (workspaceId: string) => {
    const draft = subEdits[workspaceId];
    if (!draft) return;
    setSavingWorkspaceSubId(workspaceId);
    try {
      await updatePlatformWorkspaceSubscription(workspaceId, {
        tier: draft.tier,
        billingCycle: draft.billingCycle,
        status: draft.status as any
      });
      onShowToast(`Updated subscription for ${workspaceId}.`, 'success');
      await loadPlatformOverview();
      if (workspaceId === overview?.workspace.id) {
        await loadWorkspaceOverview(true);
      }
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to update subscription', 'error');
    } finally {
      setSavingWorkspaceSubId(null);
    }
  };

  const handleChangePlatformUserRole = async (userId: string, role: 'Admin' | 'Analyst' | 'Viewer') => {
    setSavingUserRoleId(userId);
    try {
      await updatePlatformUserRole(userId, role);
      onShowToast(`Updated user system role to ${role}.`, 'success');
      await loadPlatformOverview();
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to update user role', 'error');
    } finally {
      setSavingUserRoleId(null);
    }
  };

  const filteredMembers = useMemo(() => {
    const list = overview?.members || [];
    const q = memberSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        m.fullName.toLowerCase().includes(q) ||
        m.workspaceRole.toLowerCase().includes(q)
    );
  }, [overview?.members, memberSearch]);

  const filteredStorageFiles = useMemo(() => {
    if (bucketFilter === 'all') return storageFiles;
    return storageFiles.filter((f) => f.bucketId === bucketFilter);
  }, [storageFiles, bucketFilter]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        String(l.actor_email || '').toLowerCase().includes(q) ||
        String(l.action || '').toLowerCase().includes(q) ||
        String(l.target_type || '').toLowerCase().includes(q) ||
        String(l.target_id || '').toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  const filteredPlatformWorkspaces = useMemo(() => {
    if (!platformData) return [];
    const q = platformSearch.trim().toLowerCase();
    if (!q) return platformData.workspaces;
    return platformData.workspaces.filter(
      (w) => w.id.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || w.owner_id.toLowerCase().includes(q)
    );
  }, [platformData, platformSearch]);

  const filteredPlatformUsers = useMemo(() => {
    if (!platformData) return [];
    const q = platformSearch.trim().toLowerCase();
    if (!q) return platformData.users;
    return platformData.users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.workspaceId.toLowerCase().includes(q)
    );
  }, [platformData, platformSearch]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-gray-600">Loading administration console...</p>
      </div>
    );
  }

  if (accessDeniedMessage) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-xl mx-auto mt-6 text-center space-y-4">
        <div className="w-11 h-11 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center mx-auto">
          <Lock className="w-5 h-5" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-gray-900">Administrator Access Required</h2>
          <p className="text-xs text-gray-600 leading-relaxed">{accessDeniedMessage}</p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-2">
          {!currentUser ? (
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
            >
              Sign In
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-xs font-semibold cursor-pointer"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (loadError || !overview) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2 text-red-700 text-sm font-semibold">
          <AlertTriangle className="w-4 h-4" />
          <span>Unable to load Admin Panel</span>
        </div>
        <p className="text-xs text-gray-600">{loadError || 'Unexpected server error.'}</p>
        <button
          type="button"
          onClick={() => loadWorkspaceOverview(false)}
          className="px-3.5 py-2 bg-blue-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const tabs: Array<{ id: AdminTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview & Health', icon: Server },
    { id: 'team', label: `Team (${overview.members.length})`, icon: Users },
    { id: 'billing', label: 'Billing & Orders', icon: CreditCard },
    { id: 'storage', label: `Storage (${storageFiles.length})`, icon: HardDrive },
    { id: 'audit', label: 'Audit Trail', icon: FileText },
    ...(overview.isPlatformAdmin
      ? [{ id: 'platform' as AdminTabId, label: 'Platform Control', icon: ShieldCheck }]
      : [])
  ];

  const healthItems = [
    {
      name: 'Primary Database',
      statusText: overview.health.database.connected ? 'Connected' : 'Disconnected',
      ok: overview.health.database.connected,
      detail: `${overview.health.database.target}`
    },
    {
      name: 'Razorpay Billing',
      statusText: overview.health.razorpay.configured
        ? `Configured (${overview.health.razorpay.mode.toUpperCase()})`
        : 'Not Configured',
      ok: overview.health.razorpay.configured,
      detail: overview.health.razorpay.internationalEnabled ? 'International USD enabled' : 'Standard currency mode'
    },
    {
      name: 'Firebase Admin SDK',
      statusText: overview.health.firebaseAdmin.configured ? 'Connected' : 'Awaiting IAM Grant',
      ok: overview.health.firebaseAdmin.configured,
      detail: overview.health.firebaseAdmin.configured
        ? 'Service account authorized for Firestore'
        : 'Grant IAM role to preview ADC service account'
    },
    {
      name: 'Cloud Object Storage',
      statusText: overview.health.cloudStorage.cloudConnected ? 'Cloud Connected' : 'Local Fallback Active',
      ok: overview.health.cloudStorage.cloudConnected,
      detail: overview.health.cloudStorage.bucket
    },
    {
      name: 'Email Outreach (Resend)',
      statusText: overview.health.email.configured ? 'Connected' : 'Not Configured',
      ok: overview.health.email.configured,
      detail: overview.health.email.fromEmail || 'Sender credentials not set'
    },
    {
      name: 'WhatsApp Business Cloud',
      statusText: overview.health.whatsapp.configured ? 'Connected' : 'Not Configured',
      ok: overview.health.whatsapp.configured,
      detail: overview.health.whatsapp.configured ? 'Webhook & Phone ID active' : 'Credentials not set'
    },
    {
      name: 'AI Analysis Engine',
      statusText: overview.health.aiEngine.configured ? 'Gemini Active' : 'Rule Engine Fallback',
      ok: overview.health.aiEngine.configured,
      detail: overview.health.aiEngine.model
    },
    {
      name: 'Daily Scan Scheduler',
      statusText: overview.scheduler.enabled ? 'Enabled' : 'Paused',
      ok: overview.scheduler.enabled,
      detail: `${overview.scheduler.scanTime} ${overview.scheduler.timezone}`
    }
  ];

  return (
    <div className="space-y-5">
      {/* Header + Unboxed Inline Metadata */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Admin Panel</h1>
          <p className="text-xs text-gray-600 mt-1 font-mono tabular-nums">
            Workspace: {overview.workspace.name} · ID: {overview.workspace.id} · Engine: {overview.health.database.target}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadWorkspaceOverview(true);
            if (activeTab === 'audit') void loadAuditTrail();
            if (activeTab === 'platform' && overview.isPlatformAdmin) void loadPlatformOverview();
          }}
          disabled={refreshing}
          className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 flex items-center gap-1.5 self-start sm:self-auto cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Segmented Navigation Bar */}
      <div className="flex flex-wrap items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 w-fit max-w-full overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isCurrent = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-white text-blue-900 shadow-2xs border border-gray-200/80'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. OVERVIEW & INFRASTRUCTURE HEALTH */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Flat KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-600">Customers Monitored</div>
              <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                {overview.metrics.totalCustomers.toLocaleString('en-US')}
              </div>
              <div className="text-[11px] text-gray-500 mt-1 tabular-nums">
                {overview.metrics.atRiskCount} at risk · {overview.metrics.savedCount} saved
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-600">At-Risk MRR</div>
              <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                {formatUsd(overview.metrics.atRiskMrr)}
              </div>
              <div className="text-[11px] text-gray-500 mt-1 tabular-nums">
                Total tracked {formatUsd(overview.metrics.totalMrr)}/mo
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-600">Saved Revenue</div>
              <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                {formatUsd(overview.metrics.savedMrr)}
              </div>
              <div className="text-[11px] text-gray-500 mt-1 tabular-nums">
                {overview.metrics.importCount} import batches logged
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-600">Workspace Subscription</div>
              <div className="text-2xl font-bold text-gray-900 mt-1 capitalize">
                {overview.subscription.tier}
              </div>
              <div className="text-[11px] text-gray-500 mt-1 capitalize">
                Status: {String(overview.subscription.status || 'trialing').replace(/_/g, ' ')} ·{' '}
                {overview.subscription.billing_cycle}
              </div>
            </div>
          </div>

          {/* Infrastructure Readiness Table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Backend & Integration Health</h2>
                <p className="text-xs text-gray-500">Live connection checks reported by the API server</p>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {healthItems.map((item) => (
                <div
                  key={item.name}
                  className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-semibold text-gray-900">{item.name}</div>
                    <div className="text-gray-500 font-mono text-[11px] mt-0.5">{item.detail}</div>
                  </div>
                  <div className="flex items-center gap-1.5 font-semibold whitespace-nowrap">
                    {item.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    )}
                    <span className={item.ok ? 'text-emerald-700' : 'text-amber-700'}>{item.statusText}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. TEAM & ACCESS CONTROL */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <form
            onSubmit={handleAddMember}
            className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
          >
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Add Existing User to Workspace
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                required
                className="w-full px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>

            <div className="w-full sm:w-40">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Workspace Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value === 'admin' ? 'admin' : 'member')}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-900"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={memberSubmitting}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{memberSubmitting ? 'Adding...' : 'Add Member'}</span>
            </button>
          </form>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900">Workspace Members</h2>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Filter members..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
            </div>

            {filteredMembers.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                No workspace members matched your search.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">User</th>
                      <th className="px-4 py-2.5 font-semibold">Workspace Role</th>
                      <th className="px-4 py-2.5 font-semibold">2FA</th>
                      <th className="px-4 py-2.5 font-semibold">Joined</th>
                      <th className="px-5 py-2.5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredMembers.map((member) => {
                      const isOwner = member.workspaceRole === 'owner';
                      const isSelf = member.userId === currentUser?.id;
                      return (
                        <tr key={member.userId} className="hover:bg-gray-50/70">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-gray-900">{member.fullName}</div>
                            <div className="text-gray-500 font-mono text-[11px]">{member.email}</div>
                          </td>
                          <td className="px-4 py-3">
                            {isOwner ? (
                              <span className="font-semibold text-blue-900">Owner</span>
                            ) : (
                              <select
                                value={member.workspaceRole}
                                onChange={(e) =>
                                  handleChangeMemberRole(
                                    member.userId,
                                    e.target.value === 'admin' ? 'admin' : 'member'
                                  )
                                }
                                className="px-2 py-1 text-xs bg-white border border-gray-200 rounded-md text-gray-800"
                              >
                                <option value="admin">Admin</option>
                                <option value="member">Member</option>
                              </select>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {member.twoFactorEnabled ? 'Enabled' : 'Not set'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 font-mono tabular-nums text-[11px]">
                            {formatDate(member.joinedAt)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {isOwner || isSelf ? (
                              <span className="text-[11px] text-gray-400">Protected</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingMemberRemoval({ userId: member.userId, email: member.email })
                                }
                                className="px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-md font-semibold cursor-pointer inline-flex items-center gap-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Remove</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. BILLING & ORDERS */}
      {activeTab === 'billing' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-gray-900">Workspace Subscription Record</h2>
              <p className="text-xs text-gray-600 font-mono tabular-nums">
                Plan: {overview.subscription.tier} ({overview.subscription.billing_cycle}) · Status:{' '}
                {overview.subscription.status} · Verification: {overview.subscription.payment_verification_status}
              </p>
              {overview.subscription.razorpay_subscription_id && (
                <p className="text-[11px] text-gray-500 font-mono">
                  Razorpay Subscription ID: {overview.subscription.razorpay_subscription_id}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold cursor-pointer self-start sm:self-auto"
            >
              Manage Plan & Checkout
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-bold text-gray-900">Razorpay Orders & Mandate Verifications</h2>
            </div>
            {overview.orders.length === 0 && overview.trialVerifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                No Razorpay orders recorded for this workspace yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">Order ID</th>
                      <th className="px-4 py-2.5 font-semibold">Type</th>
                      <th className="px-4 py-2.5 font-semibold">Amount</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-5 py-2.5 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {overview.orders.map((ord: any) => (
                      <tr key={ord.order_id} className="hover:bg-gray-50/70">
                        <td className="px-5 py-3 font-mono text-[11px] text-gray-900">{ord.order_id}</td>
                        <td className="px-4 py-3 text-gray-700 capitalize">
                          {ord.metadata_json?.type || ord.metadata_json?.tier || 'Checkout Order'}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-gray-900">
                          {ord.currency} {(Number(ord.amount_paise || 0) / 100).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800 capitalize">{ord.status}</td>
                        <td className="px-5 py-3 font-mono tabular-nums text-[11px] text-gray-500">
                          {formatDate(ord.created_at)}
                        </td>
                      </tr>
                    ))}
                    {overview.trialVerifications.map((tv: any) => (
                      <tr key={tv.razorpay_order_id} className="hover:bg-gray-50/70">
                        <td className="px-5 py-3 font-mono text-[11px] text-gray-900">
                          {tv.razorpay_order_id}
                        </td>
                        <td className="px-4 py-3 text-gray-700">Trial Mandate Verification ({tv.tier})</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-gray-900">
                          {tv.currency} {(Number(tv.amount_paise || 100) / 100).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800 capitalize">{tv.status}</td>
                        <td className="px-5 py-3 font-mono tabular-nums text-[11px] text-gray-500">
                          {formatDate(tv.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-bold text-gray-900">Captured Payments Ledger</h2>
            </div>
            {overview.payments.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                No captured subscription payments recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">Payment ID</th>
                      <th className="px-4 py-2.5 font-semibold">Amount (USD)</th>
                      <th className="px-4 py-2.5 font-semibold">INR Settlement</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-5 py-2.5 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {overview.payments.map((p: any) => (
                      <tr key={p.razorpay_payment_id} className="hover:bg-gray-50/70">
                        <td className="px-5 py-3 font-mono text-[11px] text-gray-900">
                          {p.razorpay_payment_id}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums font-semibold text-gray-900">
                          {formatUsd(p.amount_usd)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-gray-600">
                          {p.converted_inr_amount ? `₹${Number(p.converted_inr_amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800 capitalize">
                          {p.settlement_status}
                        </td>
                        <td className="px-5 py-3 font-mono tabular-nums text-[11px] text-gray-500">
                          {formatDate(p.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. FILES & CLOUD OBJECT STORAGE */}
      {activeTab === 'storage' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-bold text-gray-900">Workspace Object Storage</div>
              <p className="text-xs text-gray-600 font-mono">
                Active Backend: {storageBackend === 'firebase' ? 'Firebase Cloud Storage' : 'Workspace Local Storage'} · Target Bucket: {overview.storage.status.bucket}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={uploadBucket}
                onChange={(e) => setUploadBucket(e.target.value as AdminStorageFile['bucketId'])}
                className="px-2.5 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-800"
              >
                <option value="user-uploads">user-uploads</option>
                <option value="customer-imports">customer-imports</option>
                <option value="generated-reports">generated-reports</option>
                <option value="customer-exports">customer-exports</option>
              </select>

              <label className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingFile ? 'Uploading...' : 'Upload File'}</span>
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploadingFile}
                  onChange={handleFileUpload}
                />
              </label>
            </div>
          </div>

          {signedLinkReady && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-medium text-emerald-900">
                Signed download URL generated for <strong>{signedLinkReady.name}</strong>
              </span>
              <a
                href={signedLinkReady.url}
                download={signedLinkReady.name}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Download File</span>
              </a>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900">Stored Workspace Files</h2>
              <select
                value={bucketFilter}
                onChange={(e) => setBucketFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-800"
              >
                <option value="all">All Categories</option>
                <option value="customer-imports">customer-imports</option>
                <option value="customer-exports">customer-exports</option>
                <option value="generated-reports">generated-reports</option>
                <option value="user-uploads">user-uploads</option>
              </select>
            </div>

            {filteredStorageFiles.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                No files stored in this workspace yet. Upload a CSV, PDF, or JSON file above to store it.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">File Name</th>
                      <th className="px-4 py-2.5 font-semibold">Category</th>
                      <th className="px-4 py-2.5 font-semibold">Size</th>
                      <th className="px-4 py-2.5 font-semibold">Updated</th>
                      <th className="px-5 py-2.5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStorageFiles.map((file) => (
                      <tr key={`${file.bucketId}:${file.path}`} className="hover:bg-gray-50/70">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-gray-900">{file.name}</div>
                          <div className="text-[11px] font-mono text-gray-400 truncate max-w-xs">{file.path}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-gray-700">{file.bucketId}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-gray-700">
                          {formatBytes(file.sizeBytes)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-[11px] text-gray-500">
                          {formatDate(file.updatedAt)}
                        </td>
                        <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handlePrepareDownload(file)}
                            className="px-2.5 py-1 text-blue-900 hover:bg-blue-50 rounded-md font-semibold cursor-pointer inline-flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Signed URL</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingFileDelete(file)}
                            className="px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-md font-semibold cursor-pointer inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Administrative & Security Audit Log</h2>
              <p className="text-xs text-gray-500">Immutable workspace activity records</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search action or actor..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <button
                type="button"
                onClick={handleExportAuditCsv}
                disabled={filteredAuditLogs.length === 0}
                className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {auditLoading ? (
            <div className="p-8 text-center text-xs text-gray-500">Loading audit events...</div>
          ) : filteredAuditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500">No audit log records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold">Timestamp</th>
                    <th className="px-4 py-2.5 font-semibold">Actor</th>
                    <th className="px-4 py-2.5 font-semibold">Action</th>
                    <th className="px-4 py-2.5 font-semibold">Target</th>
                    <th className="px-5 py-2.5 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredAuditLogs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-gray-50/70">
                      <td className="px-5 py-2.5 font-mono tabular-nums text-[11px] text-gray-500 whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-gray-800">{log.actor_email}</td>
                      <td className="px-4 py-2.5 font-semibold text-gray-900">{log.action}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-gray-600">
                        {log.target_type}
                        {log.target_id ? ` · ${log.target_id}` : ''}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-[11px] text-gray-500 max-w-xs truncate">
                        {log.metadata
                          ? typeof log.metadata === 'string'
                            ? log.metadata
                            : JSON.stringify(log.metadata)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 6. PLATFORM CONTROL (SUPER-ADMIN ONLY) */}
      {activeTab === 'platform' && overview.isPlatformAdmin && (
        <div className="space-y-5">
          {platformLoading || !platformData ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs text-gray-500">
              Loading platform directory...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-xs font-medium text-gray-600">Total Workspaces</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                    {platformData.summary.totalWorkspaces}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-xs font-medium text-gray-600">Registered Users</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                    {platformData.summary.totalUsers}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-xs font-medium text-gray-600">Subscriptions</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                    {platformData.summary.activeSubscriptions} active
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 tabular-nums">
                    {platformData.summary.trialingSubscriptions} trialing
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-xs font-medium text-gray-600">Captured Revenue</div>
                  <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                    {formatUsd(platformData.summary.totalCapturedUsd)}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 tabular-nums">
                    {platformData.summary.totalPayments} payments · {platformData.summary.totalOrders} orders
                  </div>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="relative max-w-sm">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={platformSearch}
                  onChange={(e) => setPlatformSearch(e.target.value)}
                  placeholder="Search workspaces, users, or emails..."
                  className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>

              {/* Workspaces & Subscription Controls */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200">
                  <h2 className="text-sm font-bold text-gray-900">Workspaces & Subscription Manager</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <tr>
                        <th className="px-5 py-2.5 font-semibold">Workspace</th>
                        <th className="px-4 py-2.5 font-semibold">Plan Tier</th>
                        <th className="px-4 py-2.5 font-semibold">Cycle</th>
                        <th className="px-4 py-2.5 font-semibold">Billing Status</th>
                        <th className="px-5 py-2.5 font-semibold text-right">Update</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredPlatformWorkspaces.map((ws) => {
                        const draft = subEdits[ws.id] || {
                          tier: 'growth',
                          billingCycle: 'monthly',
                          status: 'trialing'
                        };
                        return (
                          <tr key={ws.id} className="hover:bg-gray-50/70">
                            <td className="px-5 py-3">
                              <div className="font-semibold text-gray-900">{ws.name}</div>
                              <div className="text-[11px] font-mono text-gray-500">{ws.id}</div>
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={draft.tier}
                                onChange={(e) =>
                                  setSubEdits((prev) => ({
                                    ...prev,
                                    [ws.id]: {
                                      ...draft,
                                      tier: e.target.value as 'starter' | 'growth' | 'pro'
                                    }
                                  }))
                                }
                                className="px-2 py-1 text-xs bg-white border border-gray-200 rounded-md"
                              >
                                <option value="starter">Starter</option>
                                <option value="growth">Growth</option>
                                <option value="pro">Pro</option>
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={draft.billingCycle}
                                onChange={(e) =>
                                  setSubEdits((prev) => ({
                                    ...prev,
                                    [ws.id]: {
                                      ...draft,
                                      billingCycle: e.target.value as 'monthly' | 'annual'
                                    }
                                  }))
                                }
                                className="px-2 py-1 text-xs bg-white border border-gray-200 rounded-md"
                              >
                                <option value="monthly">Monthly</option>
                                <option value="annual">Annual</option>
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={draft.status}
                                onChange={(e) =>
                                  setSubEdits((prev) => ({
                                    ...prev,
                                    [ws.id]: { ...draft, status: e.target.value }
                                  }))
                                }
                                className="px-2 py-1 text-xs bg-white border border-gray-200 rounded-md"
                              >
                                <option value="active">active</option>
                                <option value="trialing">trialing</option>
                                <option value="pending">pending</option>
                                <option value="trial_expired">trial_expired</option>
                                <option value="past_due">past_due</option>
                                <option value="halted">halted</option>
                                <option value="cancelled">cancelled</option>
                              </select>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <button
                                type="button"
                                disabled={savingWorkspaceSubId === ws.id}
                                onClick={() => handleSavePlatformSubscription(ws.id)}
                                className="px-3 py-1.5 bg-blue-900 hover:bg-blue-800 text-white rounded-md font-semibold cursor-pointer disabled:opacity-60"
                              >
                                {savingWorkspaceSubId === ws.id ? 'Saving...' : 'Save'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Platform Users Directory */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200">
                  <h2 className="text-sm font-bold text-gray-900">User Directory & Role Assignment</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <tr>
                        <th className="px-5 py-2.5 font-semibold">User</th>
                        <th className="px-4 py-2.5 font-semibold">Workspace</th>
                        <th className="px-4 py-2.5 font-semibold">Plan / Billing</th>
                        <th className="px-4 py-2.5 font-semibold">System Role</th>
                        <th className="px-5 py-2.5 font-semibold">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredPlatformUsers.map((u) => {
                        const isPrimaryAdmin =
                          u.id === 'usr-admin-001' || u.email.toLowerCase() === 'nageshsharat@gmail.com';
                        return (
                          <tr key={u.id} className="hover:bg-gray-50/70">
                            <td className="px-5 py-3">
                              <div className="font-semibold text-gray-900">{u.fullName}</div>
                              <div className="font-mono text-[11px] text-gray-500">{u.email}</div>
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] text-gray-600">{u.workspaceId}</td>
                            <td className="px-4 py-3 text-gray-700 capitalize">
                              {u.selectedPlan} · {u.billingStatus}
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={u.role}
                                disabled={isPrimaryAdmin || savingUserRoleId === u.id}
                                onChange={(e) =>
                                  handleChangePlatformUserRole(
                                    u.id,
                                    e.target.value as 'Admin' | 'Analyst' | 'Viewer'
                                  )
                                }
                                className="px-2 py-1 text-xs bg-white border border-gray-200 rounded-md disabled:bg-gray-100"
                              >
                                <option value="Admin">Admin</option>
                                <option value="Analyst">Analyst</option>
                                <option value="Viewer">Viewer</option>
                              </select>
                            </td>
                            <td className="px-5 py-3 font-mono tabular-nums text-[11px] text-gray-500">
                              {formatDate(u.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Razorpay Webhook Events */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200">
                  <h2 className="text-sm font-bold text-gray-900">Recent Billing Webhook Events</h2>
                </div>
                {platformData.webhookEvents.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-500">
                    No webhook deliveries logged yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                        <tr>
                          <th className="px-5 py-2.5 font-semibold">Event Type</th>
                          <th className="px-4 py-2.5 font-semibold">Event ID</th>
                          <th className="px-4 py-2.5 font-semibold">Workspace</th>
                          <th className="px-4 py-2.5 font-semibold">Status</th>
                          <th className="px-5 py-2.5 font-semibold">Processed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {platformData.webhookEvents.map((ev) => (
                          <tr key={ev.event_id} className="hover:bg-gray-50/70">
                            <td className="px-5 py-2.5 font-semibold text-gray-900">{ev.event_type}</td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-gray-600">{ev.event_id}</td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-gray-600">
                              {ev.workspace_id || '—'}
                            </td>
                            <td className="px-4 py-2.5 font-semibold text-emerald-700 capitalize">{ev.status}</td>
                            <td className="px-5 py-2.5 font-mono tabular-nums text-[11px] text-gray-500">
                              {formatDate(ev.processed_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* In-Page Confirmation Modal: Remove Member */}
      {pendingMemberRemoval && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-gray-200 rounded-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-900">Remove Workspace Member</h3>
            <p className="text-xs text-gray-600">
              Remove <strong>{pendingMemberRemoval.email}</strong> from this workspace? They will lose access immediately.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingMemberRemoval(null)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveMember}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Remove Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-Page Confirmation Modal: Delete Storage File */}
      {pendingFileDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-gray-200 rounded-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-900">Delete Stored File</h3>
            <p className="text-xs text-gray-600">
              Permanently delete <strong>{pendingFileDelete.name}</strong> from{' '}
              <span className="font-mono">{pendingFileDelete.bucketId}</span>?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingFileDelete(null)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteFile}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Delete File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
