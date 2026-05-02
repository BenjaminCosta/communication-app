import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const haptic = {
  light:       () => navigator?.vibrate?.(8),
  success:     () => navigator?.vibrate?.([6, 0, 6]),
  destructive: () => navigator?.vibrate?.([15, 8, 20]),
}
