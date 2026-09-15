import { useLiveStreams } from '@/hooks/use-live-streams'

type LiveIndicatorProps = {
  /** Optional className passthrough for positioning/sizing tweaks. */
  className?: string
}

/**
 * Tiny red dot used to signal "someone is live right now". Mirrors
 * the website's `components/live-indicator.tsx` so the launcher and
 * the web app give consistent visual feedback. Renders nothing when
 * no one is live to keep the surrounding UI quiet.
 *
 * Note: the original Tailwind v3 `animate-ping` utility was dropped
 * from Tailwind v4 (and the `tw-animate-css` package we use does
 * not re-add it). Rather than hand-rolling a CSS keyframe just for
 * this dot, we render a static indicator. The website can keep its
 * pulse because it still runs on Tailwind v3.
 */
export function LiveIndicator({ className }: LiveIndicatorProps) {
  const { liveCount } = useLiveStreams()
  if (liveCount <= 0) return null

  return (
    <span
      role="status"
      aria-label={`${liveCount} live stream${liveCount === 1 ? '' : 's'}`}
      className={`inline-block h-2 w-2 shrink-0 rounded-full bg-red-500 ${className ?? ''}`}
    />
  )
}
