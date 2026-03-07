"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithPopup,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  sendEmailVerification,
  signOut as firebaseSignOut,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  multiFactor,
  getMultiFactorResolver,
  type MultiFactorResolver,
  type MultiFactorError,
} from "firebase/auth";
import { auth, getRecaptchaVerifier, clearRecaptchaVerifier } from "@/lib/firebase-auth";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, Loader2, Phone, ShieldCheck } from "lucide-react";

type Tab = "signin" | "signup";
type MfaStep = "none" | "verify-email" | "enroll-phone" | "enroll-code" | "challenge-code";

/* Shared sub-components for the dark glassmorphic theme */

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 backdrop-blur-xl shadow-[0_24px_70px_rgba(2,6,23,0.45)] p-6">
      {children}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-xl bg-red-500/10 border border-red-400/20 p-3 text-sm text-red-300">
      {message}
    </div>
  );
}

function InfoBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-xl bg-cyan-500/10 border border-cyan-400/20 p-3 text-sm text-cyan-300">
      {message}
    </div>
  );
}

function GlassInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400/30 transition ${props.className ?? ""}`}
    />
  );
}

function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-full bg-[#03b2e6] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#029ad0] disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function OutlineButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-full px-4 py-2.5 text-sm font-medium text-slate-400 transition hover:text-white hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

/* Main page */

function AuthPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        backgroundImage: "url('/backgrounds/dashboardback2.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/logo-images/logo.png"
            alt="Mentora"
            width={320}
            height={100}
            className="h-20 w-auto mb-3 drop-shadow-[0_0_20px_rgba(3,178,230,0.3)]"
            priority
          />
        </div>
        {children}
      </div>
    </div>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const { user, loading: authLoading, skipRedirect, setSkipRedirect } = useAuth();

  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // MFA state
  const [mfaStep, setMfaStep] = useState<MfaStep>("none");
  const [phoneNumber, setPhoneNumber] = useState("+65 ");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const mfaResolverRef = useRef<MultiFactorResolver | null>(null);

  const passwordPolicy = {
    minLength: password.length >= 8,
    maxLength: password.length <= 70,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const isSignupPasswordValid =
    passwordPolicy.minLength &&
    passwordPolicy.maxLength &&
    passwordPolicy.uppercase &&
    passwordPolicy.lowercase &&
    passwordPolicy.number &&
    passwordPolicy.special;
  const isSignupReady =
    !loading &&
    !!email &&
    !!password &&
    !!confirmPassword &&
    password === confirmPassword &&
    isSignupPasswordValid;

  function formatSingaporePhoneInput(value: string): string {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("65")) {
      digits = digits.slice(2);
    }
    digits = digits.slice(0, 8);

    if (digits.length === 0) return "+65 ";
    if (digits.length <= 4) return `+65 ${digits}`;
    return `+65 ${digits.slice(0, 4)} ${digits.slice(4)}`;
  }

  function toSingaporeE164(value: string): string | null {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("65")) {
      digits = digits.slice(2);
    }
    if (digits.length !== 8) return null;
    return `+65${digits}`;
  }

  // If already authenticated, verified, and not in an MFA flow, redirect to dashboard
  useEffect(() => {
    if (!authLoading && user && user.emailVerified && mfaStep === "none" && !skipRedirect) {
      router.replace("/");
    }
    // If user exists but email not verified, show the verification screen
    if (!authLoading && user && !user.emailVerified && mfaStep === "none" && !skipRedirect) {
      setSkipRedirect(true);
      setMfaStep("verify-email");
      setMessage("Please verify your email before continuing.");
    }
  }, [user, authLoading, mfaStep, skipRedirect, router, setSkipRedirect]);

  // Handle magic link completion on page load
  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let storedEmail = localStorage.getItem("emailForSignIn");
      if (!storedEmail) {
        storedEmail = window.prompt("Please enter your email to complete sign-in:");
      }
      if (storedEmail) {
        setLoading(true);
        signInWithEmailLink(auth, storedEmail, window.location.href)
          .then(() => {
            localStorage.removeItem("emailForSignIn");
            router.replace("/");
          })
          .catch((err) => {
            setError(err.message);
            setLoading(false);
          });
      }
    }
  }, [router]);

  // Helpers

  function isMultiFactorError(err: unknown): err is MultiFactorError {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "auth/multi-factor-auth-required"
    );
  }

  // Auth handlers

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (!cred.user.emailVerified) {
        // Block unverified users - show verification screen
        setSkipRedirect(true);
        setMfaStep("verify-email");
        setMessage("Please verify your email before continuing. Check your inbox for the verification link.");
        setLoading(false);
        return;
      }
      router.replace("/");
    } catch (err: unknown) {
      if (isMultiFactorError(err)) {
        const resolver = getMultiFactorResolver(auth, err);
        mfaResolverRef.current = resolver;

        const phoneHint = resolver.hints.find(
          (h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID
        );
        if (phoneHint) {
          try {
            const recaptcha = getRecaptchaVerifier();
            const provider = new PhoneAuthProvider(auth);
            const vId = await provider.verifyPhoneNumber(
              { multiFactorHint: phoneHint, session: resolver.session },
              recaptcha
            );
            clearRecaptchaVerifier();
            setVerificationId(vId);
            setMfaStep("challenge-code");
            setMessage("A verification code was sent to your phone.");
          } catch (innerErr) {
            clearRecaptchaVerifier();
            setError(
              innerErr instanceof Error ? innerErr.message : "Failed to send MFA code"
            );
          }
        } else {
          setError("No phone factor enrolled. Contact support.");
        }
      } else {
        setError(err instanceof Error ? err.message : "Sign in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaChallengeVerify = async () => {
    setError("");
    setLoading(true);
    try {
      const resolver = mfaResolverRef.current;
      if (!resolver) throw new Error("No MFA resolver found");

      const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
      const assertion = PhoneMultiFactorGenerator.assertion(cred);
      await resolver.resolveSignIn(assertion);
      setMfaStep("none");
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!isSignupPasswordValid) {
      setError(
        "Password must be 8-70 chars and include uppercase, lowercase, number, and special character"
      );
      return;
    }
    setLoading(true);
    setSkipRedirect(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
      await sendEmailVerification(cred.user);
      setMfaStep("verify-email");
      setMessage("Account created! A verification email has been sent. Please verify your email, then click Continue.");
    } catch (err: unknown) {
      setSkipRedirect(false);
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  const handleMfaEnrollPhone = async () => {
    setError("");
    const e164PhoneNumber = toSingaporeE164(phoneNumber);
    if (!e164PhoneNumber) {
      setError("Please enter a valid Singapore number in +65 XXXX XXXX format");
      return;
    }
    setLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("No authenticated user");

      const session = await multiFactor(currentUser).getSession();
      const recaptcha = getRecaptchaVerifier();
      const provider = new PhoneAuthProvider(auth);
      const vId = await provider.verifyPhoneNumber(
        { phoneNumber: e164PhoneNumber, session },
        recaptcha
      );
      clearRecaptchaVerifier();
      setVerificationId(vId);
      setMfaStep("enroll-code");
      setMessage("Verification code sent to your phone.");
    } catch (err: unknown) {
      clearRecaptchaVerifier();
      const errorCode =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: string }).code)
          : "";
      if (errorCode === "auth/invalid-app-credential") {
        setError("Phone verification setup failed. Check Firebase Authorized Domains and ensure browser tracking/ad blockers are not blocking reCAPTCHA.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to send verification code");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaEnrollVerify = async () => {
    setError("");
    setLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("No authenticated user");

      const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
      const assertion = PhoneMultiFactorGenerator.assertion(cred);
      await multiFactor(currentUser).enroll(assertion, "Phone Number");
      setMfaStep("none");
      setMessage("");
      setSkipRedirect(false);
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckEmailVerified = async () => {
    setError("");
    setLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("No authenticated user");

      await currentUser.reload();
      if (currentUser.emailVerified) {
        setMfaStep("enroll-phone");
        setMessage("Email verified! Now add your phone number for extra security.");
      } else {
        setError("Email not yet verified. Please check your inbox and click the verification link, then try again.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to check verification status");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setError("");
    setLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("No authenticated user");
      await sendEmailVerification(currentUser);
      setMessage("Verification email resent! Check your inbox.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resend verification email");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setMessage("");
    if (!email) {
      setError("Enter your email in the Email field, then click Forgot Password.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("Password reset email sent. Check your inbox.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send password reset email");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    setError("");
    if (!email) {
      setError("Please enter your email first");
      return;
    }
    setLoading(true);
    try {
      await sendSignInLinkToEmail(auth, email, {
        url: window.location.origin + "/auth/signin",
        handleCodeInApp: true,
      });
      localStorage.setItem("emailForSignIn", email);
      setMessage("Magic link sent! Check your email inbox.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      router.replace("/");
    } catch (err: unknown) {
      if (isMultiFactorError(err)) {
        const resolver = getMultiFactorResolver(auth, err);
        mfaResolverRef.current = resolver;
        const phoneHint = resolver.hints.find(
          (h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID
        );
        if (phoneHint) {
          try {
            const recaptcha2 = getRecaptchaVerifier();
            const phoneProvider = new PhoneAuthProvider(auth);
            const vId = await phoneProvider.verifyPhoneNumber(
              { multiFactorHint: phoneHint, session: resolver.session },
              recaptcha2
            );
            clearRecaptchaVerifier();
            setVerificationId(vId);
            setMfaStep("challenge-code");
            setMessage("A verification code was sent to your phone.");
          } catch (innerErr) {
            clearRecaptchaVerifier();
            setError(
              innerErr instanceof Error ? innerErr.message : "Failed to send MFA code"
            );
          }
        }
      } else {
        setError(err instanceof Error ? err.message : "Google sign in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  // Render

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-[#03b2e6]" />
      </div>
    );
  }

  // Email verification step
  if (mfaStep === "verify-email") {
    return (
      <AuthPageWrapper>
        <GlassCard>
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
              <Mail className="w-5 h-5 text-[#03b2e6]" />
              Verify Your Email
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Check your inbox and click the verification link
            </p>
          </div>
          <ErrorBanner message={error} />
          <InfoBanner message={message} />
          <div className="space-y-3">
            <PrimaryButton onClick={handleCheckEmailVerified} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
              I&apos;ve Verified My Email - Continue
            </PrimaryButton>
            <OutlineButton onClick={handleResendVerification} disabled={loading}>
              Resend Verification Email
            </OutlineButton>
            <GhostButton
              onClick={async () => {
                await firebaseSignOut(auth);
                setMfaStep("none");
                setSkipRedirect(false);
                setMessage("");
                setError("");
              }}
              disabled={loading}
            >
              Back to Sign In
            </GhostButton>
          </div>
        </GlassCard>
      </AuthPageWrapper>
    );
  }

  // MFA enrollment (phone setup after signup)
  if (mfaStep === "enroll-phone" || mfaStep === "enroll-code") {
    return (
      <AuthPageWrapper>
        <GlassCard>
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
              <ShieldCheck className="w-5 h-5 text-[#03b2e6]" />
              Set Up Two-Factor Authentication
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Add your phone number for an extra layer of security
            </p>
          </div>
          <ErrorBanner message={error} />
          <InfoBanner message={message} />

          {mfaStep === "enroll-phone" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Phone Number
                </label>
                <div className="flex gap-2 items-center">
                  <Phone className="w-5 h-5 text-slate-400 shrink-0" />
                  <GlassInput
                    type="tel"
                    placeholder="+65 9234 5678"
                    value={phoneNumber}
                    onChange={(e) =>
                      setPhoneNumber(formatSingaporePhoneInput(e.target.value))
                    }
                  />
                </div>
              </div>
              <PrimaryButton onClick={handleMfaEnrollPhone} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
                Send Verification Code
              </PrimaryButton>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Verification Code
                </label>
                <GlassInput
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={verificationCode}
                  onChange={(e) =>
                    setVerificationCode(e.target.value.replace(/\D/g, ""))
                  }
                />
              </div>
              <PrimaryButton
                onClick={handleMfaEnrollVerify}
                disabled={loading || verificationCode.length !== 6}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
                Verify & Enable MFA
              </PrimaryButton>
            </div>
          )}
        </GlassCard>
        <div id="recaptcha-container" />
      </AuthPageWrapper>
    );
  }

  // MFA challenge (during sign-in)
  if (mfaStep === "challenge-code") {
    return (
      <AuthPageWrapper>
        <GlassCard>
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
              <ShieldCheck className="w-5 h-5 text-[#03b2e6]" />
              Two-Factor Verification
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Enter the verification code sent to your phone
            </p>
          </div>
          <ErrorBanner message={error} />
          <InfoBanner message={message} />
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Verification Code
              </label>
              <GlassInput
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(e.target.value.replace(/\D/g, ""))
                }
                autoFocus
              />
            </div>
            <PrimaryButton
              onClick={handleMfaChallengeVerify}
              disabled={loading || verificationCode.length !== 6}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
              Verify
            </PrimaryButton>
          </div>
        </GlassCard>
        <div id="recaptcha-container" />
      </AuthPageWrapper>
    );
  }

  // Default sign-in / sign-up form

  return (
    <AuthPageWrapper>
      <GlassCard>
        {/* Tab switcher */}
        <div className="flex rounded-full bg-white/5 border border-white/10 p-1 mb-6">
          <button
            onClick={() => { setTab("signin"); setError(""); setMessage(""); }}
            className={`flex-1 py-2 text-sm font-medium rounded-full transition-all ${
              tab === "signin"
                ? "bg-[#03b2e6]/20 text-[#4cc9f0] shadow-sm border border-[#03b2e6]/30"
                : "text-slate-400 hover:text-white border border-transparent"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setTab("signup"); setError(""); setMessage(""); }}
            className={`flex-1 py-2 text-sm font-medium rounded-full transition-all ${
              tab === "signup"
                ? "bg-[#03b2e6]/20 text-[#4cc9f0] shadow-sm border border-[#03b2e6]/30"
                : "text-slate-400 hover:text-white border border-transparent"
            }`}
          >
            Sign Up
          </button>
        </div>

        <ErrorBanner message={error} />
        <InfoBanner message={message} />

        {tab === "signin" ? (
          <>
            <form onSubmit={handleEmailSignIn} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Email
                </label>
                <GlassInput
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <GlassInput
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <PrimaryButton type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
                Sign In
              </PrimaryButton>
            </form>

            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              className="mt-2 w-full text-sm text-[#4cc9f0] hover:text-[#03b2e6] hover:underline disabled:opacity-60 transition"
            >
              Forgot Password?
            </button>

            {/* Magic link */}
            <div className="mt-3">
              <OutlineButton type="button" disabled={loading} onClick={handleMagicLink}>
                <Mail className="w-4 h-4 mr-2 inline" />
                Send Magic Link
              </OutlineButton>
            </div>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-slate-950/70 px-3 text-slate-500">or</span>
              </div>
            </div>

            {/* Google */}
            <OutlineButton type="button" disabled={loading} onClick={handleGoogleSignIn}>
              <svg className="w-4 h-4 mr-2 inline" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </OutlineButton>
          </>
        ) : (
          /* Sign Up tab */
          <form onSubmit={handleEmailSignUp} className="space-y-4">
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-slate-300 mb-1.5">
                Display Name
              </label>
              <GlassInput
                id="displayName"
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="signupEmail" className="block text-sm font-medium text-slate-300 mb-1.5">
                Email
              </label>
              <GlassInput
                id="signupEmail"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="signupPassword" className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <GlassInput
                id="signupPassword"
                type="password"
                placeholder="8-70 chars, mixed complexity"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-1.5">
                Confirm Password
              </label>
              <GlassInput
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm space-y-1">
              <p className={passwordPolicy.minLength ? "text-emerald-400" : "text-red-400"}>
                Min length 8
              </p>
              <p className={passwordPolicy.maxLength ? "text-emerald-400" : "text-red-400"}>
                Max length 70
              </p>
              <p className={passwordPolicy.uppercase ? "text-emerald-400" : "text-red-400"}>
                Require uppercase character
              </p>
              <p className={passwordPolicy.lowercase ? "text-emerald-400" : "text-red-400"}>
                Require lowercase character
              </p>
              <p className={passwordPolicy.number ? "text-emerald-400" : "text-red-400"}>
                Require numeric character
              </p>
              <p className={passwordPolicy.special ? "text-emerald-400" : "text-red-400"}>
                Require special character
              </p>
            </div>
            <PrimaryButton type="submit" disabled={!isSignupReady}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}
              Create Account
            </PrimaryButton>
          </form>
        )}
      </GlassCard>

      {/* Invisible reCAPTCHA container */}
      <div id="recaptcha-container" />
    </AuthPageWrapper>
  );
}

