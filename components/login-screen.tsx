"use client"

import { useState } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface LoginScreenProps {
  onLogin: (email: string) => void
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState("")
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)

  const valid = isValidEmail(email)
  const showError = touched && email.length > 0 && !valid

  const handleContinue = () => {
    setTouched(true)
    if (!valid) return
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      onLogin(email.trim())
    }, 800)
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Top spacer */}
      <div className="flex-1" />

      {/* Logo + Brand */}
      <div className="flex flex-col items-center gap-5 px-8 mb-12">

        {/* App icon — navy gradient rect + gradient border ring */}
        <div className="animate-spring-pop animate-logo-breathe">
          {/* Gradient border layer */}
          <div
            className="rounded-[32px] p-[1.5px]"
            style={{
              background: "linear-gradient(160deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 55%, rgba(255,255,255,0.14) 100%)",
              boxShadow: "0 24px 64px rgba(5, 15, 50, 0.75), 0 4px 16px rgba(5,15,50,0.5)",
            }}
          >
            {/* Inner dark navy gradient */}
            <div
              className="w-[112px] h-[112px] rounded-[30.5px] flex items-center justify-center overflow-hidden"
              style={{
                background: "linear-gradient(160deg, #0e2040 0%, #07112a 60%, #050d1e 100%)",
              }}
            >
              <Image
                src="/logo.png"
                alt="SVC Stream"
                width={90}
                height={90}
                className="w-[90px] h-[90px] object-contain"
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
            Your team's communication layer
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="px-6 flex flex-col gap-3 animate-fade-up delay-300">
        {/* Email label */}
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono px-1">
          Email
        </label>

        {/* Email input */}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => e.key === "Enter" && handleContinue()}
          placeholder="you@company.com"
          autoComplete="email"
          className={cn(
            "bg-white/5 border rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200",
            showError
              ? "border-destructive/50 focus:border-destructive/60 bg-destructive/5"
              : "border-white/10 focus:border-primary/50 focus:bg-white/[0.07]"
          )}
        />

        {/* Inline error */}
        {showError && (
          <p className="text-[11px] text-destructive/80 px-1 font-mono -mt-1 animate-fade-in">
            Enter a valid email — needs an @
          </p>
        )}

        {/* Continue button */}
        <button
          onClick={handleContinue}
          disabled={loading}
          className={cn(
            "relative mt-1 w-full py-3.5 rounded-xl text-sm font-semibold text-white overflow-hidden",
            "transition-all duration-200 active:scale-[0.97]",
            valid && !loading
              ? "bg-primary shadow-[0_6px_24px_rgba(37,99,235,0.45)]"
              : "bg-white/8 text-muted-foreground/40 border border-white/8"
          )}
        >
          {/* Shimmer overlay when active */}
          {valid && !loading && (
            <span className="absolute inset-0 animate-shimmer pointer-events-none" />
          )}
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white/25 border-t-white animate-spin" />
              Signing in…
            </span>
          ) : (
            "Continue"
          )}
        </button>
      </div>

      {/* Bottom spacer */}
      <div className="flex-[1.5]" />

      {/* Footer */}
      <div className="pb-10 px-8 text-center animate-fade-in delay-400">
        <p className="text-[11px] text-muted-foreground/30 font-mono tracking-wide">
          MVP · Not connected to Firebase yet
        </p>
      </div>
    </div>
  )
}
