import React from 'react';
import {
  Shield,
  Lock,
  ExternalLink,
  RotateCcw,
  Trash2,
  Building,
  Mail
} from 'lucide-react';

interface FooterProps {
  onNavigate: (view: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="border-t border-gray-200 bg-white mt-auto text-xs" aria-label="Global footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* Brand & Tagline */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-900 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0 mt-0.5">
              <Shield className="w-4 h-4 text-blue-100" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-900 tracking-tight">Churnveda</span>
                <span className="text-[10px] font-semibold text-blue-900 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-sm">
                  B2B SaaS Only (18+)
                </span>
              </div>
              <p className="text-[11px] text-gray-600 mt-0.5 max-w-sm">
                Your AI Retention Employee — identifies at-risk accounts, explains friction signals in plain English, and prepares personalized outreach for human approval.
              </p>
            </div>
          </div>

          {/* Legal and Policy Links */}
          <nav aria-label="Legal & policy links" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-gray-700">
            <button
              type="button"
              onClick={() => onNavigate('terms')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              Terms of Service
            </button>
            <button
              type="button"
              onClick={() => onNavigate('privacy')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => onNavigate('refund')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              Refund & Cancellation
            </button>
            <button
              type="button"
              onClick={() => onNavigate('cookies')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              Cookie Policy
            </button>
            <button
              type="button"
              onClick={() => onNavigate('dpa')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              DPA
            </button>
            <button
              type="button"
              onClick={() => onNavigate('deletion')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              Data Deletion
            </button>
            <button
              type="button"
              onClick={() => onNavigate('acceptable-use')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              Acceptable Use
            </button>
            <button
              type="button"
              onClick={() => onNavigate('contact')}
              className="hover:text-blue-900 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-900 rounded-xs"
            >
              Contact
            </button>
          </nav>
        </div>

        {/* Legal Entity, Business Details & Grievance Contact (Requirement 11) */}
        <div className="pt-4 border-t border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] text-gray-600">
          <div>
            <strong className="block text-gray-900 font-semibold">Legal Entity & Headquarters:</strong>
            <span>Churnveda Technologies Inc.</span>
            <span className="block">548 Market St, Suite 89201, San Francisco, CA 94104</span>
          </div>

          <div>
            <strong className="block text-gray-900 font-semibold">Support & Assistance:</strong>
            <span>Email: <a href="mailto:support@churnveda.com" className="text-blue-900 hover:underline">support@churnveda.com</a></span>
            <span className="block">Response SLA: Within 2 business days</span>
          </div>

          <div>
            <strong className="block text-gray-900 font-semibold">Grievance & Data Protection Officer:</strong>
            <span>Elena Rostova, Chief Privacy Officer</span>
            <span className="block">Email: <a href="mailto:privacy@churnveda.com" className="text-blue-900 hover:underline">privacy@churnveda.com</a></span>
          </div>
        </div>

        {/* Bottom Sub-bar */}
        <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-gray-600">
          <div>
            © {new Date().getFullYear()} Churnveda Technologies Inc. All rights reserved. B2B service for businesses only (18+).
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-600">Encrypted at rest (AES-256)</span>
            <span>•</span>
            <span className="text-gray-600">TLS 1.3 in-transit</span>
            <span>•</span>
            <span className="text-gray-600">Role-Based Access</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
