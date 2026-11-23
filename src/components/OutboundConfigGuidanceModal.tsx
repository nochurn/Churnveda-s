import React from 'react';
import {
  Smartphone,
  Mail,
  X,
  AlertTriangle,
  Info,
  Sliders
} from 'lucide-react';

interface OutboundConfigGuidanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: 'whatsapp' | 'email';
  onNavigateToSettings?: () => void;
}

export const OutboundConfigGuidanceModal: React.FC<OutboundConfigGuidanceModalProps> = ({
  isOpen,
  onClose,
  channel,
  onNavigateToSettings
}) => {
  if (!isOpen) return null;

  const isWa = channel === 'whatsapp';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 space-y-5 animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isWa
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-blue-100 text-blue-900 border border-blue-200'
              }`}
            >
              {isWa ? <Smartphone className="w-5 h-5" /> : <Mail className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-base text-gray-900">
                {isWa ? 'WhatsApp Delivery Not Enabled' : 'Email Delivery Not Enabled'}
              </h3>
              <p className="text-xs text-gray-500">
                {isWa ? 'WhatsApp Business Messaging' : 'Customer Email Outreach'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notice */}
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Verified Provider Delivery Only</p>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              Messages are only marked as Sent once confirmed by the messaging provider. Drafts remain safely queued until delivery is enabled for your workspace.
            </p>
          </div>
        </div>

        {/* Next steps */}
        <div className="bg-gray-50 border border-gray-200/80 rounded-xl p-4 space-y-2 text-xs text-gray-700">
          <p className="flex items-center gap-1.5 font-semibold text-gray-900">
            <Info className="w-4 h-4 text-blue-900" />
            <span>How to enable {isWa ? 'WhatsApp' : 'Email'} outreach:</span>
          </p>
          <ol className="list-decimal list-inside space-y-1 pl-1 text-[11px]">
            <li>Open <strong>Settings &gt; Connected Channels</strong> to inspect your workspace delivery status.</li>
            <li>Run <strong>Verify Connection</strong> to confirm live provider availability without sending customer messages.</li>
            <li>If the channel remains inactive, contact workspace support to complete sender verification.</li>
          </ol>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100 gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 text-gray-700 hover:bg-gray-100 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Dismiss
          </button>

          {onNavigateToSettings && (
            <button
              onClick={() => {
                onClose();
                onNavigateToSettings();
              }}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Open Channel Settings</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
