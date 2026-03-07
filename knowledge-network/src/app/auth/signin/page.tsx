"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
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
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  multiFactor,
  getMultiFactorResolver,
  type MultiFactorResolver,
  type MultiFactorError,
  type UserCredential,
} from "firebase/auth";
import { auth, getRecaptchaVerifier, clearRecaptchaVerifier } from "@/lib/firebase-auth";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Loader2, Phone, ShieldCheck } from "lucide-react";

type Tab = "signin" | "signup";
type MfaStep = "none" | "verify-email" | "enroll-phone" | "enroll-code" | "challenge-code";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
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

  // If already authenticated and not in an MFA flow, redirect to dashboard
  useEffect(() => {
    if (!authLoading && user?.emailVerified && mfaStep === "none" && !skipRedirect) {
      router.replace("/");
    }
  }, [user, authLoading, mfaStep, skipRedirect, router]);

  useEffect(() => {
    if (searchParams.get("verifyEmail") === "1") {
      setError("Please verify your email address before signing in.");
    }
  }, [searchParams]);

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
          .then(async (credential) => {
            localStorage.removeItem("emailForSignIn");
            await completeSignInIfEmailVerified(credential);
            setLoading(false);
          })
          .catch(async (err: unknown) => {
            if (isMultiFactorError(err)) {
              const resolver = getMultiFactorResolver(auth, err);
              await startMfaPhoneChallenge(resolver);
            } else {
              setError(err instanceof Error ? err.message : "Magic link sign in failed");
            }
            setLoading(false);
          });
      }
    }
  }, [router]);

  // ── Helpers ──────────────────────────────────────────────

  function isMultiFactorError(err: unknown): err is MultiFactorError {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "auth/multi-factor-auth-required"
    );
  }

  const completeSignInIfEmailVerified = async (
    credential: UserCredential,
    options?: { fromGoogle?: boolean }
  ): Promise<boolean> => {
    await credential.user.reload();
    if (credential.user.emailVerified) {
      router.replace("/");
      return true;
    }

    try {
      await sendEmailVerification(credential.user);
    } catch {
      // Best effort only.
    }
    setError(
      options?.fromGoogle
        ? "Your Google account email is not verified. Verify it with Google first, then sign in again."
        : "Email not verified. We sent a fresh verification email. Please verify it, then sign in."
    );
    router.replace("/auth/signin?verifyEmail=1");
    return false;
  };

  const startMfaPhoneChallenge = async (resolver: MultiFactorResolver) => {
    mfaResolverRef.current = resolver;
    const phoneHint = resolver.hints.find(
      (h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID
    );
    if (!phoneHint) {
      setError("No phone factor enrolled. Contact support.");
      return;
    }

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
  };

  // ── Auth handlers ────────────────────────────────────────

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await completeSignInIfEmailVerified(credential);
    } catch (err: unknown) {
      if (isMultiFactorError(err)) {
        const resolver = getMultiFactorResolver(auth, err);
        await startMfaPhoneChallenge(resolver);
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
      const signInResult = await resolver.resolveSignIn(assertion);
      await completeSignInIfEmailVerified(signInResult);
      setMfaStep("none");
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
    // Prevent route guard from redirecting during sign-up flow
    setSkipRedirect(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
      // Send verification email before MFA enrollment
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

  const getCurrentUserForVerification = async () => {
    if (auth.currentUser) return auth.currentUser;
    if (email && password) {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      return credential.user;
    }
    throw new Error("Session expired. Sign in again, then continue verification.");
  };

  const handleCheckEmailVerified = async () => {
    setError("");
    setLoading(true);
    try {
      const currentUser = await getCurrentUserForVerification();

      // Reload user to get latest emailVerified status
      await currentUser.reload();
      if (currentUser.emailVerified) {
        setMfaStep("none");
        setMessage("");
        setSkipRedirect(false);
        router.replace("/");
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
      const currentUser = await getCurrentUserForVerification();
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

  const handleCheckEmailVerifiedAndEnrollPhone = async () => {
    setError("");
    setLoading(true);
    try {
      const currentUser = await getCurrentUserForVerification();

      await currentUser.reload();
      if (currentUser.emailVerified) {
        setMfaStep("enroll-phone");
        setMessage("Email verified! You can set up phone verification now, or skip for now.");
      } else {
        setError("Email not yet verified. Please verify your email first.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to check verification status");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipPhoneEnrollment = () => {
    setMfaStep("none");
    setMessage("");
    setSkipRedirect(false);
    router.replace("/");
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
    setMessage("");
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      await completeSignInIfEmailVerified(credential, { fromGoogle: true });
    } catch (err: unknown) {
      if (isMultiFactorError(err)) {
        const resolver = getMultiFactorResolver(auth, err);
        await startMfaPhoneChallenge(resolver);
      } else {
        setError(err instanceof Error ? err.message : "Google sign in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-[#03b2e6]" />
      </div>
    );
  }

  // MFA enrollment flow (after sign-up)
  // Email verification step (after sign-up, before MFA enrollment)
  if (mfaStep === "verify-email") {
    return (
      <div className="flex h-dvh items-start justify-center overflow-y-auto bg-background px-4 py-6 sm:items-center sm:py-8">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <Image
              src="/logo-images/logo.png"
              alt="Mentora"
              width={320}
              height={100}
              className="h-20 w-auto mb-3"
              priority
            />
          </div>
          <Card>
            <CardHeader className="pb-4 text-center">
              <div className="flex items-center justify-center gap-2 text-lg font-semibold">
                <Mail className="w-5 h-5 text-[#03b2e6]" />
                Verify Your Email
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Check your inbox and click the verification link
              </p>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {message && (
                <div className="mb-4 rounded-md bg-blue-50 border border-[#03b2e6]/30 p-3 text-sm text-[#03b2e6]">
                  {message}
                </div>
              )}
              <div className="space-y-3">
                <Button
                  onClick={handleCheckEmailVerified}
                  disabled={loading}
                  className="w-full bg-[#03b2e6] hover:bg-[#029ad0] text-white"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  I&apos;ve Verified My Email — Continue
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCheckEmailVerifiedAndEnrollPhone}
                  disabled={loading}
                  className="w-full"
                >
                  Continue And Set Up Phone Verification
                </Button>
                <Button
                  variant="outline"
                  onClick={handleResendVerification}
                  disabled={loading}
                  className="w-full"
                >
                  Resend Verification Email
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (mfaStep === "enroll-phone" || mfaStep === "enroll-code") {
    return (
      <div className="flex h-dvh items-start justify-center overflow-y-auto bg-background px-4 py-6 sm:items-center sm:py-8">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <Image
              src="/logo-images/logo.png"
              alt="Mentora"
              width={320}
              height={100}
              className="h-20 w-auto mb-3"
              priority
            />
          </div>
          <Card>
            <CardHeader className="pb-4 text-center">
              <div className="flex items-center justify-center gap-2 text-lg font-semibold">
                <ShieldCheck className="w-5 h-5 text-[#03b2e6]" />
                Set Up Two-Factor Authentication
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Add your phone number for an extra layer of security
              </p>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {message && (
                <div className="mb-4 rounded-md bg-blue-50 border border-[#03b2e6]/30 p-3 text-sm text-[#03b2e6]">
                  {message}
                </div>
              )}

              {mfaStep === "enroll-phone" ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number
                    </label>
                    <div className="flex gap-2">
                      <Phone className="w-5 h-5 mt-2 text-gray-400" />
                      <Input
                        type="tel"
                        placeholder="+65 9234 5678"
                        value={phoneNumber}
                        onChange={(e) =>
                          setPhoneNumber(formatSingaporePhoneInput(e.target.value))
                        }
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleMfaEnrollPhone}
                    disabled={loading}
                    className="w-full bg-[#03b2e6] hover:bg-[#029ad0] text-white"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Send Verification Code
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSkipPhoneEnrollment}
                    disabled={loading}
                    className="w-full"
                  >
                    Skip For Now
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Verification Code
                    </label>
                    <Input
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
                  <Button
                    onClick={handleMfaEnrollVerify}
                    disabled={loading || verificationCode.length !== 6}
                    className="w-full bg-[#03b2e6] hover:bg-[#029ad0] text-white"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Verify & Enable MFA
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSkipPhoneEnrollment}
                    disabled={loading}
                    className="w-full"
                  >
                    Skip For Now
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <div id="recaptcha-container" />
        </div>
      </div>
    );
  }

  // MFA challenge flow (during sign-in)
  if (mfaStep === "challenge-code") {
    return (
      <div className="flex h-dvh items-start justify-center overflow-y-auto bg-background px-4 py-6 sm:items-center sm:py-8">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <Image
              src="/logo-images/logo.png"
              alt="Mentora"
              width={320}
              height={100}
              className="h-20 w-auto mb-3"
              priority
            />
          </div>
          <Card>
            <CardHeader className="pb-4 text-center">
              <div className="flex items-center justify-center gap-2 text-lg font-semibold">
                <ShieldCheck className="w-5 h-5 text-[#03b2e6]" />
                Two-Factor Verification
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Enter the verification code sent to your phone
              </p>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {message && (
                <div className="mb-4 rounded-md bg-blue-50 border border-[#03b2e6]/30 p-3 text-sm text-[#03b2e6]">
                  {message}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Verification Code
                  </label>
                  <Input
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
                <Button
                  onClick={handleMfaChallengeVerify}
                  disabled={loading || verificationCode.length !== 6}
                  className="w-full bg-[#03b2e6] hover:bg-[#029ad0] text-white"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Verify
                </Button>
              </div>
            </CardContent>
          </Card>
          <div id="recaptcha-container" />
        </div>
      </div>
    );
  }

  // ── Default sign-in / sign-up form ──────────────────────

  return (
    <div className="flex h-dvh items-start justify-center overflow-y-auto bg-background px-4 py-6 sm:items-center sm:py-8">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/logo-images/logo.png"
            alt="Mentora"
            width={320}
            height={100}
            className="h-20 w-auto mb-3"
            priority
          />
          <p className="text-sm text-gray-500 mt-1">Sign in to continue learning</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            {/* Tab switcher */}
            <div className="flex rounded-full bg-muted p-1">
              <button
                onClick={() => { setTab("signin"); setError(""); setMessage(""); }}
                className={`flex-1 py-2 text-sm font-medium rounded-full transition-colors ${
                  tab === "signin"
                    ? "bg-white text-[#03b2e6] shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setTab("signup"); setError(""); setMessage(""); }}
                className={`flex-1 py-2 text-sm font-medium rounded-full transition-colors ${
                  tab === "signup"
                    ? "bg-white text-[#03b2e6] shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sign Up
              </button>
            </div>
          </CardHeader>

          <CardContent>
            {error && (
              <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {message && (
              <div className="mb-4 rounded-md bg-blue-50 border border-[#03b2e6]/30 p-3 text-sm text-[#03b2e6]">
                {message}
              </div>
            )}

            {tab === "signin" ? (
              <>
                {/* Email + Password sign in */}
                <form onSubmit={handleEmailSignIn} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                    </label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                      Password
                    </label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#03b2e6] hover:bg-[#029ad0] text-white"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Sign In
                  </Button>
                </form>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="mt-2 w-full text-sm text-[#03b2e6] hover:underline disabled:opacity-60"
                >
                  Forgot Password?
                </button>

                {/* Magic link */}
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={handleMagicLink}
                    className="w-full"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send Magic Link
                  </Button>
                </div>

                {/* Divider */}
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                {/* Google */}
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading}
                  onClick={handleGoogleSignIn}
                  className="w-full"
                >
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
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
                </Button>
              </>
            ) : (
              /* Sign Up tab */
              <form onSubmit={handleEmailSignUp} className="space-y-4">
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
                    Display Name
                  </label>
                  <Input
                    id="displayName"
                    type="text"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="signupEmail" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <Input
                    id="signupEmail"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="signupPassword" className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <Input
                    id="signupPassword"
                    type="password"
                    placeholder="8-70 chars, mixed complexity"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm Password
                  </label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
                  <p className={passwordPolicy.minLength ? "text-green-700" : "text-red-600"}>
                    Min length 8
                  </p>
                  <p className={passwordPolicy.maxLength ? "text-green-700" : "text-red-600"}>
                    Max length 70
                  </p>
                  <p className={passwordPolicy.uppercase ? "text-green-700" : "text-red-600"}>
                    Require uppercase character
                  </p>
                  <p className={passwordPolicy.lowercase ? "text-green-700" : "text-red-600"}>
                    Require lowercase character
                  </p>
                  <p className={passwordPolicy.number ? "text-green-700" : "text-red-600"}>
                    Require numeric character
                  </p>
                  <p className={passwordPolicy.special ? "text-green-700" : "text-red-600"}>
                    Require special character
                  </p>
                </div>
                <Button
                  type="submit"
                  disabled={!isSignupReady}
                  className="w-full bg-[#03b2e6] hover:bg-[#029ad0] text-white"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Create Account
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Invisible reCAPTCHA container */}
        <div id="recaptcha-container" />
      </div>
    </div>
  );
}

