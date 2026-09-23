'use client'

import { ClantagBadge } from '@/components/leaderboard/clantag-badge'
import { Verified } from '@/components/icons/verified'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Single member shown in the top-members avatar stack on every
 * directory card. Mirrors `apps/web/components/clan-card.tsx:
 * ClanCardMember`.
 */
export type ClanCardMember = {
  displayName: string
  avatarUrl: string | null
}

/**
 * Display-only clan payload. The launcher's `/clans` directory
 * projects its row shape into this before rendering — keeps the
 * card agnostic of how the caller fetches its data.
 *
 * Mirrors the website's `ClanCardData` 1:1.
 */
export type ClanCardData = {
  slug: string
  name: string
  /** Display tag (e.g. "ZEMU"). */
  tag: string
  avatarUrl: string | null
  coverImageUrl: string | null
  /** Staff-only trust flag. When true, renders the verified badge
   *  next to the clan name. */
  isVerified: boolean
  memberCount: number
  followerCount: number
  /** Up to 3 members shown in the avatar stack below the counts.
   *  Empty arrays hide the stack entirely. */
  topMembers: ClanCardMember[]
}

/**
 * First-letter fallback for the avatar — uppercase, capped at 2
 * chars. Same posture as the website's `avatarFallback`.
 */
function avatarFallback(tag: string): string {
  return tag.charAt(0).toUpperCase().slice(0, 2)
}

/**
 * Unified clan card. The whole card is a link to the clan profile
 * (mirrors the website's `ClanCard` public-directory variant).
 *
 * Visual language mirrors the website 1:1:
 *
 *   - Banner with clantag overlay (top-right corner)
 *   - Avatar overlapping the banner (offset by -mt-10)
 *   - Name + verified badge
 *   - Counts (members / followers)
 *   - Top-3 member avatar stack with "+N more" overflow
 *
 * The launcher's existing `<Avatar>` primitive replaces the
 * website's hand-rolled avatar circle (we already have one in
 * `components/ui/avatar.tsx`). Everything else — the layout, the
 * banner overlay, the typography — is 1:1 with the website so
 * the two surfaces read identically.
 */
export function ClanCard({ clan }: { clan: ClanCardData }) {
  const body = (
    <>
      {/* Banner with clantag overlay */}
      <div className="relative mx-0.5 mt-0.5 h-20 rounded-md bg-muted">
        {clan.coverImageUrl ? (
          <img
            src={clan.coverImageUrl}
            alt=""
            className="h-full w-full rounded-md object-cover"
          />
        ) : (
          <div className="h-full w-full rounded-md bg-gradient-to-br from-primary/20 to-primary/5" />
        )}
        <div className="absolute top-2 right-2 z-10">
          <ClantagBadge tag={clan.tag} size="sm" />
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        {/* Avatar (overlapping banner) + name + verified badge */}
        <div className="flex gap-3">
          <div className="relative -mt-10">
            {clan.avatarUrl ? (
              <div className="size-16 overflow-hidden rounded-lg border-3 border-card sm:size-20">
                <img
                  src={clan.avatarUrl}
                  alt=""
                  className="h-full w-full rounded-md object-cover"
                />
              </div>
            ) : (
              <div className="flex size-16 items-center justify-center rounded-md border-4 border-background bg-muted text-xl font-bold sm:size-20">
                {avatarFallback(clan.tag)}
              </div>
            )}
          </div>

          <div className="z-10 -mt-2 flex flex-1 flex-col justify-center">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-lg leading-tight font-semibold">
                {clan.name}
              </span>
              {clan.isVerified ? (
                <Verified
                  className="size-4 shrink-0"
                  aria-label="Verified clan"
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* Counts */}
        <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            <span className="font-mono font-bold text-foreground">
              {clan.memberCount}
            </span>{' '}
            Member{clan.memberCount === 1 ? '' : 's'}
          </span>
          <span>
            <span className="font-mono font-bold text-foreground">
              {clan.followerCount}
            </span>{' '}
            Follower{clan.followerCount === 1 ? '' : 's'}
          </span>
        </div>

        {/* Top-member avatar stack */}
        {clan.topMembers.length > 0 ? (
          <div className="mt-4 flex items-center">
            <div className="flex -space-x-2 overflow-hidden">
              {clan.topMembers.map((member, i) => (
                <Tooltip key={`${member.displayName}-${i}`}>
                  <TooltipTrigger asChild>
                    <div className="relative size-8 cursor-pointer overflow-hidden rounded-full border-2 border-background bg-muted">
                      {member.avatarUrl ? (
                        <img
                          src={member.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground">
                          {member.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{member.displayName}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            {clan.memberCount > clan.topMembers.length ? (
              <span className="ml-2 text-xs text-muted-foreground">
                +{clan.memberCount - clan.topMembers.length} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )

  return (
    <a
      href={`#/clan/${encodeURIComponent(clan.slug)}`}
      className="block outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex w-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
        {body}
      </div>
    </a>
  )
}
