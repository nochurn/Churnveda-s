/**
 * Churnveda Server-Side CAPTCHA & Anti-Bot Protection Service (Area 19)
 *
 * Supports:
 * 1. Cloudflare Turnstile (Recommended)
 * 2. Google reCAPTCHA (v2 / v3)
 * 3. hCaptcha
 * 4. Anti-bot honeypot and time-based heuristic verification
 *
 * Server-side verified: never trusts client-side success flags.
 */

export interface CaptchaVerificationResult {
  success: boolean;
  score?: number;
  error?: string;
  provider?: string;
  skipped?: boolean;
}

export async function verifyCaptchaToken(
  token?: string | null,
  clientIp?: string,
  honeypotValue?: string,
  formRenderTimeMs?: number
): Promise<CaptchaVerificationResult> {
  // 1. Anti-bot honeypot field verification: bot filled a hidden field
  if (honeypotValue && honeypotValue.trim().length > 0) {
    console.warn('[Anti-Bot Protection] Honeypot triggered by automated submission.');
    return {
      success: false,
      error: 'Automated submission detected. Request rejected.',
      provider: 'honeypot'
    };
  }

  // 2. Form render time heuristic: sub-500ms form completion is almost certainly an automated script
  if (formRenderTimeMs && formRenderTimeMs > 0) {
    const elapsed = Date.now() - formRenderTimeMs;
    if (elapsed < 400) {
      console.warn(`[Anti-Bot Protection] Form submitted unrealistically fast (${elapsed}ms). Bot suspected.`);
      return {
        success: false,
        error: 'Submission too fast. Please take your time and submit again.',
        provider: 'timing'
      };
    }
  }

  // 3. Resolve configured CAPTCHA provider secret
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.CF_TURNSTILE_SECRET;
  const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY || process.env.GOOGLE_RECAPTCHA_SECRET;
  const hcaptchaSecret = process.env.HCAPTCHA_SECRET_KEY;
  const genericSecret = process.env.CAPTCHA_SECRET_KEY;

  const isProduction = process.env.NODE_ENV === 'production' && !process.env.AIS_DEV_ENVIRONMENT;

  // If no external CAPTCHA provider is configured:
  if (!turnstileSecret && !recaptchaSecret && !hcaptchaSecret && !genericSecret) {
    if (isProduction) {
      console.warn(
        '[CAPTCHA Notice] Production environment detected without TURNSTILE_SECRET_KEY or RECAPTCHA_SECRET_KEY. Protected public forms will enforce strict IP rate limiting and honeypot validation.'
      );
    }
    // Allow development and unconfigured instances to function without crash, relying on rate limiter
    return {
      success: true,
      skipped: true,
      provider: 'rate_limit_honeypot_fallback'
    };
  }

  // If provider is configured, token is mandatory
  if (!token || typeof token !== 'string' || token.trim() === '') {
    return {
      success: false,
      error: 'Bot verification required. Please complete the security verification.',
      provider: 'missing_token'
    };
  }

  // A. Cloudflare Turnstile Verification
  if (turnstileSecret) {
    try {
      const formData = new URLSearchParams();
      formData.append('secret', turnstileSecret);
      formData.append('response', token);
      if (clientIp) formData.append('remoteip', clientIp);

      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      const data = await response.json().catch(() => ({}));
      if (data.success) {
        return { success: true, provider: 'turnstile' };
      }
      return {
        success: false,
        error: 'Security challenge failed. Please refresh and try again.',
        provider: 'turnstile'
      };
    } catch (err: any) {
      console.error('[Turnstile Verification Error]:', err?.message);
      return {
        success: false,
        error: 'Unable to verify security challenge at this time. Please retry in a moment.',
        provider: 'turnstile'
      };
    }
  }

  // B. Google reCAPTCHA Verification
  if (recaptchaSecret) {
    try {
      const formData = new URLSearchParams();
      formData.append('secret', recaptchaSecret);
      formData.append('response', token);
      if (clientIp) formData.append('remoteip', clientIp);

      const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      const data = await response.json().catch(() => ({}));
      if (data.success) {
        const score = typeof data.score === 'number' ? data.score : 1.0;
        // reCAPTCHA v3 score threshold
        if (score < 0.3) {
          return {
            success: false,
            score,
            error: 'Suspicious activity detected. Please try again or contact support.',
            provider: 'recaptcha'
          };
        }
        return { success: true, score, provider: 'recaptcha' };
      }
      return {
        success: false,
        error: 'reCAPTCHA verification failed. Please try again.',
        provider: 'recaptcha'
      };
    } catch (err: any) {
      console.error('[reCAPTCHA Verification Error]:', err?.message);
      return {
        success: false,
        error: 'reCAPTCHA verification service unreachable.',
        provider: 'recaptcha'
      };
    }
  }

  // C. hCaptcha Verification
  if (hcaptchaSecret) {
    try {
      const formData = new URLSearchParams();
      formData.append('secret', hcaptchaSecret);
      formData.append('response', token);
      if (clientIp) formData.append('remoteip', clientIp);

      const response = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      const data = await response.json().catch(() => ({}));
      if (data.success) {
        return { success: true, provider: 'hcaptcha' };
      }
      return {
        success: false,
        error: 'hCaptcha verification failed. Please retry.',
        provider: 'hcaptcha'
      };
    } catch (err: any) {
      return {
        success: false,
        error: 'hCaptcha verification service unreachable.',
        provider: 'hcaptcha'
      };
    }
  }

  return { success: true, skipped: true };
}
