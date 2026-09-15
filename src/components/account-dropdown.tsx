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
import { emit } from '@tauri-apps/api/event'

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
            {token?.image && <AvatarImage src={token.image} alt={displayName} />}
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
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            if (import.meta.env.DEV) {
              void emit('friends:incoming-request', {
                fromUser: { id: 'debug-user-id', displayName: 'Test User', avatarUrl: null },
              })
            }
          }}
        >
          <span>🔥 Fire friend-request toast (dev)</span>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => logout()}>
          <LogOut className="size-4" />
          <span>{t('account.signOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
