import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Server,
  KeyRound,
  FileCheck,
  AlertTriangle,
  HelpCircle,
  Download,
  CheckCircle2,
  Activity,
  Award,
  Globe,
  Mail,
  Phone,
  Clock,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from 'lucide-react';

interface SecurityTermsViewProps {
  onNavigate: (view: string) => void;
  onShowToast: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export const SecurityTermsView: React.FC<SecurityTermsViewProps> = ({ onNavigate, onShowToast }) => {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const handleDownloadSecurityBrief = () => {
    onShowToast('Downloading Churnveda Security & Architecture Overview...', 'success');
    const element = document.createElement('a');
    const file = new Blob([
      `CHURNVEDA - SECURITY & ARCHITECTURE WHITE PAPER\n` +
      `Platform: Churnveda AI Retention Employee\n` +
      `Data Processing Role: B2B SaaS Data Processor\n` +
      `Hosting: Tier-4 Cloud Infrastructure (PostgreSQL & Google Cloud Run)\n` +
      `Encryption: AES-256 at Rest, TLS 1.3 In-Transit\n` +
      `AI Processing: Google Gemini API (Enterprise Non-Training Agreement)\n` +
      `Access Controls: Strict Tenant Isolation & Multi-Factor Authentication\n` +
      `Backup Schedule: Automated Daily Backups with 30-Day Erasure SLA`
    ], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = 'Churnveda_Security_Whitepaper.txt';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const faqs = [
    {
      q: 'Where is customer data physically stored?',
      a: 'All database records and telemetry logs reside in Tier-4 cloud infrastructure with encrypted PostgreSQL databases. All customer accounts are strictly isolated by workspace ID with row-level tenant barriers.'
    },
    {
      q: 'Who at Churnveda has access to my customer data?',
      a: 'Churnveda employees do not have routine access to customer datasets. Privileged administrative operations are restricted to designated infrastructure maintainers and require multi-factor authentication and tamper-evident audit logging.'
    },
    {
      q: 'Does Google or any third party use our customer data to train AI models?',
      a: 'No. Churnveda connects to the enterprise Google Gemini API with contractual non-training commitments. Customer prompt tokens and telemetry inputs are processed in-memory and are never retained for public model training.'
    },
    {
      q: 'How does Churnveda ensure messages are not sent automatically without approval?',
      a: 'Human-in-the-loop is an immutable architectural rule in Churnveda. AI algorithms generate proposed retention drafts in "Ready for Review" state. A human manager must review and explicitly click "Approve & Send" before any outbound webhook or API call is triggered.'
    }
  ];

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
          Security Overview | Version 3.0
        </span>
      </div>

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
            <span>Enterprise Security Architecture</span>
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Security & Trust Center</h1>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            Churnveda is engineered with tenant isolation, strict encryption, role-based access control, and human approval safeguards. Review our infrastructure controls and compliance standards below.
          </p>
        </div>

        {/* 1. Infrastructure Security */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-900" aria-hidden="true" />
            <h2 className="text-lg font-bold text-gray-900">1. Infrastructure & Cloud Security</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 text-xs">
              <span className="font-bold text-gray-900 block">Tier-4 Cloud Infrastructure</span>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                Hosted in isolated VPC containers with automated health monitoring and managed PostgreSQL database replicas.
              </p>
            </div>

            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 text-xs">
              <span className="font-bold text-gray-900 block">End-to-End Encryption</span>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                All database stores encrypted using AES-256 at rest. All API endpoints and client sessions strictly enforce HTTPS with TLS 1.3.
              </p>
            </div>

            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 text-xs">
              <span className="font-bold text-gray-900 block">Role-Based Access Control</span>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                Granular Admin, Analyst, and Viewer permissions ensuring least-privilege access across your organization.
              </p>
            </div>

            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 text-xs">
              <span className="font-bold text-gray-900 block">Automated Backups</span>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                Daily immutable encrypted database snapshots with 30-day retention adhering to our complete data erasure SLA.
              </p>
            </div>

            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 text-xs">
              <span className="font-bold text-gray-900 block">Human-in-the-Loop Safeguard</span>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                All outreach is drafted for human review. No messages are dispatched to WhatsApp or Email without explicit human approval.
              </p>
            </div>
          </div>
        </section>

        {/* 2. Security Whitepaper Download */}
        <section className="space-y-4 border-t border-gray-100 pt-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-blue-900" aria-hidden="true" />
              <h2 className="text-lg font-bold text-gray-900">2. Security Architecture Summary</h2>
            </div>
            <button
              type="button"
              onClick={handleDownloadSecurityBrief}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-800 text-white rounded-lg text-xs font-bold transition-colors shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-blue-400 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download Security Brief</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
            <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl">
              <span className="block text-xs font-bold text-blue-950">AES-256</span>
              <span className="text-[10px] text-blue-800 font-medium">Encryption at Rest</span>
            </div>
            <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl">
              <span className="block text-xs font-bold text-blue-950">TLS 1.3</span>
              <span className="text-[10px] text-blue-800 font-medium">Encryption in Transit</span>
            </div>
            <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl">
              <span className="block text-xs font-bold text-blue-950">GDPR Ready</span>
              <span className="text-[10px] text-blue-800 font-medium">Article 28 DPA & SCCs</span>
            </div>
            <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl">
              <span className="block text-xs font-bold text-blue-950">PCI-DSS Level 1</span>
              <span className="text-[10px] text-blue-800 font-medium">via Razorpay Gateway</span>
            </div>
          </div>
        </section>

        {/* 3. Security FAQ */}
        <section className="space-y-4 border-t border-gray-100 pt-8">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-blue-900" aria-hidden="true" />
            <h2 className="text-lg font-bold text-gray-900">3. Frequently Asked Security Questions</h2>
          </div>

          <div className="space-y-2">
            {faqs.map((faq, index) => (
              <div key={index} className="border border-gray-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenFaqIndex(openFaqIndex === index ? null : index)}
                  className="w-full text-left p-3.5 bg-gray-50/70 hover:bg-gray-100/70 flex items-center justify-between text-xs font-semibold text-gray-900 transition-colors cursor-pointer"
                >
                  <span>{faq.q}</span>
                  {openFaqIndex === index ? (
                    <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
                  )}
                </button>
                {openFaqIndex === index && (
                  <div className="p-3.5 bg-white text-xs text-gray-600 leading-relaxed border-t border-gray-200">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Security Contact Footer */}
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-bold text-gray-900 block">Security Inquiries & Vulnerability Reporting</span>
            <span className="text-gray-500">Contact our security team directly with any architectural questions</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="mailto:security@churnveda.com"
              className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-900"
            >
              security@churnveda.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
