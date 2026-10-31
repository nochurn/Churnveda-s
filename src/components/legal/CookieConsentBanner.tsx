import React, { useState, useEffect } from 'react';
import { Cookie, Shield, Check, X, Settings2 } from 'lucide-react';

export interface CookiePreferences {
  essential: boolean; // Always true
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  timestamp: string;
}

const COOKIE_CONSENT_KEY = 'nochurn_cookie_consent_v1';

export const CookieConsentBanner: React.FC<{ onNavigate?: (view: string) => void }> = ({ onNavigate }) => {
  const [showBanner, setShowBanner] = useState<boolean>(false);
  const [showPreferences, setShowPreferences] = useState<boolean>(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    essential: true,
    functional: false,
    analytics: false,
    marketing: false,
    timestamp: ''
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (!stored) {
        setShowBanner(true);
      } else {
        const parsed = JSON.parse(stored);
        setPreferences(parsed);
      }
    } catch {
      setShowBanner(true);
    }
  }, []);

  const saveConsent = (prefs: CookiePreferences) => {
    try {
      localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(prefs));
      setPreferences(prefs);
      setShowBanner(false);
      setShowPreferences(false);
    } catch {
      setShowBanner(false);
    }
  };

  const handleAcceptAll = () => {
    saveConsent({
      essential: true,
      functional: true,
      analytics: false, // No marketing/tracking trackers exist in Churnveda
      marketing: false,
      timestamp: new Date().toISOString()
    });
  };

  const handleRejectNonEssential = () => {
    saveConsent({
      essential: true,
      functional: false,
      analytics: false,
      marketing: false,
      timestamp: new Date().toISOString()
    });
  };

  const handleSaveCustom = () => {
    saveConsent({
      ...preferences,
      essential: true,
      timestamp: new Date().toISOString()
    });
  };

  if (!showBanner) return null;

  return (
    <aside
      aria-label="Cookie consent banner"
      className="fixed bottom-0 inset-x-0 z-50 p-4 sm:p-6 bg-slate-900/95 text-white backdrop-blur-md border-t border-slate-800 shadow-2xl animate-in slide-in-from-bottom duration-300"
    >
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex items-center gap-2">
            <Cookie className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <h2 className="text-sm font-bold text-white tracking-tight">
              Privacy & Cookie Choices at Churnveda
            </h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            We use strictly essential cookies for secure login and CSRF defense. We never use third-party behavioral ad trackers or sell data. Non-essential cookies and functional storage are blocked unless you consent. Review our{' '}
            <button
              type="button"
              onClick={() => onNavigate?.('cookies')}
              className="text-blue-300 underline hover:text-blue-200 font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-400 rounded-xs"
            >
              Cookie Policy
            </button>{' '}
            and{' '}
            <button
              type="button"
              onClick={() => onNavigate?.('privacy')}
              className="text-blue-300 underline hover:text-blue-200 font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-400 rounded-xs"
            >
              Privacy Policy
            </button>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0 w-full lg:w-auto">
          <button
            type="button"
            onClick={handleRejectNonEssential}
            className="flex-1 lg:flex-none px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-colors focus:outline-hidden focus:ring-2 focus:ring-slate-400 cursor-pointer text-center"
          >
            Reject Non-Essential
          </button>

          <button
            type="button"
            onClick={() => setShowPreferences(!showPreferences)}
            className="flex-1 lg:flex-none px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-colors focus:outline-hidden focus:ring-2 focus:ring-slate-400 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Manage Preferences</span>
          </button>

          <button
            type="button"
            onClick={handleAcceptAll}
            className="flex-1 lg:flex-none px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors shadow-sm focus:outline-hidden focus:ring-2 focus:ring-blue-300 cursor-pointer text-center"
          >
            Accept Necessary & Functional
          </button>
        </div>
      </div>

      {showPreferences && (
        <div className="mt-4 pt-4 border-t border-slate-800 max-w-7xl mx-auto space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Cookie Preference Settings
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">Strictly Essential</span>
                <span className="text-[10px] text-emerald-400 font-bold uppercase bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">Always Active</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Required for authentication, session integrity, CSRF mitigation, and payment checkouts. Cannot be disabled.
              </p>
            </div>

            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">Functional Preferences</span>
                <input
                  type="checkbox"
                  id="cookie-pref-functional"
                  checked={preferences.functional}
                  onChange={(e) => setPreferences(p => ({ ...p, functional: e.target.checked }))}
                  className="rounded border-slate-600 text-blue-600 focus:ring-blue-400 cursor-pointer"
                />
              </div>
              <label htmlFor="cookie-pref-functional" className="text-[11px] text-slate-300 block cursor-pointer">
                Remembers UI theme layout, table density, and column sorting preferences across sessions.
              </label>
            </div>

            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 space-y-1 opacity-75">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">Marketing & Pixels</span>
                <span className="text-[10px] text-slate-400 font-bold uppercase bg-slate-900 px-2 py-0.5 rounded border border-slate-700">None Used</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Churnveda never embeds third-party marketing retargeting pixels, Facebook Pixels, or cross-site tracking beacons.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSaveCustom}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-300 cursor-pointer"
            >
              Save Cookie Choices
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
