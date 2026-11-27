import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  CreditCard
} from 'lucide-react';
import { apiService } from '../services/api';
import { authService } from '../services/authService';
import {
  USD_RECURRING_CARD_DISCLOSURE,
  buildRazorpayOneTimeOptions,
  buildRazorpaySubscriptionOptions,
  getAuthoritativePlan
} from '../services/razorpayConfig';
import { getEditionLabel, normalizePlanEdition, PlanEdition } from '../config/pricing';
import { ensureRazorpaySdk } from '../services/razorpaySdk';

interface BillingVerifyViewProps {
  onNavigate: (view: string, queryParams?: Record<string, string>) => void;
  onShowToast: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export const BillingVerifyView: React.FC<BillingVerifyViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const currentUser = authService.getCurrentUser();
  const pendingPlan = authService.getPendingPlan();

  const tier: 'starter' | 'growth' | 'pro' =
    (currentUser?.plan as any) ||
    (pendingPlan?.tier as any) ||
    'growth';

  const billingCycle: 'monthly' | 'annual' =
    (currentUser?.billingCycle as any) ||
    (pendingPlan?.billingCycle as any) ||
    'monthly';

  const planEdition: PlanEdition = normalizePlanEdition(
    currentUser?.planEdition || pendingPlan?.planEdition || 'standard',
    'standard'
  );
  const editionLabel = getEditionLabel(planEdition);

  const authoritativePlan = getAuthoritativePlan(tier, planEdition);
  const authoritativePrice =
    billingCycle === 'annual'
      ? authoritativePlan.formattedAnnual
      : authoritativePlan.formattedMonthly;

  const [isLoading, setIsLoading] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mandatePendingWarning, setMandatePendingWarning] = useState<string | null>(null);

  const futureBillingDate = new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const ctaLabel =
    billingCycle === 'annual'
      ? 'Pay $1 USD & Start Annual Trial'
      : 'Authorize $1 USD Card & Enable Autopay';

  const handleVerificationCallback = async (response: any) => {
    try {
      onShowToast('Verifying payment & Autopay mandate with Churnveda backend...', 'info');
      const verifyRes = await apiService.verifyTrialPayment({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_subscription_id: response.razorpay_subscription_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      });

      if (!verifyRes.success) {
        setErrorMessage(verifyRes.error || 'Payment verification failed');
        onShowToast(verifyRes.error || 'Verification failed', 'error');
        return;
      }

      const resultingEdition = normalizePlanEdition(verifyRes.plan_edition || planEdition);
      const resultingAutopay = verifyRes.autopay_status || (verifyRes.autopay_authorized ? 'authenticated' : 'pending');

      authService.updateSubscriptionState('trialing', tier, {
        planEdition: resultingEdition,
        autopayStatus: resultingAutopay,
        trialEndDate: verifyRes.trial_ends_at
      });
      authService.clearPendingPlan();

      if (verifyRes.autopay_authorized) {
        onShowToast(
          `Verification & Autopay complete! 14-day ${authoritativePlan.name} (${editionLabel}) trial activated.`,
          'success'
        );
        onNavigate('dashboard');
      } else {
        const msg =
          verifyRes.mandate_failure_reason ||
          verifyRes.message ||
          '$1 USD verification captured, but recurring Autopay is not yet established.';
        setMandatePendingWarning(msg);
        onShowToast('Trial started, but Autopay authorization needs completion in Billing Settings.', 'info');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Signature verification error');
      onShowToast(err.message || 'Signature verification error', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartVerification = async () => {
    if (!consentAccepted) {
      setErrorMessage('Please accept the recurring Autopay authorization disclosure before proceeding.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setMandatePendingWarning(null);

    try {
      onShowToast('Initializing $1.00 USD subscription mandate with Razorpay...', 'info');

      const orderRes = await apiService.createTrialVerificationOrder({
        tier,
        billing_cycle: billingCycle,
        planEdition,
        currency: 'USD',
        consentAccepted: true
      });

      if (!orderRes.success) {
        throw new Error(orderRes.error || 'Failed to initialize verification checkout');
      }

      const sdkReady = await ensureRazorpaySdk();
      if (!sdkReady || typeof (window as any).Razorpay === 'undefined') {
        setErrorMessage('Razorpay Checkout SDK could not load. Please check your internet connection or disable content blockers and try again.');
        onShowToast('Razorpay Checkout SDK is unavailable. Please retry.', 'error');
        setIsLoading(false);
        return;
      }

      if (orderRes.authMode === 'subscription_mandate' && orderRes.subscriptionId) {
        const subOptions = buildRazorpaySubscriptionOptions({
          keyId: orderRes.keyId || '',
          subscriptionId: orderRes.subscriptionId,
          name: 'Churnveda',
          planName: `${authoritativePlan.name} ${editionLabel}`,
          description: `$1.00 USD Verification + Autopay — ${authoritativePlan.name} (${editionLabel})`,
          customerName: currentUser?.name || 'SaaS Founder',
          customerEmail: currentUser?.email || 'founder@churnveda.com',
          cardOnly: true,
          notes: {
            purpose: 'trial_verification_autopay',
            tier,
            plan_edition: planEdition,
            billing_cycle: billingCycle
          },
          handler: handleVerificationCallback,
          onDismiss: () => {
            setIsLoading(false);
            onShowToast('Trial verification & Autopay setup was canceled.', 'info');
          }
        });

        const rzp = new (window as any).Razorpay(subOptions);
        rzp.on('payment.failed', (resp: any) => {
          setIsLoading(false);
          const reason = resp?.error?.description || 'Card mandate authorization failed';
          setErrorMessage(`Autopay setup failed: ${reason}`);
          onShowToast(`Autopay setup failed: ${reason}`, 'error');
        });
        rzp.open();
        return;
      }

      const options = buildRazorpayOneTimeOptions({
        keyId: orderRes.keyId || '',
        orderId: orderRes.orderId || '',
        amountCents: orderRes.amountCents || orderRes.amount,
        amount: orderRes.amountCents || orderRes.amount,
        currency: orderRes.currency || 'USD',
        name: 'Churnveda',
        description: `$1 Verification - ${authoritativePlan.name} (${editionLabel}) 14-Day Trial`,
        customerName: currentUser?.name || 'SaaS Founder',
        customerEmail: currentUser?.email || 'founder@churnveda.com',
        handler: handleVerificationCallback,
        onDismiss: () => {
          setIsLoading(false);
          onShowToast('Trial verification was canceled.', 'info');
        }
      });

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        setIsLoading(false);
        const reason = resp?.error?.description || 'Payment failed';
        setErrorMessage(`Payment failed: ${reason}`);
        onShowToast(`Payment failed: ${reason}`, 'error');
      });
      rzp.open();
    } catch (err: any) {
      setIsLoading(false);
      setErrorMessage(err.message || 'Could not initiate $1.00 USD verification.');
      onShowToast(err.message || 'Could not initiate $1.00 USD verification.', 'error');
    }
  };

  return (
    <div className="min-h-[calc(100vh-14rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-900 text-white shadow-xs mb-3">
              <ShieldCheck className="w-6 h-6 text-blue-100" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Verify Card &amp; Authorize Autopay
            </h1>
            <p className="text-xs text-gray-600 mt-1">
              A $1.00 USD card verification &amp; Razorpay Subscription mandate is required to start your 14-day trial.
            </p>
          </div>

          {/* Selected Plan Card (Locked) */}
          <div
            id="selected-plan-card"
            className="mb-5 p-4 bg-blue-50/90 border border-blue-200 rounded-xl space-y-3 text-xs shadow-2xs"
          >
            <div className="flex items-center justify-between pb-2 border-b border-blue-200/70">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse" />
                <span className="font-bold text-blue-950 text-sm">
                  {authoritativePlan.name} ({editionLabel})
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                14-Day Trial
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-500 block text-[11px]">Recurring Rate After Day 14:</span>
                <strong className="text-gray-900 font-bold text-sm">
                  {authoritativePrice}
                </strong>
              </div>
              <div>
                <span className="text-gray-500 block text-[11px]">Due Today:</span>
                <strong className="text-emerald-700 font-bold text-sm">
                  $1.00 USD Verification
                </strong>
              </div>
            </div>

            <div className="pt-2 border-t border-blue-200/70 space-y-1 text-xs text-gray-700 leading-relaxed">
              <div className="flex items-start gap-1.5 text-blue-950 font-bold">
                <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <span>$1.00 USD subscription mandate authorization required.</span>
              </div>
              <p className="text-gray-600 pl-5 text-[11px]">
                First full renewal ({authoritativePrice}) is scheduled on {futureBillingDate} unless cancelled.
              </p>
            </div>

            {/* Supported Payment Methods Badges */}
            <div className="pt-2 border-t border-blue-200/70 space-y-1.5">
              <span className="text-[10px] font-bold text-blue-950 uppercase tracking-wider block">
                Supported Method for USD Recurring Billing
              </span>
              <div className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded border border-blue-200/80 text-gray-800 font-medium text-[11px]">
                <CreditCard className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>International &amp; Domestic Cards (Visa, Mastercard, Amex)</span>
              </div>
              <p className="text-[10px] text-gray-600 pt-0.5 font-medium">
                {USD_RECURRING_CARD_DISCLOSURE}
              </p>
            </div>
          </div>

          {/* Unchecked Pre-Authorization Consent */}
          <div className="mb-4 p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
            <label className="flex items-start gap-2 text-[11px] text-gray-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-blue-900 focus:ring-blue-900/20 cursor-pointer"
              />
              <span className="leading-relaxed">
                I authorize Churnveda via Razorpay to charge $1.00 USD today and enable recurring Autopay for {authoritativePrice} starting {futureBillingDate} until I cancel.
              </span>
            </label>
          </div>

          {mandatePendingWarning && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs text-amber-950">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{mandatePendingWarning}</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('billing')}
                className="px-3 py-1.5 bg-blue-900 text-white rounded-lg text-[11px] font-bold cursor-pointer"
              >
                Go to Billing Settings to Retry Autopay
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action CTA */}
          <button
            type="button"
            onClick={handleStartVerification}
            disabled={isLoading || !consentAccepted}
            className="w-full py-3 px-4 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Processing Razorpay Verification...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>{ctaLabel}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="mt-2 text-[10px] text-center text-gray-500 font-medium flex items-center justify-center gap-1">
            <Lock className="w-3 h-3" />
            <span>{USD_RECURRING_CARD_DISCLOSURE}</span>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>Logged in as <strong>{currentUser?.email || 'Guest'}</strong></span>
            <button
              type="button"
              onClick={() => onNavigate('pricing')}
              className="text-blue-900 hover:underline font-semibold"
            >
              Choose different plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
