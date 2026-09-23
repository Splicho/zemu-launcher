import { ClantagBadge } from '@/components/leaderboard/clantag-badge'
import { Verified } from '@/components/icons/verified'

/**
 * Avatar + name + clantag chip row that overlaps the cover banner.
 *
 * Mirrors the website's identity row in
 * `apps/web/app/clans/[slug]/page.tsx`:
 *   - `rounded-4xl` avatar with a 4px ring in the page
 *     background colour (`border-4 border-page`) so the avatar
 *     visually cuts through the cover banner.
 *   - When no cover is set the overlap collapses to `mt-0` so
 *     the avatar doesn't climb a non-existent banner.
 *   - The negative margin pulls the identity row up into the
 *     cover image so the action surface (next to it on the
 *     same flex row) is visually pinned to the top of the page.
 */
export function ClanIdentityRow({
  avatarUrl,
  name,
  clantag,
  isVerified,
  hasCover,
}: {
  avatarUrl: string | null
  name: string
  clantag: string
  isVerified: boolean
  hasCover: boolean
}) {
  return (
    <div
      className={`flex items-end gap-4 px-2 pt-2 sm:px-4 sm:pt-4 lg:px-6 ${
        hasCover ? '-mt-14 sm:-mt-20' : 'mt-0'
      }`}
    >
      <div className="relative size-20 shrink-0 overflow-hidden rounded-4xl border-4 border-page bg-muted sm:size-28">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={`${name}'s avatar`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-full w-full items-center justify-center bg-muted text-2xl font-semibold text-muted-foreground sm:text-4xl"
          >
            {clantag.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 pb-3 sm:pb-4">
        <h1 className="flex min-w-0 items-center gap-2 truncate text-xl font-bold tracking-tight sm:text-3xl">
          <span className="min-w-0 truncate">{name}</span>
          {isVerified ? (
            <Verified
              className="size-5 shrink-0 sm:size-6"
              aria-label="Verified clan"
            />
          ) : null}
        </h1>
        <ClantagBadge tag={clantag} size="default" className="shrink-0 rounded-sm" />
      </div>
    </div>
  )
}
