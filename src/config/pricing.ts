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
export type BillingInterval = 'monthly' | 'annual';
export type BillingCurrency = 'USD' | 'INR';

/**
 * Authoritative Founding Offer Specification
 */
export interface FoundingOfferPlan {
  tier: 'starter' | 'growth' | 'pro';
  eligible: boolean;
  standardMonthlyPriceUsd: number;
  foundingMonthlyPriceUsd: number;
  monthlySavingsUsd: number;
  standardMonthlyPriceInr: number;
  foundingMonthlyPriceInr: number;
  monthlySavingsInr: number;
  formattedFoundingUsd: string;
  formattedFoundingInr: string;
  formattedStandardUsd: string;
  formattedStandardInr: string;
  checkoutLabel: string;
  checkoutLabelInr: string;
  // Legacy aliases for backward compatibility
  standardMonthlyPrice: number;
  foundingMonthlyPrice: number;
  monthlySavings: number;
  formattedFounding: string;
  formattedStandard: string;
}

export const FOUNDING_OFFER_CONFIG: Record<'starter' | 'growth' | 'pro', FoundingOfferPlan> = {
  starter: {
    tier: 'starter',
    eligible: true,
    standardMonthlyPriceUsd: 29,
    foundingMonthlyPriceUsd: 29,
    monthlySavingsUsd: 0,
    standardMonthlyPriceInr: 2756,
    foundingMonthlyPriceInr: 2756,
    monthlySavingsInr: 0,
    formattedFoundingUsd: '$29/month',
    formattedFoundingInr: '₹2,756/month',
    formattedStandardUsd: '$29/month',
    formattedStandardInr: '₹2,756/month',
    checkoutLabel: '$29 USD / month (Founding Price)',
    checkoutLabelInr: '₹2,756 INR / month (Founding Price)',
    standardMonthlyPrice: 29,
    foundingMonthlyPrice: 29,
    monthlySavings: 0,
    formattedFounding: '$29/month',
    formattedStandard: '$29/month'
  },
  growth: {
    tier: 'growth',
    eligible: true,
    standardMonthlyPriceUsd: 79,
    foundingMonthlyPriceUsd: 79,
    monthlySavingsUsd: 0,
    standardMonthlyPriceInr: 7508,
    foundingMonthlyPriceInr: 7508,
    monthlySavingsInr: 0,
    formattedFoundingUsd: '$79/month',
    formattedFoundingInr: '₹7,508/month',
    formattedStandardUsd: '$79/month',
    formattedStandardInr: '₹7,508/month',
    checkoutLabel: '$79 USD / month (Founding Price)',
    checkoutLabelInr: '₹7,508 INR / month (Founding Price)',
    standardMonthlyPrice: 79,
    foundingMonthlyPrice: 79,
    monthlySavings: 0,
    formattedFounding: '$79/month',
    formattedStandard: '$79/month'
  },
  pro: {
    tier: 'pro',
    eligible: false,
    standardMonthlyPriceUsd: 349,
    foundingMonthlyPriceUsd: 349,
    monthlySavingsUsd: 0,
    standardMonthlyPriceInr: 33169,
    foundingMonthlyPriceInr: 33169,
    monthlySavingsInr: 0,
    formattedFoundingUsd: '$349/month',
    formattedFoundingInr: '₹33,169/month',
    formattedStandardUsd: '$349/month',
    formattedStandardInr: '₹33,169/month',
    checkoutLabel: '$349 USD / month (Custom Terms Available)',
    checkoutLabelInr: '₹33,169 INR / month (Custom Terms Available)',
    standardMonthlyPrice: 349,
    foundingMonthlyPrice: 349,
    monthlySavings: 0,
    formattedFounding: '$349/month',
    formattedStandard: '$349/month'
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
    amountInr: number;
    amountPaise: number;
    formatted: string;
    formattedInr: string;
    checkoutLabel: string;
    checkoutLabelInr: string;
  };
  annual: {
    totalAmountUsd: number;
    totalAmountCents: number;
    totalAmountInr: number;
    totalAmountPaise: number;
    monthlyEquivalentUsd: number;
    monthlyEquivalentInr: number;
    formatted: string;
    formattedInr: string;
    checkoutLabel: string;
    checkoutLabelInr: string;
    savingsBadge: string;
    savingsBadgeInr: string;
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

/**
 * AUTHORITATIVE SIX PRICING OPTIONS
 * Annual billing represents 10 months of the monthly founding price, giving two months free.
 * INR figures are initial indicative converted prices treated as fixed published prices.
 */
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
      amountUsd: 29,
      amountCents: 2900,
      amountInr: 2756,
      amountPaise: 275600,
      formatted: '$29/month',
      formattedInr: '₹2,756/month',
      checkoutLabel: '$29 USD / month',
      checkoutLabelInr: '₹2,756 INR / month'
    },
    annual: {
      totalAmountUsd: 290,
      totalAmountCents: 29000,
      totalAmountInr: 27562,
      totalAmountPaise: 2756200,
      monthlyEquivalentUsd: 24,
      monthlyEquivalentInr: 2297,
      formatted: '$290/year',
      formattedInr: '₹27,562/year',
      checkoutLabel: '$290 USD / year (2 months free)',
      checkoutLabelInr: '₹27,562 INR / year (2 months free)',
      savingsBadge: '2 months free (Save $58/yr)',
      savingsBadgeInr: '2 months free (Save ₹5,512/yr)'
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
      amountUsd: 79,
      amountCents: 7900,
      amountInr: 7508,
      amountPaise: 750800,
      formatted: '$79/month',
      formattedInr: '₹7,508/month',
      checkoutLabel: '$79 USD / month',
      checkoutLabelInr: '₹7,508 INR / month'
    },
    annual: {
      totalAmountUsd: 790,
      totalAmountCents: 79000,
      totalAmountInr: 75082,
      totalAmountPaise: 7508200,
      monthlyEquivalentUsd: 66,
      monthlyEquivalentInr: 6257,
      formatted: '$790/year',
      formattedInr: '₹75,082/year',
      checkoutLabel: '$790 USD / year (2 months free)',
      checkoutLabelInr: '₹75,082 INR / year (2 months free)',
      savingsBadge: '2 months free (Save $158/yr)',
      savingsBadgeInr: '2 months free (Save ₹15,016/yr)'
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
      amountInr: 33169,
      amountPaise: 3316900,
      formatted: '$349/month',
      formattedInr: '₹33,169/month',
      checkoutLabel: '$349 USD / month',
      checkoutLabelInr: '₹33,169 INR / month'
    },
    annual: {
      totalAmountUsd: 3490,
      totalAmountCents: 349000,
      totalAmountInr: 331690,
      totalAmountPaise: 33169000,
      monthlyEquivalentUsd: 291,
      monthlyEquivalentInr: 27641,
      formatted: '$3,490/year',
      formattedInr: '₹331,690/year',
      checkoutLabel: '$3,490 USD / year (2 months free)',
      checkoutLabelInr: '₹331,690 INR / year (2 months free)',
      savingsBadge: '2 months free (Save $698/yr)',
      savingsBadgeInr: '2 months free (Save ₹66,338/yr)'
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
 * Normalizes input billing cycle / interval keys
 */
export function normalizeBillingInterval(rawCycle?: string): 'monthly' | 'annual' {
  const clean = String(rawCycle || 'monthly').toLowerCase().trim();
  return clean === 'annual' || clean === 'yearly' ? 'annual' : 'monthly';
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
 * Used by backend to validate payments against published fixed prices.
 */
export function getExpectedPlanAmount(
  rawTier?: string,
  rawCycle?: string,
  _isFoundingOffer?: boolean,
  rawCurrency?: string
): {
  tier: 'starter' | 'growth' | 'pro';
  billingCycle: 'monthly' | 'annual';
  billingInterval: 'monthly' | 'annual';
  name: string;
  amountUsd: number;
  amountCents: number;
  amountInr: number;
  amountPaise: number;
  currency: 'USD' | 'INR';
  formatted: string;
  formattedInr: string;
  checkoutLabel: string;
  isFoundingOffer: boolean;
} {
  const tier = normalizePlanTier(rawTier);
  const cycle = normalizeBillingInterval(rawCycle);
  const plan = CENTRAL_PRICING[tier];
  const currency: 'USD' | 'INR' = String(rawCurrency || 'USD').toUpperCase().trim() === 'INR' ? 'INR' : 'USD';

  if (cycle === 'annual') {
    return {
      tier,
      billingCycle: 'annual',
      billingInterval: 'annual',
      name: `${plan.displayName} Annual`,
      amountUsd: plan.annual.totalAmountUsd,
      amountCents: plan.annual.totalAmountCents,
      amountInr: plan.annual.totalAmountInr,
      amountPaise: plan.annual.totalAmountPaise,
      currency,
      formatted: plan.annual.formatted,
      formattedInr: plan.annual.formattedInr,
      checkoutLabel: currency === 'INR' ? plan.annual.checkoutLabelInr : plan.annual.checkoutLabel,
      isFoundingOffer: true
    };
  }

  return {
    tier,
    billingCycle: 'monthly',
    billingInterval: 'monthly',
    name: `${plan.displayName} Monthly`,
    amountUsd: plan.monthly.amountUsd,
    amountCents: plan.monthly.amountCents,
    amountInr: plan.monthly.amountInr,
    amountPaise: plan.monthly.amountPaise,
    currency,
    formatted: plan.monthly.formatted,
    formattedInr: plan.monthly.formattedInr,
    checkoutLabel: currency === 'INR' ? plan.monthly.checkoutLabelInr : plan.monthly.checkoutLabel,
    isFoundingOffer: true
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
  billing_interval: 'monthly' | 'annual';
  amount_usd: number;
  amount_cents: number;
  amount_inr: number;
  amount_paise: number;
  currency: 'USD';
  currency_inr: 'INR';
  formatted: string;
  formattedInr: string;
  checkout_label: string;
  checkout_label_inr: string;
  razorpay_plan_id: string;
  is_active: boolean;
  is_founding_offer?: boolean;
  discountDescription: string;
  created_at: string;
  updated_at: string;
}

export function buildAuthoritativeBillingPlans(): AuthoritativeBillingPlanRecord[] {
  const now = new Date().toISOString();
  return [
    // 1. Starter Monthly: $29 USD / ₹2,756 INR
    {
      id: 'plan_tier_starter_monthly',
      name: 'Churnveda Starter — Monthly',
      tier: 'starter',
      billing_cycle: 'monthly',
      billing_interval: 'monthly',
      amount_usd: 29,
      amount_cents: 2900,
      amount_inr: 2756,
      amount_paise: 275600,
      currency: 'USD',
      currency_inr: 'INR',
      formatted: '$29/month',
      formattedInr: '₹2,756/month',
      checkout_label: '$29 USD / month',
      checkout_label_inr: '₹2,756 INR / month',
      discountDescription: 'Fixed monthly billing in USD (International) / INR (India)',
      razorpay_plan_id: process.env.RAZORPAY_STARTER_MONTHLY_PLAN_ID || process.env.RAZORPAY_PLAN_STARTER_MONTHLY || 'plan_TeZlsQOQaeAWAw',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now
    },
    // 2. Starter Annual: $290 USD / ₹27,562 INR (10 months price = 2 months free)
    {
      id: 'plan_tier_starter_annual',
      name: 'Churnveda Starter — Annual',
      tier: 'starter',
      billing_cycle: 'annual',
      billing_interval: 'annual',
      amount_usd: 290,
      amount_cents: 29000,
      amount_inr: 27562,
      amount_paise: 2756200,
      currency: 'USD',
      currency_inr: 'INR',
      formatted: '$290/year',
      formattedInr: '₹27,562/year',
      checkout_label: '$290 USD / year (2 months free)',
      checkout_label_inr: '₹27,562 INR / year (2 months free)',
      discountDescription: '2 months free — 10 months of monthly founding price',
      razorpay_plan_id: process.env.RAZORPAY_STARTER_ANNUAL_PLAN_ID || process.env.RAZORPAY_PLAN_STARTER_ANNUAL || 'plan_TeZMQYLVPEtQuj',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now
    },
    // 3. Growth Monthly: $79 USD / ₹7,508 INR
    {
      id: 'plan_tier_growth_monthly',
      name: 'Churnveda Growth — Monthly',
      tier: 'growth',
      billing_cycle: 'monthly',
      billing_interval: 'monthly',
      amount_usd: 79,
      amount_cents: 7900,
      amount_inr: 7508,
      amount_paise: 750800,
      currency: 'USD',
      currency_inr: 'INR',
      formatted: '$79/month',
      formattedInr: '₹7,508/month',
      checkout_label: '$79 USD / month',
      checkout_label_inr: '₹7,508 INR / month',
      discountDescription: 'Fixed monthly billing in USD (International) / INR (India)',
      razorpay_plan_id: process.env.RAZORPAY_GROWTH_MONTHLY_PLAN_ID || process.env.RAZORPAY_PLAN_GROWTH_MONTHLY || 'plan_TeZQFjmJoxrnKM',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now
    },
    // 4. Growth Annual: $790 USD / ₹75,082 INR (10 months price = 2 months free)
    {
      id: 'plan_tier_growth_annual',
      name: 'Churnveda Growth — Annual',
      tier: 'growth',
      billing_cycle: 'annual',
      billing_interval: 'annual',
      amount_usd: 790,
      amount_cents: 79000,
      amount_inr: 75082,
      amount_paise: 7508200,
      currency: 'USD',
      currency_inr: 'INR',
      formatted: '$790/year',
      formattedInr: '₹75,082/year',
      checkout_label: '$790 USD / year (2 months free)',
      checkout_label_inr: '₹75,082 INR / year (2 months free)',
      discountDescription: '2 months free — 10 months of monthly founding price',
      razorpay_plan_id: process.env.RAZORPAY_GROWTH_ANNUAL_PLAN_ID || process.env.RAZORPAY_PLAN_GROWTH_ANNUAL || 'plan_TfXxPsAOqPYklF',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now
    },
    // 5. Enterprise Monthly: $349 USD / ₹33,169 INR
    {
      id: 'plan_tier_pro_monthly',
      name: 'Churnveda Enterprise — Monthly',
      tier: 'pro',
      billing_cycle: 'monthly',
      billing_interval: 'monthly',
      amount_usd: 349,
      amount_cents: 34900,
      amount_inr: 33169,
      amount_paise: 3316900,
      currency: 'USD',
      currency_inr: 'INR',
      formatted: '$349/month',
      formattedInr: '₹33,169/month',
      checkout_label: '$349 USD / month',
      checkout_label_inr: '₹33,169 INR / month',
      discountDescription: 'Fixed monthly billing in USD (International) / INR (India)',
      razorpay_plan_id: process.env.RAZORPAY_ENTERPRISE_MONTHLY_PLAN_ID || process.env.RAZORPAY_PLAN_PRO_MONTHLY || 'plan_TeZraPPrYthtEk',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now
    },
    // 6. Enterprise Annual: $3,490 USD / ₹331,690 INR (10 months price = 2 months free)
    {
      id: 'plan_tier_pro_annual',
      name: 'Churnveda Enterprise — Annual',
      tier: 'pro',
      billing_cycle: 'annual',
      billing_interval: 'annual',
      amount_usd: 3490,
      amount_cents: 349000,
      amount_inr: 331690,
      amount_paise: 33169000,
      currency: 'USD',
      currency_inr: 'INR',
      formatted: '$3,490/year',
      formattedInr: '₹331,690/year',
      checkout_label: '$3,490 USD / year (2 months free)',
      checkout_label_inr: '₹331,690 INR / year (2 months free)',
      discountDescription: '2 months free — 10 months of monthly founding price',
      razorpay_plan_id: process.env.RAZORPAY_ENTERPRISE_ANNUAL_PLAN_ID || process.env.RAZORPAY_PLAN_PRO_ANNUAL || 'plan_Tea17dB6H4EHdn',
      is_active: true,
      is_founding_offer: true,
      created_at: now,
      updated_at: now
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
  const normCurrency = String(currency || 'USD').toUpperCase().trim();
  const isINR = normCurrency === 'INR';
  const expected = getExpectedPlanAmount(planId, billingCycle, isFoundingOffer, isINR ? 'INR' : 'USD');

  if (amount !== undefined && amount !== null && amount !== '') {
    const num = Number(amount);
    if (isINR) {
      const matchesPaise = num === expected.amountPaise;
      const matchesInr = num === expected.amountInr;
      if (!matchesPaise && !matchesInr) {
        return {
          isValid: false,
          error: `Invalid amount: received ${num}, expected ₹${expected.amountInr} INR (${expected.amountPaise} paise) for ${expected.name}.`,
          expected
        };
      }
    } else {
      const matchesCents = num === expected.amountCents;
      const matchesUsd = num === expected.amountUsd;
      if (!matchesCents && !matchesUsd) {
        return {
          isValid: false,
          error: `Invalid amount: received ${num}, expected $${expected.amountUsd} USD (${expected.amountCents} cents) for ${expected.name}.`,
          expected
        };
      }
    }
  }

  return { isValid: true, expected };
}

