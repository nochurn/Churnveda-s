import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Smartphone,
  KeyRound,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  RotateCw,
  CheckCircle2
} from 'lucide-react';
import { authService } from '../../services/authService';
import { UserProfile } from '../../types';

interface TwoFactorPromptViewProps {
  user: UserProfile;
  onNavigate: (view: string) => void;
  onShowToast: (message: string, type?: 'success' | 'info' | 'error') => void;
  onAuthenticated: () => void;
}

export const TwoFactorPromptView: React.FC<TwoFactorPromptViewProps> = ({
  onNavigate
}) => {
  return (
    <div className="min-h-[calc(100vh-14rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-100 text-amber-800 shadow-xs mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Two-Factor Authentication Unavailable
          </h1>
          <p className="text-xs text-gray-600 leading-relaxed">
            Server-side Two-Factor Authentication is currently disabled pending backend TOTP enrollment. Sign in with your verified credentials or Google Auth.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-2.5 px-4 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Login</span>
          </button>
        </div>
      </div>
    </div>
  );
};
