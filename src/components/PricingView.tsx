import React, { useState, useEffect, useRef } from 'react';
import {
  Check,
  Zap,
  Sparkles,
  Gift,
  HelpCircle,
  ShieldCheck,
  ArrowRight,
  CreditCard,
  Calendar,
  MessageSquare,
  Building,
  User,
  Mail,
  Lock,
  ExternalLink,
  Smartphone,
  Building2,
  Wallet
} from 'lucide-react';
import { authService } from '../services/authService';
import { apiService } from '../services/api';
import { TrialVerificationModal } from './TrialVerificationModal';
import {
  ONE_TIME_PAYMENT_DISCLOSURE,
  RECURRING_MANDATE_DISCLOSURE,
  buildRazorpayOneTimeOptions,
  buildRazorpaySubscriptionOptions,
  getAuthoritativePlan
} from '../services/razorpayConfig';
import { ensureRazorpaySdk } from '../services/razorpaySdk';

import {
  FOUNDING_OFFER_CONFIG,
  FoundingOfferPlan,
  PlanEdition,
  getEditionLabel,
  getEditionMarketing,
  getEditionPlanFeatures,
  getFoundationVsStandardComparison,
  getPlanLimits,
  getPlanPricing
} from '../config/pricing';

interface PricingTierConfig {
  id: 'starter' | 'growth' | 'pro';
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  annualTotalPrice: number;
  monthlyPriceInr: number;
  annualPriceInr: number;
  annualTotalPriceInr: number;
  annualSavingsBadge: string;
  annualSavingsBadgeInr: string;
  customersIncluded: string;
  description: string;
  isPopular?: boolean;
  features: string[];
  foundingOffer: FoundingOfferPlan;
}

function buildPricingTiersConfig(edition: PlanEdition): PricingTierConfig[] {
  return (['starter', 'growth', 'pro'] as const).map((tierId) => {
    const p = getPlanPricing(tierId, edition);
    return {
      id: tierId,
      name: p.displayName,
      monthlyPrice: p.monthly.amountUsd,
      annualPrice: p.annual.monthlyEquivalentUsd,
      annualTotalPrice: p.annual.totalAmountUsd,
      monthlyPriceInr: p.monthly.amountInr,
      annualPriceInr: p.annual.monthlyEquivalentInr,
      annualTotalPriceInr: p.annual.totalAmountInr,
      annualSavingsBadge: p.annual.savingsBadge,
      annualSavingsBadgeInr: p.annual.savingsBadgeInr,
      customersIncluded: p.customersIncluded,
      description: p.description,
      isPopular: p.isPopular,
      features: p.features,
      foundingOffer: FOUNDING_OFFER_CONFIG[tierId]
    };
  });
}

interface PricingViewProps {
  onSelectPlan?: (tierId: string) => void;
  onNavigate?: (view: string, params?: Record<string, string>) => void;
  onShowToast?: (message: string, type?: 'success' | 'info' | 'error') => void;
  initialPlan?: string;
  routeParams?: Record<string, string>;
}

export const PricingView: React.FC<PricingViewProps> = ({
  onSelectPlan,
  onNavigate,
  onShowToast,
  initialPlan = 'growth',
  routeParams
}) => {
  const currentUser = authService.getCurrentUser();
  const isTrialExpired =
    routeParams?.expired === 'true' ||
    currentUser?.billingStatus === 'trial_expired' ||
    Boolean(currentUser?.trialEndDate && new Date(currentUser.trialEndDate).getTime() <= Date.now() && currentUser.billingStatus !== 'active');

  // Annual toggle: false = Monthly, true = Annual (10 months price, 2 months free)
  const [isAnnual, setIsAnnual] = useState<boolean>(false);
  // Currency toggle: USD (International billing currency) vs INR (Indian display/billing currency)
  const [currency, setCurrency] = useState<'USD' | 'INR'>(() => {
    try {
      const stored = localStorage.getItem('churnveda_billing_currency');
      if (stored === 'INR' || stored === 'USD') return stored;
    } catch {}
    return 'USD';
  });

  const handleCurrencyToggle = (curr: 'USD' | 'INR') => {
    setCurrency(curr);
    try {
      localStorage.setItem('churnveda_billing_currency', curr);
    } catch {}
  };

  // Edition mode: 'standard' is default for new customers; 'founding' is exclusive to eligible early customers
  const [offerMode, setOfferMode] = useState<PlanEdition>('standard');
  const [foundingEligibility, setFoundingEligibility] = useState<{
    eligible: boolean;
    enabled: boolean;
    isExistingFounding: boolean;
  }>({
    eligible: false,
    enabled: false,
    isExistingFounding: currentUser?.planEdition === 'founding'
  });
  const [comparisonTier, setComparisonTier] = useState<'starter' | 'growth'>('starter');
  // Pre-selected plan persists after toggle
  const [selectedPlan, setSelectedPlan] = useState<string>(initialPlan || 'growth');

  // Inline form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [salesNotes, setSalesNotes] = useState('');
  const [salesConsent, setSalesConsent] = useState(false);
  const [inlineConsent, setInlineConsent] = useState(false);
  const [calendlyModalOpen, setCalendlyModalOpen] = useState(false);
  const [verificationModalOpen, setVerificationModalOpen] = useState(false);
  const [verificationTier, setVerificationTier] = useState<'starter' | 'growth' | 'pro'>('growth');
  const [exchangeRate, setExchangeRate] = useState<number>(86.85);
  const [displayRate, setDisplayRate] = useState<string>('1 USD = ₹86.85');

  React.useEffect(() => {
    apiService.fetchExchangeRate().then(res => {
      if (res.rate) {
        setExchangeRate(res.rate);
        setDisplayRate(res.displayRate || `1 USD = ₹${res.rate.toFixed(2)}`);
      }
    }).catch(() => {});

    apiService.fetchRazorpayConfig().then(cfg => {
      if (cfg?.foundingEligibility) {
        setFoundingEligibility(cfg.foundingEligibility);
        const requestedFounding =
          routeParams?.edition === 'founding' ||
          routeParams?.offer === 'founding';
        if (requestedFounding && (cfg.foundingEligibility.eligible || cfg.foundingEligibility.isExistingFounding)) {
          setOfferMode('founding');
        } else if (!cfg.foundingEligibility.eligible && !cfg.foundingEligibility.isExistingFounding) {
          setOfferMode('standard');
        }
      }
    }).catch(() => {});
  }, []);

  // Referral link state
  const [copiedReferral, setCopiedReferral] = useState(false);
  const currentUserProfile = authService.getCurrentUser();
  const referralLink = currentUserProfile?.referralCode
    ? `https://churnveda.com/ref/${currentUserProfile.referralCode}`
    : 'https://churnveda.com/signup';

  const signupFormRef = useRef<HTMLDivElement>(null);

  const canSelectFounding = foundingEligibility.eligible || foundingEligibility.isExistingFounding;
  const pricingTiersConfig = buildPricingTiersConfig(offerMode);

  // Active tier object based on current selectedPlan and active edition
  const activeTier = pricingTiersConfig.find((t) => t.id === selectedPlan) || pricingTiersConfig[1];

  // Active price in dollars (for charge / query params)
  const activeChargePrice = isAnnual ? activeTier.annualTotalPrice : activeTier.monthlyPrice;

  // Dedicated $1 Verification checkout launcher
  const handleStartTrialVerification = (planId: 'starter' | 'growth' | 'pro') => {
    setSelectedPlan(planId);
    setVerificationTier(planId);
    setVerificationModalOpen(true);
    if (onSelectPlan) {
      onSelectPlan(planId);
    }
  };

  // Plan Selection handler
  const handleSelectPlan = async (planId: string, triggerVerification: boolean = false) => {
    setSelectedPlan(planId);
    try {
      localStorage.setItem('churnveda_selected_plan', planId);
      localStorage.setItem('nochurn_selected_plan', planId);
    } catch (e) {
      // Ignored
    }
    if (onSelectPlan) {
      onSelectPlan(planId);
    }

    const tier = pricingTiersConfig.find((t) => t.id === planId) || pricingTiersConfig[1];
    const priceVal = isAnnual ? tier.annualTotalPrice : tier.monthlyPrice;
    const billingVal = isAnnual ? 'annual' : 'monthly';

    // Auto-fill hidden input fields in DOM immediately
    const planInputs = document.querySelectorAll('input[name="plan"]');
    planInputs.forEach((el) => {
      (el as HTMLInputElement).value = planId;
    });
    const priceInputs = document.querySelectorAll('input[name="price"]');
    priceInputs.forEach((el) => {
      (el as HTMLInputElement).value = String(priceVal);
    });
    const cycleInputs = document.querySelectorAll('input[name="billing-cycle"]');
    cycleInputs.forEach((el) => {
      (el as HTMLInputElement).value = billingVal;
    });

    if (triggerVerification) {
      handleStartTrialVerification(planId as 'starter' | 'growth' | 'pro');
    }
  };

  // Direct redirection to /signup?plan=...&price=...
  const handleRedirectToSignup = () => {
    const effectiveEdition: PlanEdition = selectedPlan === 'pro' ? 'standard' : offerMode;
    const priceVal = isAnnual ? activeTier.annualTotalPrice : activeTier.monthlyPrice;
    const billingVal = isAnnual ? 'annual' : 'monthly';
    const isPlanFounding = effectiveEdition === 'founding';
    const queryParams: Record<string, string> = {
      plan: selectedPlan,
      price: String(priceVal),
      billing: billingVal,
      edition: effectiveEdition,
      ...(isPlanFounding ? { offer: 'founding' } : {})
    };
    if (onNavigate) {
      onNavigate('signup', queryParams);
    } else {
      window.location.hash = `#signup?plan=${selectedPlan}&price=${priceVal}&billing=${billingVal}&edition=${effectiveEdition}${isPlanFounding ? '&offer=founding' : ''}`;
    }
  };

  // Instant checkout via Razorpay
  const handleRazorpayCheckout = async (planId: string) => {
    const selectedCycle: 'monthly' | 'annual' = isAnnual ? 'annual' : 'monthly';
    const isFoundingEligible = offerMode === 'founding';

    if (!authService.isAuthenticated() && !authService.getCurrentUser()) {
      setSelectedPlan(planId);
      authService.setPendingPlan({ tier: planId, billingCycle: selectedCycle, planEdition: offerMode });
      if (onShowToast) {
        onShowToast('Please create an account or sign in to complete your Razorpay checkout.', 'info');
      }
      handleRedirectToSignup();
      return;
    }

    const currentUser = authService.getCurrentUser();
    const customerName = name.trim() || currentUser?.name || 'SaaS Founder';
    const customerEmail = email.trim() || currentUser?.email || 'founder@example.com';

    setIsSubmitting(true);
    try {
      if (onShowToast) onShowToast('Connecting to Razorpay payment gateway...', 'info');

      if (selectedCycle === 'annual') {
        // Annual billing uses the One-Time Order Checkout Flow (UPI, Cards, Netbanking, Wallets)
        const orderRes = await apiService.createRazorpayOrder({
          plan: planId,
          billingCycle: 'annual',
          customerName,
          customerEmail,
          isFoundingOffer: isFoundingEligible,
          planEdition: offerMode
        });

        if (!orderRes.success) {
          throw new Error(orderRes.error || 'Failed to initialize Razorpay order');
        }

        const sdkReady = await ensureRazorpaySdk();
        if (!sdkReady || typeof (window as any).Razorpay === 'undefined') {
          if (onShowToast) {
            onShowToast('Razorpay Checkout SDK could not load. Please check your internet connection and try again.', 'error');
          }
          setIsSubmitting(false);
          return;
        }

        const orderCurrency = orderRes.currency || 'INR';
        const options = buildRazorpayOneTimeOptions({
          keyId: orderRes.keyId,
          orderId: orderRes.orderId,
          amountCents: orderRes.amount,
          amount: orderRes.amount,
          currency: orderCurrency,
          description: `${getAuthoritativePlan(planId, offerMode).name.toUpperCase()} (${getEditionLabel(offerMode)}) - Annual`,
          customerName,
          customerEmail,
          handler: async (response: any) => {
            try {
              const verifyRes = await apiService.verifyRazorpayPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                plan: planId,
                billingCycle: 'annual',
                amount: orderRes.amount,
                currency: orderCurrency,
                isFoundingOffer: isFoundingEligible,
                planEdition: offerMode,
                email: customerEmail
              });

              if (verifyRes.success) {
                authService.updateSubscriptionState('active', planId as 'starter' | 'growth' | 'pro', {
                  planEdition: offerMode,
                  autopayStatus: 'not_established'
                });
                authService.clearPendingPlan();
                if (onShowToast) {
                  onShowToast(`Annual Razorpay payment verified! Upgraded to ${planId.toUpperCase()} (${getEditionLabel(offerMode)}).`, 'success');
                }
                if (onNavigate) onNavigate('dashboard');
              } else {
                if (onShowToast) onShowToast(verifyRes.error || 'Payment signature verification failed.', 'error');
              }
            } catch (verErr: any) {
              if (onShowToast) onShowToast('Verification error: ' + verErr.message, 'error');
            } finally {
              setIsSubmitting(false);
            }
          },
          onDismiss: () => {
            setIsSubmitting(false);
          }
        });

        const rzp = new (window as any).Razorpay(options);
        rzp.on('payment.failed', (resp: any) => {
          setIsSubmitting(false);
          if (onShowToast) {
            onShowToast(resp?.error?.description || 'Razorpay payment failed or was declined.', 'error');
          }
        });
        rzp.open();
        return;
      }

      // Monthly billing uses Recurring Subscription Card Mandate Flow
      const subRes = await apiService.createRazorpaySubscription({
        tier: planId as 'starter' | 'growth' | 'pro',
        billing_cycle: 'monthly',
        isFoundingOffer: isFoundingEligible,
        planEdition: offerMode,
        consentAccepted: true
      });

      if (!subRes.success || !subRes.subscriptionId) {
        throw new Error(subRes.error || 'Failed to initialize recurring subscription');
      }

      const sdkReady = await ensureRazorpaySdk();
      if (!sdkReady || typeof (window as any).Razorpay === 'undefined') {
        if (onShowToast) {
          onShowToast('Razorpay Checkout SDK could not load. Please check your internet connection and try again.', 'error');
        }
        setIsSubmitting(false);
        return;
      }

      const options = buildRazorpaySubscriptionOptions({
        keyId: subRes.keyId,
        subscriptionId: subRes.subscriptionId,
        planName: `${getAuthoritativePlan(planId, offerMode).name.toUpperCase()} (${getEditionLabel(offerMode)})`,
        customerName,
        customerEmail,
        cardOnly: true,
        handler: async (response: any) => {
          try {
            const verifyRes = await apiService.verifyRazorpaySubscription({
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              tier: planId,
              billing_cycle: 'monthly',
              isFoundingOffer: isFoundingEligible,
              planEdition: offerMode,
              email: customerEmail
            });

            if (verifyRes.success) {
              authService.updateSubscriptionState('active', planId as 'starter' | 'growth' | 'pro', {
                planEdition: verifyRes.planEdition || offerMode,
                autopayStatus: (verifyRes.autopay_status as any) || 'active'
              });
              authService.clearPendingPlan();
              if (onShowToast) {
                onShowToast(`Monthly recurring subscription activated for ${planId.toUpperCase()} (${getEditionLabel(offerMode)})!`, 'success');
              }
              if (onNavigate) onNavigate('dashboard');
            } else {
              if (onShowToast) onShowToast(verifyRes.error || 'Subscription verification failed.', 'error');
            }
          } catch (verErr: any) {
            if (onShowToast) onShowToast('Verification error: ' + verErr.message, 'error');
          } finally {
            setIsSubmitting(false);
          }
        },
        onDismiss: () => {
          setIsSubmitting(false);
        }
      });

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        setIsSubmitting(false);
        if (onShowToast) {
          onShowToast(resp?.error?.description || 'Subscription mandate authorization failed.', 'error');
        }
      });
      rzp.open();
    } catch (err: any) {
      setIsSubmitting(false);
      if (onShowToast) onShowToast(err.message || 'Razorpay checkout failed.', 'error');
    }
  };

  // Submit inline signup form
  const handleInlineSignupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !company.trim() || !password.trim()) {
      if (onShowToast) onShowToast('Please fill in all required fields.', 'error');
      return;
    }
    if (!inlineConsent) {
      if (onShowToast) onShowToast('Please agree to the Terms of Service and Privacy Policy to continue.', 'error');
      return;
    }

    setIsSubmitting(true);
    setTimeout(async () => {
      const res = await authService.signup({
        name,
        email,
        company,
        password,
        plan: selectedPlan,
        planEdition: offerMode,
        billingCycle: isAnnual ? 'annual' : 'monthly'
      });
      setIsSubmitting(false);

      if (res.success) {
        if (onShowToast) {
          onShowToast(`Account created for ${activeTier.name} Plan! Check your email to verify.`, 'success');
        }
        if (onNavigate) {
          onNavigate('login', { email, plan: selectedPlan, verified: 'false' });
        }
      } else {
        if (onShowToast) onShowToast(res.message, 'error');
      }
    }, 500);
  };

  // Submit Pro sales contact
  const handleSalesContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !company.trim()) {
      if (onShowToast) onShowToast('Please complete name, email, and company.', 'error');
      return;
    }
    if (!salesConsent) {
      if (onShowToast) onShowToast('Please check the consent box to submit your demo request.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiService.submitContactForm({
        name: name.trim(),
        email: email.trim(),
        company: company.trim(),
        message: salesNotes.trim() || 'Enterprise Pro Plan demo inquiry',
        consent: salesConsent
      });
      if (res?.success) {
        if (onShowToast) {
          onShowToast('Sales request received! A Senior Enterprise Architect will reach out within 2 hours.', 'success');
        }
        setName('');
        setEmail('');
        setCompany('');
        setSalesNotes('');
        setSalesConsent(false);
      } else {
        if (onShowToast) onShowToast(res?.error || 'Failed to submit sales inquiry.', 'error');
      }
    } catch (err: any) {
      if (onShowToast) onShowToast(err?.message || 'Failed to submit sales inquiry.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyReferral = () => {
    navigator.clipboard.writeText(referralLink);
    setCopiedReferral(true);
    if (onShowToast) onShowToast('Referral link copied to clipboard.', 'success');
    setTimeout(() => setCopiedReferral(false), 2500);
  };

  return (
    <div className="space-y-12 pb-12">
      {/* Header & Value Proposition */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        {/* Trial Expired Upgrade Screen (Requirement 4) */}
        {isTrialExpired && (
          <div className="p-6 bg-amber-50 border-2 border-amber-300 rounded-2xl text-center space-y-2 shadow-sm animate-in fade-in duration-200 mb-6">
            <div className="inline-flex items-center justify-center p-2.5 bg-amber-100 text-amber-800 rounded-full mb-1">
              <ShieldCheck className="w-6 h-6 text-amber-800" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-amber-950">
              Your 14-day free trial has ended.
            </h2>
            <p className="text-sm text-amber-800 font-semibold max-w-md mx-auto">
              Choose a plan to continue using Churnveda. All customer data, risk analytics, and retention drafts are safely preserved.
            </p>
          </div>
        )}

        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-900 bg-blue-50 px-3.5 py-1 rounded-full border border-blue-200 shadow-2xs">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
          Predictive Retention Pricing
        </span>
        <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">
          Save 1 customer, pay for your whole year.
        </h1>
        <p className="text-xs sm:text-sm text-gray-600 max-w-xl mx-auto">
          All plans include an automated <strong>14-day free trial</strong> with instant Razorpay, Mixpanel, and Intercom telemetry synchronization.
        </p>

        {/* Billing Interval & Currency Switchers */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          {/* Monthly vs Annual Toggle (2 months free) */}
          <div className="flex items-center gap-2.5 p-1.5 bg-gray-100 rounded-xl border border-gray-200 shadow-2xs">
            <button
              type="button"
              onClick={() => setIsAnnual(false)}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                !isAnnual
                  ? 'bg-white text-gray-900 shadow-xs ring-1 ring-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setIsAnnual(true)}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                isAnnual
                  ? 'bg-[#1E3A8A] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>Annual</span>
              <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ${
                isAnnual ? 'bg-emerald-400 text-slate-950' : 'bg-emerald-100 text-emerald-800'
              }`}>
                2 months free
              </span>
            </button>
          </div>

          {/* USD ($) International vs INR (₹) India Currency Selector */}
          <div className="flex items-center gap-2.5 p-1.5 bg-blue-50 rounded-xl border border-blue-200 shadow-2xs">
            <button
              type="button"
              onClick={() => handleCurrencyToggle('USD')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                currency === 'USD'
                  ? 'bg-[#1E3A8A] text-white shadow-xs'
                  : 'text-blue-900 hover:text-blue-950'
              }`}
            >
              <span>$ USD</span>
              <span className="text-[10px] opacity-80">(International)</span>
            </button>
            <button
              type="button"
              onClick={() => handleCurrencyToggle('INR')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                currency === 'INR'
                  ? 'bg-[#1E3A8A] text-white shadow-xs'
                  : 'text-blue-900 hover:text-blue-950'
              }`}
            >
              <span>₹ INR</span>
              <span className="text-[10px] opacity-80">(India · Fixed)</span>
            </button>
          </div>
        </div>

        <p className="text-[11px] text-gray-500 max-w-lg mx-auto">
          {currency === 'INR'
            ? 'Fixed published INR rates for Indian customers via Razorpay. Annual billing gives 2 months free.'
            : 'Fixed published USD rates for international customers. Annual billing gives 2 months free (pay for 10 months).'}
        </p>
      </div>

      {/* FOUNDING MEMBER EDITION VS STANDARD EDITION SWITCHER BANNER */}
      <div className="max-w-6xl mx-auto px-2 sm:px-4">
        <div className="rounded-2xl bg-gradient-to-r from-slate-950 via-[#1E293B] to-[#1E3A8A] text-white p-6 sm:p-7 shadow-xl border border-blue-900/40 relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-300 flex-wrap">
                <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                <span className="uppercase tracking-wider font-bold">
                  {getEditionMarketing(offerMode).badge}
                </span>
                {canSelectFounding && (
                  <>
                    <span className="text-blue-400">·</span>
                    <span className="text-blue-200">Standard vs Founding Member Edition</span>
                  </>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {offerMode === 'founding' && canSelectFounding
                  ? 'Founding Member Edition — Exclusive Early Customer Pricing'
                  : 'Standard — Regular Pricing & Full Capacity'}
              </h2>
              <p className="text-xs sm:text-sm text-blue-100/90 leading-relaxed">
                {offerMode === 'founding' && canSelectFounding
                  ? 'Best for early supporters who want founding-member pricing. Starter at $19/mo ($190/yr) and Growth at $59/mo ($590/yr); upgrade to Standard anytime for higher limits.'
                  : 'Best for businesses that need higher limits and more retention capacity — up to 2.5× customer monitoring, automated daily retention briefs, expanded messaging quotas, and API access.'}
              </p>
            </div>

            {/* Segmented Control for Edition Selection */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-700/80 rounded-xl shrink-0 self-start md:self-center">
              <button
                type="button"
                id="edition-toggle-standard"
                onClick={() => setOfferMode('standard')}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  offerMode === 'standard'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Standard</span>
                <span className="text-[10px] opacity-80">(Regular Pricing)</span>
              </button>
              {canSelectFounding && (
                <button
                  type="button"
                  id="edition-toggle-founding"
                  onClick={() => setOfferMode('founding')}
                  className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                    offerMode === 'founding'
                      ? 'bg-[#1E3A8A] text-white shadow-sm ring-1 ring-blue-400/40'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <span>Founding Member Edition</span>
                  <span className="text-[10px] opacity-80">(Early Offer)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3 PRICING TIERS SIDE-BY-SIDE */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch px-2 sm:px-4">
        {pricingTiersConfig.map((tier) => {
          const isSelected = selectedPlan === tier.id;
          const cardEdition: PlanEdition = tier.id === 'pro' ? 'standard' : offerMode;
          const editionLimits = getPlanLimits(tier.id, cardEdition);
          const dynamicFeatures = getEditionPlanFeatures(tier.id, cardEdition);
          const dynamicCapacityLabel =
            editionLimits.customers === Infinity
              ? 'Unlimited customers'
              : `${editionLimits.customers.toLocaleString()} customers (${getEditionLabel(cardEdition)})`;

          return (
            <div
              key={tier.id}
              data-plan={tier.id}
              onClick={() => handleSelectPlan(tier.id)}
              className={`pricing-card relative flex flex-col justify-between rounded-2xl bg-white p-6 sm:p-7 cursor-pointer transition-all duration-300 ease-in-out ${
                isSelected
                  ? 'selected scale-[1.01] sm:scale-105 border-2 border-[#1E3A8A] shadow-2xl ring-4 ring-[#1E3A8A]/15 z-10'
                  : tier.isPopular
                  ? 'border-2 border-blue-200 shadow-md scale-100 hover:border-blue-300 hover:shadow-lg'
                  : 'border border-gray-200 shadow-xs scale-100 hover:border-gray-300 hover:shadow-md'
              }`}
            >
              {/* Checkmark Badge "✓ Selected" on top-right when selected */}
              {isSelected && (
                <div className="absolute -top-3.5 -right-2 z-20 bg-[#1E3A8A] text-white text-[11px] font-bold px-3.5 py-1 rounded-full shadow-md flex items-center gap-1 animate-in fade-in zoom-in-90 duration-200">
                  <span>✓ Selected</span>
                </div>
              )}

              {/* MOST POPULAR badge on Growth tier */}
              {tier.isPopular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#1E3A8A] text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  <span>MOST POPULAR</span>
                </div>
              )}

              <div>
                {/* Header & Name */}
                <div className="flex items-center justify-between mt-1">
                  <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
                  {tier.id === 'growth' && <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />}
                </div>

                <p className="text-xs text-gray-500 mt-1 min-h-[32px] leading-relaxed">
                  {tier.description}
                </p>

                {/* Price Display with Exact Published USD & INR Rates */}
                <div className="price mt-4">
                  {currency === 'INR' ? (
                    isAnnual ? (
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-4xl font-black text-gray-900 tracking-tight">
                            ₹{tier.annualTotalPriceInr.toLocaleString('en-IN')}
                          </span>
                          <span className="text-xs text-gray-500 font-semibold">/year</span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-medium mt-0.5">
                          ₹{tier.annualPriceInr.toLocaleString('en-IN')}/mo billed annually (10 months price, 2 months free)
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-4xl font-black text-gray-900 tracking-tight">
                            ₹{tier.monthlyPriceInr.toLocaleString('en-IN')}
                          </span>
                          <span className="text-xs text-gray-500 font-semibold">/month</span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-medium mt-0.5">
                          Fixed published price in INR · Annual: ₹{tier.annualTotalPriceInr.toLocaleString('en-IN')}/yr
                        </div>
                      </div>
                    )
                  ) : (
                    isAnnual ? (
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-4xl font-black text-gray-900 tracking-tight">
                            ${tier.annualTotalPrice.toLocaleString('en-US')}
                          </span>
                          <span className="text-xs text-gray-500 font-semibold">/year</span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-medium mt-0.5">
                          ${tier.annualPrice}/mo billed annually (10 months price, 2 months free)
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-4xl font-black text-gray-900 tracking-tight">
                            ${tier.monthlyPrice.toLocaleString('en-US')}
                          </span>
                          <span className="text-xs text-gray-500 font-semibold">/month</span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-medium mt-0.5">
                          Fixed published price in USD · Annual: ${tier.annualTotalPrice.toLocaleString('en-US')}/yr
                        </div>
                      </div>
                    )
                  )}
                </div>

                {/* Customers capacity */}
                <p className="text-xs font-semibold text-gray-700 mt-2">
                  {dynamicCapacityLabel}
                </p>

                {/* Edition / Savings Badge */}
                <div className="min-h-[26px] mt-1.5">
                  {isAnnual ? (
                    <span className="savings-badge inline-flex items-center text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                      {currency === 'INR' ? tier.annualSavingsBadgeInr : tier.annualSavingsBadge}
                    </span>
                  ) : cardEdition === 'founding' && tier.foundingOffer.monthlySavingsUsd > 0 ? (
                    <span className="inline-flex items-center text-[11px] font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                      Exclusive Early Customer Pricing · Save ${tier.foundingOffer.monthlySavingsUsd}/mo
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                      Standard · Regular Pricing
                    </span>
                  )}
                </div>

                <div className="my-5 border-t border-gray-100"></div>

                {/* Dynamic Feature List by Tier + Edition */}
                <ul className="space-y-3 text-xs text-gray-700">
                  {dynamicFeatures.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          isSelected || tier.isPopular
                            ? 'bg-[#1E3A8A] text-white'
                            : 'bg-blue-50 text-blue-900'
                        }`}
                      >
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      <span className="leading-snug">{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Button */}
              <div className="mt-8 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  id={`select-plan-${tier.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tier.id === 'pro') {
                      handleSelectPlan('pro');
                      const el = document.getElementById('signup-form');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    } else {
                      handleStartTrialVerification(tier.id);
                    }
                  }}
                  className={`select-btn w-full py-3 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#1E3A8A] text-white hover:bg-blue-800 ring-2 ring-blue-400/30'
                      : tier.isPopular
                      ? 'bg-[#1E3A8A] hover:bg-blue-800 text-white'
                      : 'bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {tier.id === 'pro' ? (
                    <>
                      <Building className="w-3.5 h-3.5 text-blue-900" />
                      <span>Contact Sales</span>
                    </>
                  ) : isAnnual ? (
                    <span>Start Annual Trial ({getEditionLabel(offerMode)})</span>
                  ) : (
                    <span>Start {getEditionLabel(offerMode)} Trial ($1 USD)</span>
                  )}
                </button>

                <div className="text-[10px] text-center text-gray-500 mt-2 font-medium">
                  {tier.id === 'pro'
                    ? 'Custom contracts • Dedicated onboarding • SLA'
                    : '$1.00 USD card verification & Autopay • 14-day free trial • Cancel anytime'}
                </div>
                <div className="text-[10px] text-center text-gray-500 mt-1">
                  {isAnnual ? ONE_TIME_PAYMENT_DISCLOSURE : RECURRING_MANDATE_DISCLOSURE}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* FOUNDING MEMBER EDITION VS STANDARD SIDE-BY-SIDE COMPARISON TABLE */}
      <div id="foundation-vs-standard-comparison" className="max-w-6xl mx-auto px-2 sm:px-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/70">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#1E3A8A]">
                Side-by-Side Pricing &amp; Entitlement Breakdown
              </span>
              <h3 className="text-lg font-black text-gray-900 mt-0.5">
                Founding Member Edition vs Standard Comparison
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                Compare early-founder pricing and entry limits against Standard regular pricing and expanded business capacity.
              </p>
            </div>
            <div className="inline-flex rounded-xl bg-white border border-gray-200 p-1 shrink-0 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setComparisonTier('starter')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  comparisonTier === 'starter'
                    ? 'bg-[#1E3A8A] text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Starter ($19 vs $29/mo)
              </button>
              <button
                type="button"
                onClick={() => setComparisonTier('growth')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  comparisonTier === 'growth'
                    ? 'bg-[#1E3A8A] text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Growth ($59 vs $79/mo)
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-gray-200">
              <thead className="bg-gray-50 text-gray-700 font-bold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-5 w-1/3">Pricing / Capability</th>
                  <th className="py-3.5 px-5 w-1/3 text-blue-950">
                    Founding Member Edition ({comparisonTier === 'starter' ? '$19/mo' : '$59/mo'})
                  </th>
                  <th className="py-3.5 px-5 w-1/3 text-emerald-900 bg-emerald-50/60">
                    Standard ({comparisonTier === 'starter' ? '$29/mo' : '$79/mo'})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="bg-blue-50/30">
                  <td className="py-3 px-5 font-semibold text-gray-800">Monthly Price</td>
                  <td className="py-3 px-5 font-bold text-blue-950">
                    {getPlanPricing(comparisonTier, 'founding').monthly.formatted} (Exclusive Early Offer)
                  </td>
                  <td className="py-3 px-5 font-bold text-emerald-900 bg-emerald-50/30">
                    {getPlanPricing(comparisonTier, 'standard').monthly.formatted} (Regular Pricing)
                  </td>
                </tr>
                <tr className="bg-blue-50/30">
                  <td className="py-3 px-5 font-semibold text-gray-800">Annual Price (10 Months · 2 Months Free)</td>
                  <td className="py-3 px-5 font-bold text-blue-950">
                    {getPlanPricing(comparisonTier, 'founding').annual.formatted}
                  </td>
                  <td className="py-3 px-5 font-bold text-emerald-900 bg-emerald-50/30">
                    {getPlanPricing(comparisonTier, 'standard').annual.formatted}
                  </td>
                </tr>
                {getFoundationVsStandardComparison(comparisonTier).map((row) => (
                  <tr key={row.label} className="hover:bg-gray-50/60">
                    <td className="py-3 px-5 font-semibold text-gray-800">{row.label}</td>
                    <td className="py-3 px-5 text-gray-600">{row.foundation}</td>
                    <td className="py-3 px-5 font-semibold text-emerald-900 bg-emerald-50/30">{row.standard}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SIGNUP FORM INTEGRATION & CONFIRMATION NOTICE (#signup-form) */}
      <div
        id="signup-form"
        ref={signupFormRef}
        className="max-w-3xl mx-auto bg-white rounded-2xl border border-gray-200 shadow-md p-6 sm:p-8 space-y-6 scroll-mt-24"
      >
        {/* Hidden inputs requested for form integrations */}
        <input type="hidden" id="plan" name="plan" value={selectedPlan} />
        <input type="hidden" id="plan-edition" name="planEdition" value={offerMode} />
        <input type="hidden" id="price" name="price" value={activeChargePrice} />
        <input type="hidden" id="billing-cycle" name="billing-cycle" value={isAnnual ? 'annual' : 'monthly'} />
        <input type="hidden" id="signup-plan" value={selectedPlan} />
        <input type="hidden" id="signup-price" value={activeChargePrice} />

        {/* Selected Plan Notice Banner */}
        <div className="selected-plan-notice bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1E3A8A] text-white flex items-center justify-center shrink-0 shadow-2xs">
              <Check className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Selected Configuration</div>
              <div className="text-sm font-bold text-gray-900">
                {activeTier.name} ({getEditionLabel(selectedPlan === 'pro' ? 'standard' : offerMode)}) —{' '}
                {isAnnual
                  ? `$${activeTier.annualTotalPrice.toLocaleString('en-US')} USD/year`
                  : `$${activeTier.monthlyPrice.toLocaleString('en-US')} USD/month`}
              </div>
              <div className="text-[11px] text-gray-600 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
                <span>Billing currency: <strong className="text-blue-900">USD</strong></span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-500">14-day free trial included</span>
                <span className="text-gray-400">·</span>
                <span className="text-blue-900 font-bold bg-blue-100/70 px-2 py-0.5 rounded-full border border-blue-200">
                  {getEditionLabel(selectedPlan === 'pro' ? 'standard' : offerMode)}
                </span>
              </div>
              <div className="text-[10px] text-blue-900/80">
                All recurring subscriptions are billed transparently in USD ($) on a card mandate.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleStartTrialVerification(selectedPlan as any)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-bold rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>
                {isAnnual
                  ? 'Start Annual Trial ($1 USD)'
                  : `Start ${getEditionLabel(selectedPlan === 'pro' ? 'standard' : offerMode)} ($1 USD)`}
              </span>
            </button>
            <button
              type="button"
              onClick={handleRedirectToSignup}
              className="inline-flex items-center gap-1 px-3 py-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 text-xs font-semibold rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <span>Full Signup</span>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Form Body: Either Instant Trial Start or Enterprise Sales Contact */}
        {selectedPlan === 'pro' ? (
          <div>
            <div className="border-b border-gray-100 pb-4 mb-5">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Building className="w-4 h-4 text-[#1E3A8A]" />
                Schedule Enterprise Consultation or Start Pro
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                Connect with our Solution Architecture team for custom volume pricing, Spanner/Snowflake connectors, or SLA terms.
              </p>
            </div>

            <form onSubmit={handleSalesContactSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Your Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Mercer"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Work Email <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@enterprise.com"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Building className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Enterprise SaaS Ltd"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Active Customer Count
                  </label>
                  <select className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]">
                    <option>5,000 - 15,000 Accounts</option>
                    <option>15,000 - 50,000 Accounts</option>
                    <option>50,000+ Accounts</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Specific Requirements or Integration Questions
                </label>
                <textarea
                  rows={2}
                  value={salesNotes}
                  onChange={(e) => setSalesNotes(e.target.value)}
                  placeholder="Need custom billing sync, dedicated data residency, or high volume requirements..."
                  className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                />
              </div>

              {/* Explicit Consent Checkbox (unchecked by default) */}
              <div className="pt-1">
                <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    required
                    checked={salesConsent}
                    onChange={(e) => setSalesConsent(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-blue-900 focus:ring-blue-900/20 cursor-pointer"
                  />
                  <span className="leading-snug">
                    I agree to Churnveda processing my contact information to reply to this demo request in accordance with the{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate?.('privacy')}
                      className="text-blue-900 hover:underline font-semibold"
                    >
                      Privacy Policy
                    </button>
                    .
                  </span>
                </label>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-6 py-2.5 bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>{isSubmitting ? 'Submitting...' : 'Request Pro Demo & Pricing'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCalendlyModalOpen(true)}
                  className="w-full sm:w-auto px-4 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-800 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-blue-900" />
                  <span>Open Calendly to book instantly</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <div className="border-b border-gray-100 pb-4 mb-5">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#1E3A8A]" />
                Start Your 14-Day Free Trial on the {activeTier.name} Plan
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                No credit card required. Instant sandbox with simulated telemetry and automated Churnveda AI predictions.
              </p>
            </div>

            <form onSubmit={handleInlineSignupSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Work Email <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@company.com"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Building className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Acme SaaS Inc"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 chars, 1 uppercase, 1 special"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>
              </div>

              {/* Explicit Consent Checkbox (unchecked by default) */}
              <div className="pt-1">
                <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    required
                    checked={inlineConsent}
                    onChange={(e) => setInlineConsent(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-blue-900 focus:ring-blue-900/20 cursor-pointer"
                  />
                  <span className="leading-snug">
                    I confirm I am 18+ representing a business entity and agree to the{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate?.('terms')}
                      className="text-blue-900 hover:underline font-semibold"
                    >
                      Terms of Service
                    </button>
                    ,{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate?.('privacy')}
                      className="text-blue-900 hover:underline font-semibold"
                    >
                      Privacy Policy
                    </button>
                    , and{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate?.('refund')}
                      className="text-blue-900 hover:underline font-semibold"
                    >
                      Refund & Cancellation Policy
                    </button>
                    .
                  </span>
                </label>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleStartTrialVerification(selectedPlan as any)}
                  className="w-full sm:w-auto px-6 py-2.5 bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <CreditCard className="w-4 h-4 text-emerald-300" />
                  <span>
                    {isAnnual
                      ? `Start ${getEditionLabel(offerMode)} Annual ($1 USD)`
                      : `Start ${getEditionLabel(offerMode)} Trial ($1 USD)`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRazorpayCheckout(selectedPlan)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-blue-900 to-indigo-900 hover:from-blue-950 hover:to-indigo-950 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer border border-blue-700"
                >
                  <CreditCard className="w-4 h-4 text-cyan-300" />
                  <span>
                    {isAnnual
                      ? 'Pay Annual via Razorpay (UPI, Cards, Netbanking, Wallets)'
                      : 'Authorize USD Card Mandate'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleRedirectToSignup}
                  className="text-xs font-semibold text-blue-900 hover:text-blue-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Or use SSO</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Supported Payment Disclosures */}
              <div className="pt-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2.5 space-y-1">
                {isAnnual ? (
                  <div className="flex items-center gap-3 text-gray-700 font-semibold text-xs">
                    <span className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5 text-emerald-600" /> UPI</span>
                    <span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5 text-blue-600" /> Cards</span>
                    <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5 text-indigo-600" /> Netbanking</span>
                    <span className="flex items-center gap-1"><Wallet className="w-3.5 h-3.5 text-amber-600" /> Wallets</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-gray-700 font-semibold text-xs">
                    <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                    <span>International &amp; Domestic Cards (Visa / Mastercard / Amex)</span>
                  </div>
                )}
                <p>
                  {isAnnual ? ONE_TIME_PAYMENT_DISCLOSURE : RECURRING_MANDATE_DISCLOSURE}
                </p>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Calendly Booking Modal for Pro */}
      {calendlyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-[#1E3A8A]" />
                <h3 className="text-base font-bold text-gray-900">Schedule Pro Consultation</h3>
              </div>
              <button
                onClick={() => setCalendlyModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-950 space-y-1">
              <div className="font-bold">Calendly Integration: Churnveda Enterprise Desk</div>
              <div className="text-gray-600">
                15-Minute Technical Evaluation & Custom Retention Automation Strategy
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 text-center space-y-3">
              <div className="text-xs text-gray-600">Available time slots for this week:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {['Today at 2:00 PM', 'Today at 4:30 PM', 'Tomorrow at 10:00 AM', 'Tomorrow at 1:30 PM'].map((slot, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (onShowToast) onShowToast(`Booked slot: ${slot}! Calendar invitation sent.`, 'success');
                      setCalendlyModalOpen(false);
                    }}
                    className="p-2 bg-white border border-gray-200 rounded-lg font-semibold text-gray-800 hover:bg-blue-50 hover:border-[#1E3A8A] transition-colors"
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setCalendlyModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Founder Referral Program Banner */}
      <div className="bg-linear-to-r from-blue-900 to-blue-950 rounded-2xl p-6 text-white max-w-4xl mx-auto shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 bg-blue-800/80 px-2.5 py-0.5 rounded-full text-blue-200 text-xs font-semibold">
              <Gift className="w-3.5 h-3.5 text-amber-300" />
              Founder Referral Program
            </div>
            <h3 className="text-xl font-bold tracking-tight">
              Refer a SaaS founder, both get 1 month free.
            </h3>
            <p className="text-xs text-blue-200 max-w-md">
              Share your unique referral link with fellow SaaS founders. When they activate a paid plan, you both receive a 1-month credit toward your subscription.
            </p>
          </div>

          <div className="space-y-2 shrink-0">
            <div className="flex items-center gap-2 bg-blue-950/80 p-2 rounded-xl border border-blue-800 text-xs font-mono">
              <span className="truncate max-w-[200px] text-blue-200">{referralLink}</span>
              <button
                type="button"
                onClick={handleCopyReferral}
                className="px-2.5 py-1 bg-white text-blue-950 font-bold rounded text-[11px] hover:bg-blue-50 transition-colors cursor-pointer"
              >
                {copiedReferral ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 max-w-4xl mx-auto shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-[#1E3A8A]" />
            Frequently Asked Questions
          </h3>
          <div className="text-xs text-gray-500">
            Need custom pricing?{' '}
            <a
              href="mailto:sharatbuchanalli4@gmail.com"
              className="text-[#1E3A8A] font-semibold hover:underline"
            >
              Contact Support
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 bg-gray-50 rounded-xl space-y-1 border border-gray-100">
            <span className="font-bold text-gray-900">How does the 14-day free trial work?</span>
            <p className="text-gray-600 leading-relaxed">
              Every plan includes a 14-day free trial with no credit card required at signup. You receive instant access to telemetry ingestion, Churnveda AI predictions, and automated retention playbooks.
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 rounded-xl space-y-1 border border-gray-100">
            <span className="font-bold text-gray-900">What is the cancellation policy?</span>
            <p className="text-gray-600 leading-relaxed">
              You can cancel your subscription at any time with 1 click directly from your Billing settings. There are no contracts, lock-ins, or cancellation fees. You retain access until the end of your billing cycle.
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 rounded-xl space-y-1 border border-gray-100">
            <span className="font-bold text-gray-900">How does billing and plan switching work?</span>
            <p className="text-gray-600 leading-relaxed">
              Payments are processed securely via Razorpay Subscriptions. You can upgrade or downgrade anytime; changes are prorated automatically. Annual plans save 18% compared to monthly billing.
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 rounded-xl space-y-1 border border-gray-100">
            <span className="font-bold text-gray-900">How accurate is the AI churn score?</span>
            <p className="text-gray-600 leading-relaxed">
              Churnveda AI analyzes multi-dimensional telemetry (login dropoff, ticket sentiment, payment failure patterns) yielding an 89% early detection accuracy 30-60 days before account churn.
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 rounded-xl space-y-1 border border-gray-100">
            <span className="font-bold text-gray-900">Is my customer & billing data secure?</span>
            <p className="text-gray-600 leading-relaxed">
              Yes. All telemetry is encrypted at rest using AES-256 and in transit via TLS 1.3. We only require read-only permissions for Razorpay, Mixpanel, and Intercom.
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 rounded-xl space-y-1 border border-gray-100">
            <span className="font-bold text-gray-900">Can I export reports for investors & board members?</span>
            <p className="text-gray-600 leading-relaxed">
              Yes. The ROI & Reports dashboard exports audit-ready PDFs detailing monthly MRR saved, protected ARR, and cohort risk migration.
            </p>
          </div>
        </div>

        {/* Customer Support Contact Callout */}
        <div className="mt-4 p-3.5 bg-blue-50/60 rounded-xl border border-blue-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#1E3A8A] shrink-0" />
            <span className="text-gray-700">
              Have specific billing or technical questions? Reach our team directly via email or phone.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="mailto:sharatbuchanalli4@gmail.com"
              className="px-3 py-1.5 bg-[#1E3A8A] hover:bg-blue-800 text-white font-semibold rounded-lg transition-colors"
            >
              Email Support
            </a>
            <a
              href="tel:+919620262041"
              className="px-3 py-1.5 bg-white hover:bg-blue-50 border border-blue-200 text-[#1E3A8A] font-semibold rounded-lg transition-colors"
            >
              Call +91 96202 62041
            </a>
          </div>
        </div>
      </div>

      {/* Authoritative $1 Trial Verification & Autopay Checkout Modal */}
      <TrialVerificationModal
        isOpen={verificationModalOpen}
        onClose={() => setVerificationModalOpen(false)}
        tier={verificationTier}
        billingCycle={isAnnual ? 'annual' : 'monthly'}
        planEdition={offerMode}
        isFoundingOffer={offerMode === 'founding'}
        onSuccess={(result) => {
          if (onShowToast) {
            onShowToast(
              result.autopay_authorized
                ? `$1.00 USD verification & Autopay authorized! Your 14-day ${result.tier.toUpperCase()} (${getEditionLabel(offerMode)}) trial has begun.`
                : result.message,
              result.autopay_authorized ? 'success' : 'info'
            );
          }
          if (result.autopay_authorized && onNavigate) {
            onNavigate('dashboard');
          }
        }}
        onShowToast={onShowToast}
      />
    </div>
  );
};
