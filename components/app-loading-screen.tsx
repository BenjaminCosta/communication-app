"use client"

export function AppLoadingScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-10 stream-glass-screen animate-fade-in">
      <div className="flex flex-col items-center gap-4">
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
          <div
            className="absolute inset-0 rounded-[28px] pointer-events-none"
            style={{ boxShadow: "0 0 0 1px rgba(37,99,235,0.10)" }}
          />
        </div>

        <div className="text-center animate-fade-up delay-200">
          <p className="text-xl font-bold tracking-tight">
            SVC <span className="text-primary">Stream</span>
          </p>
          <p className="text-[11px] text-muted-foreground/50 font-mono tracking-[3px] uppercase mt-1">
            Team Communication
          </p>
        </div>
      </div>

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

export function AppScreenSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-h-0 stream-glass-screen animate-fade-in">
      <div className="flex-shrink-0 px-4 app-topbar flex items-center justify-between border-b border-white/10">
        <div className="h-6 w-32 rounded-lg bg-white/8 animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-white/8 animate-pulse" />
          <div className="h-9 w-9 rounded-full bg-white/8 animate-pulse" />
          <div className="h-9 w-9 rounded-full bg-white/12 animate-pulse" />
        </div>
      </div>

      <div className="flex-shrink-0 flex gap-2 overflow-hidden px-4 py-2.5 border-b border-white/10">
        <div className="h-7 w-14 rounded-full bg-primary/15 animate-pulse" />
        <div className="h-7 w-24 rounded-full bg-white/8 animate-pulse" />
        <div className="h-7 w-20 rounded-full bg-white/8 animate-pulse" />
        <div className="h-7 w-16 rounded-full bg-white/8 animate-pulse" />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden px-4 py-4 flex flex-col gap-4">
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-white/10" />
          <div className="h-3 w-14 rounded bg-white/8 animate-pulse" />
          <div className="flex-1 h-px bg-white/10" />
        </div>
        <MessageSkeleton align="left" width="w-[72%]" />
        <MessageSkeleton align="right" width="w-[64%]" />
        <MessageSkeleton align="left" width="w-[78%]" tall />
        <MessageSkeleton align="right" width="w-[58%]" />
      </div>

      <div className="flex-shrink-0 border-t border-white/10 bg-[rgba(7,13,24,0.92)] backdrop-blur-md px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)]">
        <div className="mx-auto max-w-2xl flex items-end gap-2">
          <div className="w-10 h-10 rounded-full bg-white/8 animate-pulse" />
          <div className="h-10 flex-1 rounded-2xl bg-white/8 animate-pulse" />
          <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
        </div>
      </div>
    </div>
  )
}

function MessageSkeleton({
  align,
  width,
  tall,
}: {
  align: "left" | "right"
  width: string
  tall?: boolean
}) {
  return (
    <div className={`flex gap-2 items-end ${align === "right" ? "flex-row-reverse" : ""}`}>
      <div className="w-8 h-8 rounded-full bg-white/8 animate-pulse flex-shrink-0" />
      <div className={`${width} flex flex-col gap-1 ${align === "right" ? "items-end" : ""}`}>
        {align === "left" && <div className="h-3 w-20 rounded bg-white/8 animate-pulse" />}
        <div className={`w-full rounded-2xl border border-white/10 bg-white/8 animate-pulse ${tall ? "h-28" : "h-18"}`} />
      </div>
    </div>
  )
}
