"use client"

import { useState } from "react"
import Image from "next/image"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

interface RegisterScreenProps {
  onRegister: (name: string, email: string, password: string) => Promise<void>
  onGoogleSignIn: () => Promise<void>
  onGoLogin: () => void
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function RegisterScreen({ onRegister, onGoogleSignIn, onGoLogin }: RegisterScreenProps) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validEmail = isValidEmail(email)
  const passwordOk = password.length >= 6
  const passwordsMatch = password === confirmPassword
  const canSubmit = name.trim().length >= 2 && validEmail && passwordOk && passwordsMatch

  const showEmailError = touched && email.length > 0 && !validEmail
  const showPasswordError = touched && password.length > 0 && !passwordOk
  const showMismatch = touched && confirmPassword.length > 0 && !passwordsMatch

  const handleSubmit = async () => {
    setTouched(true)
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await onRegister(name.trim(), email.trim(), password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed"
      setError(friendlyAuthError(msg))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    setError(null)
    try {
      await onGoogleSignIn()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Google sign in failed"
      setError(friendlyAuthError(msg))
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col stream-glass-screen overflow-y-auto">
      {/* Top spacer */}
      <div className="flex-1 min-h-8" />

      <div className="w-full md:max-w-sm md:mx-auto flex flex-col">

        {/* Logo + Brand */}
        <div className="flex flex-col items-center gap-5 px-8 mb-10">
          <div className="animate-spring-pop">
            <div
              className="rounded-4xl p-[1.5px]"
              style={{
                background: "linear-gradient(160deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 55%, rgba(255,255,255,0.14) 100%)",
                boxShadow: "0 24px 64px rgba(5, 15, 50, 0.75), 0 4px 16px rgba(5,15,50,0.5)",
              }}
            >
              <div
                className="w-20 h-20 rounded-[22px] flex items-center justify-center overflow-hidden"
                style={{ background: "linear-gradient(160deg, #0e2040 0%, #07112a 60%, #050d1e 100%)" }}
              >
                <Image src="/logo.png" alt="SVC Stream" width={64} height={64} className="object-contain" priority />
              </div>
            </div>
          </div>

          <div className="text-center animate-fade-up delay-200">
            <h1 className="text-[20px] font-bold tracking-tight">
              Create account
            </h1>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">
              Join your team on SVC Stream
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="px-6 flex flex-col gap-3 animate-fade-up delay-300 pb-10">

          {/* Name */}
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono px-1">
            Full Name
          </label>
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Jane Smith"
            autoComplete="name"
            autoCapitalize="words"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200 focus:border-primary/50 focus:bg-white/[0.07]"
          />

          {/* Email */}
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono px-1 mt-1">
            Email
          </label>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="you@company.com"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            spellCheck={false}
            className={cn(
              "bg-white/5 border rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200",
              showEmailError
                ? "border-destructive/50 focus:border-destructive/60 bg-destructive/5"
                : "border-white/10 focus:border-primary/50 focus:bg-white/[0.07]"
            )}
          />
          {showEmailError && (
            <p className="text-[11px] text-destructive/80 px-1 font-mono -mt-1 animate-fade-in">
              Enter a valid email — needs an @
            </p>
          )}

          {/* Password */}
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono px-1 mt-1">
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Min. 6 characters"
              autoComplete="new-password"
              className={cn(
                "w-full bg-white/5 border rounded-xl px-4 py-3.5 pr-11 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200",
                showPasswordError
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-white/10 focus:border-primary/50 focus:bg-white/[0.07]"
              )}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {showPasswordError && (
            <p className="text-[11px] text-destructive/80 px-1 font-mono -mt-1 animate-fade-in">
              Password must be at least 6 characters
            </p>
          )}

          {/* Confirm Password */}
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono px-1 mt-1">
            Confirm Password
          </label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              name="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Repeat your password"
              autoComplete="new-password"
              className={cn(
                "w-full bg-white/5 border rounded-xl px-4 py-3.5 pr-11 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200",
                showMismatch
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-white/10 focus:border-primary/50 focus:bg-white/[0.07]"
              )}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {showMismatch && (
            <p className="text-[11px] text-destructive/80 px-1 font-mono -mt-1 animate-fade-in">
              Passwords don&apos;t match
            </p>
          )}

          {/* Auth error */}
          {error && (
            <p className="text-[11px] text-destructive/80 px-1 font-mono -mt-1 animate-fade-in">
              {error}
            </p>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={cn(
              "relative mt-1 w-full py-3.5 rounded-xl text-sm font-semibold text-white overflow-hidden",
              "transition-all duration-200 active:scale-[0.97] hover:scale-[1.01]",
              canSubmit && !loading
                ? "bg-primary shadow-[0_6px_24px_rgba(37,99,235,0.45)] hover:shadow-[0_8px_32px_rgba(37,99,235,0.55)]"
                : "bg-white/8 text-muted-foreground/40 border border-white/8"
            )}
          >
            {canSubmit && !loading && (
              <span className="absolute inset-0 animate-shimmer pointer-events-none" />
            )}
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                Creating account…
              </span>
            ) : (
              "Create Account"
            )}
          </button>

          <button
            onClick={handleGoogle}
            disabled={googleLoading || loading}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white px-4 py-3.5 text-sm font-semibold text-gray-900 shadow-[0_6px_24px_rgba(255,255,255,0.08)] transition-all duration-200 hover:scale-[1.01] active:scale-[0.97] disabled:opacity-60 disabled:hover:scale-100"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 text-[13px] font-bold text-blue-600">
              G
            </span>
            {googleLoading ? "Signing in..." : "Continue with Google"}
          </button>

          {/* Login link */}
          <p className="text-center text-xs text-muted-foreground mt-1">
            Already have an account?{" "}
            <button
              onClick={onGoLogin}
              className="text-primary font-semibold hover:underline"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>

      <div className="flex-[0.5] min-h-4" />
    </div>
  )
}

function friendlyAuthError(msg: string): string {
  if (msg.includes("popup-closed-by-user") || msg.includes("cancelled-popup-request"))
    return "Google sign in was cancelled."
  if (msg.includes("popup-blocked"))
    return "Popup was blocked. Allow popups and try again."
  if (msg.includes("email-already-in-use"))
    return "An account with this email already exists."
  if (msg.includes("weak-password"))
    return "Password is too weak. Use at least 6 characters."
  if (msg.includes("invalid-email"))
    return "Invalid email address."
  if (msg.includes("network"))
    return "Network error. Check your connection."
  return "Registration failed. Please try again."
}
