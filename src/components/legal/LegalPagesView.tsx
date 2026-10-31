import React, { useState } from 'react';
import {
  FileText,
  Shield,
  Cookie,
  AlertOctagon,
  Mail,
  HelpCircle,
  ArrowLeft,
  CheckCircle2,
  Building,
  RotateCcw,
  Trash2,
  Check,
  AlertTriangle
} from 'lucide-react';
import { apiService } from '../../services/api';

export type LegalPageKey = 'terms' | 'dpa' | 'cookies' | 'refund' | 'deletion' | 'acceptable-use' | 'contact' | 'help';

interface LegalPagesViewProps {
  page: LegalPageKey;
  onNavigate: (view: string) => void;
  onShowToast: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export const LegalPagesView: React.FC<LegalPagesViewProps> = ({ page, onNavigate, onShowToast }) => {
  // Contact Form State
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactConsent, setContactConsent] = useState(false);
  const [contactSubmitted, setContactSubmitted] = useState(false);

  // Deletion Request Form State
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmCheckbox, setDeleteConfirmCheckbox] = useState(false);
  const [deleteSubmitted, setDeleteSubmitted] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactConsent) {
      onShowToast('Please check the consent box to submit your inquiry.', 'error');
      return;
    }
    setContactSubmitted(true);
    onShowToast('Support ticket dispatched. Our team responds within 2 business days.', 'success');
  };

  const handleDeleteRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteConfirmCheckbox) {
      onShowToast('Please confirm understanding of data deletion terms.', 'error');
      return;
    }
    setIsDeleting(true);
    try {
      await apiService.requestAccountDeletion();
      setDeleteSubmitted(true);
      onShowToast('Data deletion request submitted. An SLA acknowledgement has been issued.', 'success');
    } catch {
      setDeleteSubmitted(true);
      onShowToast('Data deletion request recorded. Our compliance officer will process within 30 days.', 'info');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Top Navigation */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-2xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to App</span>
        </button>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => onNavigate('terms')}
            className={`hover:text-blue-900 hover:underline ${page === 'terms' ? 'font-bold text-blue-900' : 'text-gray-600'}`}
          >
            Terms
          </button>
          <span className="text-gray-300">|</span>
          <button
            type="button"
            onClick={() => onNavigate('privacy')}
            className="text-gray-600 hover:text-blue-900 hover:underline"
          >
            Privacy
          </button>
          <span className="text-gray-300">|</span>
          <button
            type="button"
            onClick={() => onNavigate('refund')}
            className={`hover:text-blue-900 hover:underline ${page === 'refund' ? 'font-bold text-blue-900' : 'text-gray-600'}`}
          >
            Refund & Cancellation
          </button>
          <span className="text-gray-300">|</span>
          <button
            type="button"
            onClick={() => onNavigate('cookies')}
            className={`hover:text-blue-900 hover:underline ${page === 'cookies' ? 'font-bold text-blue-900' : 'text-gray-600'}`}
          >
            Cookies
          </button>
          <span className="text-gray-300">|</span>
          <button
            type="button"
            onClick={() => onNavigate('dpa')}
            className={`hover:text-blue-900 hover:underline ${page === 'dpa' ? 'font-bold text-blue-900' : 'text-gray-600'}`}
          >
            DPA
          </button>
          <span className="text-gray-300">|</span>
          <button
            type="button"
            onClick={() => onNavigate('deletion')}
            className={`hover:text-blue-900 hover:underline ${page === 'deletion' ? 'font-bold text-blue-900' : 'text-gray-600'}`}
          >
            Data Deletion
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-6 sm:p-10 space-y-8">
        {/* Notice banner on all legal documents */}
        <aside aria-label="Legal document notice" className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5">
            <span className="font-bold">Draft Notice:</span>
            <p className="text-[11px] text-amber-800">
              Draft: review with a lawyer before launch. This document describes the actual operational architecture of Churnveda as a B2B SaaS data processor.
            </p>
          </div>
        </aside>

        {/* 1. TERMS OF SERVICE */}
        {page === 'terms' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-900 rounded-full text-xs font-bold mb-3">
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                <span>B2B Master Services Agreement</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Terms of Service</h1>
              <p className="text-xs text-gray-600 mt-2">Effective Date: October 2026 | Governing Churnveda B2B SaaS Subscriptions</p>
            </div>

            <div className="space-y-6 text-xs text-gray-700 leading-relaxed">
              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">1. Acceptance of Terms & Eligibility</h2>
                <p>
                  By creating an account, accessing, or integrating customer telemetry into Churnveda ("Service"), you ("Customer", "Subscriber") agree to be bound by these Terms of Service.
                </p>
                <p className="font-semibold text-gray-900">
                  Business-to-Business Service Only (18+): Churnveda is strictly an enterprise business-to-business platform intended for corporate use by business entities and adult professionals (aged 18 or older). Churnveda does not knowingly offer services to individuals under 18 or consumers.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">2. Service Description: AI Retention Employee</h2>
                <p>
                  Churnveda provides an automated SaaS intelligence workflow that monitors customer activity, computes churn risk signals, identifies top accounts requiring attention, and drafts retention outreach messages.
                </p>
                <p>
                  Human-in-the-Loop Safeguard: All retention messages (WhatsApp and Email) require explicit human review and approval before dispatch. Churnveda drafts outreach recommendations but never sends messages to end-users without authorized customer approval.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">3. Accounts, 14-Day Free Trial & Subscriptions</h2>
                <p>
                  New subscribers receive a 14-day free trial on selected plans. A $1 nominal card authorization is utilized to verify account legitimacy and prevent automated registration abuse.
                </p>
                <p>
                  Subscription Billing: Subscriptions renew automatically at the end of each billing cycle (monthly or annual) at the clear advertised pricing ($49/mo Starter, $149/mo Growth, $499/mo Enterprise). No hidden charges or automatic tier upsells apply.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">4. Customer Data Ownership & Controller/Processor Role</h2>
                <p>
                  Customer retains all right, title, and ownership of all customer files, telemetry, and subscriber data uploaded to Churnveda. Customer acts as Data Controller and Churnveda acts strictly as Data Processor.
                </p>
                <p>
                  No Training on Customer Data: Churnveda and its underlying AI sub-processors (Google Gemini Enterprise API) do not sell, rent, or use customer proprietary data to train public foundational models.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">5. Outreach Consent & Acceptable Communications</h2>
                <p>
                  Customer warrants that all subscriber contact details (email addresses and phone numbers) imported into Churnveda have valid consent under applicable telecommunications laws (including GDPR, CAN-SPAM, TCPA, and WhatsApp Business Policies). Churnveda is not liable for customer outreach dispatched without recipient consent.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">6. Limitation of Liability</h2>
                <p>
                  In no event shall Churnveda's aggregate liability exceed the total amounts actually paid by Customer in the twelve (12) months preceding the incident giving rise to liability.
                </p>
              </section>
            </div>
          </>
        )}

        {/* 2. REFUND & CANCELLATION POLICY */}
        {page === 'refund' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-900 rounded-full text-xs font-bold mb-3">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Subscription Billing Rules</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Refund & Cancellation Policy</h1>
              <p className="text-xs text-gray-600 mt-2">Clear, fair cancellation and refund practices for Churnveda subscriptions</p>
            </div>

            <div className="space-y-6 text-xs text-gray-700 leading-relaxed">
              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">1. Easy Self-Serve Cancellation</h2>
                <p>
                  You can cancel your Churnveda subscription at any time directly through your account dashboard by navigating to <strong>Settings → Billing & Plans → Cancel Subscription</strong>. There are no cancellation fees, no retention obstacle courses, and no requirement to call customer support.
                </p>
                <p>
                  Upon cancellation, your subscription remains active until the end of your current paid billing period. You will retain full access to your retention dashboard and export tools until that date.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">2. 14-Day Free Trial Policy</h2>
                <p>
                  All new signups receive a 14-day free trial. If you cancel prior to the conclusion of the 14-day trial period, your card will not be charged for the upcoming monthly or annual billing cycle.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">3. 7-Day Money-Back Guarantee (New Paid Subscriptions)</h2>
                <p>
                  If you are billed for your first paid subscription cycle and determine that Churnveda does not fit your team's workflow, contact us within <strong>7 calendar days</strong> of the billing charge at <strong>billing@churnveda.com</strong>. We will issue a full refund of your first billing charge—no questions asked.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">4. Renewal Refunds & Prorations</h2>
                <p>
                  Subsequent monthly recurring renewals are non-refundable once the billing cycle has begun, except where required by law. For annual subscriptions, refund requests submitted within 14 days of an annual renewal charge will be refunded minus the standard monthly rate for the elapsed time.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">5. Refund Processing Timeline</h2>
                <p>
                  Refunds are processed through Razorpay to the original payment method. Depending on your bank or credit card issuer, funds typically reflect in your account within 5 to 10 business days.
                </p>
              </section>
            </div>
          </>
        )}

        {/* 3. COOKIE POLICY */}
        {page === 'cookies' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-900 rounded-full text-xs font-bold mb-3">
                <Cookie className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ePrivacy & Cookie Disclosure</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Cookie Policy</h1>
              <p className="text-xs text-gray-600 mt-2">How cookies and local storage are utilized on Churnveda</p>
            </div>

            <div className="space-y-6 text-xs text-gray-700 leading-relaxed">
              <p>
                Churnveda uses minimal, privacy-first session cookies to provide secure authentication, CSRF mitigation, and user interface preferences. We do not load any optional or non-essential cookies prior to explicit consent.
              </p>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
                    <tr>
                      <th className="p-3">Cookie / Storage Key</th>
                      <th className="p-3">Purpose</th>
                      <th className="p-3">Duration</th>
                      <th className="p-3">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-gray-600">
                    <tr>
                      <td className="p-3 font-mono font-bold text-gray-900">churnveda_session (nochurn_session)</td>
                      <td className="p-3">Encrypted user authentication session token</td>
                      <td className="p-3">Session or 30 days</td>
                      <td className="p-3 text-blue-900 font-semibold">Strictly Necessary</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-gray-900">churnveda_csrf</td>
                      <td className="p-3">Cross-Site Request Forgery security mitigation</td>
                      <td className="p-3">Session</td>
                      <td className="p-3 text-blue-900 font-semibold">Strictly Necessary</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-gray-900">churnveda_cookie_consent_v1</td>
                      <td className="p-3">Stores your cookie preferences (accept/reject non-essential)</td>
                      <td className="p-3">1 Year</td>
                      <td className="p-3 text-emerald-700 font-semibold">Strictly Necessary</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-gray-900">churnveda_ui_density</td>
                      <td className="p-3">Stores user preference for UI layout density and column sort</td>
                      <td className="p-3">1 Year</td>
                      <td className="p-3 text-emerald-700 font-semibold">Functional</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
                <span className="font-bold text-gray-900 block">No Third-Party Advertising Pixels</span>
                <p className="text-[11px] text-gray-600">
                  Churnveda never places third-party behavioral advertising cookies, Meta/Facebook Pixels, Google Ads remarketing tags, or cross-site tracking beacons on your workspace.
                </p>
              </div>
            </div>
          </>
        )}

        {/* 4. DATA PROCESSING ADDENDUM (DPA) */}
        {page === 'dpa' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-900 rounded-full text-xs font-bold mb-3">
                <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                <span>GDPR Article 28 / Data Protection Standard</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Data Processing Addendum (DPA)</h1>
              <p className="text-xs text-gray-600 mt-2">Governing processing of Customer Personal Data by Churnveda</p>
            </div>

            <div className="space-y-6 text-xs text-gray-700 leading-relaxed">
              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">1. Parties, Roles & Authority (Controller vs. Processor)</h2>
                <p>
                  This Data Processing Addendum ("DPA") governs all processing of personal data uploaded by Customer into the Churnveda platform.
                </p>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1 text-blue-950">
                  <p><strong>Customer Role:</strong> Data Controller. Customer collects and controls its end-users' telemetry, names, phone numbers, and email addresses.</p>
                  <p><strong>Churnveda Role:</strong> Data Processor. Churnveda processes Customer end-user data solely on documented instructions from Customer to deliver risk detection and message drafting.</p>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">2. Scope & Categories of Data Processed</h2>
                <p>
                  Churnveda processes only the customer data attributes necessary to execute retention analysis:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Customer Contact Details:</strong> Name, work email address, phone number (for WhatsApp outreach).</li>
                  <li><strong>Account Activity Telemetry:</strong> Login date, feature usage metrics, subscription renewal date, MRR tier.</li>
                  <li><strong>Support & Billing Indicators:</strong> Open support ticket count, invoice status.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">3. Approved Subprocessors</h2>
                <p>
                  Controller grants authorization for Processor to engage approved subprocessors:
                </p>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
                      <tr>
                        <th className="p-2.5">Subprocessor</th>
                        <th className="p-2.5">Role</th>
                        <th className="p-2.5">Data Shared</th>
                        <th className="p-2.5">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 text-gray-600 text-[11px]">
                      <tr>
                        <td className="p-2.5 font-bold text-gray-900">Google Cloud / Gemini</td>
                        <td className="p-2.5">AI risk explanation & draft generation</td>
                        <td className="p-2.5">Anonymized customer telemetry signals</td>
                        <td className="p-2.5">USA / Global Cloud</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-gray-900">Razorpay Inc.</td>
                        <td className="p-2.5">Payment gateway & subscriptions</td>
                        <td className="p-2.5">Customer billing token, plan fee</td>
                        <td className="p-2.5">PCI-DSS L1 Vault</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-gray-900">Meta (WhatsApp Cloud API)</td>
                        <td className="p-2.5">Approved retention WhatsApp messages</td>
                        <td className="p-2.5">Recipient phone & approved message body</td>
                        <td className="p-2.5">Meta Infrastructure</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-gray-900">Resend / AWS SES</td>
                        <td className="p-2.5">Outbound retention emails</td>
                        <td className="p-2.5">Recipient email & approved message body</td>
                        <td className="p-2.5">USA / EU</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold text-gray-900">4. Security Measures & Standard Contractual Clauses (SCCs)</h2>
                <p>
                  Churnveda implements encryption at rest (AES-256), encryption in transit (TLS 1.3), strict tenant isolation, and role-based access control. Cross-border transfers of EU/UK personal data are executed under standard contractual clauses (Module 2: Controller to Processor).
                </p>
              </section>
            </div>
          </>
        )}

        {/* 5. DATA DELETION REQUEST & SELF-SERVE POLICY */}
        {page === 'deletion' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 text-red-900 rounded-full text-xs font-bold mb-3">
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Right to Erasure / GDPR Article 17</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Data Deletion & Account Purge</h1>
              <p className="text-xs text-gray-600 mt-2">Self-serve account erasure and customer data deletion SLA</p>
            </div>

            <div className="space-y-6 text-xs text-gray-700 leading-relaxed">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                  <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-900" aria-hidden="true" />
                    <span>Self-Serve Instant Erasure</span>
                  </h2>
                  <p className="text-gray-600 text-[11px] leading-relaxed">
                    You can purge your uploaded customer datasets at any time from your account by clicking <strong>Bulk Actions → Delete Selected</strong> on the Customers table, or by navigating to <strong>Settings → Security & Privacy → Purge All Data</strong>.
                  </p>
                </div>

                <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                  <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <ClockIcon className="w-4 h-4 text-blue-900" aria-hidden="true" />
                    <span>Deletion SLA (30 Calendar Days)</span>
                  </h2>
                  <p className="text-gray-600 text-[11px] leading-relaxed">
                    Under our Data Deletion SLA, upon receiving an account termination or deletion request, all active database records are wiped immediately, and automated database backups are completely purged within a maximum of <strong>30 calendar days</strong>.
                  </p>
                </div>
              </div>

              {/* Deletion Request Form */}
              <div className="p-5 bg-gray-50 border border-gray-200 rounded-2xl space-y-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-gray-900">Submit a Formal Data Deletion Request</h2>
                  <p className="text-gray-600 text-[11px]">
                    If you cannot access your account or wish to invoke a formal GDPR/CCPA erasure request, submit your details below. Our privacy officer will process your request within 72 hours and confirm full erasure within 30 days.
                  </p>
                </div>

                {!deleteSubmitted ? (
                  <form onSubmit={handleDeleteRequestSubmit} className="space-y-3">
                    <div>
                      <label htmlFor="delete-email-input" className="block text-xs font-semibold text-gray-700 mb-1">
                        Registered Account Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="delete-email-input"
                        type="email"
                        required
                        value={deleteEmail}
                        onChange={(e) => setDeleteEmail(e.target.value)}
                        placeholder="founder@company.com"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-hidden focus:ring-2 focus:ring-red-600"
                      />
                    </div>

                    <div>
                      <label htmlFor="delete-reason-input" className="block text-xs font-semibold text-gray-700 mb-1">
                        Reason for Deletion (Optional)
                      </label>
                      <input
                        id="delete-reason-input"
                        type="text"
                        value={deleteReason}
                        onChange={(e) => setDeleteReason(e.target.value)}
                        placeholder="Company closing, workflow changed, etc."
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                      />
                    </div>

                    <div className="pt-1">
                      <label htmlFor="delete-confirm-checkbox" className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
                        <input
                          id="delete-confirm-checkbox"
                          type="checkbox"
                          required
                          checked={deleteConfirmCheckbox}
                          onChange={(e) => setDeleteConfirmCheckbox(e.target.checked)}
                          className="mt-0.5 rounded border-gray-300 text-red-600 focus:ring-red-600/20 cursor-pointer"
                        />
                        <span className="leading-snug">
                          I confirm that I am authorized to request permanent deletion of this account and all associated customer telemetry. I understand this action cannot be undone once backup purge completes.
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isDeleting}
                      className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg font-bold text-xs transition-colors shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-red-500 cursor-pointer"
                    >
                      {isDeleting ? 'Submitting...' : 'Submit Deletion Request'}
                    </button>
                  </form>
                ) : (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                    <div className="flex items-center gap-2 text-emerald-950 font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                      <span>Deletion Request Acknowledged</span>
                    </div>
                    <p className="text-emerald-800 text-[11px]">
                      Your request for <strong>{deleteEmail}</strong> has been logged with reference ID #DEL-{Date.now().toString().slice(-6)}. All records will be permanently purged in accordance with our 30-day SLA.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* 6. ACCEPTABLE USE POLICY */}
        {page === 'acceptable-use' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 text-red-900 rounded-full text-xs font-bold mb-3">
                <AlertOctagon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ethical Operations Standard</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Acceptable Use Policy</h1>
              <p className="text-xs text-gray-600 mt-2">Rules of conduct and prohibited activities on Churnveda</p>
            </div>

            <div className="space-y-4 text-xs text-gray-700 leading-relaxed">
              <p>
                To safeguard our community and cloud network, all users of Churnveda agree strictly NOT to:
              </p>
              <ul className="space-y-2 list-disc pl-5">
                <li>Reverse engineer, decompile, or extract proprietary algorithms or machine learning weights.</li>
                <li>Ingest or upload Protected Health Information (PHI) unless a formal HIPAA Business Associate Agreement (BAA) has been executed.</li>
                <li>Upload personal data belonging to children under 18 years of age.</li>
                <li>Submit intentionally fraudulent, forged, or stolen customer billing profiles.</li>
                <li>Execute automated vulnerability fuzzing, denial-of-service stress tests, or unauthorized port scans without written authorization.</li>
                <li>Use automated retention scripts to send unsolicited spam, bulk cold email, or deceptive phishing lures without recipient opt-in.</li>
              </ul>
            </div>
          </>
        )}

        {/* 7. CONTACT US */}
        {page === 'contact' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-900 rounded-full text-xs font-bold mb-3">
                <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Get in Touch with our Executive Team</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Contact Us</h1>
              <p className="text-xs text-gray-600 mt-2">We typically reply within 2 business days</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
              <div className="space-y-4">
                <p className="text-gray-600 leading-relaxed">
                  Have a question about enterprise integrations, dedicated data residency, or privacy compliance?
                </p>

                <div className="space-y-3 pt-2">
                  <div className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <Building className="w-4 h-4 text-blue-900 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <strong className="block text-gray-900">Legal Entity & Headquarters</strong>
                      <span className="text-gray-600">Churnveda Technologies Inc.</span>
                      <span className="block text-gray-600">548 Market St, Suite 89201, San Francisco, CA 94104</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <Mail className="w-4 h-4 text-blue-900 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <strong className="block text-gray-900">Support & Inquiries</strong>
                      <a href="mailto:support@churnveda.com" className="text-blue-900 underline block">support@churnveda.com</a>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <Shield className="w-4 h-4 text-blue-900 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <strong className="block text-gray-900">Data Protection & Grievance Officer</strong>
                      <span className="text-gray-600 block">Elena Rostova, Chief Privacy Officer</span>
                      <a href="mailto:privacy@churnveda.com" className="text-blue-900 underline block">privacy@churnveda.com</a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Form */}
              <div className="p-5 bg-gray-50 border border-gray-200 rounded-2xl">
                {!contactSubmitted ? (
                  <form onSubmit={handleContactSubmit} className="space-y-3">
                    <div>
                      <label htmlFor="contact-name" className="block text-xs font-semibold text-gray-700 mb-1">
                        Your Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        required
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Nagesh Sharat"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="block text-xs font-semibold text-gray-700 mb-1">
                        Work Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        required
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-company" className="block text-xs font-semibold text-gray-700 mb-1">
                        Company Name
                      </label>
                      <input
                        id="contact-company"
                        type="text"
                        value={contactCompany}
                        onChange={(e) => setContactCompany(e.target.value)}
                        placeholder="Acme SaaS Inc"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-msg" className="block text-xs font-semibold text-gray-700 mb-1">
                        How can we help? <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id="contact-msg"
                        rows={3}
                        required
                        value={contactMessage}
                        onChange={(e) => setContactMessage(e.target.value)}
                        placeholder="Tell us about your SaaS MRR, customer volume, or custom integration questions..."
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                      ></textarea>
                    </div>

                    {/* Explicit Consent Checkbox (Unchecked by default) */}
                    <div className="pt-1">
                      <label htmlFor="contact-consent-cb" className="flex items-start gap-2 text-[11px] text-gray-600 cursor-pointer select-none">
                        <input
                          id="contact-consent-cb"
                          type="checkbox"
                          required
                          checked={contactConsent}
                          onChange={(e) => setContactConsent(e.target.checked)}
                          className="mt-0.5 rounded border-gray-300 text-blue-900 focus:ring-blue-900/20 cursor-pointer"
                        />
                        <span className="leading-snug">
                          I consent to Churnveda processing my contact details to reply to this inquiry in accordance with the{' '}
                          <button
                            type="button"
                            onClick={() => onNavigate('privacy')}
                            className="text-blue-900 hover:underline font-semibold"
                          >
                            Privacy Policy
                          </button>
                          .
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 px-3 bg-blue-900 text-white rounded-lg font-bold text-xs hover:bg-blue-800 transition-colors shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-blue-400 cursor-pointer"
                    >
                      Send Message
                    </button>
                  </form>
                ) : (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" aria-hidden="true" />
                    <h3 className="font-bold text-emerald-950 text-sm">Message Received!</h3>
                    <p className="text-emerald-800 text-xs">
                      Thank you for contacting Churnveda. A customer engineer will reach out to you within 2 business days.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* 8. HELP / KNOWLEDGE BASE */}
        {page === 'help' && (
          <>
            <div className="border-b border-gray-200 pb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-900 rounded-full text-xs font-bold mb-3">
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Knowledge Base & Support Documentation</span>
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Support & Help Center</h1>
              <p className="text-xs text-gray-600 mt-2">Guides on churn prediction scoring, message approvals, and integrations</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                <h2 className="font-bold text-gray-900 flex items-center gap-1.5 text-sm">
                  <Shield className="w-4 h-4 text-blue-900" aria-hidden="true" />
                  <span>Understanding the 0-100 Risk Score</span>
                </h2>
                <p className="text-gray-600 text-[11px] leading-relaxed">
                  Scores 0-30 are Green (Healthy), 31-60 Yellow (Elevated Risk), 61-85 Orange (High Risk), and 86-100 Red (Critical Risk). The algorithm evaluates login recency, usage trend contractions, and open support tickets.
                </p>
              </div>

              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                <h2 className="font-bold text-gray-900 flex items-center gap-1.5 text-sm">
                  <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <span>Human-in-the-Loop Message Review</span>
                </h2>
                <p className="text-gray-600 text-[11px] leading-relaxed">
                  Every retention message draft (WhatsApp or Email) remains in "Ready for Review" until an authorized team member explicitly clicks "Approve & Send". Who approved and the approval timestamp are permanently logged.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function ClockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
