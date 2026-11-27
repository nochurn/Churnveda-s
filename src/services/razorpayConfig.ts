/**
 * Churnveda Authoritative Razorpay Configuration & Payment Methods
 *
 * Supported Payment Methods:
 * - UPI (Google Pay, PhonePe, Paytm, BHIM, any UPI ID / QR)
 * - Credit Cards (Visa, Mastercard, Amex, RuPay, Diners)
 * - Debit Cards (Visa, Mastercard, RuPay, Maestro)
 * - Netbanking (All Indian banks: HDFC, ICICI, SBI, Axis, Kotak, etc.)
 * - Wallets (Paytm, PhonePe, Mobikwik, Amazon Pay, Freecharge)
 */

import { CENTRAL_PRICING, FOUNDING_OFFER_CONFIG, getPlanPricing, PlanEdition } from '../config/pricing';

export { FOUNDING_OFFER_CONFIG };

export interface RazorpayPaymentMethodConfig {
  upi: boolean;
  card: boolean;
  netbanking: boolean;
  wallet: boolean;
  emi: boolean;
  paylater: boolean;
}

/**
 * Authoritative one-time payment methods configuration for Razorpay Checkout.
 * Used for:
 * A. $1 trial verification
 * B. Annual plan activation
 * C. One-time upgrade payments
 * D. Failed-payment retry
 */
export const oneTimePaymentMethods: RazorpayPaymentMethodConfig = {
  upi: true,
  card: true,
  netbanking: true,
  wallet: true,
  emi: false,
  paylater: false
};

/**
 * Standard required disclosures
 */
export const ONE_TIME_PAYMENT_DISCLOSURE =
  'One-time payment via debit/credit card, netbanking, UPI, or wallet.';

export const USD_RECURRING_CARD_DISCLOSURE =
  'USD recurring billing authorizes a Razorpay Subscription mandate on Visa, Mastercard, or Amex cards (UPI AutoPay is not supported for USD recurring billing).';

export const MONTHLY_RECURRING_DISCLOSURE =
  'Monthly billing charged in USD on a 30-day recurring card mandate cycle.';

export const RECURRING_MANDATE_DISCLOSURE = USD_RECURRING_CARD_DISCLOSURE;

export interface AuthoritativePlanSummary {
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  annualTotalPrice: number;
  monthlyPriceInr: number;
  annualTotalPriceInr: number;
  formattedMonthly: string;
  formattedAnnual: string;
  formattedMonthlyInr: string;
  formattedAnnualInr: string;
  checkoutMonthlyLabel: string;
  checkoutAnnualLabel: string;
  checkoutMonthlyLabelInr: string;
  checkoutAnnualLabelInr: string;
}

export function getAuthoritativePlan(
  tier?: string,
  edition: PlanEdition | string | boolean | null = 'standard'
): AuthoritativePlanSummary {
  const p = getPlanPricing(tier, edition);
  return {
    name: p.displayName,
    monthlyPrice: p.monthly.amountUsd,
    annualPrice: p.annual.monthlyEquivalentUsd,
    annualTotalPrice: p.annual.totalAmountUsd,
    monthlyPriceInr: p.monthly.amountInr,
    annualTotalPriceInr: p.annual.totalAmountInr,
    formattedMonthly: p.monthly.formatted,
    formattedAnnual: p.annual.formatted,
    formattedMonthlyInr: p.monthly.formattedInr,
    formattedAnnualInr: p.annual.formattedInr,
    checkoutMonthlyLabel: p.monthly.checkoutLabel,
    checkoutAnnualLabel: p.annual.checkoutLabel,
    checkoutMonthlyLabelInr: p.monthly.checkoutLabelInr,
    checkoutAnnualLabelInr: p.annual.checkoutLabelInr
  };
}

/**
 * Authoritative Standard (Regular Pricing) lookup (USD) derived directly from centralized pricing
 * Starter: $29/mo ($290/yr) | Growth: $79/mo ($790/yr) | Enterprise: $349/mo ($3,490/yr)
 * Use getAuthoritativePlan(tier, edition) when Founding Member Edition pricing may apply.
 */
export const AUTHORITATIVE_PLANS: Record<string, AuthoritativePlanSummary> = {
  starter: getAuthoritativePlan('starter', 'standard'),
  growth: getAuthoritativePlan('growth', 'standard'),
  pro: getAuthoritativePlan('pro', 'standard'),
  enterprise: getAuthoritativePlan('pro', 'standard')
};

/**
 * Helper to build Razorpay Standard Checkout options for one-time payments
 * ($1 verification / INR annual or one-time upgrade checkout)
 */
export function buildRazorpayOneTimeOptions(params: {
  keyId: string;
  orderId: string;
  amountPaise?: number;
  amountCents?: number;
  amount?: number;
  currency?: string;
  name?: string;
  description: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  notes?: Record<string, string>;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  onDismiss?: () => void;
}) {
  const chargeAmount = params.amount ?? params.amountCents ?? params.amountPaise ?? 0;
  return {
    key: params.keyId,
    amount: chargeAmount,
    currency: params.currency || 'USD',
    name: params.name || 'Churnveda',
    description: params.description,
    order_id: params.orderId,
    prefill: {
      name: params.customerName || 'Founder',
      email: params.customerEmail || 'founder@churnveda.com',
      contact: params.customerPhone || ''
    },
    notes: params.notes || {},
    method: {
      upi: true,
      card: true,
      netbanking: true,
      wallet: true,
      emi: false,
      paylater: false
    },
    config: {
      display: {
        blocks: {
          preferred: {
            name: 'Pay via UPI, Cards, Netbanking or Wallet',
            instruments: [
              { method: 'upi' },
              { method: 'card' },
              { method: 'netbanking' },
              { method: 'wallet' }
            ]
          }
        },
        sequence: ['block.preferred'],
        preferences: {
          show_default_blocks: true
        }
      }
    },
    theme: {
      color: '#1E3A8A'
    },
    modal: {
      ondismiss: params.onDismiss || (() => {})
    },
    handler: params.handler
  };
}

/**
 * Helper to build Razorpay Checkout options for Recurring Subscriptions & Trial Mandates.
 * USD recurring mandates strictly restrict checkout to Card (`cardOnly: true` by default).
 */
export function buildRazorpaySubscriptionOptions(params: {
  keyId: string;
  subscriptionId: string;
  name?: string;
  description?: string;
  planName?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  cardOnly?: boolean;
  notes?: Record<string, string>;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  onDismiss?: () => void;
}) {
  const useCardOnly = params.cardOnly !== false;
  return {
    key: params.keyId,
    subscription_id: params.subscriptionId,
    name: params.name || 'Churnveda',
    description: params.description || (params.planName ? `${params.planName} Recurring Card Mandate` : 'Churnveda Recurring Card Mandate'),
    prefill: {
      name: params.customerName || 'Founder',
      email: params.customerEmail || 'founder@churnveda.com',
      contact: params.customerPhone || ''
    },
    notes: params.notes || {},
    method: useCardOnly
      ? {
          card: true,
          upi: false,
          netbanking: false,
          wallet: false,
          emi: false,
          paylater: false
        }
      : {
          card: true,
          upi: true,
          netbanking: true,
          wallet: false,
          emi: false,
          paylater: false
        },
    config: {
      display: {
        blocks: {
          mandate: {
            name: useCardOnly
              ? 'International & Domestic Card Mandate (Visa / Mastercard / Amex)'
              : 'Card Mandate & UPI AutoPay',
            instruments: useCardOnly
              ? [{ method: 'card' }]
              : [{ method: 'card' }, { method: 'upi' }, { method: 'netbanking' }]
          }
        },
        sequence: ['block.mandate'],
        preferences: {
          show_default_blocks: !useCardOnly
        }
      }
    },
    theme: {
      color: '#1E3A8A'
    },
    modal: {
      ondismiss: params.onDismiss || (() => {})
    },
    handler: params.handler
  };
}
