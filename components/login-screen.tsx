"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>
  onGoRegister: () => void
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function LoginScreen({ onLogin, onGoRegister }: LoginScreenProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validEmail = isValidEmail(email)
  const showEmailError = touched && email.length > 0 && !validEmail
  const canSubmit = validEmail && password.length >= 6

  const handleContinue = async () => {
    setTouched(true)
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await onLogin(email.trim(), password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign in failed"
      setError(friendlyAuthError(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Top spacer */}
      <div className="flex-1" />

      {/* Centered content — max-width on desktop */}
      <div className="w-full md:max-w-sm md:mx-auto flex flex-col">

        {/* Logo + Brand */}
        <div className="flex flex-col items-center gap-5 px-8 mb-12">

          {/* App icon */}
          <div className="animate-spring-pop animate-logo-breathe">
            <div
              className="rounded-4xl p-[1.5px]"
              style={{
                background: "linear-gradient(160deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 55%, rgba(255,255,255,0.14) 100%)",
                boxShadow: "0 24px 64px rgba(5, 15, 50, 0.75), 0 4px 16px rgba(5,15,50,0.5)",
              }}
            >
              <div
                className="w-28 h-28 rounded-[30.5px] flex items-center justify-center overflow-hidden"
                style={{
                  background: "linear-gradient(160deg, #0e2040 0%, #07112a 60%, #050d1e 100%)",
                }}
              >
                <Image
                  src="/logo.png"
                  alt="SVC Stream"
                  width={90}
                  height={90}
                  style={{ width: 90, height: 90 }}
                  className="object-contain"
                  priority
                />
              </div>
            </div>
          </div>

          {/* Brand text */}
          <div className="text-center animate-fade-up delay-200">
            <h1 className="text-[22px] font-bold tracking-tight">
              SVC <span className="text-primary">Stream</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">
              Your team&apos;s communication layer
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="px-6 flex flex-col gap-3 animate-fade-up delay-300">

          {/* Email */}
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono px-1">
            Email
          </label>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onInput={(e) => setEmail(e.currentTarget.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => e.key === "Enter" && handleContinue()}
            placeholder="you@company.com"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            spellCheck={false}
            ref={inputRef}
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
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 pr-11 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200 focus:border-primary/50 focus:bg-white/[0.07]"
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

          {/* Auth error */}
          {error && (
            <p className="text-[11px] text-destructive/80 px-1 font-mono -mt-1 animate-fade-in">
              {error}
            </p>
          )}

          {/* Sign in button */}
          <button
            onClick={handleContinue}
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
                Signing in…
              </span>
            ) : (
              "Sign In"
            )}
          </button>

          {/* Register link */}
          <p className="text-center text-xs text-muted-foreground mt-1">
            No account yet?{" "}
            <button
              onClick={onGoRegister}
              className="text-primary font-semibold hover:underline"
            >
              Create one
            </button>
          </p>
        </div>
      </div>

      {/* Bottom spacer */}
      <div className="flex-[1.5]" />

      {/* Footer */}
      <div className="pb-10 px-8 text-center animate-fade-in delay-400">
        <p className="text-[11px] text-muted-foreground/30 font-mono tracking-wide">
          SVC Stream · Powered by Firebase
        </p>
      </div>
    </div>
  )
}

function friendlyAuthError(msg: string): string {
  if (msg.includes("user-not-found") || msg.includes("wrong-password") || msg.includes("invalid-credential"))
    return "Invalid email or password."
  if (msg.includes("too-many-requests"))
    return "Too many attempts. Try again later."
  if (msg.includes("network"))
    return "Network error. Check your connection."
  return "Sign in failed. Please try again."
}
