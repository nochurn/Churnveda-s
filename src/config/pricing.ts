/**
 * Churnveda Centralized Authoritative Pricing Configuration
 *
 * SINGLE SOURCE OF TRUTH for:
 * - Pricing UI
 * - Signup & Onboarding
 * - Billing settings & checkout
 * - Backend order creation & verification
 * - Subscription records
 * - Admin billing plans
 * - Upgrade / Downgrade workflows
 *
 * EXACT PRICING (USD only):
 * Monthly:
 *   Starter:    $49/month
 *   Growth:     $149/month
 *   Enterprise: $349/month
 *
 * Annual:
 *   Starter:    $468/year ($39/month equivalent)
 *   Growth:     $1,428/year ($119/month equivalent)
 *   Enterprise: $3,348/year ($279/month equivalent)
 *
 * FOUNDING 10 CUSTOMERS OFFER (Limited to first 10 paying customers):
 *   Starter:    $29/month (Standard $49/mo)
 *   Growth:     $79/month (Standard $149/mo)
 *   Enterprise: Standard $349/mo (Custom pricing on approval; no automatic discount)
 */

export type PlanTierId = 'starter' | 'growth' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';

/**
 * Authoritative Founding 10 Customers Offer Specification
 */
export interface FoundingOfferPlan {
  tier: 'starter' | 'growth' | 'pro';
  eligible: boolean;
  standardMonthlyPrice: number;
  foundingMonthlyPrice: number;
  monthlySavings: number;
  formattedFounding: string;
  formattedStandard: string;
  checkoutLabel: string;
}

export const FOUNDING_OFFER_CONFIG: Record<'starter' | 'growth' | 'pro', FoundingOfferPlan> = {
  starter: {
    tier: 'starter',
    eligible: true,
    standardMonthlyPrice: 49,
    foundingMonthlyPrice: 29,
    monthlySavings: 20,
    formattedFounding: '$29/month',
    formattedStandard: '$49/month',
    checkoutLabel: '$29 USD / month (Founding Customer Price)'
  },
  growth: {
    tier: 'growth',
    eligible: true,
    standardMonthlyPrice: 149,
    foundingMonthlyPrice: 79,
    monthlySavings: 70,
    formattedFounding: '$79/month',
    formattedStandard: '$149/month',
    checkoutLabel: '$79 USD / month (Founding Customer Price)'
  },
  pro: {
    tier: 'pro',
    eligible: false,
    standardMonthlyPrice: 349,
    foundingMonthlyPrice: 349,
    monthlySavings: 0,
    formattedFounding: '$349/month',
    formattedStandard: '$349/month',
    checkoutLabel: '$349 USD / month (Custom Terms Available)'
  }
};

export interface PlanPricingDetails {
  id: 'starter' | 'growth' | 'pro';
  displayName: string;
  customersIncluded: string;
  description: string;
  isPopular?: boolean;
  features: string[];
  monthly: {
    amountUsd: number;
    amountCents: number;
    formatted: string;
    checkoutLabel: string;
  };
  annual: {
    totalAmountUsd: number;
    totalAmountCents: number;
    monthlyEquivalentUsd: number;
    formatted: string;
    checkoutLabel: string;
    savingsBadge: string;
  };
}

export interface PlanLimits {
  customers: number;
  aiScansPerDay: number;
  customersAnalyzedPerScan: number;
  topAtRiskCustomers: number;
  aiRetentionMessagesPerMonth: number;
  whatsappMessagesPerMonth: number;
  emailMessagesPerMonth: number;
  csvImportsPerMonth: number;
  pdfImportsPerMonth: number;
  customerHistoryDays: number;
  teamMembers: number;
  workspaces: number;
  customIntegrations: number;
  apiAccess: boolean;
  webhooks: boolean;
  advancedAutomation: boolean;
  customRiskRules: 'none' | 'limited' | 'full';
  prioritySupport: boolean;
  dedicatedOnboarding: boolean;
  sla: boolean;
}

export const PLAN_LIMITS: Record<'starter' | 'growth' | 'pro', PlanLimits> = {
  starter: {
    customers: 100,
    aiScansPerDay: 1,
    customersAnalyzedPerScan: 100,
    topAtRiskCustomers: 5,
    aiRetentionMessagesPerMonth: 50,
    whatsappMessagesPerMonth: 50,
    emailMessagesPerMonth: 50,
    csvImportsPerMonth: 10,
    pdfImportsPerMonth: 5,
    customerHistoryDays: 90,
    teamMembers: 1,
    workspaces: 1,
    customIntegrations: 0,
    apiAccess: false,
    webhooks: false,
    advancedAutomation: false,
    customRiskRules: 'none',
    prioritySupport: false,
    dedicatedOnboarding: false,
    sla: false
  },
  growth: {
    customers: 1000,
    aiScansPerDay: 3,
    customersAnalyzedPerScan: 1000,
    topAtRiskCustomers: 10,
    aiRetentionMessagesPerMonth: 500,
    whatsappMessagesPerMonth: 500,
    emailMessagesPerMonth: 500,
    csvImportsPerMonth: 50,
    pdfImportsPerMonth: 25,
    customerHistoryDays: 365,
    teamMembers: 5,
    workspaces: 3,
    customIntegrations: 2,
    apiAccess: true,
    webhooks: true,
    advancedAutomation: true,
    customRiskRules: 'limited',
    prioritySupport: true,
    dedicatedOnboarding: false,
    sla: false
  },
  pro: {
    customers: Infinity,
    aiScansPerDay: Infinity,
    customersAnalyzedPerScan: Infinity,
    topAtRiskCustomers: 25,
    aiRetentionMessagesPerMonth: 2500,
    whatsappMessagesPerMonth: 2500,
    emailMessagesPerMonth: 2500,
    csvImportsPerMonth: Infinity,
    pdfImportsPerMonth: Infinity,
    customerHistoryDays: Infinity,
    teamMembers: 20,
    workspaces: 10,
    customIntegrations: 10,
    apiAccess: true,
    webhooks: true,
    advancedAutomation: true,
    customRiskRules: 'full',
    prioritySupport: true,
    dedicatedOnboarding: true,
    sla: true
  }
};

export const CENTRAL_PRICING: Record<'starter' | 'growth' | 'pro', PlanPricingDetails> = {
  starter: {
    id: 'starter',
    displayName: 'Starter',
    customersIncluded: '100 customers',
    description: 'AI Retention Employee for growing SaaS products.',
    features: [
      '100 customers monitored',
      '1 AI scan / day (100 analyzed)',
      'Top 5 at-risk priorities daily',
      '50 AI retention messages / month',
      '50 WhatsApp & 50 Email messages / month',
      '10 CSV & 5 PDF imports / month',
      '90 days customer history',
      '1 team member & 1 workspace',
      'WhatsApp & Resend/email integration',
      'Daily Retention Brief & basic reports'
    ],
    monthly: {
      amountUsd: 49,
      amountCents: 4900,
      formatted: '$49/month',
      checkoutLabel: '$49 USD / month'
    },
    annual: {
      totalAmountUsd: 468,
      totalAmountCents: 46800,
      monthlyEquivalentUsd: 39,
      formatted: '$468/year ($39/mo)',
      checkoutLabel: '$468 USD / year ($39/month equivalent)',
      savingsBadge: 'Save $120/year (20% off)'
    }
  },
  growth: {
    id: 'growth',
    displayName: 'Growth',
    customersIncluded: '1,000 customers',
    description: 'Complete AI Retention Employee with sending automations & API.',
    isPopular: true,
    features: [
      '1,000 customers monitored',
      '3 AI scans / day (1,000 analyzed)',
      'Top 10 at-risk priorities daily',
      '500 AI retention messages / month',
      '500 WhatsApp & 500 Email messages / month',
      '50 CSV & 25 PDF imports / month',
      '1 year customer history',
      '5 team members & 3 workspaces',
      '2 custom integrations',
      'API access & Webhooks',
      'Advanced automation & limited risk rules',
      'Priority support'
    ],
    monthly: {
      amountUsd: 149,
      amountCents: 14900,
      formatted: '$149/month',
      checkoutLabel: '$149 USD / month'
    },
    annual: {
      totalAmountUsd: 1428,
      totalAmountCents: 142800,
      monthlyEquivalentUsd: 119,
      formatted: '$1,428/year ($119/mo)',
      checkoutLabel: '$1,428 USD / year ($119/month equivalent)',
      savingsBadge: 'Save $360/year (20% off)'
    }
  },
  pro: {
    id: 'pro',
    displayName: 'Enterprise',
    customersIncluded: 'Unlimited customers',
    description: 'Enterprise retention intelligence, dedicated scale & custom integrations.',
    features: [
      'Unlimited customers monitored',
      'Unlimited AI scans (unlimited analyzed)',
      'Top 25 at-risk priorities daily',
      '2,500 AI retention messages / month',
      '2,500 WhatsApp & 2,500 Email messages / month',
      'Unlimited CSV & PDF imports',
      'Unlimited customer history',
      '20 team members & 10 workspaces',
      '10 custom integrations',
      'API access & Webhooks',
      'Advanced automation & custom risk rules',
      'Priority support & dedicated onboarding',
      'SLA available'
    ],
    monthly: {
      amountUsd: 349,
      amountCents: 34900,
      formatted: '$349/month',
      checkoutLabel: '$349 USD / month'
    },
    annual: {
      totalAmountUsd: 3348,
      totalAmountCents: 334800,
      monthlyEquivalentUsd: 279,
      formatted: '$3,348/year ($279/mo)',
      checkoutLabel: '$3,348 USD / year ($279/month equivalent)',
      savingsBadge: 'Save $840/year (20% off)'
    }
  }
};

/**
 * Normalizes input tier keys (e.g. 'enterprise' -> 'pro')
 */
export function normalizePlanTier(rawTier?: string): 'starter' | 'growth' | 'pro' {
  const clean = String(rawTier || 'growth').toLowerCase().trim();
  if (clean === 'starter') return 'starter';
  if (clean === 'pro' || clean === 'enterprise' || clean === 'business') return 'pro';
  return 'growth';
}

/**
 * Get pricing details for a given plan tier
 */
export function getPlanPricing(rawTier?: string): PlanPricingDetails {
  const key = normalizePlanTier(rawTier);
  return CENTRAL_PRICING[key];
}

/**
 * Authoritative lookup for expected charge amount and currency.
 * Used by backend to ignore any frontend-sent amounts.
 */
export function getExpectedPlanAmount(
  rawTier?: string,
  rawCycle?: string,
  isFoundingOffer?: boolean
): {
  tier: 'starter' | 'growth' | 'pro';
  billingCycle: 'monthly' | 'annual';
  name: string;
  amountUsd: number;
  amountCents: number;
  currency: 'USD';
  formatted: string;
  checkoutLabel: string;
  isFoundingOffer: boolean;
} {
  const tier = normalizePlanTier(rawTier);
  const cycle: 'monthly' | 'annual' = String(rawCycle).toLowerCase().trim() === 'annual' ? 'annual' : 'monthly';
  const plan = CENTRAL_PRICING[tier];
  const founding = FOUNDING_OFFER_CONFIG[tier];

  // Founding offer is available for Starter ($29/mo) and Growth ($79/mo) on monthly billing
  if (isFoundingOffer && cycle === 'monthly' && founding.eligible) {
    return {
      tier,
      billingCycle: 'monthly',
      name: `${plan.displayName} (Founding Customer Offer)`,
      amountUsd: founding.foundingMonthlyPrice,
      amountCents: founding.foundingMonthlyPrice * 100,
      currency: 'USD',
      formatted: founding.formattedFounding,
      checkoutLabel: founding.checkoutLabel,
      isFoundingOffer: true
    };
  }

  if (cycle === 'annual') {
    return {
      tier,
      billingCycle: 'annual',
      name: plan.displayName,
      amountUsd: plan.annual.totalAmountUsd,
      amountCents: plan.annual.totalAmountCents,
      currency: 'USD',
      formatted: plan.annual.formatted,
      checkoutLabel: plan.annual.checkoutLabel,
      isFoundingOffer: false
    };
  }

  return {
    tier,
    billingCycle: 'monthly',
    name: plan.displayName,
    amountUsd: plan.monthly.amountUsd,
    amountCents: plan.monthly.amountCents,
    currency: 'USD',
    formatted: plan.monthly.formatted,
    checkoutLabel: plan.monthly.checkoutLabel,
    isFoundingOffer: false
  };
}

/**
 * Authoritative list of billing plans for DB synchronization & Admin views
 */
export interface AuthoritativeBillingPlanRecord {
  id: string;
  name: string;
  tier: 'starter' | 'growth' | 'pro';
  billing_cycle: 'monthly' | 'annual';
  amount_usd: number;
  amount_cents: number;
  currency: 'USD';
  formatted: string;
  checkout_label: string;
  razorpay_plan_id: string;
  is_active: boolean;
  is_founding_offer?: boolean;
  discountDescription: string;
  created_at: string;
  updated_at: string;
  // Compatibility fields for legacy views
  amount_paise: number;
  amount_inr: number;
  formattedInr: string;
}

export function buildAuthoritativeBillingPlans(): AuthoritativeBillingPlanRecord[] {
  const now = new Date().toISOString();
  return [
    // Standard Starter Monthly
    {
      id: 'plan_tier_starter_monthly',
      name: 'Churnveda Starter — Monthly',
      tier: 'starter',
      billing_cycle: 'monthly',
      amount_usd: 49,
      amount_cents: 4900,
      currency: 'USD',
      formatted: '$49/month',
      checkout_label: '$49 USD / month',
      discountDescription: 'Standard monthly billing in USD',
      razorpay_plan_id: process.env.RAZORPAY_STARTER_MONTHLY_PLAN_ID || process.env.RAZORPAY_PLAN_STARTER_MONTHLY || 'plan_TeZlsQOQaeAWAw',
      is_active: true,
      is_founding_offer: false,
      created_at: now,
      updated_at: now,
      amount_paise: 4900,
      amount_inr: 49,
      formattedInr: '$49/month'
    },
    // Founding Offer Starter Monthly
    {
      id: 'plan_tier_starter_founding_monthly',
      name: 'Churnveda Starter — Founding Offer Monthly',
      tier: 'starter',
      billing_cycle: 'monthly',
      amount_usd: 29,
      amount_cents: 2900,
      currency: 'USD',
      formatted: '$29/month',
      checkout_label: '$29 USD / month (Founding Customer Offer)',
      discountDescription: 'Founding customer offer for first 10 paying customers ($20/mo savings)',
      razorpay_plan_id: process.env.RAZORPAY_STARTER_FOUNDING_PLAN_ID || 'plan_TeZlsQOQaeAWAw_fnd',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now,
      amount_paise: 2900,
      amount_inr: 29,
      formattedInr: '$29/month'
    },
    // Standard Starter Annual
    {
      id: 'plan_tier_starter_annual',
      name: 'Churnveda Starter — Annual',
      tier: 'starter',
      billing_cycle: 'annual',
      amount_usd: 468,
      amount_cents: 46800,
      currency: 'USD',
      formatted: '$468/year ($39/mo)',
      checkout_label: '$468 USD / year ($39/month equivalent)',
      discountDescription: 'Save $120/year (20% annual billing discount)',
      razorpay_plan_id: process.env.RAZORPAY_STARTER_ANNUAL_PLAN_ID || process.env.RAZORPAY_PLAN_STARTER_ANNUAL || 'plan_TeZMQYLVPEtQuj',
      is_active: true,
      is_founding_offer: false,
      created_at: now,
      updated_at: now,
      amount_paise: 46800,
      amount_inr: 468,
      formattedInr: '$468/year ($39/mo)'
    },
    // Standard Growth Monthly
    {
      id: 'plan_tier_growth_monthly',
      name: 'Churnveda Growth — Monthly',
      tier: 'growth',
      billing_cycle: 'monthly',
      amount_usd: 149,
      amount_cents: 14900,
      currency: 'USD',
      formatted: '$149/month',
      checkout_label: '$149 USD / month',
      discountDescription: 'Standard monthly billing in USD',
      razorpay_plan_id: process.env.RAZORPAY_GROWTH_MONTHLY_PLAN_ID || process.env.RAZORPAY_PLAN_GROWTH_MONTHLY || 'plan_TeZQFjmJoxrnKM',
      is_active: true,
      is_founding_offer: false,
      created_at: now,
      updated_at: now,
      amount_paise: 14900,
      amount_inr: 149,
      formattedInr: '$149/month'
    },
    // Founding Offer Growth Monthly
    {
      id: 'plan_tier_growth_founding_monthly',
      name: 'Churnveda Growth — Founding Offer Monthly',
      tier: 'growth',
      billing_cycle: 'monthly',
      amount_usd: 79,
      amount_cents: 7900,
      currency: 'USD',
      formatted: '$79/month',
      checkout_label: '$79 USD / month (Founding Customer Offer)',
      discountDescription: 'Founding customer offer for first 10 paying customers ($70/mo savings)',
      razorpay_plan_id: process.env.RAZORPAY_GROWTH_FOUNDING_PLAN_ID || 'plan_TeZQFjmJoxrnKM_fnd',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now,
      amount_paise: 7900,
      amount_inr: 79,
      formattedInr: '$79/month'
    },
    // Standard Growth Annual
    {
      id: 'plan_tier_growth_annual',
      name: 'Churnveda Growth — Annual',
      tier: 'growth',
      billing_cycle: 'annual',
      amount_usd: 1428,
      amount_cents: 142800,
      currency: 'USD',
      formatted: '$1,428/year ($119/mo)',
      checkout_label: '$1,428 USD / year ($119/month equivalent)',
      discountDescription: 'Save $360/year (20% annual billing discount)',
      razorpay_plan_id: process.env.RAZORPAY_GROWTH_ANNUAL_PLAN_ID || process.env.RAZORPAY_PLAN_GROWTH_ANNUAL || 'plan_TfXxPsAOqPYklF',
      is_active: true,
      is_founding_offer: false,
      created_at: now,
      updated_at: now,
      amount_paise: 142800,
      amount_inr: 1428,
      formattedInr: '$1,428/year ($119/mo)'
    },
    // Standard Enterprise Monthly
    {
      id: 'plan_tier_pro_monthly',
      name: 'Churnveda Enterprise — Monthly',
      tier: 'pro',
      billing_cycle: 'monthly',
      amount_usd: 349,
      amount_cents: 34900,
      currency: 'USD',
      formatted: '$349/month',
      checkout_label: '$349 USD / month',
      discountDescription: 'Standard monthly billing in USD',
      razorpay_plan_id: process.env.RAZORPAY_ENTERPRISE_MONTHLY_PLAN_ID || process.env.RAZORPAY_PLAN_PRO_MONTHLY || 'plan_TeZraPPrYthtEk',
      is_active: true,
      is_founding_offer: false,
      created_at: now,
      updated_at: now,
      amount_paise: 34900,
      amount_inr: 349,
      formattedInr: '$349/month'
    },
    // Standard Enterprise Annual
    {
      id: 'plan_tier_pro_annual',
      name: 'Churnveda Enterprise — Annual',
      tier: 'pro',
      billing_cycle: 'annual',
      amount_usd: 3348,
      amount_cents: 334800,
      currency: 'USD',
      formatted: '$3,348/year ($279/mo)',
      checkout_label: '$3,348 USD / year ($279/month equivalent)',
      discountDescription: 'Save $840/year (20% annual billing discount)',
      razorpay_plan_id: process.env.RAZORPAY_ENTERPRISE_ANNUAL_PLAN_ID || process.env.RAZORPAY_PLAN_PRO_ANNUAL || 'plan_Tea17dB6H4EHdn',
      is_active: true,
      is_founding_offer: false,
      created_at: now,
      updated_at: now,
      amount_paise: 334800,
      amount_inr: 3348,
      formattedInr: '$3,348/year ($279/mo)'
    }
  ];
}

/**
 * Validates whether a payment amount and currency strictly match the authoritative plan
 */
export function validatePaymentMatch(
  planId: string | undefined,
  billingCycle: string | undefined,
  amount: number | string | undefined,
  currency: string | undefined,
  isFoundingOffer?: boolean
): { isValid: boolean; error?: string; expected: ReturnType<typeof getExpectedPlanAmount> } {
  const expected = getExpectedPlanAmount(planId, billingCycle, isFoundingOffer);

  if (currency && currency.toUpperCase() !== 'USD') {
    return {
      isValid: false,
      error: `Invalid currency: "${currency}". All Churnveda subscriptions are strictly USD ($). INR is rejected.`,
      expected
    };
  }

  if (amount !== undefined && amount !== null && amount !== '') {
    const num = Number(amount);
    const matchesCents = num === expected.amountCents;
    const matchesUsd = num === expected.amountUsd;

    // Check alternate (e.g. if user paid founding price without explicit flag, or vice versa)
    const altExpected = getExpectedPlanAmount(planId, billingCycle, !isFoundingOffer);
    const matchesAlt = num === altExpected.amountCents || num === altExpected.amountUsd;

    if (!matchesCents && !matchesUsd && !matchesAlt) {
      return {
        isValid: false,
        error: `Invalid amount: received ${num}, expected $${expected.amountUsd} USD (${expected.amountCents} cents) for ${expected.name} (${expected.billingCycle}).`,
        expected
      };
    }
  }

  return { isValid: true, expected };
}
