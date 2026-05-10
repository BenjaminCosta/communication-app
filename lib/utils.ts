import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Deterministic avatar color palette — maps a user ID to a consistent color
const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-orange-600",
] as const

export function getUserAvatarColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export const haptic = {
  light:       () => navigator?.vibrate?.(8),
  success:     () => navigator?.vibrate?.([6, 0, 6]),
  destructive: () => navigator?.vibrate?.([15, 8, 20]),
}
