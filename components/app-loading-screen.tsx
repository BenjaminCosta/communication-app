"use client"

export function AppLoadingScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-10 bg-background animate-fade-in">

      {/* Logo block */}
      <div className="flex flex-col items-center gap-4">
        {/* Icon */}
        <div className="relative animate-spring-pop">
          <div
            className="w-24 h-24 rounded-[28px] flex items-center justify-center animate-logo-breathe"
            style={{
              background: "linear-gradient(145deg, #0f2249 0%, #0d1a3a 100%)",
              boxShadow: "0 0 0 1px rgba(37,99,235,0.18), 0 0 40px rgba(37,99,235,0.18), 0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            <span className="text-5xl select-none" role="img" aria-label="thinking">🤔</span>
          </div>
          {/* Outer glow ring */}
          <div
            className="absolute inset-0 rounded-[28px] pointer-events-none"
            style={{ boxShadow: "0 0 0 1px rgba(37,99,235,0.10)" }}
          />
        </div>

        {/* App name */}
        <div className="text-center animate-fade-up delay-200">
          <p className="text-xl font-bold tracking-tight">
            SVC <span className="text-primary">Stream</span>
          </p>
          <p className="text-[11px] text-muted-foreground/50 font-mono tracking-[3px] uppercase mt-1">
            Team Communication
          </p>
        </div>
      </div>

      {/* Loading bar */}
      <div className="flex flex-col items-center gap-3 animate-fade-up delay-400">
        <div className="w-44 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            className="h-full w-1/2 rounded-full animate-load-bar"
            style={{ background: "linear-gradient(90deg, transparent, #2563EB, #60a5fa, transparent)" }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/40 font-mono tracking-[3px] uppercase">
          Loading
        </p>
      </div>

    </div>
  )
}
