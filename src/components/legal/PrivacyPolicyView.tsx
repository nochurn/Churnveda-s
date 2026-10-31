import React from 'react';
import {
  Shield,
  Lock,
  FileText,
  Mail,
  CheckCircle2,
  Database,
  Globe,
  Download,
  AlertTriangle,
  Server,
  UserCheck,
  Building,
  ArrowLeft,
  Sparkles
} from 'lucide-react';

interface PrivacyPolicyViewProps {
  onNavigate: (view: string) => void;
}

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onNavigate }) => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back button */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-2xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to App</span>
        </button>

        <span className="text-xs text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
          Effective Date: October 2026 | Version 3.0
        </span>
      </div>

      {/* Main Container */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 sm:p-10 space-y-8">
        {/* Notice banner */}
        <aside aria-label="Legal draft notice" className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5">
            <span className="font-bold">Draft Notice:</span>
            <p className="text-[11px] text-amber-800">
              Draft: review with a lawyer before launch. This document describes the actual operational architecture of Churnveda as a B2B SaaS data processor.
            </p>
          </div>
        </aside>

        {/* Header */}
        <div className="border-b border-gray-200 pb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-900 rounded-full text-xs font-bold mb-3">
            <Shield className="w-3.5 h-3.5" aria-hidden="true" />
            <span>GDPR & CCPA Compliant Privacy Policy</span>
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Churnveda Privacy Policy</h1>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            At Churnveda Technologies Inc. ("Churnveda", "we", "us"), we build privacy-first customer intelligence software.
            This policy outlines what data we collect, why we collect it, how it is secured, and your full rights under global privacy laws.
          </p>
        </div>

        {/* Section 1: Business Only & Age Notice */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center font-bold text-xs">
              1
            </div>
            <h2 className="text-lg font-bold text-gray-900">B2B Platform & Age Eligibility (18+)</h2>
          </div>
          <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
            <p className="text-gray-700 leading-relaxed">
              Churnveda is exclusively a Business-to-Business (B2B) SaaS intelligence platform designed for business owners, customer success managers, and software executives. We do not provide services to consumers or children.
            </p>
            <p className="font-semibold text-gray-900 text-[11px]">
              No Children's Data Collected: Churnveda does not knowingly collect, process, or store personal data from individuals under 18 years of age. Customers are strictly prohibited under our Acceptable Use Policy from uploading personal data belonging to minors.
            </p>
          </div>
        </section>

        {/* Section 2: Data Minimization Audit */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center font-bold text-xs">
              2
            </div>
            <h2 className="text-lg font-bold text-gray-900">Data Minimization: What We Collect & Why</h2>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            In accordance with GDPR Article 5(1)(c) data minimization principles, Churnveda collects strictly the data elements necessary to calculate churn risk scores and draft approved retention messages. We audit our data collection regularly:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
              <span className="font-bold text-gray-900 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-blue-900" aria-hidden="true" />
                Customer Account Information
              </span>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                <strong>Fields collected:</strong> Name, work email address, company name, hashed password, billing plan.
                <br /><strong>Purpose:</strong> Account creation, authentication, subscription billing, and product notifications.
              </p>
            </div>

            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
              <span className="font-bold text-gray-900 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-900" aria-hidden="true" />
                End-User Customer Telemetry
              </span>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                <strong>Fields collected:</strong> Customer name/company, contact email, phone number (for WhatsApp outreach), monthly recurring revenue (MRR), last login date, support ticket count, usage trend percentage.
                <br /><strong>Purpose:</strong> Computing risk scores (0–100) and generating personalized outreach drafts.
              </p>
            </div>
          </div>
          <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl text-xs text-blue-950">
            <strong>Removed & Excluded Fields:</strong> Churnveda does not collect, request, or store social security numbers, government IDs, credit scores, raw payment card numbers, user biometric data, or end-user browsing histories outside of direct app telemetry.
          </div>
        </section>

        {/* Section 3: AI Processing & Third-Party Disclosure */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center font-bold text-xs">
              3
            </div>
            <h2 className="text-lg font-bold text-gray-900">AI Disclosure & AI Vendor Processing</h2>
          </div>
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-900 shrink-0" aria-hidden="true" />
              <strong className="text-gray-900 text-sm">How Artificial Intelligence Analyzes Your Data</strong>
            </div>
            <p className="text-gray-600 leading-relaxed">
              Churnveda employs Artificial Intelligence models (Google Gemini API via Google Cloud) to analyze telemetry signals (such as dropping login activity or unresolved support tickets) and to draft plain-English risk explanations and personalized outreach templates.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-gray-700">
              <li><strong>Zero Foundation Model Training:</strong> Your uploaded customer telemetry is processed under enterprise non-training commitments. Google does not use customer inputs or generated retention drafts to train foundation models.</li>
              <li><strong>Subprocessor Location:</strong> Google Cloud Platform infrastructure with SOC 2, ISO 27001, and HIPAA compliance attestations.</li>
              <li><strong>Human in the Loop:</strong> The AI only generates suggested drafts. No message is dispatched without manual review and human approval.</li>
            </ul>
          </div>
        </section>

        {/* Section 4: Third-Party SDK & Subprocessors Audit */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center font-bold text-xs">
              4
            </div>
            <h2 className="text-lg font-bold text-gray-900">Third-Party Subprocessors & Integrations</h2>
          </div>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
                <tr>
                  <th className="p-3">Vendor / Service</th>
                  <th className="p-3">Data Received</th>
                  <th className="p-3">Purpose</th>
                  <th className="p-3">Security Attestation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-600 text-[11px]">
                <tr>
                  <td className="p-3 font-bold text-gray-900">Google Gemini API</td>
                  <td className="p-3">Anonymized customer telemetry indicators</td>
                  <td className="p-3">Risk diagnosis & draft generation</td>
                  <td className="p-3 text-emerald-800 font-medium">Enterprise API / No training</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-gray-900">Razorpay</td>
                  <td className="p-3">Billing email, customer ID, plan amount</td>
                  <td className="p-3">Subscription checkout & payment billing</td>
                  <td className="p-3 text-emerald-800 font-medium">PCI-DSS Level 1 Certified</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-gray-900">Meta (WhatsApp Cloud API)</td>
                  <td className="p-3">Recipient phone number, approved message text</td>
                  <td className="p-3">Customer retention WhatsApp outreach</td>
                  <td className="p-3 text-emerald-800 font-medium">Official Cloud API / TLS encrypted</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-gray-900">Resend (Email API)</td>
                  <td className="p-3">Recipient email, approved email body</td>
                  <td className="p-3">Retention check-in emails</td>
                  <td className="p-3 text-emerald-800 font-medium">SOC 2 compliant infrastructure</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500">
            No behavioral ad SDKs (such as Facebook Pixel, Google Ads Remarketing, TikTok Pixel) or third-party session replay tools are installed on Churnveda.
          </p>
        </section>

        {/* Section 5: Data Deletion & Retention Practices */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center font-bold text-xs">
              5
            </div>
            <h2 className="text-lg font-bold text-gray-900">Data Deletion & Retention Practices (30-Day SLA)</h2>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Customers retain full sovereign control over all data uploaded to Churnveda:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1">
              <strong className="text-gray-900 block">Instant Self-Serve Deletion</strong>
              <p className="text-gray-600 text-[11px]">
                You can delete individual accounts, batches of customers, or all sample datasets instantly via the Customers table. Deleted rows are expunged from the live database immediately.
              </p>
            </div>
            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1">
              <strong className="text-gray-900 block">30-Day Complete Backup Purge SLA</strong>
              <p className="text-gray-600 text-[11px]">
                When an account deletion request is triggered via <strong>Settings → Purge Data</strong> or our Data Deletion Request form, all production and database backup archives are permanently overwritten within 30 calendar days.
              </p>
            </div>
          </div>
        </section>

        {/* Section 6: Legal Contact & Grievance Officer */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-blue-900" aria-hidden="true" />
            <h2 className="text-lg font-bold text-gray-900">Legal Contact & Data Protection Officer</h2>
          </div>
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1.5 text-gray-700">
            <p><strong>Legal Entity:</strong> Churnveda Technologies Inc.</p>
            <p><strong>Mailing Address:</strong> 548 Market St, Suite 89201, San Francisco, CA 94104, USA</p>
            <p><strong>Support Contact:</strong> <a href="mailto:support@churnveda.com" className="text-blue-900 underline">support@churnveda.com</a></p>
            <p><strong>Data Protection / Grievance Officer:</strong> Elena Rostova, Chief Privacy Officer (<a href="mailto:privacy@churnveda.com" className="text-blue-900 underline">privacy@churnveda.com</a>)</p>
          </div>
        </section>
      </div>
    </div>
  );
};
