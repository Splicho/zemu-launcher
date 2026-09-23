import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { LogOut, UserCircle } from 'lucide-react'
import { useAuthContext } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import { useHashRouter } from '@/hooks/use-hash'

/**
 * Account dropdown anchored to the user's avatar.
 *
 * The trigger is the avatar only (no name, no chevron). Inside the
 * dropdown: an "Account" entry that routes to `#/account` (which
 * swaps the app sidebar for the account rail via `MainLayout`), then
 * a separator, then "Sign out".
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('account.openMenu')}
          // Reset native `<button>` defaults (padding, 2px outset
          // border, system background) so the avatar fills the
          // trigger edge-to-edge. The focus ring stays visible via
          // `focus-visible:ring-*`.
          className="rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar>
            {avatarSrc ? <AvatarImage src={avatarSrc} alt={displayName} /> : null}
            <AvatarFallback>{fallback}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="min-w-40">
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          <UserCircle className="size-4" />
          <span>{t('account.menuItem')}</span>
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
