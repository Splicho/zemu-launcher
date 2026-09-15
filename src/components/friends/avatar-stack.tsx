import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface AvatarStackItem {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
}

interface AvatarStackProps {
  people: readonly AvatarStackItem[]
  /** Maximum number of avatars to show — the rest are folded into a
   *  "+N" chip. Defaults to 3. */
  max?: number
  /** Pixel size of each avatar. Defaults to 28 (matches `size-7`). */
  size?: number
  className?: string
}

/**
 * Small, horizontally overlapping pile of avatars used in compact
 * entry points like the "Friend requests" row. The most recent
 * avatars (head of the array) sit on top.
 */
export function AvatarStack({
  people,
  max = 3,
  size = 28,
  className,
}: AvatarStackProps) {
  const visible = people.slice(0, max)
  const overflow = Math.max(0, people.length - visible.length)

  return (
    <div
      className={cn('relative flex shrink-0 items-center', className)}
      style={{ height: size }}
    >
      {visible.map((person, index) => (
        <Avatar
          key={person.id}
          style={{
            width: size,
            height: size,
            // Each subsequent avatar nudges right by ~60% of its width,
            // creating the classic overlap. `zIndex` keeps the leftmost
            // (most recent) person on top.
            marginLeft: index === 0 ? 0 : -Math.round(size * 0.3),
            zIndex: visible.length - index,
          }}
          className="border-2 border-popover"
        >
          {person.avatarUrl ? (
            <AvatarImage src={person.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback className="text-[10px]">
            {(person.displayName ?? '?').slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 ? (
        <span
          aria-hidden="true"
          style={{
            marginLeft: -Math.round(size * 0.3),
            width: size,
            height: size,
          }}
          className="z-0 flex items-center justify-center rounded-full border-2 border-popover bg-muted text-[10px] font-semibold text-muted-foreground"
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
