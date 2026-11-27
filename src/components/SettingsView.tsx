import React, { useState, useEffect } from 'react';
import { AiEmployeeSettings, UserProfile } from '../types';
import {
  Settings,
  Sliders,
  Bell,
  ShieldCheck,
  Check,
  Lock,
  Mail,
  Sparkles,
  Globe,
  MessageSquare,
  Smartphone,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
  Download,
  User,
  Building2,
  CreditCard,
  Laptop,
  ArrowRight
} from 'lucide-react';
import { aiEmployeeService } from '../services/aiEmployeeService';
import { apiService, OutboundStatusResponse, TestOutboundConfigResponse } from '../services/api';
import { auth as firebaseAuth, db as firestoreDb } from '../lib/firebaseClient';
import { deleteDoc, doc } from 'firebase/firestore';

type SettingsTab = 'profile' | 'employee' | 'notifications' | 'integrations' | 'security';

interface SettingsViewProps {
  currentUser: UserProfile | null;
  onNavigate: (view: string) => void;
  onShowToast: (text: string, type?: 'success' | 'info' | 'error') => void;
  onLoggedOut?: () => void;
  initialTab?: SettingsTab;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUser,
  onNavigate,
  onShowToast,
  onLoggedOut,
  initialTab = 'profile'
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [settings, setSettings] = useState<AiEmployeeSettings>(() => aiEmployeeService.getSettings());

  const [ownerEmail, setOwnerEmail] = useState<string>(
    settings.ownerNotificationEmail || currentUser?.email || ''
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Outbound Integrations State
  const [outboundStatus, setOutboundStatus] = useState<OutboundStatusResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(false);
  const [testingChannel, setTestingChannel] = useState<'whatsapp' | 'email' | null>(null);
  const [testResult, setTestResult] = useState<TestOutboundConfigResponse | null>(null);

  // Self-Serve Account Deletion State
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>('');
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);
  const [isExportingAccount, setIsExportingAccount] = useState<boolean>(false);

  const handleExportMyData = async () => {
    setIsExportingAccount(true);
    try {
      const blob = await apiService.exportAccountData();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `churnveda_account_export_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      onShowToast('Your full account & workspace data export has been downloaded.', 'success');
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to export account data.', 'error');
    } finally {
      setIsExportingAccount(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      onShowToast('Please type DELETE to confirm permanent account erasure.', 'error');
      return;
    }
    setIsDeletingAccount(true);
    try {
      const fbUser = firebaseAuth.currentUser;
      if (fbUser) {
        await deleteDoc(doc(firestoreDb, 'users', fbUser.uid)).catch(() => {});
      }
      const res = await apiService.requestAccountDeletion();
      if (fbUser) {
        await fbUser.delete().catch(() => {});
      }
      const cleanedSummary = res.servicesCleaned?.length
        ? ` Cleaned: ${res.servicesCleaned.join(', ')}.`
        : '';
      onShowToast(`${res.message || 'Account deleted.'}${cleanedSummary}`, 'success');
      setShowDeleteModal(false);
      setDeleteConfirmText('');
      if (onLoggedOut) {
        setTimeout(() => onLoggedOut(), 1500);
      }
    } catch (err: any) {
      onShowToast(err.message || 'Failed to submit account deletion request.', 'error');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const loadOutboundStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const data = await apiService.fetchOutboundStatus();
      setOutboundStatus(data);
    } catch {
      // ignore background status fetch failure
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadOutboundStatus();
  }, []);

  const handleTestChannel = async (channel: 'whatsapp' | 'email') => {
    setTestingChannel(channel);
    setTestResult(null);
    try {
      const res = await apiService.testOutboundConfig(channel);
      setTestResult(res);
      if (res.verified) {
        onShowToast(`Connection verified: ${res.message}`, 'success');
      } else if (res.status === 'not_configured') {
        onShowToast(`${channel === 'whatsapp' ? 'WhatsApp' : 'Email'} delivery is not enabled yet.`, 'info');
      } else {
        onShowToast(res.message, 'error');
      }
      loadOutboundStatus();
    } catch (err: any) {
      onShowToast(`Verification failed: ${err.message}`, 'error');
    } finally {
      setTestingChannel(null);
    }
  };

  const handleUpdate = async <K extends keyof AiEmployeeSettings>(key: K, value: AiEmployeeSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setIsSaving(true);
    try {
      await aiEmployeeService.updateSettings({ [key]: value });
      onShowToast('Settings updated.', 'success');
    } catch {
      onShowToast('Failed to update settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEmail = async () => {
    setIsSaving(true);
    try {
      await aiEmployeeService.updateSettings({ ownerNotificationEmail: ownerEmail });
      onShowToast('Owner notification email saved.', 'success');
    } catch {
      onShowToast('Failed to save email', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const subscriptionLabel =
    currentUser?.billingStatus === 'active'
      ? `Active (${currentUser?.plan || 'Growth'} Plan)`
      : currentUser?.billingStatus === 'trial_expired'
      ? 'Trial Ended'
      : '14-Day Free Trial';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-900" />
            <span>Settings</span>
          </h1>
          <p className="text-xs text-gray-600 mt-0.5">
            Manage your profile, workspace preferences, notifications, connected channels, billing, and account security.
          </p>
        </div>

        {isSaving && (
          <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            <span>Changes saved</span>
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2 text-xs font-bold">
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'profile' ? 'bg-blue-900 text-white shadow-xs' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Profile &amp; Workspace</span>
        </button>

        <button
          onClick={() => setActiveTab('employee')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'employee' ? 'bg-blue-900 text-white shadow-xs' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>AI Employee</span>
        </button>

        <button
          onClick={() => setActiveTab('notifications')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'notifications' ? 'bg-blue-900 text-white shadow-xs' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Notifications</span>
        </button>

        <button
          onClick={() => setActiveTab('integrations')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'integrations' ? 'bg-blue-900 text-white shadow-xs' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Connected Channels</span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'security' ? 'bg-blue-900 text-white shadow-xs' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Account Security</span>
        </button>
      </div>

      {/* TAB 0: PROFILE, WORKSPACE & SUBSCRIPTION */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-900" />
                <span>Profile Settings</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Your account details used across alerts and retention drafts.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                <span className="text-gray-500 font-medium">Full Name</span>
                <span className="font-bold text-gray-900">{currentUser?.name || 'Workspace Member'}</span>
              </div>
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                <span className="text-gray-500 font-medium">Email Address</span>
                <span className="font-bold text-gray-900">{currentUser?.email || '—'}</span>
              </div>
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                <span className="text-gray-500 font-medium">Role</span>
                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-900 border border-blue-200 font-bold text-[11px]">
                  {currentUser?.role || 'Workspace Owner'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-900" />
                <span>Workspace &amp; Subscription</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Company organization, timezone, and active billing plan.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                <span className="text-gray-500 font-medium">Workspace / Company</span>
                <span className="font-bold text-gray-900">{currentUser?.company || 'My SaaS Workspace'}</span>
              </div>
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                <span className="text-gray-500 font-medium">Timezone</span>
                <span className="font-bold text-gray-900">{settings.timezone || 'UTC'}</span>
              </div>
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                <span className="text-gray-500 font-medium">Subscription &amp; Billing</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[11px]">
                  {subscriptionLabel}
                </span>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('billing')}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Manage Subscription &amp; Billing</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('security')}
                className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Account Security
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: AI EMPLOYEE SETTINGS */}
      {activeTab === 'employee' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-5">
          <div className="border-b border-gray-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-900" />
                <span>Daily Morning Automation</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Configure your daily retention scan schedule and owner brief preferences.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* 1. Daily Scan ON/OFF */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
              <label className="font-bold text-gray-900 block">Daily Scan</label>
              <p className="text-gray-500 text-[11px]">
                Toggle automated morning scans on or off. Manual scans are always available from Home or AI Employee.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleUpdate('dailyScanEnabled', true)}
                  className={`px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer ${
                    settings.dailyScanEnabled ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 border border-gray-200'
                  }`}
                >
                  ON
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdate('dailyScanEnabled', false)}
                  className={`px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer ${
                    !settings.dailyScanEnabled ? 'bg-red-600 text-white' : 'bg-white text-gray-700 border border-gray-200'
                  }`}
                >
                  OFF
                </button>
              </div>
            </div>

            {/* 2. Scan Time */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
              <label className="font-bold text-gray-900 block">Scan Time</label>
              <p className="text-gray-500 text-[11px]">
                Preferred time for daily account risk scoring (Default: 09:00 AM).
              </p>
              <input
                type="time"
                value={settings.scanTime || '09:00'}
                onChange={(e) => handleUpdate('scanTime', e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-mono font-bold"
              />
            </div>

            {/* 3. Timezone */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
              <label className="font-bold text-gray-900 block">Timezone</label>
              <p className="text-gray-500 text-[11px]">
                Organization timezone for morning schedules and reports.
              </p>
              <select
                value={settings.timezone}
                onChange={(e) => handleUpdate('timezone', e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-medium"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="America/Chicago">America/Chicago (CST)</option>
                <option value="America/Denver">America/Denver (MST)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="Europe/Paris">Europe/Paris (CET)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>

            {/* 4. Owner Notification ON/OFF */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
              <label className="font-bold text-gray-900 block">Owner Notification</label>
              <p className="text-gray-500 text-[11px]">
                Send morning retention summary email after scan completes.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleUpdate('ownerNotificationEmail', ownerEmail || currentUser?.email || '')}
                  className={`px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer ${
                    Boolean(settings.ownerNotificationEmail) ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 border border-gray-200'
                  }`}
                >
                  ON
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdate('ownerNotificationEmail', '')}
                  className={`px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer ${
                    !settings.ownerNotificationEmail ? 'bg-red-600 text-white' : 'bg-white text-gray-700 border border-gray-200'
                  }`}
                >
                  OFF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MORNING NOTIFICATIONS */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-5">
          <div className="border-b border-gray-100 pb-3">
            <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-900" />
              <span>Notification Preferences</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Receive your daily retention brief right after your AI Employee finishes scanning.
            </p>
          </div>

          <div className="space-y-4 max-w-lg text-xs">
            <div className="space-y-1.5">
              <label className="font-bold text-gray-900 block">Owner Email Address:</label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="founder@company.com"
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs"
              />
              <p className="text-[11px] text-gray-500">
                Morning digest email will be delivered to this address summarizing high-risk accounts.
              </p>
            </div>

            <button
              onClick={handleSaveEmail}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              Save Notification Preferences
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: CONNECTED CHANNELS (WhatsApp & Email) */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div>
                <h3 className="font-bold text-base text-gray-900 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-blue-900" />
                  <span>Outbound Messaging Channels</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  View delivery availability and verify connections for approved retention outreach.
                </p>
              </div>

              <button
                type="button"
                onClick={loadOutboundStatus}
                disabled={isLoadingStatus}
                className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
                <span>Refresh Status</span>
              </button>
            </div>

            {/* Test result announcement banner */}
            {testResult && (
              <div
                className={`p-4 rounded-xl border text-xs flex items-start gap-3 animate-in fade-in duration-200 ${
                  testResult.verified
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                    : testResult.status === 'not_configured'
                    ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                    : 'bg-red-50/80 border-red-200 text-red-950'
                }`}
              >
                {testResult.verified ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : testResult.status === 'not_configured' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between">
                    <strong className="font-bold">
                      {testResult.verified
                        ? 'Channel Verified'
                        : testResult.status === 'not_configured'
                        ? 'Not Enabled'
                        : 'Verification Issue'}
                    </strong>
                    <span className="text-[10px] font-medium uppercase bg-white/70 px-2 py-0.5 rounded border border-current">
                      No Customer Messages Sent
                    </span>
                  </div>
                  <p className="leading-relaxed">{testResult.message}</p>
                  {testResult.safeDetails && <p className="text-[11px] opacity-80">{testResult.safeDetails}</p>}
                </div>
              </div>
            )}

            {/* Channel Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
              {/* WhatsApp Card */}
              <div className="bg-gray-50/60 rounded-xl border border-gray-200 p-5 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-800 flex items-center justify-center">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-gray-900">WhatsApp Business</h4>
                        <span className="text-[11px] text-gray-500">Direct customer messaging</span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                        outboundStatus?.whatsapp.status === 'connected'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : outboundStatus?.whatsapp.status === 'error'
                          ? 'bg-red-100 text-red-800 border border-red-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          outboundStatus?.whatsapp.status === 'connected'
                            ? 'bg-emerald-600'
                            : outboundStatus?.whatsapp.status === 'error'
                            ? 'bg-red-600'
                            : 'bg-amber-500'
                        }`}
                      />
                      <span>
                        {outboundStatus?.whatsapp.status === 'connected'
                          ? 'Connected'
                          : outboundStatus?.whatsapp.status === 'error'
                          ? 'Attention Needed'
                          : 'Not Enabled'}
                      </span>
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 leading-relaxed">
                    Delivers approved, personalized check-in messages directly to churn-risk customer phone numbers.
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-200/80 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestChannel('whatsapp')}
                    disabled={testingChannel === 'whatsapp'}
                    className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingChannel === 'whatsapp' ? 'animate-spin' : ''}`} />
                    <span>{testingChannel === 'whatsapp' ? 'Checking...' : 'Verify Connection'}</span>
                  </button>
                  <span className="text-[10px] text-gray-500 italic">No customer message sent</span>
                </div>
              </div>

              {/* Email Card */}
              <div className="bg-gray-50/60 rounded-xl border border-gray-200 p-5 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-100 border border-blue-200 text-blue-900 flex items-center justify-center">
                        <Mail className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-gray-900">Email Outreach</h4>
                        <span className="text-[11px] text-gray-500">
                          {outboundStatus?.email.configured && outboundStatus.email.fromEmail
                            ? `Sending as ${outboundStatus.email.fromEmail}`
                            : 'Founder retention emails'}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                        outboundStatus?.email.status === 'connected'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : outboundStatus?.email.status === 'error'
                          ? 'bg-red-100 text-red-800 border border-red-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          outboundStatus?.email.status === 'connected'
                            ? 'bg-emerald-600'
                            : outboundStatus?.email.status === 'error'
                            ? 'bg-red-600'
                            : 'bg-amber-500'
                        }`}
                      />
                      <span>
                        {outboundStatus?.email.status === 'connected'
                          ? 'Connected'
                          : outboundStatus?.email.status === 'error'
                          ? 'Attention Needed'
                          : 'Not Enabled'}
                      </span>
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 leading-relaxed">
                    Sends founder-style check-in emails with personalized talking points and retention offers after your approval.
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-200/80 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestChannel('email')}
                    disabled={testingChannel === 'email'}
                    className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingChannel === 'email' ? 'animate-spin' : ''}`} />
                    <span>{testingChannel === 'email' ? 'Checking...' : 'Verify Connection'}</span>
                  </button>
                  <span className="text-[10px] text-gray-500 italic">No customer message sent</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ACCOUNT SECURITY */}
      {activeTab === 'security' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-5">
          <div className="border-b border-gray-100 pb-3">
            <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-900" />
              <span>Account Security &amp; Privacy</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Two-factor authentication, active sessions, data portability, and account erasure.
            </p>
          </div>

          <div className="space-y-3 text-xs max-w-xl">
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between gap-3">
              <div>
                <strong className="text-gray-900 font-bold block">Two-Factor Authentication (2FA)</strong>
                <span className="text-gray-500 text-[11px]">Workspace TOTP enrollment is pending server schema rollout</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 font-bold text-[11px] rounded-full bg-amber-100 text-amber-800">
                  Unavailable
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('security')}
                  className="px-2.5 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-[11px] font-semibold text-blue-900 cursor-pointer"
                >
                  Security Center
                </button>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Laptop className="w-4 h-4 text-gray-600 shrink-0" />
                <div>
                  <strong className="text-gray-900 font-bold block">Signed In As</strong>
                  <span className="text-gray-500 text-[11px]">{currentUser?.email || 'Authenticated User'}</span>
                </div>
              </div>
              {onLoggedOut && (
                <button
                  onClick={onLoggedOut}
                  className="px-3 py-1.5 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-semibold text-red-700 cursor-pointer"
                >
                  Sign Out
                </button>
              )}
            </div>

            {/* Self-Serve Account Data Export */}
            <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-200 space-y-3">
              <div className="flex items-start gap-2.5">
                <Download className="w-4 h-4 text-blue-900 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <strong className="text-blue-950 font-bold block">Download My Data (GDPR / DPDP Portability)</strong>
                  <p className="text-gray-600 text-[11px] leading-relaxed">
                    Export a machine-readable JSON archive of your account profile, workspace, customer records, and retention drafts.
                  </p>
                </div>
              </div>
              <div className="pt-1 flex items-center justify-between">
                <span className="text-[11px] text-gray-500">Format: JSON</span>
                <button
                  type="button"
                  disabled={isExportingAccount}
                  onClick={handleExportMyData}
                  className="px-3 py-1.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  {isExportingAccount ? 'Preparing Export...' : 'Download My Data'}
                </button>
              </div>
            </div>

            {/* Self-Serve Account & Data Deletion */}
            <div className="p-4 bg-red-50/50 rounded-xl border border-red-200 space-y-3">
              <div className="flex items-start gap-2.5">
                <Trash2 className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <strong className="text-red-950 font-bold block">Delete Account &amp; Data Erasure</strong>
                  <p className="text-gray-600 text-[11px] leading-relaxed">
                    Under GDPR Article 17, India DPDP Act, and CCPA, permanent erasure removes live workspace records, cancels active billing subscriptions, and emails confirmation.
                  </p>
                </div>
              </div>
              <div className="pt-1 flex items-center justify-between">
                <span className="text-[11px] text-gray-500">SLA: 30-day complete backup purge</span>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(true)}
                  className="px-3 py-1.5 bg-white hover:bg-red-50 border border-red-300 text-red-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Delete My Account...
                </button>
              </div>
            </div>
          </div>

          {/* Delete Account Confirmation Modal */}
          {showDeleteModal && (
            <div className="fixed inset-0 z-50 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 space-y-4 animate-in fade-in">
                <div className="flex items-center gap-3 text-red-700">
                  <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-700" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-gray-900">Confirm Account Deletion</h4>
                    <span className="text-xs text-red-700 font-semibold">Irreversible Action</span>
                  </div>
                </div>

                <p className="text-xs text-gray-600 leading-relaxed">
                  This will immediately remove your workspace access, deactivate AI monitoring, and delete all customer telemetry. To proceed, please type <span className="font-mono font-bold text-gray-900">DELETE</span> below.
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 block">Type DELETE to confirm:</label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-mono uppercase"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteModal(false);
                      setDeleteConfirmText('');
                    }}
                    className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deleteConfirmText.trim().toUpperCase() !== 'DELETE' || isDeletingAccount}
                    onClick={handleDeleteAccount}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    {isDeletingAccount ? 'Erasing Data...' : 'Confirm Delete & Purge Data'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
