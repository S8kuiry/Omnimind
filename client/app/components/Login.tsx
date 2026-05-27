'use client'

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from 'react'
import { toast } from "react-hot-toast";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialErrorCode?: string | null;
}

export default function LoginModal({ isOpen, onClose, initialErrorCode }: LoginModalProps) {
  const [isLoading, setLoading] = useState<boolean>(false);
  const [googlLoad, setGoogleLoad] = useState<boolean>(false);
  const [step, setStep] = useState<number>(1); // 1 - login form, 2 - otp form
  const [email, setEmail] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  const router = useRouter();
  const [uiError, setUiError] = useState<{ title: string; message: string } | null>(null);

  function friendlyAuthError(code: string) {
    switch (code) {
      case "ALREADY_EXISTS_WITH_EMAIL":
        return { title: "Use OTP login", message: "This email is registered via OTP. Please sign in using the email + OTP flow." };
      case "ALREADY_EXISTS_WITH_GOOGLE":
        return { title: "Use Google login", message: "This email is registered with Google. Please sign in with Google." };
      case "OAuthSignin":
      case "OAuthCallback":
        return { title: "Google sign-in failed", message: "We couldn’t complete Google login. Please try again." };
      case "OAuthAccountNotLinked":
        return { title: "Account not linked", message: "This email is already used with a different sign-in method. Use the same method you used before." };
      case "AccessDenied":
        return { title: "Access denied", message: "Sign-in was blocked. Please try again or use a different method." };
      case "CredentialsSignin":
        return { title: "Invalid OTP", message: "The OTP is incorrect or expired. Please request a new OTP and try again." };
      default:
        return { title: "Sign-in error", message: "Something went wrong while signing in. Please try again." };
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    if (!initialErrorCode) return;
    setUiError(friendlyAuthError(initialErrorCode));
    setStep(1);
  }, [isOpen, initialErrorCode]);

  if (!isOpen) return null;

  const handleOtpSend = async () => {
    setUiError(null);
    if (!email || !username) {
      setUiError({ title: "Missing details", message: "Please enter both username and email to receive an OTP." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      const data = await res.json();

      if (res.ok) {
        toast.success("OTP sent to your email!");
        setStep(2);
      } else {
        setUiError({ title: "Couldn’t send OTP", message: String(data?.error || "Something went wrong. Please try again.") });
      }
    } catch (error) {
      setUiError({ title: "Network error", message: "Failed to send OTP. Please check your connection and try again." });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setUiError(null);
    if (!otp) {
      setUiError({ title: "OTP required", message: "Please enter the 6-digit OTP sent to your email." });
      return;
    }
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email,
        username,
        otp,
        redirect: false,
      });

      if (res?.ok) {
        toast.success("Welcome back!");
        onClose();
        router.push("/dashboard");
      } else {
        setUiError(friendlyAuthError(res?.error || "CredentialsSignin"));
      }
    } catch (error) {
      setUiError({ title: "Sign-in failed", message: "Something went wrong while verifying your OTP. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setUiError(null);
      setGoogleLoad(true);
      await signIn('google', { callbackUrl: '/dashboard' });
    } catch (error) {
      console.error('Google login failed:', error);
      setUiError({ title: "Google sign-in failed", message: "Please try again." });
    } finally {
      setGoogleLoad(false);
    }
  };

  return (
    <div className="fixed inset-0 w-screen h-screen z-50 flex items-center justify-center bg-[#010003]/80 backdrop-blur-md transition-all duration-300">
      
      {/* Structural Central Container Frame */}
      <div 
        className="w-full max-w-md p-8 mx-4 relative border border-white/50 bg-[#010003] shadow-[0_0_50px_rgba(244,63,94,0.06)] rounded-sm"
        style={{ fontFamily: "'Courier New', Courier, monospace" }}
      >
        {/* Terminal Close Window Flag */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-rose-300 text-[11px] uppercase tracking-wider transition-colors"
        >
          [ close_x ]
        </button>

        {uiError && (
          <div className="mb-6 mt-3 border border-rose-500/30 bg-rose-500/5 px-4 py-3 rounded-sm">
            <p className="text-[10px] uppercase tracking-[0.25em] text-rose-300/90 font-bold">
              {uiError.title}
            </p>
            <p className="mt-1 text-[11px] text-white/70 leading-relaxed">
              {uiError.message}
            </p>
          </div>
        )}

        {step === 1 ? (
          <>
            {/* Header Identity Section */}
            <div className="mb-8 space-y-1">
              <h2 className="text-sm font-bold text-white tracking-[0.15em] uppercase">
                // SECURE_GATEWAY_AUTH
              </h2>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">
                Provide credentials to connect to user workspace nodes.
              </p>
            </div>

            <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
              {/* Username Input Frame */}
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase tracking-[0.25em] text-white/50 block">
                  node_username
                </label>
                <input
                  type="text"
                  value={username}
                  placeholder="e.g., user_node_cse"
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#010003] border border-white/50 rounded-sm px-4 py-3 text-white text-xs font-mono placeholder:text-white/20 focus:outline-none focus:border-rose-500/50 transition-all"
                />
              </div>

              {/* Email Input Frame */}
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase tracking-[0.25em] text-white/50 block">
                  network_email_address
                </label>
                <input
                  type="email"
                  value={email}
                  placeholder="name@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#010003] border border-white/50 rounded-sm px-4 py-3 text-white text-xs font-mono placeholder:text-white/20 focus:outline-none focus:border-rose-500/50 transition-all"
                />
              </div>

              {/* Core Verification Submit Action */}
              <button 
                onClick={handleOtpSend} 
                className="w-full flex items-center justify-center border border-rose-500/40 hover:border-rose-400 text-rose-300 bg-rose-500/5 hover:bg-rose-500/10 font-bold py-3 text-xs tracking-[0.2em] rounded-sm transition-all duration-150 active:scale-[0.98]"
              >
                {isLoading ? "REQUESTING_OTP..." : "CONTINUE_AUTHENTICATION"}
              </button>
            </form>

            {/* Split Decorative Divider Layer */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10"></div>
              </div>
              <div className="relative flex justify-center text-[9px] uppercase tracking-[0.2em]">
                <span className="bg-[#010003] px-3 text-white/50">OR_FEDERATED_SIGNIN</span>
              </div>
            </div>

            {/* Google OAuth Activation Mechanism */}
            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 border border-white/50 rounded-sm bg-white/5 py-3 text-white/70 hover:text-white hover:border-white transition-all text-xs font-mono tracking-widest uppercase active:scale-[0.98]"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  fill="#EA4335"
                />
              </svg>
              <span>{googlLoad ? "CONNECTING_PROVIDERS..." : "LOGIN_VIA_GOOGLE"}</span>
            </button>
          </>
        ) : (
          /* OTP TOKEN INPUT STAGE */
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-white tracking-[0.15em] uppercase">
                // VERIFY_DISPATCHED_TOKEN
              </h2>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">
                A 6-digit credential signature was securely dispatched to: <span className="text-white/70 lowercase">{email}</span>
              </p>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                maxLength={6}
                value={otp}
                placeholder="000000"
                onChange={(e) => setOtp(e.target.value)}
                className="w-full bg-[#010003] border border-white/50 rounded-sm px-4 py-3 text-center text-sm text-white font-mono tracking-[0.5em] placeholder:text-white/20 focus:outline-none focus:border-rose-500/50 transition-all"
              />

              <button
                onClick={handleVerifyOtp}
                disabled={isLoading}
                className="w-full border border-rose-500/40 hover:border-rose-400 text-rose-300 bg-rose-500/5 hover:bg-rose-500/10 font-bold py-3 text-xs tracking-[0.2em] rounded-sm transition-all duration-150 active:scale-[0.98]"
              >
                {isLoading ? "VALIDATING_TOKEN..." : "VERIFY_AND_CONNECT"}
              </button>

              <button
                onClick={() => setStep(1)}
                className="w-full text-[9px] uppercase tracking-[0.2em] text-white/50 hover:text-white text-center block transition-colors"
              >
                [&lt;- return_to_credentials]
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}