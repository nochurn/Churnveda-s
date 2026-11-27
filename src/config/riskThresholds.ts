import type { RiskCategory } from '../types';

/**
 * Single authoritative Churn Risk Threshold definition shared across
 * backend scoring/filtering/alerts and frontend dashboard/AI Employee/analytics/reports.
 *
 * Bands (0–100 scale):
 * - Low:      0 – 30
 * - Medium:  31 – 60
 * - High:    61 – 85
 * - Critical: 86 – 100
 * - At-Risk (actionable cohort): >= 61 (High + Critical)
 */
export const CHURN_RISK_THRESHOLDS = {
  LOW_MAX: 30,
  MEDIUM_MIN: 31,
  MEDIUM_MAX: 60,
  HIGH_MIN: 61,
  HIGH_MAX: 85,
  CRITICAL_MIN: 86,
  AT_RISK_MIN: 61
} as const;

export function getCanonicalRiskCategory(score: number | null | undefined): RiskCategory {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return 'Low';
  }
  const s = Number(score);
  if (s >= CHURN_RISK_THRESHOLDS.CRITICAL_MIN) return 'Critical';
  if (s >= CHURN_RISK_THRESHOLDS.HIGH_MIN) return 'High';
  if (s >= CHURN_RISK_THRESHOLDS.MEDIUM_MIN) return 'Medium';
  return 'Low';
}

export function isAtRiskScore(score: number | null | undefined): boolean {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return false;
  return Number(score) >= CHURN_RISK_THRESHOLDS.AT_RISK_MIN;
}

export function isCriticalRiskScore(score: number | null | undefined): boolean {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return false;
  return Number(score) >= CHURN_RISK_THRESHOLDS.CRITICAL_MIN;
}

export function isHighRiskScore(score: number | null | undefined): boolean {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return false;
  const s = Number(score);
  return s >= CHURN_RISK_THRESHOLDS.HIGH_MIN && s < CHURN_RISK_THRESHOLDS.CRITICAL_MIN;
}

export function isMediumRiskScore(score: number | null | undefined): boolean {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return false;
  const s = Number(score);
  return s >= CHURN_RISK_THRESHOLDS.MEDIUM_MIN && s < CHURN_RISK_THRESHOLDS.HIGH_MIN;
}

export function isLowRiskScore(score: number | null | undefined): boolean {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return true;
  return Number(score) < CHURN_RISK_THRESHOLDS.MEDIUM_MIN;
}
