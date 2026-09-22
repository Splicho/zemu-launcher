import { cn } from '@/lib/utils'

/**
 * Compact tag chip rendered next to a player name to advertise
 * their clan affiliation.
 */
export function ClantagBadge({
  tag,
  href,
  className,
  size = 'default',
}: {
  tag: string
  href?: string
  className?: string
  size?: 'sm' | 'default' | 'lg'
}) {
  const sizeClass =
    size === 'sm'
      ? 'px-1.5 py-0.5 text-[0.65rem]'
      : size === 'lg'
        ? 'px-2.5 py-1 text-sm'
        : 'px-2 py-0.5 text-xs'

  const classes = cn(
    'inline-flex items-center gap-0.5 rounded-lg border border-muted-foreground/30 bg-muted font-mono font-semibold tracking-wider text-muted-foreground uppercase',
    sizeClass,
    className,
  )

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(classes, 'transition-colors hover:bg-muted/80')}
        aria-label={`View clan ${tag}`}
      >
        {tag}
      </a>
    )
  }
  return <span className={classes}>{tag}</span>
}
