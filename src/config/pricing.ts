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
 * AUTHORITATIVE PRICING (USD):
 * Standard (Regular Pricing — Default Edition for new customers):
 *   Starter:    $29/month  | $290/year (10 months = 2 months free)
 *   Growth:     $79/month  | $790/year (10 months = 2 months free)
 *   Enterprise: $349/month | $3,490/year (10 months = 2 months free)
 *
 * Founding Member Edition (Exclusive Early Customer Pricing — Capacity Gated):
 *   Starter:    $19/month  | $190/year (10 months = 2 months free)
 *   Growth:     $59/month  | $590/year (10 months = 2 months free)
 *   Enterprise: Unchanged ($349/month | $3,490/year; no founding discount)
 */

export type PlanTierId = 'starter' | 'growth' | 'pro' | 'enterprise';
export type PlanEdition = 'founding' | 'standard';
export type AutopayStatus =
  | 'not_established'
  | 'pending'
  | 'authenticated'
  | 'active'
  | 'failed'
  | 'cancelled'
  | 'expired';
export type BillingCycle = 'monthly' | 'annual';
export type BillingInterval = 'monthly' | 'annual';
export type BillingCurrency = 'USD' | 'INR';

export interface EditionMarketingInfo {
  id: PlanEdition;
  label: string;
  shortLabel: string;
  badge: string;
  description: string;
}

export const EDITION_MARKETING: Record<PlanEdition, EditionMarketingInfo> = {
  founding: {
    id: 'founding',
    label: 'Founding Member Edition',
    shortLabel: 'Foundation',
    badge: 'Exclusive Early Customer Pricing',
    description: 'Best for early supporters who want founding-member pricing.'
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    shortLabel: 'Standard',
    badge: 'Regular Pricing',
    description: 'Best for businesses that need higher limits and more retention capacity.'
  }
};

/**
 * Authoritative Edition Configuration (Founding Member Edition vs Standard Regular Pricing)
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
    foundingMonthlyPriceUsd: 19,
    monthlySavingsUsd: 10,
    standardMonthlyPriceInr: 2756,
    foundingMonthlyPriceInr: 1806,
    monthlySavingsInr: 950,
    formattedFoundingUsd: '$19/month',
    formattedFoundingInr: '₹1,806/month',
    formattedStandardUsd: '$29/month',
    formattedStandardInr: '₹2,756/month',
    checkoutLabel: '$19 USD / month',
    checkoutLabelInr: '₹1,806 INR / month',
    standardMonthlyPrice: 29,
    foundingMonthlyPrice: 19,
    monthlySavings: 10,
    formattedFounding: '$19/month',
    formattedStandard: '$29/month'
  },
  growth: {
    tier: 'growth',
    eligible: true,
    standardMonthlyPriceUsd: 79,
    foundingMonthlyPriceUsd: 59,
    monthlySavingsUsd: 20,
    standardMonthlyPriceInr: 7508,
    foundingMonthlyPriceInr: 5607,
    monthlySavingsInr: 1901,
    formattedFoundingUsd: '$59/month',
    formattedFoundingInr: '₹5,607/month',
    formattedStandardUsd: '$79/month',
    formattedStandardInr: '₹7,508/month',
    checkoutLabel: '$59 USD / month',
    checkoutLabelInr: '₹5,607 INR / month',
    standardMonthlyPrice: 79,
    foundingMonthlyPrice: 59,
    monthlySavings: 20,
    formattedFounding: '$59/month',
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
    checkoutLabel: '$349 USD / month',
    checkoutLabelInr: '₹33,169 INR / month',
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

/**
 * Authoritative Foundation (entry-level: 'founding') vs Standard (expanded: 'standard') Limits.
 * Prices and Razorpay Plan IDs stay locked while Standard grants significantly higher capacity and capabilities.
 */
export const EDITION_PLAN_LIMITS: Record<PlanEdition, Record<'starter' | 'growth' | 'pro', PlanLimits>> = {
  founding: {
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
  },
  standard: {
    starter: {
      customers: 250,
      aiScansPerDay: 2,
      customersAnalyzedPerScan: 250,
      topAtRiskCustomers: 10,
      aiRetentionMessagesPerMonth: 150,
      whatsappMessagesPerMonth: 150,
      emailMessagesPerMonth: 150,
      csvImportsPerMonth: 25,
      pdfImportsPerMonth: 10,
      customerHistoryDays: 180,
      teamMembers: 2,
      workspaces: 1,
      customIntegrations: 1,
      apiAccess: true,
      webhooks: true,
      advancedAutomation: true,
      customRiskRules: 'limited',
      prioritySupport: true,
      dedicatedOnboarding: false,
      sla: false
    },
    growth: {
      customers: 2500,
      aiScansPerDay: 5,
      customersAnalyzedPerScan: 2500,
      topAtRiskCustomers: 15,
      aiRetentionMessagesPerMonth: 1000,
      whatsappMessagesPerMonth: 1000,
      emailMessagesPerMonth: 1000,
      csvImportsPerMonth: 100,
      pdfImportsPerMonth: 50,
      customerHistoryDays: 730,
      teamMembers: 10,
      workspaces: 5,
      customIntegrations: 5,
      apiAccess: true,
      webhooks: true,
      advancedAutomation: true,
      customRiskRules: 'full',
      prioritySupport: true,
      dedicatedOnboarding: false,
      sla: false
    },
    pro: {
      customers: Infinity,
      aiScansPerDay: Infinity,
      customersAnalyzedPerScan: Infinity,
      topAtRiskCustomers: 50,
      aiRetentionMessagesPerMonth: 5000,
      whatsappMessagesPerMonth: 5000,
      emailMessagesPerMonth: 5000,
      csvImportsPerMonth: Infinity,
      pdfImportsPerMonth: Infinity,
      customerHistoryDays: Infinity,
      teamMembers: 50,
      workspaces: 25,
      customIntegrations: 25,
      apiAccess: true,
      webhooks: true,
      advancedAutomation: true,
      customRiskRules: 'full',
      prioritySupport: true,
      dedicatedOnboarding: true,
      sla: true
    }
  }
};

export const PLAN_LIMITS: Record<'starter' | 'growth' | 'pro', PlanLimits> = EDITION_PLAN_LIMITS.standard;

export function normalizePlanEdition(
  rawEdition?: string | boolean | null,
  defaultEdition: PlanEdition = 'standard'
): PlanEdition {
  if (rawEdition === false) return 'standard';
  if (rawEdition === true) return 'founding';
  const clean = String(rawEdition ?? '').toLowerCase().trim();
  if (!clean) return defaultEdition;
  if (clean === 'founding' || clean === 'foundation' || clean === 'founder') return 'founding';
  if (clean === 'standard' || clean === 'std' || clean === 'expanded' || clean === 'regular') return 'standard';
  return defaultEdition;
}

export function getEditionLabel(edition: PlanEdition): string {
  return EDITION_MARKETING[edition].label;
}

export function getEditionMarketing(edition: PlanEdition): EditionMarketingInfo {
  return EDITION_MARKETING[edition];
}

export function getPlanLimits(
  rawTier?: string,
  rawEdition?: string | boolean | null
): PlanLimits {
  const clean = String(rawTier || 'growth').toLowerCase().trim();
  const tier: 'starter' | 'growth' | 'pro' =
    clean === 'starter' ? 'starter' : clean === 'pro' || clean === 'enterprise' || clean === 'business' ? 'pro' : 'growth';
  const edition = normalizePlanEdition(rawEdition);
  return EDITION_PLAN_LIMITS[edition][tier];
}

export function getEditionPlanFeatures(
  tier: 'starter' | 'growth' | 'pro',
  edition: PlanEdition
): string[] {
  const l = EDITION_PLAN_LIMITS[edition][tier];
  const custStr = l.customers === Infinity ? 'Unlimited customers monitored' : `${l.customers.toLocaleString()} customers monitored`;
  const scanStr = l.aiScansPerDay === Infinity ? 'Unlimited daily AI scans' : `${l.aiScansPerDay} AI ${l.aiScansPerDay === 1 ? 'scan' : 'scans'} / day (${l.customersAnalyzedPerScan.toLocaleString()} analyzed)`;
  const topStr = `Top ${l.topAtRiskCustomers} at-risk priorities daily`;
  const msgStr = `${l.aiRetentionMessagesPerMonth.toLocaleString()} AI retention messages / month`;
  const impStr = l.csvImportsPerMonth === Infinity ? 'Unlimited CSV & PDF imports' : `${l.csvImportsPerMonth} CSV & ${l.pdfImportsPerMonth} PDF imports / month`;
  const histStr = l.customerHistoryDays === Infinity ? 'Unlimited customer history window' : `${l.customerHistoryDays} days customer history`;
  const teamStr = `${l.teamMembers} team ${l.teamMembers === 1 ? 'member' : 'members'} & ${l.workspaces} ${l.workspaces === 1 ? 'workspace' : 'workspaces'}`;
  const intStr = l.customIntegrations === 0 ? 'WhatsApp & Email (Resend) channels' : `${l.customIntegrations} custom billing/CRM ${l.customIntegrations === 1 ? 'integration' : 'integrations'}`;
  const features = [custStr, scanStr, topStr, msgStr, impStr, histStr, teamStr, intStr];
  if (l.advancedAutomation) features.push('Scheduled Daily Retention Briefs');
  else features.push('Manual AI Retention Briefs');
  if (l.apiAccess && l.webhooks) features.push('API access & Razorpay webhooks');
  if (l.customRiskRules === 'full') features.push('Full custom churn risk scoring rules');
  else if (l.customRiskRules === 'limited') features.push('Standard churn risk scoring rules');
  if (l.prioritySupport) features.push('Priority support');
  if (l.dedicatedOnboarding) features.push('Dedicated onboarding & SLA');
  return features;
}

export interface EditionComparisonRow {
  label: string;
  foundation: string;
  standard: string;
}

export function getFoundationVsStandardComparison(tier: 'starter' | 'growth' | 'pro'): EditionComparisonRow[] {
  const f = EDITION_PLAN_LIMITS.founding[tier];
  const s = EDITION_PLAN_LIMITS.standard[tier];
  return [
    {
      label: 'Monitored Customers',
      foundation: f.customers === Infinity ? 'Unlimited' : `${f.customers.toLocaleString()} customers`,
      standard: s.customers === Infinity ? 'Unlimited' : `${s.customers.toLocaleString()} customers`
    },
    {
      label: 'Daily AI Employee Scans',
      foundation: f.aiScansPerDay === Infinity ? 'Unlimited' : `${f.aiScansPerDay}/day (${f.customersAnalyzedPerScan.toLocaleString()} analyzed)`,
      standard: s.aiScansPerDay === Infinity ? 'Unlimited' : `${s.aiScansPerDay}/day (${s.customersAnalyzedPerScan.toLocaleString()} analyzed)`
    },
    {
      label: 'Daily Top At-Risk Priorities',
      foundation: `Top ${f.topAtRiskCustomers} accounts`,
      standard: `Top ${s.topAtRiskCustomers} accounts`
    },
    {
      label: 'Monthly Retention Messages (WhatsApp & Email)',
      foundation: `${f.aiRetentionMessagesPerMonth.toLocaleString()} / month`,
      standard: `${s.aiRetentionMessagesPerMonth.toLocaleString()} / month`
    },
    {
      label: 'Monthly Data Imports',
      foundation: f.csvImportsPerMonth === Infinity ? 'Unlimited' : `${f.csvImportsPerMonth} CSV · ${f.pdfImportsPerMonth} PDF`,
      standard: s.csvImportsPerMonth === Infinity ? 'Unlimited' : `${s.csvImportsPerMonth} CSV · ${s.pdfImportsPerMonth} PDF`
    },
    {
      label: 'Customer History & Briefs Retention',
      foundation: f.customerHistoryDays === Infinity ? 'Unlimited' : `${f.customerHistoryDays} days`,
      standard: s.customerHistoryDays === Infinity ? 'Unlimited' : `${s.customerHistoryDays} days`
    },
    {
      label: 'Team Members & Workspaces',
      foundation: `${f.teamMembers} member${f.teamMembers === 1 ? '' : 's'} · ${f.workspaces} workspace${f.workspaces === 1 ? '' : 's'}`,
      standard: `${s.teamMembers} members · ${s.workspaces} workspace${s.workspaces === 1 ? '' : 's'}`
    },
    {
      label: 'Custom CRM / Billing Integrations',
      foundation: f.customIntegrations === 0 ? 'Core Email/WhatsApp only' : `Up to ${f.customIntegrations} integrations`,
      standard: `Up to ${s.customIntegrations} integration${s.customIntegrations === 1 ? '' : 's'}`
    },
    {
      label: 'Scheduled Daily Retention Briefs',
      foundation: f.advancedAutomation ? 'Included' : 'Manual scan only',
      standard: s.advancedAutomation ? 'Automated daily schedule' : 'Manual scan only'
    },
    {
      label: 'Webhook & API Access',
      foundation: f.apiAccess ? 'Included' : 'Not included',
      standard: s.apiAccess ? 'Included' : 'Not included'
    },
    {
      label: 'Custom Risk Scoring Rules',
      foundation: f.customRiskRules === 'none' ? 'Default model only' : f.customRiskRules === 'limited' ? 'Limited presets' : 'Full rules',
      standard: s.customRiskRules === 'limited' ? 'Limited presets' : 'Full rules'
    },
    {
      label: 'Support Level',
      foundation: f.prioritySupport ? 'Priority support' : 'Standard email support',
      standard: 'Priority support'
    }
  ];
}


/**
 * AUTHORITATIVE EDITION PRICING MATRIX
 * Annual billing represents 10 months of the corresponding edition's monthly price (2 months free).
 * INR figures use fixed indicative published equivalents matching Razorpay international/INR config.
 */
export const EDITION_PRICING: Record<PlanEdition, Record<'starter' | 'growth' | 'pro', PlanPricingDetails>> = {
  founding: {
    starter: {
      id: 'starter',
      displayName: 'Starter',
      customersIncluded: '100 customers',
      description: 'Founding Member entry edition of the AI Retention Employee.',
      features: getEditionPlanFeatures('starter', 'founding'),
      monthly: {
        amountUsd: 19,
        amountCents: 1900,
        amountInr: 1806,
        amountPaise: 180600,
        formatted: '$19/month',
        formattedInr: '₹1,806/month',
        checkoutLabel: '$19 USD / month',
        checkoutLabelInr: '₹1,806 INR / month'
      },
      annual: {
        totalAmountUsd: 190,
        totalAmountCents: 19000,
        totalAmountInr: 18058,
        totalAmountPaise: 1805800,
        monthlyEquivalentUsd: 16,
        monthlyEquivalentInr: 1505,
        formatted: '$190/year',
        formattedInr: '₹18,058/year',
        checkoutLabel: '$190 USD / year (2 months free)',
        checkoutLabelInr: '₹18,058 INR / year (2 months free)',
        savingsBadge: '2 months free (Save $38/yr)',
        savingsBadgeInr: '2 months free (Save ₹3,614/yr)'
      }
    },
    growth: {
      id: 'growth',
      displayName: 'Growth',
      customersIncluded: '1,000 customers',
      description: 'Founding Member AI Retention Employee with core automations & API.',
      isPopular: true,
      features: getEditionPlanFeatures('growth', 'founding'),
      monthly: {
        amountUsd: 59,
        amountCents: 5900,
        amountInr: 5607,
        amountPaise: 560700,
        formatted: '$59/month',
        formattedInr: '₹5,607/month',
        checkoutLabel: '$59 USD / month',
        checkoutLabelInr: '₹5,607 INR / month'
      },
      annual: {
        totalAmountUsd: 590,
        totalAmountCents: 59000,
        totalAmountInr: 56073,
        totalAmountPaise: 5607300,
        monthlyEquivalentUsd: 49,
        monthlyEquivalentInr: 4673,
        formatted: '$590/year',
        formattedInr: '₹56,073/year',
        checkoutLabel: '$590 USD / year (2 months free)',
        checkoutLabelInr: '₹56,073 INR / year (2 months free)',
        savingsBadge: '2 months free (Save $118/yr)',
        savingsBadgeInr: '2 months free (Save ₹11,211/yr)'
      }
    },
    pro: {
      id: 'pro',
      displayName: 'Enterprise',
      customersIncluded: 'Unlimited customers',
      description: 'Enterprise retention intelligence, dedicated scale & custom integrations.',
      features: getEditionPlanFeatures('pro', 'standard'),
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
  },
  standard: {
    starter: {
      id: 'starter',
      displayName: 'Starter',
      customersIncluded: '250 customers',
      description: 'AI Retention Employee for growing SaaS products with automated daily scans & API.',
      features: getEditionPlanFeatures('starter', 'standard'),
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
      customersIncluded: '2,500 customers',
      description: 'Complete AI Retention Employee with higher capacity, full risk rules & API.',
      isPopular: true,
      features: getEditionPlanFeatures('growth', 'standard'),
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
      features: getEditionPlanFeatures('pro', 'standard'),
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
  }
};

/**
 * Default Regular Pricing (Standard edition)
 */
export const CENTRAL_PRICING: Record<'starter' | 'growth' | 'pro', PlanPricingDetails> = EDITION_PRICING.standard;

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
 * Get pricing details for a given plan tier and edition (defaults to Standard Regular Pricing)
 */
export function getPlanPricing(
  rawTier?: string,
  rawEdition?: string | boolean | null
): PlanPricingDetails {
  const key = normalizePlanTier(rawTier);
  // Enterprise has a single regular pricing schedule
  const edition: PlanEdition = key === 'pro' ? 'standard' : normalizePlanEdition(rawEdition, 'standard');
  return EDITION_PRICING[edition][key];
}

/**
 * Authoritative lookup for expected charge amount and currency.
 * Used by backend to validate payments against published fixed prices.
 */
export function getExpectedPlanAmount(
  rawTier?: string,
  rawCycle?: string,
  editionOrFounding?: PlanEdition | boolean | null,
  rawCurrency?: string
): {
  tier: 'starter' | 'growth' | 'pro';
  planEdition: PlanEdition;
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
  const requestedEdition = normalizePlanEdition(editionOrFounding, 'standard');
  const effectiveEdition: PlanEdition = tier === 'pro' ? 'standard' : requestedEdition;
  const plan = EDITION_PRICING[effectiveEdition][tier];
  const currency: 'USD' | 'INR' = String(rawCurrency || 'USD').toUpperCase().trim() === 'INR' ? 'INR' : 'USD';
  const isFounding = effectiveEdition === 'founding';

  if (cycle === 'annual') {
    return {
      tier,
      planEdition: effectiveEdition,
      billingCycle: 'annual',
      billingInterval: 'annual',
      name: `${plan.displayName}${isFounding ? ' (Founding Member Edition)' : ''} Annual`,
      amountUsd: plan.annual.totalAmountUsd,
      amountCents: plan.annual.totalAmountCents,
      amountInr: plan.annual.totalAmountInr,
      amountPaise: plan.annual.totalAmountPaise,
      currency,
      formatted: plan.annual.formatted,
      formattedInr: plan.annual.formattedInr,
      checkoutLabel: currency === 'INR' ? plan.annual.checkoutLabelInr : plan.annual.checkoutLabel,
      isFoundingOffer: isFounding
    };
  }

  return {
    tier,
    planEdition: effectiveEdition,
    billingCycle: 'monthly',
    billingInterval: 'monthly',
    name: `${plan.displayName}${isFounding ? ' (Founding Member Edition)' : ''} Monthly`,
    amountUsd: plan.monthly.amountUsd,
    amountCents: plan.monthly.amountCents,
    amountInr: plan.monthly.amountInr,
    amountPaise: plan.monthly.amountPaise,
    currency,
    formatted: plan.monthly.formatted,
    formattedInr: plan.monthly.formattedInr,
    checkoutLabel: currency === 'INR' ? plan.monthly.checkoutLabelInr : plan.monthly.checkoutLabel,
    isFoundingOffer: isFounding
  };
}

/**
 * Authoritative list of billing plans for DB synchronization & Admin views
 */
export interface AuthoritativeBillingPlanRecord {
  id: string;
  name: string;
  tier: 'starter' | 'growth' | 'pro';
  plan_edition: PlanEdition;
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

/**
 * Validates whether a payment amount and currency strictly match the authoritative plan
 */
export function validatePaymentMatch(
  planId: string | undefined,
  billingCycle: string | undefined,
  amount: number | string | undefined,
  currency: string | undefined,
  editionOrFounding?: PlanEdition | boolean | null
): { isValid: boolean; error?: string; expected: ReturnType<typeof getExpectedPlanAmount> } {
  const normCurrency = String(currency || 'USD').toUpperCase().trim();
  const isINR = normCurrency === 'INR';
  const expected = getExpectedPlanAmount(planId, billingCycle, editionOrFounding, isINR ? 'INR' : 'USD');

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


