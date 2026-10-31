import React, { useState, useRef, useEffect } from 'react';
import {
  Shield,
  Search,
  Bell,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  User,
  Key,
  ExternalLink,
  ShieldCheck,
  CreditCard,
  Laptop,
  LogOut,
  LogIn,
  UserPlus,
  FileText,
  Clock,
  Menu,
  X,
  LayoutDashboard,
  Users,
  MessageSquare,
  Settings,
  DollarSign,
  Download
} from 'lucide-react';
import { DailyAlert, UserProfile } from '../types';

interface NavbarProps {
  onSearchChange: (search: string) => void;
  searchValue: string;
  onNavigate: (view: string, params?: Record<string, string>) => void;
  alerts: DailyAlert[];
  onOpenCustomer: (id: string) => void;
  onOpenPricing: () => void;
  onOpenSecurity: () => void;
  geminiReady: boolean;
  currentUser: UserProfile | null;
  onLogout: () => void;
  onOpenOnboarding?: () => void;
  activeView?: string;
  totalCustomers?: number;
  readyMessagesCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  onSearchChange,
  searchValue,
  onNavigate,
  alerts,
  onOpenCustomer,
  onOpenPricing,
  onOpenSecurity,
  geminiReady,
  currentUser,
  onLogout,
  onOpenOnboarding,
  activeView = 'home',
  totalCustomers = 0,
  readyMessagesCount = 0
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const handleDownloadZip = async () => {
    setIsDownloadingZip(true);
    try {
      const res = await fetch('/churnveda-deployment.zip');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'churnveda-deployment.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch {
      window.location.href = '/churnveda-deployment.zip';
    } finally {
      setIsDownloadingZip(false);
    }
  };

  // Prevent background scrolling when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Close mobile menu on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        // check if clicked target is not the toggle button
        const btn = document.getElementById('mobile-menu-toggle-btn');
        if (!btn || !btn.contains(event.target as Node)) {
          setMobileMenuOpen(false);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const totalUnread = alerts.length > 0 ? alerts[0].customersCount : 0;

  const isTrialExpired = currentUser?.billingStatus === 'trial_expired' || Boolean(currentUser?.trialEndDate && new Date(currentUser.trialEndDate).getTime() <= Date.now() && currentUser.billingStatus !== 'active');
  const isTrialing = currentUser?.billingStatus === 'trialing' || (!currentUser?.billingStatus && currentUser !== null);
  let trialDaysRemaining = 14;
  if (currentUser?.trialEndDate) {
    const diff = new Date(currentUser.trialEndDate).getTime() - Date.now();
    trialDaysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return (
    <header className="h-16 bg-white border-b border-gray-200 sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between shadow-xs">
      {/* Brand / Logo + Mobile Menu Toggle */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mobile Menu Hamburger Button */}
        <button
          type="button"
          id="mobile-menu-toggle-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
          className="lg:hidden p-2 -ml-1 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900"
        >
          {mobileMenuOpen ? (
            <X className="w-5 h-5 text-gray-900" aria-hidden="true" />
          ) : (
            <Menu className="w-5 h-5 text-gray-900" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            onNavigate('home');
          }}
          className="flex items-center gap-2 sm:gap-2.5 group text-left cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-lg"
          title="Churnveda - AI Retention Employee"
        >
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-900 flex items-center justify-center text-white shadow-xs group-hover:bg-blue-800 transition-colors shrink-0">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-blue-100" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <span className="font-bold text-base sm:text-lg tracking-tight text-gray-900 leading-none">
                Churnveda
              </span>
              <span className="text-[9px] sm:text-[10px] uppercase font-semibold px-1 sm:px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                AI Employee
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-gray-600 hidden sm:block font-normal truncate">
              Your AI Retention Employee
            </p>
          </div>
        </button>
      </div>

      {/* Global Search Bar */}
      <div className="flex-1 max-w-md mx-4 lg:mx-8 hidden md:block">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search customers by company, email, domain..."
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 transition-all"
          />
          {searchValue && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 font-medium"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Right Actions & Status */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Quick Action Queue CTA */}
        <button
          onClick={() => onNavigate('action-queue')}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
          <span>Action Queue</span>
        </button>

        {/* 14-Day Free Trial Remaining / Trial Expired Badge */}
        {currentUser && isTrialing && !isTrialExpired && (
          <button
            onClick={() => onNavigate('billing')}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
            title="14-day free trial active"
          >
            <Clock className="w-3.5 h-3.5 text-emerald-700" />
            <span>14-day free trial • {trialDaysRemaining} days remaining</span>
          </button>
        )}
        {currentUser && isTrialExpired && (
          <button
            onClick={() => onNavigate('pricing', { expired: 'true' })}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-300 text-xs text-amber-900 font-bold hover:bg-amber-100 transition-colors cursor-pointer animate-pulse"
            title="Your 14-day free trial has ended. Click to choose a plan."
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
            <span>Trial ended • Choose plan</span>
          </button>
        )}

        {/* 10m Fast Value Onboarding CTA */}
        {onOpenOnboarding && (
          <button
            onClick={onOpenOnboarding}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-200" />
            <span>Fast-Value Setup</span>
          </button>
        )}

        {/* Gemini Engine Indicator */}
        <div
          className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-50/80 border border-blue-200/70 text-xs text-blue-900"
          title={geminiReady ? 'Gemini 3.8 Flash API connected' : 'Algorithmic + Gemini Engine'}
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-700 animate-pulse" />
          <span className="font-medium text-blue-900">Gemini 3.8 Flash</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        </div>

        {/* Quick Deployment ZIP Download Button */}
        <button
          onClick={handleDownloadZip}
          disabled={isDownloadingZip}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:text-blue-900 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg transition-all shadow-2xs focus:outline-none cursor-pointer"
          title="Download complete Churnveda deployment ZIP project (ready for Netlify, Railway, or Docker)"
        >
          <Download className={`w-3.5 h-3.5 text-blue-700 ${isDownloadingZip ? 'animate-bounce' : ''}`} />
          <span className="hidden sm:inline">{isDownloadingZip ? 'Packaging...' : 'Download ZIP'}</span>
          <span className="sm:hidden">{isDownloadingZip ? '...' : 'ZIP'}</span>
        </button>

        {/* Notifications Dropdown */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg relative transition-colors focus:outline-none"
            title="Daily alerts and updates"
          >
            <Bell className="w-5 h-5" />
            {totalUnread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                {totalUnread}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Daily Churn Digests</h4>
                  <p className="text-xs text-gray-700">Scheduled 9:00 AM local digest</p>
                </div>
                <button
                  onClick={() => {
                    setShowNotifications(false);
                    onNavigate('alerts');
                  }}
                  className="text-xs text-blue-900 hover:underline font-medium"
                >
                  View All
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                {alerts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-700">No recent alerts</div>
                ) : (
                  alerts.slice(0, 3).map((al) => (
                    <div key={al.id} className="p-3.5 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-900 leading-tight">
                            {al.title}
                          </p>
                          <p className="text-[11px] text-gray-700 mt-1">
                            ${al.mrrAtRisk.toLocaleString()} MRR flagged across {al.customersCount} accounts.
                          </p>
                          <div className="mt-2 space-y-1">
                            {al.customers.slice(0, 2).map((cust) => (
                              <button
                                key={cust.id}
                                onClick={() => {
                                  setShowNotifications(false);
                                  onOpenCustomer(cust.id);
                                }}
                                className="w-full text-left flex items-center justify-between px-2 py-1 rounded bg-gray-50 hover:bg-blue-50/60 text-[11px] text-gray-700 hover:text-blue-900 border border-gray-200/60"
                              >
                                <span className="font-medium truncate">{cust.name}</span>
                                <span className="font-semibold text-red-600 text-[10px]">Score {cust.score}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-2 border-t border-gray-100 bg-gray-50 text-center">
                <button
                  onClick={() => {
                    setShowNotifications(false);
                    onNavigate('alerts');
                  }}
                  className="text-xs font-medium text-blue-900 hover:text-blue-950 flex items-center justify-center gap-1 w-full py-1"
                >
                  Configure Slack & Digest Webhooks <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Dropdown or Guest Auth Buttons */}
        {currentUser ? (
          <div className="relative" ref={userRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none"
            >
              <div className="w-8 h-8 rounded-full bg-blue-900 text-white font-medium text-xs flex items-center justify-center ring-1 ring-gray-200">
                {currentUser.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .substring(0, 2)
                  .toUpperCase() || 'CS'}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-xs font-semibold text-gray-900 leading-none">{currentUser.name}</div>
                <div className="text-[10px] text-blue-800 font-medium">{currentUser.plan} Tier</div>
              </div>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-200 py-1.5 z-50">
                <div className="px-4 py-2 border-b border-gray-100">
                  <div className="font-semibold text-sm text-gray-900">{currentUser.name}</div>
                  <div className="text-xs text-gray-600 truncate">{currentUser.email}</div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {currentUser.twoFactorEnabled ? (
                      <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> 2FA Active ({currentUser.twoFactorMethod === 'authenticator' ? 'App' : 'SMS'})
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" /> 2FA Inactive
                      </span>
                    )}
                  </div>
                </div>

                <div className="py-1 text-xs">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onNavigate('settings/billing');
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between text-gray-700 hover:text-gray-900"
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="w-3.5 h-3.5 text-gray-500" />
                      Billing & Subscription
                    </span>
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                      {currentUser.billingStatus === 'trialing' || currentUser.selectedPlan === 'starter'
                        ? 'Trial'
                        : 'Active'}
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onOpenPricing();
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between text-gray-700 hover:text-gray-900"
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="w-3.5 h-3.5 text-gray-500" />
                      Plans & Pricing
                    </span>
                    <span className="text-[10px] font-semibold text-blue-900 uppercase">Upgrade</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onNavigate('settings/security');
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-gray-700 hover:text-gray-900"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
                    Two-Factor Authentication (2FA)
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onNavigate('settings/sessions');
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-gray-700 hover:text-gray-900"
                  >
                    <Laptop className="w-3.5 h-3.5 text-gray-500" />
                    Active Sessions Management
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onNavigate('security');
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-gray-700 hover:text-gray-900"
                  >
                    <Shield className="w-3.5 h-3.5 text-gray-500" />
                    Security & Trust Center
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onNavigate('privacy');
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-gray-700 hover:text-gray-900"
                  >
                    <FileText className="w-3.5 h-3.5 text-gray-500" />
                    Privacy Policy
                  </button>
                </div>

                <div className="border-t border-gray-100 pt-1">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium"
                  >
                    <LogOut className="w-3.5 h-3.5 text-red-600" />
                    Log Out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Log in</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('signup')}
              className="px-3 py-1.5 text-xs font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Sign Up</span>
            </button>
          </div>
        )}
      </div>

      {/* Accessible Responsive Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation"
          className="fixed inset-0 top-16 z-40 lg:hidden flex flex-col bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            ref={mobileMenuRef}
            className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col justify-between overflow-y-auto border-r border-gray-200 animate-in slide-in-from-left duration-200"
          >
            <div className="p-4 space-y-4">
              {/* Drawer Header with Title and Close Button */}
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-900 text-white flex items-center justify-center shadow-xs">
                    <Sparkles className="w-3.5 h-3.5 text-blue-100" aria-hidden="true" />
                  </div>
                  <span className="font-bold text-sm text-gray-900">Navigation Menu</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {/* Mobile Search Input */}
              <div className="relative md:hidden">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search customers..."
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
                {searchValue && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Main Navigation Links */}
              <div className="space-y-1">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Navigation
                </div>
                {[
                  { id: 'home', label: 'Home Dashboard', icon: LayoutDashboard },
                  { id: 'customers', label: `Customers ${totalCustomers ? `(${totalCustomers})` : ''}`, icon: Users },
                  { id: 'ai-employee', label: 'AI Employee', icon: Sparkles, badge: 'Main' },
                  { id: 'messages', label: `Messages ${readyMessagesCount ? `(${readyMessagesCount} Ready)` : ''}`, icon: MessageSquare },
                  { id: 'reports', label: 'Reports & Brief', icon: FileText },
                  { id: 'action-queue', label: 'Action Queue', icon: Clock },
                  { id: 'playbooks', label: 'Retention Playbooks', icon: ShieldCheck },
                  { id: 'roi', label: 'ROI Calculator', icon: DollarSign },
                  { id: 'billing', label: 'Plans & Billing', icon: CreditCard },
                  { id: 'settings', label: 'Settings', icon: Settings }
                ].map((item) => {
                  const Icon = item.icon;
                  const isCurrent = activeView === item.id || (item.id === 'home' && (activeView === 'dashboard' || activeView === 'action-queue'));
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onNavigate(item.id);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors text-left ${
                        isCurrent
                          ? 'bg-blue-900 text-white'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${isCurrent ? 'text-white' : 'text-gray-500'}`} aria-hidden="true" />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isCurrent ? 'bg-blue-800 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Public & Legal Quick Links */}
              <div className="space-y-1 pt-2 border-t border-gray-100">
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Trust & Support
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onNavigate('pricing');
                    }}
                    className="p-2 text-left text-gray-600 hover:text-blue-900 font-medium"
                  >
                    Pricing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onNavigate('privacy');
                    }}
                    className="p-2 text-left text-gray-600 hover:text-blue-900 font-medium"
                  >
                    Privacy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onNavigate('terms');
                    }}
                    className="p-2 text-left text-gray-600 hover:text-blue-900 font-medium"
                  >
                    Terms
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onNavigate('contact');
                    }}
                    className="p-2 text-left text-gray-600 hover:text-blue-900 font-medium"
                  >
                    Contact
                  </button>
                </div>
              </div>

              {/* Mobile Project Archive Download Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    handleDownloadZip();
                  }}
                  disabled={isDownloadingZip}
                  className="w-full py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className={`w-4 h-4 text-blue-700 ${isDownloadingZip ? 'animate-bounce' : ''}`} />
                  <span>{isDownloadingZip ? 'Packaging Project ZIP...' : 'Download Project Deployment ZIP'}</span>
                </button>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2">
              {currentUser ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-700">
                    <div className="w-7 h-7 rounded-full bg-blue-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {currentUser.name?.[0] || 'U'}
                    </div>
                    <div className="min-w-0">
                      <span className="font-semibold block truncate">{currentUser.name}</span>
                      <span className="text-[10px] text-gray-500 truncate block">{currentUser.email}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full py-2 bg-white hover:bg-red-50 text-red-600 border border-gray-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Log Out</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onNavigate('login');
                    }}
                    className="py-2.5 bg-white text-gray-800 border border-gray-200 rounded-xl text-xs font-bold text-center hover:bg-gray-100"
                  >
                    Log In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onNavigate('signup');
                    }}
                    className="py-2.5 bg-blue-900 text-white rounded-xl text-xs font-bold text-center hover:bg-blue-800 shadow-xs"
                  >
                    Sign Up
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
