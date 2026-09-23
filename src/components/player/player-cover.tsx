import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DiscordFilled, Steam } from '@/components/icons'
import type { PlayerProfile } from '@/lib/player-profile'

/**
 * Cover banner rendered above the player identity row. Mirrors the
 * website's `apps/web/app/player/[displayName]/page.tsx` cover element:
 *
 *   - `h-64` with `brightness-50` so the avatar pops without
 *     obscuring the image.
 *   - `rounded-3xl` container.
 *   - When no cover is set the element is omitted entirely so the
 *     identity row's overlap collapses naturally.
 *
 * The launcher uses a plain `<img>` (not Next/Image) because the
 * Tauri webview can't dedupe remote image bytes the way next/image does.
 *
 * Social-link chips (Discord / Steam) are rendered in an absolutely-
 * positioned panel on the cover when the player has linked those accounts.
 * They use the `discord://` URI scheme so the desktop app opens the
 * Discord profile directly rather than navigating the browser away.
 */
export function PlayerCover({ profile }: { profile: PlayerProfile }) {
  const { displayName, coverImageUrl, discordId, steamId } = profile

  if (!coverImageUrl && !discordId && !steamId) return null

  return (
    <div className="relative overflow-hidden rounded-3xl">
      {coverImageUrl && (
        <img
          src={coverImageUrl}
          alt=""
          className="h-64 w-full object-cover brightness-50"
        />
      )}

      {(discordId || steamId) && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl bg-background/40 p-1.5 sm:bottom-4 sm:right-4 sm:gap-1.5 sm:p-2">
          {discordId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`discord://-/users/${discordId}`}
                  aria-label={`Add ${displayName} on Discord`}
                  className="inline-flex size-8 items-center justify-center rounded-lg p-1.5 text-foreground/80 transition-colors hover:text-foreground sm:size-9"
                >
                  <DiscordFilled className="size-5 sm:size-6" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Add {displayName} on Discord</p>
              </TooltipContent>
            </Tooltip>
          )}
          {steamId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`https://steamcommunity.com/profiles/${steamId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${displayName} on Steam`}
                  className="inline-flex size-8 items-center justify-center rounded-lg p-1.5 text-foreground/80 transition-colors hover:text-foreground sm:size-9"
                >
                  <Steam className="size-5 sm:size-6" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>View {displayName} on Steam</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}
