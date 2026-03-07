'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Phone, ShieldCheck } from 'lucide-react';
import {
  EmailAuthProvider,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  multiFactor,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';

import { useAuth } from '@/contexts/AuthContext';
import { auth, clearRecaptchaVerifier, getRecaptchaVerifier } from '@/lib/firebase-auth';

function formatSingaporePhoneInput(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('65')) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 8);

  if (digits.length === 0) return '+65 ';
  if (digits.length <= 4) return `+65 ${digits}`;
  return `+65 ${digits.slice(0, 4)} ${digits.slice(4)}`;
}

function toSingaporeE164(value: string): string | null {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('65')) {
    digits = digits.slice(2);
  }
  if (digits.length !== 8) return null;
  return `+65${digits}`;
}

export default function ProfilePage() {
  const { user } = useAuth();

  const [securityError, setSecurityError] = useState('');
  const [securityMessage, setSecurityMessage] = useState('');

  const [phoneNumber, setPhoneNumber] = useState('+65 ');
  const [phoneVerificationCode, setPhoneVerificationCode] = useState('');
  const [phoneVerificationId, setPhoneVerificationId] = useState('');
  const [phoneSendingCode, setPhoneSendingCode] = useState(false);
  const [phoneVerifyingCode, setPhoneVerifyingCode] = useState(false);
  const [phoneMfaEnrolled, setPhoneMfaEnrolled] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setPhoneMfaEnrolled(
      multiFactor(user).enrolledFactors.some(
        (factor) => factor.factorId === PhoneMultiFactorGenerator.FACTOR_ID
      )
    );
  }, [user]);

  const hasPasswordProvider = useMemo(
    () => Boolean(user?.providerData.some((provider) => provider.providerId === 'password')),
    [user]
  );

  const passwordPolicy = {
    minLength: newPassword.length >= 8,
    maxLength: newPassword.length <= 70,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    special: /[^A-Za-z0-9]/.test(newPassword),
  };

  const isPasswordValid =
    passwordPolicy.minLength &&
    passwordPolicy.maxLength &&
    passwordPolicy.uppercase &&
    passwordPolicy.lowercase &&
    passwordPolicy.number &&
    passwordPolicy.special;

  const handleSendPhoneCode = async () => {
    setSecurityError('');
    setSecurityMessage('');

    if (!user) {
      setSecurityError('No authenticated user found.');
      return;
    }
    if (phoneMfaEnrolled) {
      setSecurityMessage('Phone verification is already enabled for login.');
      return;
    }

    const e164PhoneNumber = toSingaporeE164(phoneNumber);
    if (!e164PhoneNumber) {
      setSecurityError('Please enter a valid Singapore number in +65 XXXX XXXX format.');
      return;
    }

    setPhoneSendingCode(true);
    try {
      const session = await multiFactor(user).getSession();
      const recaptcha = getRecaptchaVerifier();
      const provider = new PhoneAuthProvider(auth);
      const verificationId = await provider.verifyPhoneNumber(
        { phoneNumber: e164PhoneNumber, session },
        recaptcha
      );
      clearRecaptchaVerifier();
      setPhoneVerificationId(verificationId);
      setSecurityMessage('Verification code sent to your phone.');
    } catch (error) {
      clearRecaptchaVerifier();
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: string }).code)
          : '';
      if (code === 'auth/invalid-app-credential') {
        setSecurityError(
          'Phone verification setup failed. Check Firebase Authorized Domains and reCAPTCHA settings.'
        );
      } else {
        setSecurityError(error instanceof Error ? error.message : 'Failed to send verification code.');
      }
    } finally {
      setPhoneSendingCode(false);
    }
  };

  const handleVerifyPhoneCode = async () => {
    setSecurityError('');
    setSecurityMessage('');

    if (!user) {
      setSecurityError('No authenticated user found.');
      return;
    }
    if (!phoneVerificationId) {
      setSecurityError('Send a verification code first.');
      return;
    }
    if (phoneVerificationCode.length !== 6) {
      setSecurityError('Enter the 6-digit verification code.');
      return;
    }

    setPhoneVerifyingCode(true);
    try {
      const cred = PhoneAuthProvider.credential(phoneVerificationId, phoneVerificationCode);
      const assertion = PhoneMultiFactorGenerator.assertion(cred);
      await multiFactor(user).enroll(assertion, 'Phone Number');
      setPhoneMfaEnrolled(true);
      setPhoneVerificationId('');
      setPhoneVerificationCode('');
      setSecurityMessage('Phone verification is now enabled for login.');
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : 'Failed to enable phone verification.');
    } finally {
      setPhoneVerifyingCode(false);
    }
  };

  const handleCancelPhoneVerification = () => {
    setPhoneVerificationId('');
    setPhoneVerificationCode('');
    setSecurityError('');
    setSecurityMessage('');
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setSecurityError('');
    setSecurityMessage('');

    if (!user) {
      setSecurityError('No authenticated user found.');
      return;
    }
    if (!hasPasswordProvider) {
      setSecurityError('Password changes are only available for email/password accounts.');
      return;
    }
    if (!user.email) {
      setSecurityError('No email is associated with this account.');
      return;
    }
    if (!isPasswordValid) {
      setSecurityError(
        'New password must be 8-70 characters and include uppercase, lowercase, number, and special character.'
      );
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setSecurityError('New passwords do not match.');
      return;
    }

    setPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSecurityMessage('Password updated successfully.');
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: string }).code)
          : '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setSecurityError('Current password is incorrect.');
      } else if (code === 'auth/requires-recent-login') {
        setSecurityError('Please sign in again, then retry changing your password.');
      } else {
        setSecurityError(error instanceof Error ? error.message : 'Failed to update password.');
      }
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="min-h-full">
      <div className="nav-safe-top max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">Profile & Security</h1>
            <p className="text-white/70 mt-1">Manage your authentication settings</p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/90 transition-colors hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        {(securityError || securityMessage) && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              securityError
                ? 'border-red-300/40 bg-red-500/10 text-red-100'
                : 'border-cyan-300/40 bg-cyan-500/10 text-cyan-100'
            }`}
          >
            {securityError || securityMessage}
          </div>
        )}

        <div className="rounded-2xl border border-white/15 bg-slate-900/70 backdrop-blur-md p-5 shadow-xl text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Phone Verification During Login</h2>
              <p className="text-sm text-white/65 mt-1">
                Optional: add phone verification as an extra sign-in step.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                phoneMfaEnrolled
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-300/30'
                  : 'bg-amber-500/20 text-amber-200 border border-amber-300/30'
              }`}
            >
              {phoneMfaEnrolled ? 'Enabled' : 'Not Enabled'}
            </span>
          </div>

          {!phoneMfaEnrolled && (
            <div className="mt-4 space-y-3">
              {!phoneVerificationId ? (
                <>
                  <label className="block text-sm font-medium text-white/85">Phone Number</label>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-white/60" />
                    <input
                      type="tel"
                      placeholder="+65 9234 5678"
                      value={phoneNumber}
                      onChange={(event) => setPhoneNumber(formatSingaporePhoneInput(event.target.value))}
                      className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendPhoneCode}
                    disabled={phoneSendingCode}
                    className="inline-flex items-center rounded-lg bg-[#03b2e6] px-4 py-2 text-sm font-medium text-white hover:bg-[#029ad0] disabled:opacity-60"
                  >
                    {phoneSendingCode ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Send Verification Code
                  </button>
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-white/85">Verification Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    value={phoneVerificationCode}
                    onChange={(event) => setPhoneVerificationCode(event.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleVerifyPhoneCode}
                      disabled={phoneVerifyingCode || phoneVerificationCode.length !== 6}
                      className="inline-flex items-center rounded-lg bg-[#03b2e6] px-4 py-2 text-sm font-medium text-white hover:bg-[#029ad0] disabled:opacity-60"
                    >
                      {phoneVerifyingCode ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Verify & Enable
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelPhoneVerification}
                      disabled={phoneVerifyingCode}
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/85 hover:bg-white/10 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {phoneMfaEnrolled && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
              <ShieldCheck className="w-4 h-4" />
              Phone verification is active for login.
            </div>
          )}
          <div id="recaptcha-container" />
        </div>

        <div className="mt-6 rounded-2xl border border-white/15 bg-slate-900/70 backdrop-blur-md p-5 shadow-xl text-white">
          <h2 className="text-lg font-semibold">Change Password</h2>
          <p className="text-sm text-white/65 mt-1">
            Update your account password. You must confirm your current password first.
          </p>

          {!hasPasswordProvider ? (
            <div className="mt-4 rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              This account uses a social provider. Password change is only available for email/password logins.
            </div>
          ) : (
            <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-white/85 mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/85 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/85 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                  required
                />
              </div>

              <div className="rounded-md border border-white/15 bg-white/5 p-3 text-xs text-white/80 space-y-1">
                <p className={passwordPolicy.minLength ? 'text-emerald-300' : 'text-red-300'}>Min length 8</p>
                <p className={passwordPolicy.maxLength ? 'text-emerald-300' : 'text-red-300'}>Max length 70</p>
                <p className={passwordPolicy.uppercase ? 'text-emerald-300' : 'text-red-300'}>Require uppercase character</p>
                <p className={passwordPolicy.lowercase ? 'text-emerald-300' : 'text-red-300'}>Require lowercase character</p>
                <p className={passwordPolicy.number ? 'text-emerald-300' : 'text-red-300'}>Require numeric character</p>
                <p className={passwordPolicy.special ? 'text-emerald-300' : 'text-red-300'}>Require special character</p>
              </div>

              <button
                type="submit"
                disabled={passwordSaving || !isPasswordValid}
                className="inline-flex items-center rounded-lg bg-[#03b2e6] px-4 py-2 text-sm font-medium text-white hover:bg-[#029ad0] disabled:opacity-60"
              >
                {passwordSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Update Password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
