"use client"

type LoadingProduct = "stream" | "directory"

interface ProductLoadingScreenProps {
  product: LoadingProduct
}

function ProductLoadingScreen({ product }: ProductLoadingScreenProps) {
  const isDirectory = product === "directory"
  const title = isDirectory ? "Directory" : "Stream"
  const subtitle = isDirectory ? "PEOPLE · COMPANIES · JOBS" : "Team Communication"
  const emoji = isDirectory ? "🧐" : "🤔"
  const emojiLabel = isDirectory ? "searching" : "thinking"

  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-10 ${isDirectory ? "directory-glass-screen" : "stream-glass-screen"} animate-fade-in`}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative animate-spring-pop">
          <div
            className={`flex h-24 w-24 items-center justify-center rounded-[28px] ${isDirectory ? "animate-directory-logo-breathe" : "animate-logo-breathe"}`}
            style={isDirectory ? {
              background: "rgba(18,24,33,0.9)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), 0 0 0 1px rgba(253,186,116,0.16), 0 0 30px rgba(249,115,22,0.09), 0 8px 32px rgba(0,0,0,0.42)",
            } : {
              background: "linear-gradient(145deg, #0f2249 0%, #0d1a3a 100%)",
              boxShadow: "0 0 0 1px rgba(37,99,235,0.18), 0 0 40px rgba(37,99,235,0.18), 0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            <span className="select-none text-5xl" role="img" aria-label={emojiLabel}>{emoji}</span>
          </div>
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{ boxShadow: isDirectory ? "0 0 0 1px rgba(253,186,116,0.08)" : "0 0 0 1px rgba(37,99,235,0.10)" }}
          />
        </div>

        <div className="text-center animate-fade-up delay-200">
          <p className="text-xl font-bold tracking-tight">
            SVC <span style={{ color: isDirectory ? "#FDBA74" : undefined }} className={isDirectory ? undefined : "text-primary"}>{title}</span>
          </p>
          <p className="text-[11px] text-muted-foreground/50 font-mono tracking-[3px] uppercase mt-1">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 animate-fade-up delay-400">
        <div className="w-44 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            className="h-full w-1/2 rounded-full animate-load-bar"
            style={isDirectory ? {
              background: "linear-gradient(90deg, transparent, rgba(249,115,22,0.72), #FDBA74, transparent)",
              boxShadow: "0 0 10px rgba(249,115,22,0.16)",
            } : {
              background: "linear-gradient(90deg, transparent, #2563EB, #60a5fa, transparent)",
            }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/40 font-mono tracking-[3px] uppercase">
          Loading
        </p>
      </div>
    </div>
  )
}

export function AppLoadingScreen() {
  return <ProductLoadingScreen product="stream" />
}

export function DirectoryLoadingScreen() {
  return <ProductLoadingScreen product="directory" />
}

/**
 * Both variants are present in the initial HTML so a tiny head script can
 * choose the persisted module before React hydrates. That prevents a Stream
 * splash from flashing before Directory on reload.
 */
export function LaunchLoadingScreen() {
  return (
    <div className="launch-loading-root flex min-h-0 w-full flex-1">
      <div className="launch-loading-stream flex min-h-0 w-full flex-1">
        <AppLoadingScreen />
      </div>
      <div className="launch-loading-directory min-h-0 w-full flex-1">
        <DirectoryLoadingScreen />
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
