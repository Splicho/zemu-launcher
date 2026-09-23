import { ClanCardTooltip } from '@/components/clan/clan-card-tooltip'
import { CountryFlagThumb } from '@/components/leaderboard/country-flag-thumb'
import type { PlayerProfile } from '@/lib/player-profile'

/**
 * Avatar + identity row that overlaps the player cover banner.
 *
 * Mirrors the website's `apps/web/app/player/[displayName]/page.tsx`
 * identity section:
 *
 *   - `rounded-4xl` avatar with a 4px ring in the page background
 *     colour (`border-4 border-page`) so the avatar visually cuts
 *     through the cover image.
 *   - When no cover is set the overlap collapses to `mt-0` so the
 *     avatar doesn't climb a non-existent banner.
 *   - The heading is a flex row with `items-center` so the country
 *     flag sits at the optical centre of the text line-height box.
 *   - A long display name truncates before it pushes the flag off-
 *     screen because the `<span>` carrying the name has its own
 *     `min-w-0 truncate`.
 *   - If the player belongs to a clan, the `ClanCardTooltip` renders
 *     inline beside the display name (tooltip on hover, chip on click).
 */
export function PlayerIdentityRow({ profile }: { profile: PlayerProfile }) {
  const { displayName, avatarUrl, clan, country, coverImageUrl } = profile
  const hasCover = Boolean(coverImageUrl)

  return (
    <div
      className={`flex items-end gap-4 px-2 pt-2 sm:px-4 sm:pt-4 lg:px-6 ${
        hasCover ? '-mt-20 sm:-mt-24' : 'mt-0'
      }`}
    >
      <div className="relative size-20 shrink-0 overflow-hidden rounded-4xl border-4 border-page bg-muted sm:size-28">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-full items-center justify-center bg-muted text-2xl font-semibold text-muted-foreground sm:text-4xl"
          >
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <h1 className="flex min-w-0 items-center gap-2 truncate pb-3 text-2xl font-bold tracking-tight text-foreground sm:pb-4 sm:text-4xl">
        <span className="min-w-0 truncate">{displayName}</span>
        {clan ? (
          <ClanCardTooltip clan={clan} className="shrink-0" />
        ) : null}
        {country ? (
          <CountryFlagThumb code={country} size={24} className="shrink-0" />
        ) : null}
      </h1>
    </div>
  )
}
