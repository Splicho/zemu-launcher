import { ClantagBadge } from '@/components/leaderboard/clantag-badge'
import { CountryFlagThumb } from '@/components/leaderboard/country-flag-thumb'
import { RoyaltyName } from '@/components/player/royalty-shader'
import { cn } from '@/lib/utils'

/**
 * A player identity rendered the same way everywhere in the launcher:
 * display name → clan badge → country flag.
 *
 * Mirrors `packages/ui/src/components/display-name.tsx` in `zemu-website` so
 * the launcher, the website and the leaderboard agree on the order and the
 * markup. When `royalty` is set (the #1 ranked Royalty player) the name is
 * painted by the royalty shader instead of plain text.
 */
export interface DisplayNameProps {
  name: string
  /** Profile link. The launcher's hash router style, e.g. `#/player/<name>`. */
  href?: string
  /** Equipped clan; `href` is the caller-built clan URL. */
  clan?: { tag: string; href?: string } | null
  /** ISO 3166-1 alpha-2 code. */
  country?: string | null
  /** Paint the name with the royalty shader (#1 Royalty player). */
  royalty?: boolean
  /** Flag/badge scale. */
  size?: 'default' | 'sm'
  className?: string
  nameClassName?: string
}

export function DisplayName({
  name,
  href,
  clan,
  country,
  royalty = false,
  size = 'default',
  className,
  nameClassName,
}: DisplayNameProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {royalty ? (
        // The shader draws the glyphs on a canvas, so the name can't be plain
        // text — but it still needs to open the profile like every other row.
        // Wrap it in the anchor: the canvas inside `RoyaltyName` is
        // `pointer-events-none`, so the click lands on the link.
        href ? (
          <a
            href={href}
            className={cn('min-w-0 underline-offset-4 hover:underline', nameClassName)}
            onClick={(event) => event.stopPropagation()}
          >
            <RoyaltyName className="min-w-0">{name}</RoyaltyName>
          </a>
        ) : (
          <RoyaltyName className={cn('min-w-0', nameClassName)}>{name}</RoyaltyName>
        )
      ) : href ? (
        <a
          href={href}
          className={cn('truncate underline-offset-4 hover:underline', nameClassName)}
          // Rows that expand on click (leaderboard, match history) must not
          // toggle when the player is only trying to open the profile.
          onClick={(event) => event.stopPropagation()}
        >
          {name}
        </a>
      ) : (
        <span className={cn('truncate', nameClassName)}>{name}</span>
      )}
      {clan ? (
        <ClantagBadge tag={clan.tag} href={clan.href} size="sm" className="shrink-0" />
      ) : null}
      {country ? (
        <CountryFlagThumb code={country} size={size === 'sm' ? 14 : 16} className="shrink-0" />
      ) : null}
    </span>
  )
}
