import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ChevronsUpDown, LogOut, Settings, UserCircle } from 'lucide-react'
import { DiscordFilled, Mail, Steam } from '@/components/icons'
import { useAuthContext } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import { useHashRouter } from '@/hooks/use-hash'

// Same accents as the login screen's provider buttons, so the badge on
// the avatar reads as "you signed in with this".
const PROVIDER_BADGES = {
  discord: { label: 'Discord', color: '#5865F2', Icon: DiscordFilled },
  steam: { label: 'Steam', color: '#1A9FFF', Icon: Steam },
} as const
const EMAIL_BADGE_COLOR = 'oklch(0.55 0.19 29.11)'

/**
 * Account row pinned to the bottom of the sidebars.
 *
 * The trigger spans the sidebar width: avatar (with a small badge for
 * the sign-in provider), display name, and a second line naming the
 * provider — or the email address for credentials logins. The menu
 * opens upward and holds "Account" (routes to `#/account`, which swaps
 * in the account rail via `MainLayout`), "Settings" (`#/settings`) and
 * "Sign out".
 *
 * The avatar falls back to the first letter of the display name when
 * the provider didn't ship an image URL, which is the common case for
 * the credentials login path.
 */
export function AccountDropdown() {
  const { t } = useTranslation()
  const { token, logout } = useAuthContext()
  const { navigate } = useHashRouter()

  const displayName =
    token?.displayName ?? token?.username ?? token?.email ?? t('account.unknownUser')

  const fallback = (displayName[0] ?? '?').toUpperCase()

  // The avatar in the dropdown should always be a fully-qualified
  // URL on a CDN (Discord/Steam/R2). Historically the auth app's
  // `publicUrlFor` could silently return the *bare R2 key* when
  // `R2_PUBLIC_URL` was unset, and the launcher's persisted
  // `token.image` then propagated that bare path through. The
  // browser would resolve `https://tauri.localhost/avatars/...`
  // (404) and the dropdown would silently render the fallback
  // letter — but with no way for the user to tell *why*. Gate the
  // `<AvatarImage>` on a real absolute URL so the fallback is the
  // explicit "we don't know your avatar" signal rather than a
  // silent 404.
  const avatarSrc =
    token?.image && /^https?:\/\//i.test(token.image)
      ? token.image
      : null

  const provider =
    token?.provider === 'discord' || token?.provider === 'steam'
      ? PROVIDER_BADGES[token.provider]
      : null
  const BadgeIcon = provider?.Icon ?? Mail
  const badgeColor = provider?.color ?? EMAIL_BADGE_COLOR
  const subtitle = provider?.label ?? token?.email ?? null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('account.openMenu')}
          className="group/account flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent"
        >
          <span className="relative shrink-0">
            <Avatar className="size-9">
              {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
              <AvatarFallback>{fallback}</AvatarFallback>
            </Avatar>
            <span
              aria-hidden="true"
              style={{ backgroundColor: badgeColor }}
              className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full text-white ring-2 ring-background [&_svg]:size-2.5"
            >
              <BadgeIcon />
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            {subtitle ? (
              <span className="truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/account:text-foreground"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-(--radix-dropdown-menu-trigger-width) min-w-48"
      >
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          <UserCircle className="size-4" />
          <span>{t('account.menuItem')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings className="size-4" />
          <span>{t('nav.settings')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => logout()}>
          <LogOut className="size-4" />
          <span>{t('account.signOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
