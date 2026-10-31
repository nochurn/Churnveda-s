import React from 'react';
import { Shield, Home, ArrowLeft, Search, HelpCircle } from 'lucide-react';

interface NotFoundViewProps {
  onNavigate: (view: string) => void;
  currentUser?: any;
}

export const NotFoundView: React.FC<NotFoundViewProps> = ({ onNavigate, currentUser }) => {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-4 text-center max-w-lg mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-900 border border-blue-200 flex items-center justify-center mb-6 shadow-xs">
        <Shield className="w-8 h-8 text-blue-900" aria-hidden="true" />
      </div>

      <span className="px-3 py-1 bg-red-50 text-red-700 text-xs font-bold rounded-full border border-red-200 mb-3 uppercase tracking-wider">
        404 — Page Not Found
      </span>

      <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight mb-2">
        We couldn't find that page
      </h1>

      <p className="text-sm text-gray-600 mb-8 leading-relaxed max-w-sm">
        The URL you requested may have moved, expired, or doesn't exist on Churnveda.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => onNavigate(currentUser ? 'home' : 'pricing')}
          className="w-full sm:w-auto px-5 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-blue-900"
        >
          <Home className="w-4 h-4" aria-hidden="true" />
          <span>{currentUser ? 'Return to Dashboard' : 'View Plans & Pricing'}</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('help')}
          className="w-full sm:w-auto px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center justify-center gap-2 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-blue-900"
        >
          <HelpCircle className="w-4 h-4 text-blue-900" aria-hidden="true" />
          <span>Help &amp; Support</span>
        </button>
      </div>
    </div>
  );
};
