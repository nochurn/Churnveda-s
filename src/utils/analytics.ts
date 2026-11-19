declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __CHURNVEDA_GA_ID__?: string;
    [key: string]: unknown;
  }
}

export const COOKIE_CONSENT_KEY = 'nochurn_cookie_consent_v1';

let initializedGaId: string | null = null;

function resolveMeasurementId(): string {
  if (typeof window !== 'undefined' && window.__CHURNVEDA_GA_ID__) {
    return window.__CHURNVEDA_GA_ID__;
  }
  const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  const id = metaEnv?.VITE_GA_MEASUREMENT_ID;
  return typeof id === 'string' ? id.trim() : '';
}

export function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.analytics === true);
  } catch {
    return false;
  }
}

export function revokeAnalyticsConsent(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const gaId = resolveMeasurementId();
  if (gaId) {
    window[`ga-disable-${gaId}`] = true;
    document.querySelectorAll(`script[data-ga-id="${gaId}"]`).forEach((el) => el.remove());
  }
  initializedGaId = null;

  // Clear _ga cookies on current hostname
  try {
    document.cookie.split(';').forEach((cookie) => {
      const eqIdx = cookie.indexOf('=');
      const name = (eqIdx > -1 ? cookie.slice(0, eqIdx) : cookie).trim();
      if (name === '_ga' || name.startsWith('_ga_') || name === '_gid' || name.startsWith('_gat')) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    });
  } catch {
    // Non-fatal
  }
}

export function initAnalytics(): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!hasAnalyticsConsent()) return null;

  const gaId = resolveMeasurementId();
  if (!gaId || !/^G-[A-Z0-9]+$/i.test(gaId)) return null;

  window[`ga-disable-${gaId}`] = false;

  if (initializedGaId === gaId && typeof window.gtag === 'function') {
    return gaId;
  }

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
    window.gtag('js', new Date());
    window.gtag('config', gaId, { send_page_view: false, anonymize_ip: true });
  }

  if (!document.querySelector(`script[data-ga-id="${gaId}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    script.setAttribute('data-ga-id', gaId);
    document.head.appendChild(script);
  }

  initializedGaId = gaId;
  return gaId;
}

export function trackPageView(viewName: string, title?: string): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;
  const gaId = initAnalytics();
  if (!gaId || typeof window.gtag !== 'function') return;

  window.gtag('event', 'page_view', {
    page_title: title || document.title,
    page_location: window.location.href,
    page_path: `/${viewName.replace(/^\/+/, '')}`
  });
}

export function trackEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;
  const gaId = initAnalytics();
  if (!gaId || typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, params || {});
}
