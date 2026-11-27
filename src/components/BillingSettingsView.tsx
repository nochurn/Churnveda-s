import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  ArrowRight,
  Shield,
  Zap,
  ExternalLink,
  ChevronRight,
  XCircle,
  FileText,
  Lock,
  Plus,
  Trash2,
  Check,
  ShieldCheck,
  Smartphone,
  Building2,
  Wallet
} from 'lucide-react';
import { UserProfile, PaymentMethod } from '../types';
import { authService } from '../services/authService';
import { apiService } from '../services/api';
import {
  ONE_TIME_PAYMENT_DISCLOSURE,
  RECURRING_MANDATE_DISCLOSURE,
  USD_RECURRING_CARD_DISCLOSURE,
  buildRazorpayOneTimeOptions,
  buildRazorpaySubscriptionOptions,
  getAuthoritativePlan
} from '../services/razorpayConfig';
import {
  getEditionLabel,
  getEditionMarketing,
  getPlanLimits,
  getPlanPricing,
  normalizePlanEdition,
  normalizePlanTier,
  PlanEdition
} from '../config/pricing';
import { ensureRazorpaySdk } from '../services/razorpaySdk';

interface BillingSettingsViewProps {
  currentUser: UserProfile | null;
  onNavigate: (view: string, params?: Record<string, string>) => void;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onUpdateUser?: (updated: UserProfile) => void;
  initialAction?: string;
}

export const BillingSettingsView: React.FC<BillingSettingsViewProps> = ({
  currentUser,
  onNavigate,
  onShowToast,
  onUpdateUser,
  initialAction
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingMethods, setIsLoadingMethods] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showAddCardModal, setShowAddCardModal] = useState(initialAction === 'add-card');
  const [showRetryAutopayModal, setShowRetryAutopayModal] = useState(false);
  const [retryConsentAccepted, setRetryConsentAccepted] = useState(false);
  const [savedMethods, setSavedMethods] = useState<PaymentMethod[]>(currentUser?.paymentMethods || []);
  const [cancelReason, setCancelReason] = useState('');
  const [subscriptionDetails, setSubscriptionDetails] = useState<any>(null);

  // Fallback / Normalized values
  const userPlan = currentUser?.selectedPlan || currentUser?.plan?.toLowerCase() || 'starter';
  const normTier = normalizePlanTier(userPlan);
  const activeEdition: PlanEdition = normalizePlanEdition(
    subscriptionDetails?.planEdition || currentUser?.planEdition || 'standard',
    'standard'
  );
  const editionLabel = getEditionLabel(activeEdition);
  const editionMarketing = getEditionMarketing(activeEdition);
  const activeLimits = subscriptionDetails?.limits || getPlanLimits(normTier, activeEdition);
  const currentPlanPricing = getPlanPricing(normTier, activeEdition);
  const standardPlanPricing = getPlanPricing(normTier, 'standard');
  const billingCycle = (subscriptionDetails?.subscription?.billing_cycle || currentUser?.billingCycle || 'monthly') as 'monthly' | 'annual';
  const currentPlanMonthlyPrice =
    subscriptionDetails?.agreedPriceUsd ??
    currentUser?.planPrice ??
    currentPlanPricing.monthly.amountUsd;
  const displayPlanPrice =
    billingCycle === 'annual' && !subscriptionDetails?.agreedPriceUsd
      ? currentPlanPricing.annual.totalAmountUsd
      : currentPlanMonthlyPrice;
  const pricePeriodLabel = billingCycle === 'annual' ? '/yr' : '/mo';

  const isStarter = normTier === 'starter';
  const isTrial = currentUser?.billingStatus === 'trialing' || subscriptionDetails?.subscription?.status === 'trialing';
  const isCanceled = currentUser?.billingStatus === 'canceled' || currentUser?.billingStatus === 'cancelled' || subscriptionDetails?.subscription?.status === 'cancelled';

  const rawAutopayStatus =
    subscriptionDetails?.autopay?.status ||
    subscriptionDetails?.subscription?.autopay_status ||
    currentUser?.autopayStatus ||
    'not_established';
  const autopayAuthorized = Boolean(
    subscriptionDetails?.autopay?.authorized ||
    rawAutopayStatus === 'authenticated' ||
    rawAutopayStatus === 'active'
  );

  const hasPaymentMethod =
    currentUser?.paymentStatus === 'paid' ||
    currentUser?.paymentStatus === 'active' ||
    Boolean(currentUser?.cardLast4) ||
    savedMethods.length > 0 ||
    autopayAuthorized;

  // Open modal if triggered via URL parameter
  useEffect(() => {
    if (initialAction === 'add-card') {
      setShowAddCardModal(true);
    }
  }, [initialAction]);

  const [internationalStatus, setInternationalStatus] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);

  const refreshSubscriptionDetails = async () => {
    try {
      const detailsRes = await apiService.fetchSubscriptionDetails();
      if (detailsRes?.success) {
        setSubscriptionDetails(detailsRes);
      }
    } catch {
      // ignore non-fatal refresh error
    }
  };

  // Load existing payment methods, international status, subscription details, and transactions ledger
  useEffect(() => {
    let isMounted = true;
    const loadBillingData = async () => {
      try {
        setIsLoadingMethods(true);
        setIsLoadingTransactions(true);

        const [methodsRes, statusRes, txRes, detailsRes] = await Promise.allSettled([
          apiService.fetchPaymentMethods(),
          apiService.fetchInternationalBillingStatus(),
          apiService.fetchBillingTransactions(),
          apiService.fetchSubscriptionDetails()
        ]);

        if (isMounted) {
          if (methodsRes.status === 'fulfilled' && methodsRes.value?.paymentMethods) {
            setSavedMethods(methodsRes.value.paymentMethods);
          }
          if (statusRes.status === 'fulfilled' && statusRes.value) {
            setInternationalStatus(statusRes.value);
          }
          if (txRes.status === 'fulfilled' && txRes.value?.transactions) {
            setTransactions(txRes.value.transactions);
          }
          if (detailsRes.status === 'fulfilled' && detailsRes.value?.success) {
            setSubscriptionDetails(detailsRes.value);
          }
        }
      } catch (err) {
        console.warn('Failed to load billing details', err);
      } finally {
        if (isMounted) {
          setIsLoadingMethods(false);
          setIsLoadingTransactions(false);
        }
      }
    };
    loadBillingData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Calculate days remaining in 14-day trial
  const calculateDaysRemaining = () => {
    if (!currentUser?.trialEndDate) return 14;
    const end = new Date(currentUser.trialEndDate).getTime();
    const now = Date.now();
    const diffDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const daysRemaining = calculateDaysRemaining();

  const formattedTrialEnd = currentUser?.trialEndDate
    ? new Date(currentUser.trialEndDate).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })
    : new Date(Date.now() + 14 * 86400000).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });

  const formattedTrialStart = currentUser?.trialStartDate
    ? new Date(currentUser.trialStartDate).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })
    : new Date().toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });



  // Handle Remove Card
  const handleDeleteCard = async (id: string) => {
    if (!confirm('Are you sure you want to remove this payment method?')) return;
    setIsProcessing(true);
    try {
      const res = await apiService.deletePaymentMethod(id);
      if (res.paymentMethods) {
        setSavedMethods(res.paymentMethods);
      } else {
        setSavedMethods((prev) => prev.filter((m) => m.id !== id));
      }

      if (res.user && onUpdateUser) {
        authService.setCurrentUser(res.user);
        onUpdateUser(res.user);
      }

      onShowToast('Payment method removed.', 'info');
    } catch (err: any) {
      onShowToast(err.message || 'Failed to remove payment method.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Set Default Card
  const handleSetDefault = async (id: string) => {
    setIsProcessing(true);
    try {
      const res = await apiService.setDefaultPaymentMethod(id);
      if (res.paymentMethods) {
        setSavedMethods(res.paymentMethods);
      } else {
        setSavedMethods((prev) =>
          prev.map((m) => ({
            ...m,
            isDefault: m.id === id
          }))
        );
      }
      if (res.user && onUpdateUser) {
        authService.setCurrentUser(res.user);
        onUpdateUser(res.user);
      }
      onShowToast('Default payment method updated.', 'success');
    } catch (err: any) {
      onShowToast(err.message || 'Failed to update default card.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Plan Upgrade
  const handleUpgradePlan = async (targetPlan: 'growth' | 'pro') => {
    setIsProcessing(true);
    try {
      const res = await apiService.upgradePlan(targetPlan, undefined, activeEdition);
      if (res.user) {
        authService.setCurrentUser(res.user);
        if (onUpdateUser) onUpdateUser(res.user);
      }
      await refreshSubscriptionDetails();
      const targetPriceLabel = getPlanPricing(targetPlan, activeEdition).monthly.formatted;
      onShowToast(
        `Upgraded to ${targetPlan === 'growth' ? `Growth (${targetPriceLabel})` : 'Enterprise ($349/month)'} (${editionLabel}).`,
        'success'
      );
    } catch (err: any) {
      onNavigate('pricing', { plan: targetPlan });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Edition Upgrade (Founding Member Edition -> Standard on verified workspace)
  const handleUpgradeEdition = async (targetEdition: PlanEdition) => {
    setIsProcessing(true);
    try {
      const res = await apiService.upgradePlanEdition(targetEdition);
      if (res?.success) {
        if (currentUser) {
          const updated = {
            ...currentUser,
            planEdition: targetEdition,
            planEditionLabel: getEditionLabel(targetEdition),
            ...(res.agreedPriceUsd ? { planPrice: res.agreedPriceUsd } : {})
          };
          authService.setCurrentUser(updated);
          if (onUpdateUser) onUpdateUser(updated);
        }
        await refreshSubscriptionDetails();
        onShowToast(res.message || `Switched to ${getEditionLabel(targetEdition)}. Higher limits unlocked!`, 'success');
      } else {
        onShowToast(res?.error || 'Could not switch plan edition.', 'error');
      }
    } catch (err: any) {
      onShowToast(err.message || 'Please complete Razorpay checkout at Standard pricing to upgrade editions.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Retry / Setup Recurring Autopay Authorization without duplicating $1 charge
  const handleRetryAutopaySubmit = async () => {
    if (!retryConsentAccepted) {
      onShowToast('Please accept the recurring Autopay authorization disclosure to proceed.', 'error');
      return;
    }
    setIsProcessing(true);
    try {
      const retryRes = await apiService.retryMandateAuthorization({
        tier: normTier,
        billing_cycle: billingCycle,
        planEdition: activeEdition,
        consentAccepted: true
      });
      if (!retryRes.success || !retryRes.subscriptionId) {
        throw new Error(retryRes.error || 'Failed to initialize recurring Autopay mandate.');
      }

      const sdkReady = await ensureRazorpaySdk();
      if (!sdkReady || typeof (window as any).Razorpay === 'undefined') {
        onShowToast('Razorpay Checkout SDK could not load. Please check your connection and try again.', 'error');
        setIsProcessing(false);
        return;
      }

      setShowRetryAutopayModal(false);
      const options = buildRazorpaySubscriptionOptions({
        keyId: retryRes.keyId,
        subscriptionId: retryRes.subscriptionId,
        planName: `${normTier.toUpperCase()} (${editionLabel})`,
        description: retryRes.verification_fee_waived
          ? `Authorize Recurring Card Autopay ($1 fee waived) — ${normTier.toUpperCase()}`
          : `Authorize $1.00 USD Card & Recurring Autopay — ${normTier.toUpperCase()}`,
        customerName: currentUser?.name || 'SaaS Founder',
        customerEmail: currentUser?.email || 'founder@example.com',
        cardOnly: true,
        handler: async (response: any) => {
          try {
            const verifyRes = await apiService.verifyTrialPayment({
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });
            if (verifyRes.success) {
              authService.updateSubscriptionState('trialing', normTier, {
                planEdition: (verifyRes.plan_edition as PlanEdition) || activeEdition,
                autopayStatus: verifyRes.autopay_status || (verifyRes.autopay_authorized ? 'authenticated' : 'pending'),
                trialEndDate: verifyRes.trial_ends_at
              });
              await refreshSubscriptionDetails();
              if (verifyRes.autopay_authorized) {
                onShowToast('Recurring card Autopay mandate authorized!', 'success');
              } else {
                onShowToast(verifyRes.message || 'Verification processed; Autopay still pending authorization.', 'info');
              }
            } else {
              onShowToast(verifyRes.error || 'Autopay verification failed.', 'error');
            }
          } catch (verErr: any) {
            onShowToast(verErr?.message || 'Error verifying Autopay mandate.', 'error');
          } finally {
            setIsProcessing(false);
            setRetryConsentAccepted(false);
          }
        },
        onDismiss: () => {
          setIsProcessing(false);
          onShowToast('Autopay authorization cancelled before completion.', 'info');
        }
      });

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        setIsProcessing(false);
        onShowToast(resp?.error?.description || 'Card Autopay authorization failed or was declined.', 'error');
      });
      rzp.open();
    } catch (err: any) {
      setIsProcessing(false);
      onShowToast(err.message || 'Failed to retry Autopay authorization.', 'error');
    }
  };

  // Handle Cancel Trial / Subscription
  const handleConfirmCancelTrial = async () => {
    setIsProcessing(true);
    try {
      const res = await apiService.cancelRazorpaySubscription().catch(() => apiService.cancelTrial());
      if (res.user) {
        authService.setCurrentUser(res.user);
        if (onUpdateUser) onUpdateUser(res.user);
      } else if (currentUser && onUpdateUser) {
        onUpdateUser({
          ...currentUser,
          billingStatus: 'cancelled'
        });
      }
      setShowCancelModal(false);
      onShowToast('Your subscription / trial has been canceled. No future charges will occur.', 'info');
    } catch (err: any) {
      onShowToast(err.message || 'Failed to cancel subscription.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Pay / Subscribe with Razorpay (UPI, Cards, Netbanking, Wallets)
  const handlePayWithRazorpay = async (targetPlan: string = 'growth', billingCycle: string = 'monthly') => {
    setIsProcessing(true);
    try {
      onShowToast('Initializing Razorpay secure checkout...', 'info');

      const selectedCycle: 'monthly' | 'annual' = billingCycle === 'annual' ? 'annual' : 'monthly';
      const normalizedTier = (targetPlan === 'starter' || targetPlan === 'pro' ? targetPlan : 'growth') as 'starter' | 'growth' | 'pro';
      const customerName = currentUser?.name || 'SaaS Founder';
      const customerEmail = currentUser?.email || 'founder@example.com';

      const syncActivatedUser = async () => {
        if (currentUser) {
          const updated = {
            ...currentUser,
            selectedPlan: normalizedTier,
            plan: (normalizedTier.charAt(0).toUpperCase() + normalizedTier.slice(1)) as any,
            billingCycle: selectedCycle,
            billingStatus: 'active' as const,
            paymentStatus: 'paid' as const
          };
          authService.setCurrentUser(updated as any);
          if (onUpdateUser) onUpdateUser(updated as any);
        }
        try {
          const txData = await apiService.fetchBillingTransactions();
          if (txData.success && Array.isArray(txData.transactions)) {
            setTransactions(txData.transactions);
          }
        } catch {
          // Non-fatal ledger refresh
        }
      };

      if (selectedCycle === 'annual') {
        // Annual billing uses One-Time Order Checkout Flow
        const orderRes = await apiService.createRazorpayOrder({
          plan: normalizedTier,
          billingCycle: 'annual',
          customerName,
          customerEmail,
          planEdition: activeEdition,
          isFoundingOffer: activeEdition === 'founding'
        });

        if (!orderRes.success) {
          throw new Error(orderRes.error || 'Could not generate Razorpay order');
        }

        const sdkReady = await ensureRazorpaySdk();
        if (!sdkReady || typeof (window as any).Razorpay === 'undefined') {
          onShowToast('Razorpay Checkout SDK could not load. Please check your internet connection and try again.', 'error');
          setIsProcessing(false);
          return;
        }

        const orderCurrency = orderRes.currency || 'INR';
        const authPlan = getAuthoritativePlan(normalizedTier, activeEdition);
        const options = buildRazorpayOneTimeOptions({
          keyId: orderRes.keyId,
          orderId: orderRes.orderId,
          amountCents: orderRes.amount,
          amount: orderRes.amount,
          currency: orderCurrency,
          description: `${authPlan.name.toUpperCase()} (${editionLabel}) - Annual`,
          customerName,
          customerEmail,
          handler: async (response: any) => {
            try {
              const verifyRes = await apiService.verifyRazorpayPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                plan: normalizedTier,
                billingCycle: 'annual',
                amount: orderRes.amount,
                currency: orderCurrency,
                planEdition: activeEdition,
                isFoundingOffer: activeEdition === 'founding',
                email: customerEmail
              });

              if (verifyRes.success) {
                authService.updateSubscriptionState('active', normalizedTier, {
                  planEdition: verifyRes.planEdition || activeEdition,
                  autopayStatus: 'not_established'
                });
                onShowToast(`Annual Razorpay payment verified! Plan upgraded to ${normalizedTier.toUpperCase()} (${editionLabel}).`, 'success');
                await syncActivatedUser();
                await refreshSubscriptionDetails();
              } else {
                onShowToast(verifyRes.error || 'Razorpay signature verification failed.', 'error');
              }
            } catch (err: any) {
              onShowToast('Verification error: ' + err.message, 'error');
            } finally {
              setIsProcessing(false);
            }
          },
          onDismiss: () => {
            setIsProcessing(false);
          }
        });

        const rzpInstance = new (window as any).Razorpay(options);
        rzpInstance.on('payment.failed', (resp: any) => {
          setIsProcessing(false);
          onShowToast(resp?.error?.description || 'Razorpay payment failed or was declined.', 'error');
        });
        rzpInstance.open();
        return;
      }

      // Monthly billing uses Recurring Subscription Card Mandate Flow
      const subRes = await apiService.createRazorpaySubscription({
        tier: normalizedTier,
        billing_cycle: 'monthly',
        planEdition: activeEdition,
        consentAccepted: true
      });

      if (!subRes.success || !subRes.subscriptionId) {
        throw new Error(subRes.error || 'Failed to initialize Razorpay subscription');
      }

      const sdkReady = await ensureRazorpaySdk();
      if (!sdkReady || typeof (window as any).Razorpay === 'undefined') {
        onShowToast('Razorpay Checkout SDK could not load. Please check your internet connection and try again.', 'error');
        setIsProcessing(false);
        return;
      }

      const options = buildRazorpaySubscriptionOptions({
        keyId: subRes.keyId,
        subscriptionId: subRes.subscriptionId,
        planName: `${getAuthoritativePlan(normalizedTier, activeEdition).name.toUpperCase()} (${editionLabel})`,
        customerName,
        customerEmail,
        cardOnly: true,
        handler: async (response: any) => {
          try {
            const verifyRes = await apiService.verifyRazorpaySubscription({
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              tier: normalizedTier,
              billing_cycle: 'monthly',
              planEdition: activeEdition,
              email: customerEmail
            });

            if (verifyRes.success) {
              onShowToast(`Monthly recurring card subscription verified for ${normalizedTier.toUpperCase()} (${editionLabel})!`, 'success');
              await syncActivatedUser();
              await refreshSubscriptionDetails();
            } else {
              onShowToast(verifyRes.error || 'Recurring subscription verification failed.', 'error');
            }
          } catch (err: any) {
            onShowToast('Verification error: ' + err.message, 'error');
          } finally {
            setIsProcessing(false);
          }
        },
        onDismiss: () => {
          setIsProcessing(false);
        }
      });

      const rzpInstance = new (window as any).Razorpay(options);
      rzpInstance.on('payment.failed', (resp: any) => {
        setIsProcessing(false);
        onShowToast(resp?.error?.description || 'Subscription mandate authorization failed.', 'error');
      });
      rzpInstance.open();
    } catch (err: any) {
      setIsProcessing(false);
      onShowToast(err.message || 'Razorpay payment could not be initiated.', 'error');
    }
  };

  // Card brand badge helper
  const renderBrandIcon = (brand: string) => {
    const b = brand.toLowerCase();
    if (b.includes('visa')) {
      return (
        <span className="font-black italic text-blue-800 tracking-tighter text-sm bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
          VISA
        </span>
      );
    }
    if (b.includes('master')) {
      return (
        <span className="font-extrabold text-orange-700 text-xs bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
          MC
        </span>
      );
    }
    if (b.includes('amex') || b.includes('american')) {
      return (
        <span className="font-bold text-sky-800 text-xs bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
          AMEX
        </span>
      );
    }
    return (
      <span className="font-medium text-gray-700 text-xs bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
        CARD
      </span>
    );
  };

  const defaultMethod = savedMethods.find((m) => m.isDefault) || savedMethods[0];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Billing & Subscription</h1>
          <p className="text-xs text-gray-600 mt-1">
            Manage your plan, review trial status, add payment methods, and monitor subscription health.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('pricing')}
            className="px-3.5 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <span>Compare All Plans</span>
            <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Trial Status Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-6 bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white border-b border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-900 bg-blue-100/90 px-2.5 py-0.5 rounded-md border border-blue-200">
                  {normTier.toUpperCase()} · {editionLabel}
                </span>
                <span
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-md border ${
                    isCanceled
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : isTrial
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  {isCanceled
                    ? 'Trial Canceled'
                    : isTrial
                    ? (hasPaymentMethod ? 'Trial Active ($1 Verified)' : 'Trialing / Verification Pending')
                    : 'Active Subscription'}
                </span>

                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                    autopayAuthorized
                      ? 'text-emerald-800 bg-emerald-100/90 border-emerald-200'
                      : rawAutopayStatus === 'failed'
                      ? 'text-red-800 bg-red-100 border-red-200'
                      : 'text-amber-900 bg-amber-100 border-amber-200'
                  }`}
                >
                  {autopayAuthorized ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Autopay {String(rawAutopayStatus).toUpperCase()}</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3 h-3 text-amber-700" />
                      <span>Autopay: {String(rawAutopayStatus).replace(/_/g, ' ').toUpperCase()}</span>
                    </>
                  )}
                </span>
              </div>

              <h2 className="text-xl font-bold text-gray-900">
                {currentPlanPricing.displayName} ({editionLabel})
              </h2>

              <p className="text-xs text-gray-600 max-w-xl">
                {isCanceled
                  ? 'Your trial has been canceled. You can reactivate anytime to resume automated churn monitoring.'
                  : isTrial
                  ? autopayAuthorized
                    ? `Your 14-day free trial and recurring USD card Autopay mandate are authorized. Automatic billing ($${displayPlanPrice}${pricePeriodLabel}) starts on ${formattedTrialEnd} unless cancelled.`
                    : hasPaymentMethod
                    ? `Your $1 verification payment was recorded, but recurring Autopay is currently ${String(rawAutopayStatus).replace(/_/g, ' ')}. Authorize recurring Autopay below so service continues uninterrupted after ${formattedTrialEnd}.`
                    : `No verification or recurring mandate is attached yet. Complete $1.00 USD card verification & Autopay authorization before ${formattedTrialEnd}.`
                  : autopayAuthorized
                  ? 'Your subscription and recurring USD card Autopay mandate are active.'
                  : 'Your subscription access is active. Recurring Autopay authorization can be configured below.'}
              </p>
            </div>

            {/* Price badge */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs md:text-right shrink-0">
              <div className="text-xs text-gray-500 font-medium">{editionMarketing.badge}</div>
              <div className="text-3xl font-black text-gray-900 mt-0.5">
                ${displayPlanPrice}
                <span className="text-xs font-semibold text-gray-500">{pricePeriodLabel}</span>
              </div>
              <div className="text-[11px] font-semibold text-emerald-700 mt-1 flex items-center gap-1 md:justify-end">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>{isTrial ? '14-day trial window' : 'Billed in USD'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 p-6 bg-white text-xs">
          <div className="pb-4 sm:pb-0 sm:pr-4">
            <span className="text-gray-500 font-medium">Billing &amp; Autopay Status</span>
            <div className="mt-1 text-sm font-bold text-gray-900 flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isCanceled ? 'bg-red-500' : autopayAuthorized ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                }`}
              />
              <span>
                {isCanceled
                  ? 'Canceled'
                  : autopayAuthorized
                  ? 'Autopay Authorized'
                  : hasPaymentMethod
                  ? '$1 Verified · Autopay Pending'
                  : 'Verification Pending'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              {autopayAuthorized
                ? 'Recurring card mandate verified with Razorpay'
                : subscriptionDetails?.autopay?.failureReason
                ? `Reason: ${subscriptionDetails.autopay.failureReason}`
                : 'Recurring card mandate not established yet'}
            </p>
          </div>

          <div className="py-4 sm:py-0 sm:px-4">
            <span className="text-gray-500 font-medium">Days Remaining</span>
            <div className="mt-1 text-sm font-bold text-blue-950 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-700" />
              <span>{isCanceled ? '0 days' : `Days Remaining: ${daysRemaining} days`}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Trial window: {formattedTrialStart} – {formattedTrialEnd}
            </p>
          </div>

          <div className="pt-4 sm:pt-0 sm:pl-4">
            <span className="text-gray-500 font-medium">Authorized Mandate / Method</span>
            <div className="mt-1 text-sm font-bold text-gray-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-gray-400" />
              <span>
                {defaultMethod?.last4
                  ? `${defaultMethod.brand.toUpperCase()} •••• ${defaultMethod.last4}`
                  : currentUser?.cardLast4
                  ? `${(currentUser.cardBrand || 'Card').toUpperCase()} •••• ${currentUser.cardLast4}`
                  : autopayAuthorized
                  ? `${(subscriptionDetails?.autopay?.paymentMethodType || 'Card').toUpperCase()} Mandate On File`
                  : hasPaymentMethod
                  ? '$1 Paid (No Recurring Token)'
                  : 'None on file'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              {autopayAuthorized
                ? `Token: ${subscriptionDetails?.autopay?.tokenId || subscriptionDetails?.autopay?.mandateId || 'Verified'}`
                : 'Authorize a card mandate via Razorpay Checkout'}
            </p>
          </div>
        </div>

        {/* Recurring Autopay Mandate & Edition Entitlements Summary */}
        <div className="px-6 py-4 bg-slate-50 border-t border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-900">Plan Edition &amp; Active Entitlements</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200">
                {editionLabel}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
              <div>Customers: <strong className="text-gray-900">{activeLimits.customers === Infinity ? 'Unlimited' : activeLimits.customers.toLocaleString()}</strong></div>
              <div>Daily Scans: <strong className="text-gray-900">{activeLimits.aiScansPerDay === Infinity ? 'Unlimited' : `${activeLimits.aiScansPerDay}/day`}</strong></div>
              <div>Top Priorities: <strong className="text-gray-900">Top {activeLimits.topAtRiskCustomers}</strong></div>
              <div>Messages/mo: <strong className="text-gray-900">{activeLimits.aiRetentionMessagesPerMonth.toLocaleString()}</strong></div>
              <div>Team Seats: <strong className="text-gray-900">{activeLimits.teamMembers}</strong></div>
              <div>Auto Scheduler: <strong className="text-gray-900">{activeLimits.advancedAutomation ? 'Enabled' : 'Manual only'}</strong></div>
            </div>
            {activeEdition === 'founding' && normTier !== 'pro' && !isCanceled && (
              <button
                type="button"
                id="upgrade-edition-standard-btn"
                disabled={isProcessing}
                onClick={() => handleUpgradeEdition('standard')}
                className="w-full mt-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>
                  {currentPlanMonthlyPrice === standardPlanPricing.monthly.amountUsd
                    ? `Upgrade Founding Member → Standard (Same $${standardPlanPricing.monthly.amountUsd}/mo Rate)`
                    : `Upgrade Founding Member → Standard ($${standardPlanPricing.monthly.amountUsd}/mo Regular Pricing)`}
                </span>
              </button>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-900">Razorpay Autopay Mandate Details</span>
              <span className="text-[10px] font-mono text-gray-500">
                {subscriptionDetails?.subscription?.razorpay_subscription_id || currentUser?.razorpaySubscriptionId || 'No sub ID'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
              <div>Autopay: <strong className="text-gray-900 capitalize">{String(rawAutopayStatus).replace(/_/g, ' ')}</strong></div>
              <div>Method: <strong className="text-gray-900 uppercase">{subscriptionDetails?.autopay?.paymentMethodType || 'Card Only (USD)'}</strong></div>
              <div>Mandate / Token: <strong className="text-gray-900 font-mono">{subscriptionDetails?.autopay?.tokenId || subscriptionDetails?.autopay?.mandateId || 'Pending'}</strong></div>
              <div>Frequency: <strong className="text-gray-900 capitalize">{billingCycle}</strong></div>
              <div className="col-span-2">Next Scheduled Charge: <strong className="text-gray-900">{subscriptionDetails?.autopay?.nextBillingAt ? new Date(subscriptionDetails.autopay.nextBillingAt).toLocaleDateString() : formattedTrialEnd}</strong></div>
            </div>
            {!autopayAuthorized && !isCanceled && (
              <button
                type="button"
                id="retry-autopay-btn"
                disabled={isProcessing}
                onClick={() => setShowRetryAutopayModal(true)}
                className="w-full mt-1 py-2 px-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{hasPaymentMethod ? 'Retry Autopay Authorization ($1 Fee Waived)' : 'Authorize $1.00 USD Card & Autopay'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="p-6 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              id="billing-add-payment-btn"
              onClick={() => setShowAddCardModal(true)}
              className="px-4 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>{hasPaymentMethod ? 'Update Card Mandate' : 'Add Card Mandate'}</span>
            </button>

            <button
              type="button"
              id="billing-upgrade-btn"
              onClick={() => onNavigate('pricing')}
              className="px-4 py-2.5 bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-2"
            >
              <Zap className="w-4 h-4 text-amber-500" />
              <span>Compare Plans &amp; Editions</span>
            </button>

            <button
              type="button"
              id="billing-razorpay-btn"
              onClick={() => handlePayWithRazorpay(normTier, 'monthly')}
              disabled={isProcessing}
              className="px-4 py-2.5 bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-800 hover:to-indigo-900 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center gap-2 border border-blue-900"
            >
              <CreditCard className="w-4 h-4 text-cyan-300" />
              <span>Authorize USD Card Subscription</span>
            </button>
          </div>

          {!isCanceled && isTrial && (
            <button
              type="button"
              id="billing-cancel-trial-btn"
              onClick={() => setShowCancelModal(true)}
              className="px-3.5 py-2 text-xs font-semibold text-red-600 hover:text-red-800 hover:bg-red-50 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <XCircle className="w-4 h-4" />
              <span>Cancel Trial</span>
            </button>
          )}

          <div className="w-full pt-2.5 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-gray-500 gap-1 border-t border-gray-200/60">
            <span>{USD_RECURRING_CARD_DISCLOSURE}</span>
            <span className="text-gray-400 font-medium">Cancel anytime online with 1 click.</span>
          </div>
        </div>
      </div>

      {/* Saved Payment Methods Section */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Saved Payment Methods</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Securely stored in PCI-DSS Level 1 certified vault.
            </p>
          </div>

          <button
            type="button"
            onClick={() => handlePayWithRazorpay(normTier, 'monthly')}
            disabled={isProcessing}
            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add via Razorpay Checkout</span>
          </button>
        </div>

        {savedMethods.length === 0 && !currentUser?.cardLast4 ? (
          <div className="border border-dashed border-gray-200 rounded-xl p-8 text-center space-y-3 bg-gray-50/50">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-900 flex items-center justify-center mx-auto">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900">No payment methods on file</div>
              <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
                Complete secure payment setup directly through Razorpay&apos;s PCI-DSS Level 1 Checkout (cards, UPI AutoPay, netbanking, or wallets). Churnveda never collects or stores raw card numbers or CVV codes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handlePayWithRazorpay(normTier, 'monthly')}
              disabled={isProcessing}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors inline-flex items-center gap-2 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{isProcessing ? 'Opening Razorpay...' : 'Set Up Payment via Razorpay'}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {savedMethods.map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-gray-300 transition-colors bg-white text-xs"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center shrink-0">
                    {renderBrandIcon(method.brand)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 capitalize">
                        {method.brand} ending in •••• {method.last4}
                      </span>
                      {method.isDefault && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-900 text-[10px] font-extrabold rounded-md uppercase tracking-wider">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-gray-500 text-[11px] mt-0.5">
                      Expires {String(method.expMonth).padStart(2, '0')}/{String(method.expYear).slice(-2)}
                      {method.cardholderName ? ` • ${method.cardholderName}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {!method.isDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(method.id)}
                      disabled={isProcessing}
                      className="px-2.5 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                    >
                      Make Default
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDeleteCard(method.id)}
                    disabled={isProcessing}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Delete payment method"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upgrade Options Bento Grid */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
          Upgrade Options: Accelerate Retention
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Growth Tier Card */}
          <div className="bg-white rounded-2xl border-2 border-blue-900/40 p-5 shadow-xs flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-blue-900 text-white text-[10px] font-extrabold uppercase px-3 py-1 rounded-bl-xl tracking-wider">
              Most Popular
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold text-gray-900">Growth Plan</span>
                <span className="text-xs text-blue-900 font-bold bg-blue-50 px-2 py-0.5 rounded">
                  {activeEdition === 'founding' ? '$59/mo Founding · $79/mo Standard' : '$79/month (Standard)'}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                For scaling SaaS teams monitoring up to 1,000 (Founding Member Edition) or 2,500 (Standard) accounts with automated retention workflows.
              </p>

              <ul className="mt-4 space-y-2 text-xs text-gray-700">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-900 shrink-0" />
                  <span>1,000 (Founding) or 2,500 (Standard) customers monitored</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-900 shrink-0" />
                  <span>3–5 scans/day with Top 10–15 daily priorities</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-900 shrink-0" />
                  <span>500 (Founding) to 1,000 (Standard) messages / month</span>
                </li>
              </ul>
            </div>

            <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-[11px] text-gray-500 font-medium">14-day trial available</span>
              <button
                type="button"
                onClick={() => handlePayWithRazorpay('growth', 'monthly')}
                disabled={isProcessing}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span>Upgrade to Growth</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Enterprise Tier Card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-gray-900">Enterprise</span>
                <span className="text-xs text-indigo-900 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                  $349/month
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Unlimited customer monitoring, dedicated onboarding, custom risk rules, and enterprise SLA.
              </p>

              <ul className="mt-4 space-y-2 text-xs text-gray-700">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-900 shrink-0" />
                  <span>Unlimited customer monitoring & scans</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-900 shrink-0" />
                  <span>2,500 retention messages / month</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-900 shrink-0" />
                  <span>Dedicated onboarding & custom integrations</span>
                </li>
              </ul>
            </div>

            <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-[11px] text-gray-500 font-medium">SOC-2 Type II certified</span>
              <button
                type="button"
                onClick={() => handlePayWithRazorpay('pro', 'monthly')}
                disabled={isProcessing}
                className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span>Upgrade to Enterprise</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Accepted Payment Methods and Disclosures */}
        <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 text-xs text-gray-600">
          <div className="flex items-center gap-3 text-gray-700 font-semibold text-xs">
            <span className="text-gray-900 font-bold">USD Recurring Autopay Method:</span>
            <span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5 text-blue-600" /> International &amp; Domestic Cards (Visa / Mastercard / Amex)</span>
          </div>
          <p className="text-[11px] text-gray-500">
            {USD_RECURRING_CARD_DISCLOSURE}
          </p>
        </div>
      </div>

      {/* International Recurring USD Billing & Settlement Notice */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl border border-indigo-800/40 shadow-md p-6 text-white space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">International Recurring USD Billing</h3>
                {internationalStatus?.status === 'active_verified' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active &amp; Verified
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Card Mandate Required for USD
                  </span>
                )}
              </div>
              <p className="text-xs text-indigo-200/80 mt-0.5">
                Transparent USD pricing via Razorpay Subscription Card Mandates (Visa, Mastercard, Amex).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-200 bg-indigo-900/40 px-3 py-1.5 rounded-lg border border-indigo-700/40 shrink-0">
            <span>Export Code:</span>
            <span className="font-bold text-white">{internationalStatus?.purposeCode || 'P0802'} (Software Exports)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
            <span className="text-indigo-200/70 block text-[11px] font-medium">Fixed USD Subscription Plans</span>
            <span className="font-bold text-white text-sm mt-0.5 block">Standard: $29 / $79 / $349 · Founding: $19 / $59</span>
            <span className="text-[11px] text-indigo-300/80 mt-1 block">Prices stay fixed in USD regardless of FX movements</span>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
            <span className="text-indigo-200/70 block text-[11px] font-medium">USD Recurring Method</span>
            <span className="font-bold text-white text-sm mt-0.5 block">International &amp; Domestic Cards Only</span>
            <span className="text-[11px] text-indigo-300/80 mt-1 block">UPI AutoPay does not support USD recurring charges</span>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
            <span className="text-indigo-200/70 block text-[11px] font-medium">Payment Security</span>
            <span className="font-bold text-white text-sm mt-0.5 block">PCI-DSS Level 1 Checkout</span>
            <span className="text-[11px] text-indigo-300/80 mt-1 block">All signatures &amp; webhooks verified cryptographically</span>
          </div>
        </div>
      </div>

      {/* Authoritative Subscription Payments Ledger & Invoices */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Subscription Payments & Settlement Ledger</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Authoritative transaction log of recurring international charges, bank settlements, fees, and taxes.
            </p>
          </div>
          <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
            {transactions.length} {transactions.length === 1 ? 'record' : 'records'} found
          </span>
        </div>

        <div className="border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs divide-y divide-gray-200">
            <thead className="bg-gray-50 text-gray-600 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Razorpay Payment ID</th>
                <th className="py-3 px-4">Subscription ID</th>
                <th className="py-3 px-4">Currency & Amount</th>
                <th className="py-3 px-4">Converted INR</th>
                <th className="py-3 px-4">Fee / Tax</th>
                <th className="py-3 px-4">Settlement Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {transactions.map((tx) => (
                <tr key={tx.id || tx.razorpay_payment_id} className="hover:bg-gray-50/80 transition-colors">
                  <td className="py-3 px-4 font-mono text-[11px] text-gray-500">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-blue-900">
                    {tx.razorpay_payment_id}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-gray-600">
                    {tx.subscription_id}
                  </td>
                  <td className="py-3 px-4 font-bold text-gray-900">
                    ${Number(tx.amount_usd).toFixed(2)} {tx.currency || 'USD'}
                  </td>
                  <td className="py-3 px-4 text-gray-700 font-medium">
                    {tx.converted_inr_amount ? `₹${Number(tx.converted_inr_amount).toFixed(2)}` : 'Pending settlement'}
                  </td>
                  <td className="py-3 px-4 text-[11px] text-gray-500">
                    {tx.fee ? `Fee: ₹${Number(tx.fee).toFixed(2)}` : 'At settlement'}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        tx.settlement_status === 'settled'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : tx.settlement_status === 'failed'
                          ? 'bg-red-100 text-red-800 border border-red-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        tx.settlement_status === 'settled' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`} />
                      {tx.settlement_status === 'settled' ? 'Settled to Bank' : 'Pending Settlement'}
                    </span>
                  </td>
                </tr>
              ))}

              {transactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 px-4 text-center text-xs text-gray-500">
                    No payment transactions recorded yet. Completed Razorpay payments and settlements will appear here automatically.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Payment Method Modal */}
      {showAddCardModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm shadow-xs">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold">Add Payment Method</h4>
                  <p className="text-[10px] text-indigo-200">PCI-DSS Level 1 compliant secure tokenization</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCardModal(false)}
                className="w-7 h-7 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-950 space-y-2 leading-relaxed">
                <div className="flex items-center gap-2 font-bold">
                  <ShieldCheck className="w-4 h-4 text-blue-800 shrink-0" />
                  <span>Hosted PCI-DSS Level 1 Checkout via Razorpay</span>
                </div>
                <p>
                  For your security, Churnveda never collects raw card numbers, expiry dates, or CVC codes on our servers. All cards, UPI AutoPay mandates, netbanking, and wallets are tokenized directly inside Razorpay&apos;s hosted checkout window.
                </p>
              </div>

              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 text-[11px] leading-relaxed">
                <strong>Plan:</strong> {normTier.toUpperCase()} (${currentPlanMonthlyPrice}/mo) · Cancels anytime online under Billing Settings.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddCardModal(false)}
                  className="px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-semibold hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    setShowAddCardModal(false);
                    void handlePayWithRazorpay(normTier, 'monthly');
                  }}
                  className="px-5 py-2.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{isProcessing ? 'Opening Checkout...' : 'Continue to Razorpay Checkout'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Retry / Authorize Recurring Autopay Modal */}
      {showRetryAutopayModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-900" />
                <h4 className="text-sm font-bold text-gray-900">Authorize Recurring USD Card Autopay</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowRetryAutopayModal(false)}
                className="text-gray-400 hover:text-gray-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-950 space-y-1.5 leading-relaxed">
              <div><strong>Plan:</strong> {currentPlanPricing.displayName} ({editionLabel})</div>
              <div><strong>Recurring Rate:</strong> ${displayPlanPrice}{pricePeriodLabel} (USD)</div>
              <div>
                <strong>Today&apos;s Verification Fee:</strong>{' '}
                {hasPaymentMethod ? '$0.00 USD ($1 verification waived — already paid)' : '$1.00 USD refundable verification'}
              </div>
              <div><strong>First Scheduled Renewal:</strong> {formattedTrialEnd}</div>
            </div>

            <label className="flex items-start gap-2 text-[11px] text-gray-800 bg-amber-50 border border-amber-200 rounded-xl p-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={retryConsentAccepted}
                onChange={(e) => setRetryConsentAccepted(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-blue-900 cursor-pointer"
              />
              <span>
                I explicitly authorize Churnveda via Razorpay to establish recurring card Autopay for ${currentPlanMonthlyPrice}/month ({billingCycle}) starting {formattedTrialEnd} until cancelled.
              </span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowRetryAutopayModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 font-semibold hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessing || !retryConsentAccepted}
                onClick={handleRetryAutopaySubmit}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl cursor-pointer"
              >
                {isProcessing ? 'Opening Razorpay...' : 'Authorize Card Autopay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Trial Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200 text-xs">
            <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-gray-900">Cancel 14-Day Free Trial?</h3>
              <p className="text-gray-600">
                You still have <strong className="text-gray-900">{daysRemaining} days remaining</strong> of free
                predictive churn monitoring.
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 space-y-1 text-[11px]">
              <div className="font-bold">What happens next:</div>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>No recurring subscription charges will occur.</li>
                <li>Real-time customer risk telemetry will pause at the end of the day.</li>
                <li>Your customer data will remain safe and exportable.</li>
              </ul>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                Reason for cancellation (optional):
              </label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-xs"
              >
                <option value="">Select a reason...</option>
                <option value="missing_integrations">Missing integrations</option>
                <option value="too_expensive">Price point considerations</option>
                <option value="testing_mvp">Just evaluating the product</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 font-semibold hover:bg-gray-50 cursor-pointer"
              >
                Keep Free Trial
              </button>
              <button
                type="button"
                id="confirm-cancel-trial-btn"
                onClick={handleConfirmCancelTrial}
                disabled={isProcessing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {isProcessing ? 'Canceling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
