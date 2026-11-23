import { cn } from '../../lib/utils'

/** Shared dialog sizes: sm 440px, md 560px, lg 680px. Always capped to the window and scrolls inside. */
const SIZES = { sm: 'max-w-[440px]', md: 'max-w-[560px]', lg: 'max-w-[680px]' } as const

export function dialogPanel(size: keyof typeof SIZES = 'md', extra?: string): string {
  return cn('flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl', SIZES[size], extra)
}
