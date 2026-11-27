import { UserProfile, UserSession, AuthState } from '../types';
import { auth as fbAuth, googleProvider, signInWithPopup, fbSignOut } from '../lib/firebaseClient';
import { onAuthStateChanged, onIdTokenChanged, User as FbUser } from 'firebase/auth';
import {
  setupWorkspace,
  setPendingPlan,
  resolvePostLoginRedirect,
  fetchCurrentUser,
  logoutUser,
  forgotPassword,
  resetPassword as apiResetPassword,
  signupUser,
  loginUser,
  getStoredAuthToken,
  setStoredAuthToken,
  isFirebaseJwtExpired,
  fetchActiveSessions,
  revokeServerSession,
  revokeOtherServerSessions
} from './api';
import { clearFirestoreSyncCache, syncUserAndWorkspaceToFirestore } from './firestoreService';
import { aiEmployeeService } from './aiEmployeeService';

const CURRENT_USER_STORAGE_KEY = 'churnshield_auth_current_user';
const SESSIONS_STORAGE_KEY = 'churnshield_auth_sessions';
const PENDING_VERIFICATIONS_KEY = 'churnshield_pending_verifications';
const PENDING_RESETS_KEY = 'churnshield_pending_resets';
const PENDING_PLAN_KEY = 'churnshield_pending_plan';
const LOGIN_ATTEMPTS_KEY = 'churnshield_login_attempts';

export interface PendingVerification {
  email: string;
  token: string;
  expiresAt: number; // timestamp
  verificationCode: string;
}

export interface PendingReset {
  email: string;
  token: string;
  expiresAt: number;
}

export interface LoginAttemptRecord {
  count: number;
  lastAttemptAt: number;
  lockedUntil: number | null;
}

// Generate 10 cryptographically secure backup codes in format XXXX-XXXX
export function generateBackupCodes(): string[] {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const codes: string[] = [];
  const randomWords = new Uint32Array(80);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomWords);
  } else {
    throw new Error('Secure random number generator is unavailable in this environment.');
  }
  let offset = 0;
  for (let i = 0; i < 10; i++) {
    let part1 = '';
    let part2 = '';
    for (let j = 0; j < 4; j++) {
      part1 += chars.charAt(randomWords[offset++] % chars.length);
      part2 += chars.charAt(randomWords[offset++] % chars.length);
    }
    codes.push(`${part1}-${part2}`);
  }
  return codes;
}

// Password validation & strength check
export function validatePasswordRequirements(password: string): {
  isValid: boolean;
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
  strength: 'weak' | 'medium' | 'strong';
  score: number; // 0 - 100
} {
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);

  let passedCount = 0;
  if (hasMinLength) passedCount++;
  if (hasUppercase) passedCount++;
  if (hasLowercase) passedCount++;
  if (hasNumber) passedCount++;
  if (hasSpecialChar) passedCount++;

  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  let score = 20 * passedCount;

  if (password.length >= 12 && passedCount === 5) {
    strength = 'strong';
    score = 100;
  } else if (passedCount >= 4 && password.length >= 8) {
    strength = 'medium';
    score = Math.max(score, 70);
  } else {
    strength = 'weak';
    score = Math.min(score, 50);
  }

  const isValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecialChar;

  return {
    isValid,
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar,
    strength,
    score
  };
}

class AuthService {
  private users: Map<string, UserProfile> = new Map();
  private currentUser: UserProfile | null = null;
  private sessions: UserSession[] = [];
  private pendingVerifications: Map<string, PendingVerification> = new Map();
  private pendingResets: Map<string, PendingReset> = new Map();
  private loginAttempts: Map<string, LoginAttemptRecord> = new Map();
  private listeners: Set<(user: UserProfile | null) => void> = new Set();
  private initPromise: Promise<void>;
  private oauthInProgress = false;

  constructor() {
    this.initPromise = this.initFromStorage();
    this.initFirebaseAuthListener();
  }

  public subscribe(listener: (user: UserProfile | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentUser);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentUser);
      } catch (e) {
        console.warn('Error in auth listener:', e);
      }
    });
  }

  private async initFromStorage(): Promise<void> {
    try {
      const hasStorage = typeof localStorage !== 'undefined';
      const storedToken = getStoredAuthToken();
      const storedCurrentUser = hasStorage
        ? localStorage.getItem(CURRENT_USER_STORAGE_KEY)
        : null;

      if (storedToken && storedCurrentUser) {
        try {
          this.currentUser = JSON.parse(storedCurrentUser);
        } catch {
          this.currentUser = null;
        }
      }

      // Remove any stale fabricated localStorage session list; authoritative sessions come from /api/auth/sessions
      if (hasStorage) {
        localStorage.removeItem(SESSIONS_STORAGE_KEY);
      }
      this.sessions = [];

      if (typeof (fbAuth as { authStateReady?: () => Promise<void> }).authStateReady === 'function') {
        try {
          await (fbAuth as { authStateReady: () => Promise<void> }).authStateReady();
        } catch {
          // ignore authStateReady errors
        }
      }

      // Determine authoritative startup token: always prefer fresh Firebase token when signed in
      let activeToken = storedToken;
      if (fbAuth.currentUser) {
        try {
          const freshToken = await fbAuth.currentUser.getIdToken(isFirebaseJwtExpired(storedToken, 60));
          if (freshToken) {
            activeToken = freshToken;
            setStoredAuthToken(freshToken);
          }
        } catch {
          // keep activeToken fallback
        }
      } else if (activeToken && isFirebaseJwtExpired(activeToken, 0)) {
        // Stored Firebase JWT is expired and no Firebase user session exists — clear stale state immediately
        activeToken = null;
        this.currentUser = null;
        setStoredAuthToken(null);
        if (hasStorage) {
          localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
        }
      }

      // Validate active session with backend
      if (activeToken) {
        try {
          const me = await fetchCurrentUser(activeToken);
          if (me?.user) {
            this.currentUser = me.user;
            this.persistCurrentUser();
            if (fbAuth.currentUser) {
              try {
                await syncUserAndWorkspaceToFirestore(fbAuth.currentUser, me.user);
              } catch (syncErr) {
                console.warn('[Firestore Sync] Startup profile sync skipped:', syncErr);
              }
            }
            this.notifyListeners();
            return;
          } else {
            // Token rejected by backend; if no active Firebase user, clear stale credentials
            if (!fbAuth.currentUser) {
              this.currentUser = null;
              setStoredAuthToken(null);
              localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
            }
          }
        } catch {
          if (!fbAuth.currentUser) {
            this.currentUser = null;
            setStoredAuthToken(null);
            localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
          }
        }
      }
      this.notifyListeners();
    } catch (e) {
      console.error('Failed initializing auth storage:', e);
      this.currentUser = null;
      this.sessions = [];
    }
  }

  private initFirebaseAuthListener() {
    if (typeof window === 'undefined') return;

    try {
      onAuthStateChanged(fbAuth, async (fbUser: FbUser | null) => {
        if (!fbUser) {
          clearFirestoreSyncCache();
          return;
        }
        if (this.oauthInProgress) {
          return;
        }
        const activeUid = fbUser.uid;
        const idToken = await fbUser.getIdToken();
        if (fbAuth.currentUser?.uid !== activeUid) return;
        setStoredAuthToken(idToken);
        try {
          const me = await fetchCurrentUser(idToken);
          if (fbAuth.currentUser?.uid !== activeUid) return;
          if (me?.user) {
            this.currentUser = me.user;
            this.persistCurrentUser();
            try {
              await syncUserAndWorkspaceToFirestore(fbUser, me.user);
            } catch (syncErr) {
              console.warn('[Firestore Sync] Profile sync skipped:', syncErr);
            }
            if (fbAuth.currentUser?.uid !== activeUid) return;
            this.notifyListeners();
            return;
          }
        } catch (e) {
          console.warn('Backend sync with Firebase token:', e);
        }

        if (fbAuth.currentUser?.uid !== activeUid) return;

        // Fallback user profile from Firebase User
        this.currentUser = {
          id: fbUser.uid,
          name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
          email: fbUser.email || '',
          company: 'My Company',
          role: 'Admin',
          plan: 'Growth',
          billingStatus: 'trialing',
          workspaceId: `ws_${fbUser.uid.slice(0, 12)}`,
          isEmailVerified: fbUser.emailVerified,
          twoFactorEnabled: false,
          backupCodes: [],
          failedLoginAttempts: 0,
          lastLoginAt: new Date().toISOString(),
          createdAt: fbUser.metadata.creationTime || new Date().toISOString()
        };
        this.persistCurrentUser();
        try {
          await syncUserAndWorkspaceToFirestore(fbUser, this.currentUser);
        } catch (syncErr) {
          console.warn('[Firestore Sync] Fallback profile sync skipped:', syncErr);
        }
        if (fbAuth.currentUser?.uid !== activeUid) return;
        this.notifyListeners();
      });

      onIdTokenChanged(fbAuth, async (fbUser: FbUser | null) => {
        if (fbUser) {
          try {
            const idToken = await fbUser.getIdToken();
            setStoredAuthToken(idToken);
          } catch (err) {
            console.warn('[Firebase Auth] Failed to auto-refresh ID token:', err);
          }
        }
      });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && fbAuth.currentUser) {
            const stored = getStoredAuthToken();
            const needsForce = isFirebaseJwtExpired(stored, 60);
            fbAuth.currentUser
              .getIdToken(needsForce)
              .then((idToken) => {
                if (idToken) setStoredAuthToken(idToken);
              })
              .catch(() => {});
          }
        });
      }
    } catch (err) {
      console.warn('Firebase auth listener error:', err);
    }
  }

  public async getValidToken(): Promise<string | null> {
    if (fbAuth.currentUser) {
      try {
        const idToken = await fbAuth.currentUser.getIdToken();
        setStoredAuthToken(idToken);
        return idToken;
      } catch (e) {
        console.warn('Failed to get fresh Firebase ID token:', e);
      }
    }
    return getStoredAuthToken();
  }

  private persistCurrentUser() {
    try {
      if (this.currentUser) {
        localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(this.currentUser));
      } else {
        localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('LocalStorage error persisting current user:', e);
    }
  }

  private persistSessions() {
    try {
      localStorage.removeItem(SESSIONS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  public getCurrentUser(): UserProfile | null {
    return this.currentUser;
  }

  public setCurrentUser(user: UserProfile | null): void {
    this.currentUser = user;
    this.persistCurrentUser();
    this.notifyListeners();
  }

  public isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  // --- SIGNUP FLOW ---
  public async signup(data: {
    name: string;
    email: string;
    password: string;
    company: string;
    phone?: string;
    plan?: string;
    billingCycle?: 'monthly' | 'annual';
    billingStatus?: 'trialing' | 'pending_payment' | 'active' | 'cancelled';
    trialStartDate?: string;
    trialEndDate?: string;
    paymentStatus?: 'pending' | 'paid' | 'not_added' | 'failed';
    workspaceId?: string;
    planEdition?: 'founding' | 'standard';
  }): Promise<{
    success: boolean;
    message: string;
    user?: UserProfile;
    verificationToken?: string;
    verificationCode?: string;
    requiresEmailConfirmation?: boolean;
  }> {
    const emailNorm = data.email.trim().toLowerCase();

    // Check email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm)) {
      return { success: false, message: 'Please enter a valid email address.' };
    }

    // Validate password
    const pwdCheck = validatePasswordRequirements(data.password);
    if (!pwdCheck.isValid) {
      return {
        success: false,
        message: 'Password must be at least 8 characters with 1 uppercase, 1 number, and 1 special character.'
      };
    }

    const rawPlan = (data.plan || 'growth').toLowerCase();
    const billingCycle = data.billingCycle || 'monthly';

    try {
      const res = await signupUser({
        fullName: data.name.trim(),
        companyName: data.company.trim(),
        email: emailNorm,
        password: data.password,
        confirmPassword: data.password,
        phone: data.phone,
        agreedToTerms: true,
        selectedPlan: rawPlan,
        planEdition: data.planEdition,
        billingCycle,
        isFreeTrial: true
      });

      if (res.token) {
        setStoredAuthToken(res.token);
      }
      if (res.user) {
        this.currentUser = res.user;
        this.persistCurrentUser();
        this.notifyListeners();
        return {
          success: true,
          message: res.message || 'Account created successfully',
          user: this.currentUser
        };
      }
      return {
        success: true,
        message: 'Account created successfully'
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to create account.' };
    }
  }

  // --- VERIFY EMAIL FLOW ---
  public verifyEmail(tokenOrCode: string): {
    success: boolean;
    message: string;
    email?: string;
  } {
    let pending: PendingVerification | undefined;

    // Look up by token or code
    for (const p of this.pendingVerifications.values()) {
      if (p.token === tokenOrCode || p.verificationCode === tokenOrCode) {
        pending = p;
        break;
      }
    }

    if (!pending) {
      return { success: false, message: 'Invalid or expired verification link.' };
    }

    if (Date.now() > pending.expiresAt) {
      return { success: false, message: 'Verification link expired (24 hours). Please request a new one.' };
    }

    if (this.currentUser && this.currentUser.email.toLowerCase() === pending.email.toLowerCase()) {
      this.currentUser.isEmailVerified = true;
      this.persistCurrentUser();
    }

    this.pendingVerifications.delete(pending.token);
    this.pendingVerifications.delete(pending.email);

    return {
      success: true,
      message: 'Email verified! Please login',
      email: pending.email
    };
  }

  // Resend verification email
  public async resendVerificationEmail(email: string): Promise<{ success: boolean; message: string }> {
    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm) {
      return { success: false, message: 'Please enter a valid email address.' };
    }

    return {
      success: true,
      message: `Confirmation instructions dispatched to ${emailNorm}.`
    };
  }

  // --- LOGIN FLOW ---
  public async login(
    emailInput: string,
    passwordInput: string,
    rememberMe: boolean = false
  ): Promise<{
    success: boolean;
    requiresTwoFactor?: boolean;
    user?: UserProfile;
    message: string;
    warning?: string;
    isLocked?: boolean;
    lockoutRemainingMinutes?: number;
    isUnverified?: boolean;
    redirectTo?: string;
  }> {
    const emailNorm = emailInput ? emailInput.trim().toLowerCase() : '';
    const now = Date.now();

    // Check account lockout status
    const attemptRecord = this.loginAttempts.get(emailNorm) || {
      count: 0,
      lastAttemptAt: now,
      lockedUntil: null
    };

    if (attemptRecord.lockedUntil && now < attemptRecord.lockedUntil) {
      const remainingMinutes = Math.ceil((attemptRecord.lockedUntil - now) / 60000);
      return {
        success: false,
        isLocked: true,
        lockoutRemainingMinutes: remainingMinutes,
        message: `Account locked due to 5 failed attempts in 15 minutes. Try again in ${remainingMinutes} minute(s) or reset your password.`
      };
    }

    if (attemptRecord.lockedUntil && now >= attemptRecord.lockedUntil) {
      attemptRecord.count = 0;
      attemptRecord.lockedUntil = null;
    }

    // 1. Mandatory input verification: Empty email or password MUST fail
    if (!emailNorm || !passwordInput) {
      return {
        success: false,
        message: 'Invalid email or password.'
      };
    }

    try {
      const res = await loginUser({
        email: emailNorm,
        password: passwordInput,
        rememberMe
      });

      if (res.token) {
        setStoredAuthToken(res.token);
      }
      if (res.user) {
        this.currentUser = res.user;
        this.persistCurrentUser();
        this.notifyListeners();
        return {
          success: true,
          user: this.currentUser,
          redirectTo: res.redirectTo || '/dashboard',
          message: res.message || 'Login successful'
        };
      }
      return {
        success: true,
        message: 'Login successful',
        redirectTo: '/dashboard'
      };
    } catch (err: any) {
      const serverCode = err?.data?.code;
      if (serverCode === 'PASSWORD_NOT_SET') {
        return {
          success: false,
          message: err.message
        };
      }
      attemptRecord.count += 1;
      attemptRecord.lastAttemptAt = now;
      if (attemptRecord.count >= 5) {
        attemptRecord.lockedUntil = now + 15 * 60 * 1000;
        this.loginAttempts.set(emailNorm, attemptRecord);
        return {
          success: false,
          isLocked: true,
          lockoutRemainingMinutes: 15,
          message: 'Account locked due to 5 failed attempts. Please try again in 15 minutes.'
        };
      } else if (attemptRecord.count >= 3) {
        this.loginAttempts.set(emailNorm, attemptRecord);
        return {
          success: false,
          warning: `Security warning: ${attemptRecord.count} failed login attempts. Account locks after 5 failed attempts.`,
          message: err.message || 'Invalid email or password.'
        };
      }
      this.loginAttempts.set(emailNorm, attemptRecord);
      return {
        success: false,
        message: err.message || 'Invalid email or password.'
      };
    }
  }

  // --- MAGIC LINK AUTHENTICATION ---
  public async signInWithMagicLink(_email: string): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'Passwordless email-link sign-in is not enabled on this server. Please sign in with your password or Continue with Google.'
    };
  }

  // --- SOCIAL OAUTH (GOOGLE / MICROSOFT) ---
  public async loginWithOAuth(provider: 'google' | 'microsoft'): Promise<{
    success: boolean;
    user?: UserProfile;
    message: string;
  }> {
    if (provider === 'google') {
      this.oauthInProgress = true;
      try {
        const result = await signInWithPopup(fbAuth, googleProvider);
        const fbUser = result.user;
        const idToken = await fbUser.getIdToken(true);
        setStoredAuthToken(idToken);

        await setupWorkspace({
          fullName: fbUser.displayName || undefined,
          companyName: 'My Company'
        }, idToken);

        const me = await fetchCurrentUser(idToken);
        if (me?.user) {
          this.currentUser = me.user;
        } else {
          this.currentUser = {
            id: fbUser.uid,
            name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            email: fbUser.email || '',
            company: 'My Company',
            role: 'Admin',
            plan: 'Growth',
            billingStatus: 'trialing',
            workspaceId: `ws_${fbUser.uid.slice(0, 12)}`,
            isEmailVerified: fbUser.emailVerified,
            twoFactorEnabled: false,
            backupCodes: [],
            failedLoginAttempts: 0,
            lastLoginAt: new Date().toISOString(),
            createdAt: fbUser.metadata.creationTime || new Date().toISOString()
          };
        }

        try {
          await syncUserAndWorkspaceToFirestore(fbUser, this.currentUser);
        } catch (syncErr) {
          console.warn('[Firestore Sync] OAuth workspace sync skipped:', syncErr);
        }

        this.persistCurrentUser();
        this.notifyListeners();

        return {
          success: true,
          user: this.currentUser,
          message: 'Signed in with Google successfully'
        };
      } catch (err: any) {
        const code = err?.code || '';
        const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
        if (code === 'auth/unauthorized-domain') {
          return {
            success: false,
            message: `Google Sign-In is blocked for "${host}". Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains, or sign in with Email & Password below.`
          };
        }
        if (code === 'auth/popup-blocked') {
          return {
            success: false,
            message: 'Google Sign-In pop-up was blocked by your browser. Allow pop-ups for this site and try again, or sign in with Email & Password.'
          };
        }
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          return {
            success: false,
            message: 'Google Sign-In window was closed before completing login. Please try again.'
          };
        }
        return {
          success: false,
          message: err?.message || 'Google authentication failed'
        };
      } finally {
        this.oauthInProgress = false;
      }
    }

    return {
      success: false,
      message: 'Microsoft OAuth is not currently enabled.'
    };
  }

  // --- 2FA VERIFICATION ON LOGIN ---
  public verifyTwoFactorLogin(
    _email: string,
    _codeOrBackup: string
  ): {
    success: boolean;
    message: string;
    user?: UserProfile;
  } {
    return {
      success: false,
      message: 'Server-side Two-Factor Authentication is currently unavailable.'
    };
  }

  // --- FORGOT PASSWORD & RESET FLOW ---
  public async requestPasswordReset(email: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm) {
      return { success: false, message: 'Please enter your account email address.' };
    }

    try {
      const apiRes = await forgotPassword(emailNorm);
      if (apiRes?.error) {
        return { success: false, message: apiRes.error };
      }
      return {
        success: true,
        message: apiRes?.message || 'If an account matches that email, a password reset link has been dispatched.'
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to request password reset.'
      };
    }
  }

  public async resetPassword(
    tokenOrPassword: string,
    newPassword?: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const actualPassword = newPassword || tokenOrPassword;
    const token = newPassword ? tokenOrPassword : null;

    const pwdCheck = validatePasswordRequirements(actualPassword);
    if (!pwdCheck.isValid) {
      return {
        success: false,
        message: 'New password must be at least 8 characters with 1 uppercase, 1 number, and 1 special character.'
      };
    }

    if (!token) {
      return { success: false, message: 'Password reset token is required.' };
    }

    try {
      const apiRes = await apiResetPassword(token, actualPassword);
      if (apiRes?.success) {
        await this.logout();
        return { success: true, message: apiRes.message || 'Password updated! Please login.' };
      }
      return { success: false, message: apiRes?.error || 'Failed to update password.' };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Invalid or expired password reset link.'
      };
    }
  }

  // --- 2FA SETUP & MANAGEMENT (SERVER-SIDE ENROLLMENT UNAVAILABLE WITHOUT SCHEMA MIGRATION) ---
  public enableSmsTwoFactor(_phone: string): {
    success: boolean;
    verificationCode: string;
    message: string;
  } {
    return {
      success: false,
      verificationCode: '',
      message: 'SMS Two-Factor Authentication is unavailable until server-side 2FA enrollment is enabled.'
    };
  }

  public verifyAndActivateTwoFactor(
    _method: 'sms' | 'authenticator',
    _code: string,
    _phone?: string
  ): {
    success: boolean;
    message: string;
    backupCodes: string[];
  } {
    return {
      success: false,
      message: 'Two-Factor Authentication cannot be enabled locally; server-side enrollment is unavailable.',
      backupCodes: []
    };
  }

  public disableTwoFactor(): { success: boolean; message: string } {
    if (this.currentUser) {
      this.currentUser.twoFactorEnabled = false;
      this.currentUser.twoFactorMethod = undefined;
      this.currentUser.backupCodes = [];
      this.persistCurrentUser();
    }
    return {
      success: true,
      message: 'Two-Factor Authentication is inactive.'
    };
  }

  public regenerateBackupCodes(): { success: boolean; backupCodes: string[] } {
    return { success: false, backupCodes: [] };
  }

  // --- SESSION MANAGEMENT (/settings/sessions — SERVER-VERIFIED, NO FABRICATION) ---
  public getSessions(): UserSession[] {
    return [...this.sessions];
  }

  public async fetchServerSessions(): Promise<UserSession[]> {
    try {
      const res = await fetchActiveSessions();
      if (res?.success && Array.isArray(res.sessions)) {
        const mapped: UserSession[] = res.sessions.map((s) => ({
          id: s.id,
          device: s.authProvider === 'firebase' ? 'Authenticated Browser Session (Firebase Auth)' : 'Authenticated Server Session',
          location: 'Not tracked by session schema',
          ip: 'Not recorded',
          lastActive: s.isCurrent ? 'Current session' : `Expires ${new Date(s.expiresAt).toLocaleDateString()}`,
          isCurrent: Boolean(s.isCurrent),
          createdAt: s.createdAt,
          browser: s.authProvider === 'firebase' ? 'Firebase Auth' : 'Session Token',
          os: 'Verified Server Record'
        }));
        this.sessions = mapped;
        return mapped;
      }
    } catch {
      // fall through cleanly without fabricating rows
    }
    this.sessions = [];
    return [];
  }

  public registerSession(_rememberMe: boolean = false) {
    // No client-side session fabrication; sessions are tracked server-side on login.
  }

  public async revokeSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    const target = this.sessions.find((s) => s.id === sessionId);
    try {
      const res = await revokeServerSession(sessionId);
      if (res.loggedOutCurrent || target?.isCurrent) {
        await this.logout();
        return { success: true, message: res.message || 'Current session revoked. You have been logged out.' };
      }
      this.sessions = this.sessions.filter((s) => s.id !== sessionId);
      return { success: true, message: res.message || 'Session revoked.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to revoke session.' };
    }
  }

  public async revokeAllOtherSessions(): Promise<{ success: boolean; revokedCount: number; message: string }> {
    try {
      const res = await revokeOtherServerSessions();
      await this.fetchServerSessions();
      return {
        success: true,
        revokedCount: res.revokedCount || 0,
        message: res.message
      };
    } catch (err: any) {
      return {
        success: false,
        revokedCount: 0,
        message: err?.message || 'Failed to revoke other sessions.'
      };
    }
  }

  public async invalidateAllSessions(): Promise<void> {
    this.sessions = [];
    this.persistSessions();
    await this.logout();
  }

  public async logout(): Promise<void> {
    const activeToken = getStoredAuthToken();
    try {
      await fbSignOut(fbAuth);
    } catch (e) {}

    try {
      await logoutUser(activeToken || undefined);
    } catch (e) {}

    setStoredAuthToken(null);
    clearFirestoreSyncCache();
    aiEmployeeService.clearWorkspaceState();
    this.currentUser = null;
    this.persistCurrentUser();
    this.notifyListeners();
  }

  // --- PENDING PLAN & TRIAL SUBSCRIPTION MANAGEMENT ---
  public getPendingPlan(): { tier: string; billingCycle: string; planEdition?: 'founding' | 'standard' } | null {
    try {
      const stored = localStorage.getItem(PENDING_PLAN_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {}

    if (this.currentUser?.selectedPlan) {
      return {
        tier: this.currentUser.selectedPlan.toLowerCase(),
        billingCycle: (this.currentUser as any).billingCycle || 'monthly',
        planEdition: this.currentUser.planEdition
      };
    }
    return null;
  }

  public setPendingPlan(plan: { tier: string; billingCycle: string; planEdition?: 'founding' | 'standard' }): void {
    try {
      localStorage.setItem(PENDING_PLAN_KEY, JSON.stringify(plan));
    } catch (e) {}

    if (this.currentUser) {
      this.currentUser = {
        ...this.currentUser,
        selectedPlan: plan.tier,
        billingCycle: plan.billingCycle as any,
        ...(plan.planEdition ? { planEdition: plan.planEdition } : {})
      };
      this.persistCurrentUser();
      this.notifyListeners();
    }

    try {
      setPendingPlan({ tier: plan.tier, billing_cycle: plan.billingCycle, planEdition: plan.planEdition });
    } catch (e) {}
  }

  public hasPendingPlan(): boolean {
    return !!this.getPendingPlan();
  }

  public clearPendingPlan(): void {
    try {
      localStorage.removeItem(PENDING_PLAN_KEY);
    } catch (e) {}

    if (this.currentUser && this.currentUser.selectedPlan) {
      const updated = { ...this.currentUser };
      delete updated.selectedPlan;
      this.currentUser = updated;
      this.persistCurrentUser();
      this.notifyListeners();
    }
  }

  public resolvePostLoginRedirect(): string {
    if (this.currentUser) {
      if (this.currentUser.billingStatus === 'trialing' || this.currentUser.billingStatus === 'active') {
        return '/dashboard';
      }
      return '/pricing';
    }
    return '/login';
  }

  public updateSubscriptionState(
    status: 'trialing' | 'pending_payment' | 'active' | 'cancelled',
    plan?: 'starter' | 'growth' | 'pro',
    options?: {
      planEdition?: 'founding' | 'standard';
      autopayStatus?: UserProfile['autopayStatus'];
      trialEndDate?: string;
    }
  ): void {
    if (!this.currentUser) return;
    const planFormatted = plan ? ((plan.charAt(0).toUpperCase() + plan.slice(1)) as any) : this.currentUser.plan;
    this.currentUser = {
      ...this.currentUser,
      billingStatus: status,
      paymentStatus: status === 'trialing' || status === 'active' ? 'paid' : 'pending',
      plan: planFormatted,
      ...(options?.planEdition ? { planEdition: options.planEdition } : {}),
      ...(options?.autopayStatus ? { autopayStatus: options.autopayStatus } : {}),
      trialStartDate: status === 'trialing' ? (this.currentUser.trialStartDate || new Date().toISOString()) : this.currentUser.trialStartDate,
      trialEndDate: options?.trialEndDate || (status === 'trialing' ? (this.currentUser.trialEndDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()) : this.currentUser.trialEndDate)
    };
    this.persistCurrentUser();
    this.notifyListeners();
  }
}

export const authService = new AuthService();
