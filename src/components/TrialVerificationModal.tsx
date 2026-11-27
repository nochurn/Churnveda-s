import React, { useState } from 'react';
import {
  ShieldCheck,
  Calendar,
  Lock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Smartphone,
  CreditCard,
  Building2,
  Wallet
} from 'lucide-react';
import { apiService } from '../services/api';
import { authService } from '../services/authService';
import {
  ONE_TIME_PAYMENT_DISCLOSURE,
  USD_RECURRING_CARD_DISCLOSURE,
  buildRazorpayOneTimeOptions,
  buildRazorpaySubscriptionOptions,
  getAuthoritativePlan
} from '../services/razorpayConfig';
import { getEditionLabel, getEditionMarketing, normalizePlanEdition, PlanEdition } from '../config/pricing';
import { ensureRazorpaySdk } from '../services/razorpaySdk';

interface TrialVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tier: 'starter' | 'growth' | 'pro';
  billingCycle: 'monthly' | 'annual';
  planEdition?: PlanEdition;
  isFoundingOffer?: boolean;
  onSuccess: (result: {
    tier: string;
    billing_cycle: string;
    plan_edition?: PlanEdition;
    autopay_status?: string;
    autopay_authorized?: boolean;
    trial_ends_at: string;
    message: string;
  }) => void;
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const TrialVerificationModal: React.FC<TrialVerificationModalProps> = ({
  isOpen,
  onClose,
  tier,
  billingCycle,
  planEdition,
  isFoundingOffer = false,
  onSuccess,
  onShowToast
}) => {
  const currentUser = authService.getCurrentUser();
  const resolvedEdition: PlanEdition = normalizePlanEdition(
    planEdition || (isFoundingOffer ? 'founding' : undefined) || currentUser?.planEdition || 'standard',
    'standard'
  );
  const editionLabel = getEditionLabel(resolvedEdition);
  const editionMarketing = getEditionMarketing(resolvedEdition);

  const [name, setName] = useState(currentUser?.name || 'SaaS Founder');
  const [email, setEmail] = useState(currentUser?.email || 'founder@churnveda.com');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [mandatePendingState, setMandatePendingState] = useState<{
    message: string;
    autopayStatus: string;
    trialEndsAt: string;
  } | null>(null);
  const [exchangeRate, setExchangeRate] = useState<number>(86.85);
  const [displayRate, setDisplayRate] = useState<string>('1 USD = ₹86.85');
  // Preserve $1 USD as default currency for recurring card Autopay
  const [paymentCurrency, setPaymentCurrency] = useState<'USD' | 'INR'>('USD');

  React.useEffect(() => {
    apiService.fetchExchangeRate().then(res => {
      if (res.rate) {
        setExchangeRate(res.rate);
        setDisplayRate(res.displayRate || `1 USD = ₹${res.rate.toFixed(2)}`);
      }
    }).catch(() => {});
  }, []);

  if (!isOpen) return null;

  const authoritativePlan = getAuthoritativePlan(tier, resolvedEdition);
  const planUsd = billingCycle === 'annual' ? authoritativePlan.annualTotalPrice : authoritativePlan.monthlyPrice;
  const estimatedInr = Math.round(planUsd * exchangeRate);
  const authoritativePrice = billingCycle === 'annual'
    ? authoritativePlan.formattedAnnual
    : authoritativePlan.formattedMonthly;

  const trialEndDays = 14;
  const futureBillingDate = new Date(Date.now() + trialEndDays * 86400000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const verificationInr = Math.round(1.0 * exchangeRate);
  const isInrSelected = paymentCurrency === 'INR';
  const activeDisclosure = isInrSelected
    ? ONE_TIME_PAYMENT_DISCLOSURE
    : USD_RECURRING_CARD_DISCLOSURE;

  const ctaLabel = isInrSelected
    ? `Pay ₹${verificationInr} ($1 USD eq.) & Verify`
    : billingCycle === 'annual'
    ? 'Authorize $1 USD Card & Start Annual Trial'
    : 'Authorize $1 USD Card & Enable Autopay';

  const handleVerifyResponse = async (response: {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_subscription_id?: string;
    razorpay_signature: string;
  }) => {
    try {
      if (onShowToast) {
        onShowToast('Verifying payment & Autopay mandate with server...', 'info');
      }

      const verifyRes = await apiService.verifyTrialPayment({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_subscription_id: response.razorpay_subscription_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      });

      if (!verifyRes.success) {
        setErrorMessage(verifyRes.error || 'Payment signature verification failed.');
        return;
      }

      const resultingEdition = normalizePlanEdition(verifyRes.plan_edition || resolvedEdition);
      const resultingAutopayStatus = verifyRes.autopay_status || (verifyRes.autopay_authorized ? 'authenticated' : 'pending');

      authService.updateSubscriptionState('trialing', tier, {
        planEdition: resultingEdition,
        autopayStatus: resultingAutopayStatus,
        trialEndDate: verifyRes.trial_ends_at
      });

      if (verifyRes.autopay_authorized) {
        if (onShowToast) {
          onShowToast('Card verified & Autopay mandate authorized! Your 14-day Churnveda trial is active.', 'success');
        }
        onSuccess({
          tier,
          billing_cycle: billingCycle,
          plan_edition: resultingEdition,
          autopay_status: resultingAutopayStatus,
          autopay_authorized: true,
          trial_ends_at: verifyRes.trial_ends_at,
          message: verifyRes.message
        });
        onClose();
      } else {
        const warningMsg =
          verifyRes.mandate_failure_reason ||
          verifyRes.message ||
          '$1 verification payment succeeded, but recurring Autopay is not yet established.';
        setMandatePendingState({
          message: warningMsg,
          autopayStatus: resultingAutopayStatus,
          trialEndsAt: verifyRes.trial_ends_at
        });
        if (onShowToast) {
          onShowToast('Verification captured, but recurring Autopay authorization requires completion.', 'info');
        }
        onSuccess({
          tier,
          billing_cycle: billingCycle,
          plan_edition: resultingEdition,
          autopay_status: resultingAutopayStatus,
          autopay_authorized: false,
          trial_ends_at: verifyRes.trial_ends_at,
          message: warningMsg
        });
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error completing payment verification.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartVerification = async () => {
    if (!consentAccepted) {
      setErrorMessage('Please confirm the recurring billing & verification authorization checkbox before continuing.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setMandatePendingState(null);

    try {
      if (onShowToast) {
        onShowToast(
          isInrSelected
            ? `Initializing ₹${verificationInr} ($1 USD eq.) verification order with Razorpay...`
            : 'Initializing $1.00 USD subscription mandate authorization with Razorpay...',
          'info'
        );
      }

      // 1. Create server-side $1.00 USD subscription mandate (or INR one-time fallback if selected)
      const orderRes = await apiService.createTrialVerificationOrder({
        tier,
        billing_cycle: billingCycle,
        planEdition: resolvedEdition,
        isFoundingOffer: resolvedEdition === 'founding',
        currency: paymentCurrency,
        consentAccepted: true
      });

      if (!orderRes.success) {
        throw new Error(orderRes.error || 'Failed to initialize verification checkout');
      }

      const sdkReady = await ensureRazorpaySdk();
      if (!sdkReady || typeof (window as any).Razorpay === 'undefined' || !orderRes.keyId) {
        setErrorMessage('Razorpay Checkout SDK could not load. Please check your internet connection or disable content blockers and try again.');
        setIsLoading(false);
        return;
      }

      const planDesc = `${authoritativePlan.name} (${editionLabel}) · 14-Day Trial (${billingCycle === 'annual' ? 'Annual' : 'Monthly'})`;

      if (orderRes.authMode === 'subscription_mandate' && orderRes.subscriptionId) {
        const subOptions = buildRazorpaySubscriptionOptions({
          keyId: orderRes.keyId,
          subscriptionId: orderRes.subscriptionId,
          name: 'Churnveda',
          planName: `${authoritativePlan.name} ${editionLabel}`,
          description: `$1.00 USD Verification + Recurring Autopay — ${planDesc}`,
          customerName: name || 'Founder',
          customerEmail: email || 'founder@churnveda.com',
          cardOnly: true,
          notes: {
            purpose: 'trial_verification_autopay',
            tier,
            plan_edition: resolvedEdition,
            billing_cycle: billingCycle
          },
          handler: handleVerifyResponse,
          onDismiss: () => {
            setIsLoading(false);
            if (onShowToast) {
              onShowToast('Checkout closed before Autopay authorization completed.', 'info');
            }
          }
        });

        const rzp = new (window as any).Razorpay(subOptions);
        rzp.on('payment.failed', (resp: any) => {
          setErrorMessage(resp?.error?.description || 'Card verification or Autopay mandate authorization was declined.');
          setIsLoading(false);
        });
        rzp.open();
        return;
      }

      // INR one-time verification order fallback
      const chargeAmount = orderRes.amount || orderRes.amountCents || 100;
      const orderCurr = (orderRes.currency || paymentCurrency || 'USD').toUpperCase();
      const orderDesc =
        orderCurr === 'INR'
          ? `₹${Math.round(chargeAmount / 100)} ($1 USD eq.) Verification - ${planDesc}`
          : `$1 Verification - ${planDesc}`;

      const options = buildRazorpayOneTimeOptions({
        keyId: orderRes.keyId,
        orderId: orderRes.orderId || '',
        amountCents: chargeAmount,
        amount: chargeAmount,
        currency: orderCurr,
        name: 'Churnveda',
        description: orderDesc,
        customerName: name || 'Founder',
        customerEmail: email || 'founder@churnveda.com',
        notes: {
          purpose: 'trial_verification',
          tier,
          plan_edition: resolvedEdition,
          billing_cycle: billingCycle
        },
        handler: handleVerifyResponse,
        onDismiss: () => {
          setIsLoading(false);
        }
      });

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        setErrorMessage(resp?.error?.description || 'Payment was declined or cancelled.');
        setIsLoading(false);
      });
      rzp.open();
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to start trial verification checkout.');
      setIsLoading(false);
    }
  };

  const handleRetryAutopay = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const retryRes = await apiService.retryMandateAuthorization({
        tier,
        billing_cycle: billingCycle,
        planEdition: resolvedEdition,
        consentAccepted: true
      });
      if (!retryRes.success || !retryRes.subscriptionId) {
        throw new Error(retryRes.error || 'Could not initialize recurring Autopay retry');
      }
      const sdkReady = await ensureRazorpaySdk();
      if (!sdkReady || typeof (window as any).Razorpay === 'undefined') {
        setErrorMessage('Razorpay Checkout SDK could not load.');
        setIsLoading(false);
        return;
      }
      const options = buildRazorpaySubscriptionOptions({
        keyId: retryRes.keyId,
        subscriptionId: retryRes.subscriptionId,
        name: 'Churnveda',
        description: `Authorize Recurring Card Autopay ($1 fee waived) — ${authoritativePlan.name} (${editionLabel})`,
        customerName: name || 'Founder',
        customerEmail: email || 'founder@churnveda.com',
        cardOnly: true,
        handler: handleVerifyResponse,
        onDismiss: () => {
          setIsLoading(false);
        }
      });
      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        setErrorMessage(resp?.error?.description || 'Autopay authorization retry was declined.');
        setIsLoading(false);
      });
      rzp.open();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to retry Autopay authorization.');
      setIsLoading(false);
    }
  };

  return (
    <div
      id="trial-verification-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto"
    >
      <div
        id="trial-verification-modal-card"
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden my-6"
      >
        {/* Top Header */}
        <div className="bg-[#1E3A8A] text-white p-6 relative">
          <button
            type="button"
            id="close-trial-modal-btn"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white/15 text-blue-100 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>14-Day Trial · $1.00 USD Card &amp; Autopay Verification</span>
          </div>

          <h2 className="text-xl font-bold tracking-tight">
            Verify &amp; Start Your {authoritativePlan.name} Trial
          </h2>
          <p className="text-xs text-blue-100 mt-1">
            {authoritativePlan.name} ({editionLabel}) · {billingCycle === 'annual' ? 'Annual Billing' : 'Monthly Recurring'} · {authoritativePrice}
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* Selected Plan Card */}
          <div
            id="selected-plan-card"
            className="bg-blue-50/90 border border-blue-200 rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-blue-200/70">
              <div>
                <span className="text-[11px] text-gray-500 font-medium block">Selected Plan &amp; Edition</span>
                <span className="text-sm font-bold text-blue-900">
                  {authoritativePlan.name} — {editionLabel}
                </span>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  resolvedEdition === 'standard'
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                }`}
              >
                {editionMarketing.badge}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-500 block text-[11px]">Subscription Rate After Trial:</span>
                <strong className="text-gray-900 font-bold text-sm">
                  {authoritativePrice}
                </strong>
              </div>
              <div>
                <span className="text-gray-500 block text-[11px]">Verification Charge Today:</span>
                {isInrSelected ? (
                  <div>
                    <strong className="text-emerald-700 font-bold text-sm">
                      ₹{verificationInr} INR (One-Time)
                    </strong>
                    <span className="block text-[10px] text-gray-500">
                      Equivalent to $1.00 USD
                    </span>
                  </div>
                ) : (
                  <strong className="text-emerald-700 font-bold text-sm">
                    $1.00 USD (Subscription Auth)
                  </strong>
                )}
              </div>
            </div>

            {/* Region / Currency Selector */}
            <div className="pt-2 border-t border-blue-200/70 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-gray-600 font-medium">Checkout Mode &amp; Currency:</span>
                <div className="inline-flex rounded-lg bg-white border border-blue-200 p-0.5">
                  <button
                    type="button"
                    onClick={() => setPaymentCurrency('USD')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      !isInrSelected
                        ? 'bg-[#1E3A8A] text-white'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Global ($1 USD + Autopay)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentCurrency('INR')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      isInrSelected
                        ? 'bg-[#1E3A8A] text-white'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    India (₹ INR One-Time)
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-blue-900 font-medium">
                {isInrSelected
                  ? `Charges ₹${verificationInr} (${displayRate}) as a one-time verification. To enable automatic USD recurring renewals, authorize an international card under Global ($1 USD + Autopay).`
                  : 'Authorizes a $1.00 USD verification payment + recurring Razorpay card mandate. Automatic renewal begins after day 14 unless cancelled.'}
              </p>
            </div>
          </div>

          {/* Supported Payment Methods Display */}
          <div
            id="supported-payment-methods-box"
            className="bg-gray-50 rounded-xl p-3.5 border border-gray-200 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-800">
                {isInrSelected ? 'Supported One-Time INR Methods:' : 'Supported USD Recurring Autopay Method:'}
              </span>
              <span className="text-[10px] text-gray-500">Razorpay Secure</span>
            </div>

            {isInrSelected ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="flex items-center gap-1.5 p-2 bg-white rounded-lg border border-gray-200 text-xs font-medium text-gray-700">
                  <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="truncate">UPI</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 bg-white rounded-lg border border-gray-200 text-xs font-medium text-gray-700">
                  <CreditCard className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="truncate">Credit/Debit</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 bg-white rounded-lg border border-gray-200 text-xs font-medium text-gray-700">
                  <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="truncate">Netbanking</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 bg-white rounded-lg border border-gray-200 text-xs font-medium text-gray-700">
                  <Wallet className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="truncate">Wallets</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 p-2.5 bg-white rounded-lg border border-blue-200 text-xs font-semibold text-blue-950">
                <CreditCard className="w-4 h-4 text-blue-700 shrink-0" />
                <span>International &amp; Domestic Cards (Visa, Mastercard, Amex — Recurring Mandate Enabled)</span>
              </div>
            )}

            <p className="text-[11px] text-gray-600 font-medium">
              {activeDisclosure}
            </p>
          </div>

          {/* Future Billing Transparency */}
          <div className="bg-gray-50/60 rounded-xl p-3 border border-gray-200/80 space-y-1.5 text-xs text-gray-600">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-700" />
                Trial Ends (First Scheduled Renewal):
              </span>
              <span className="font-semibold text-gray-800">{futureBillingDate}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Recurring charge after day 14:</span>
              <span className="font-semibold text-gray-800 text-right">
                {authoritativePrice} ({billingCycle === 'annual' ? 'Annual' : 'Monthly'})
                {isInrSelected && (
                  <span className="block text-[10px] font-normal text-gray-500">
                    ≈ ₹{estimatedInr.toLocaleString('en-IN')}/{billingCycle === 'annual' ? 'yr' : 'mo'}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* User Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Billing Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full Name"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
              />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Receipt Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="founder@company.com"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
              />
            </div>
          </div>

          {/* Explicit Recurring Mandate Authorization Consent (Unchecked by Default) */}
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
            <label className="flex items-start gap-2.5 text-[11px] text-gray-800 cursor-pointer select-none">
              <input
                type="checkbox"
                id="autopay-consent-checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-[#1E3A8A] focus:ring-[#1E3A8A]/30 cursor-pointer"
              />
              <span className="leading-relaxed">
                {isInrSelected
                  ? `I agree to pay ₹${verificationInr} INR ($1.00 USD eq.) today as a one-time trial verification and understand recurring USD Autopay is not established by an INR one-time payment.`
                  : `I explicitly authorize Churnveda via Razorpay to charge $1.00 USD today for card verification and set up recurring Autopay billing for ${authoritativePrice} starting ${futureBillingDate} until I cancel in Billing Settings.`}
              </span>
            </label>
          </div>

          {/* Pending Mandate Warning + Immediate Retry Action */}
          {mandatePendingState && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 space-y-2.5 text-xs text-amber-950">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">
                    $1 Verification Recorded — Autopay Status: {mandatePendingState.autopayStatus.toUpperCase()}
                  </div>
                  <p className="text-[11px] text-amber-900 mt-0.5">{mandatePendingState.message}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRetryAutopay}
                  disabled={isLoading}
                  className="px-3 py-1.5 bg-[#1E3A8A] hover:bg-blue-800 text-white font-bold rounded-lg text-[11px] cursor-pointer"
                >
                  Retry Autopay Authorization ($1 Fee Waived)
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 font-semibold rounded-lg text-[11px] cursor-pointer"
                >
                  Continue to Dashboard
                </button>
              </div>
            </div>
          )}

          {/* Error notice */}
          {errorMessage && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 p-3 rounded-xl text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Trust Guarantees */}
          <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Razorpay 256-Bit SSL</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Cancel Anytime in Settings</span>
            </div>
          </div>

          {/* Action Button: Required CTA */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              id="pay-trial-verification-button"
              disabled={isLoading || !consentAccepted}
              onClick={handleStartVerification}
              className="w-full py-3.5 px-4 bg-[#1E3A8A] hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Connecting to Razorpay...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>{ctaLabel}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="text-[10px] text-center text-gray-500">
              {activeDisclosure}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
