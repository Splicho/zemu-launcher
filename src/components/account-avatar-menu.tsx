import { useEffect, useState } from 'react'
import { LogOut, Settings, UserCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  AccountSettingsModal,
  type AccountSettingsPanel,
} from '@/components/account-settings-modal'
import { useAuthContext } from '@/contexts/auth-context'
import { useHash } from '@/hooks/use-hash'

/**
 * Compact account menu used above the home news slider.
 *
 * Unlike `AccountDropdown` (the full-width sidebar footer row), this
 * trigger is just the signed-in user's avatar, outlined in the launcher
 * brand red.
 */
export function AccountAvatarMenu() {
  const { t } = useTranslation()
  const { token, logout } = useAuthContext()
  const hash = useHash()
  const [panel, setPanel] = useState<AccountSettingsPanel>(null)

  // Account/Settings rerun-setup flows navigate away; close the modal so
  // the destination route isn't hidden behind it.
  useEffect(() => {
    setPanel(null)
  }, [hash])

  const displayName =
    token?.displayName ?? token?.username ?? token?.email ?? t('account.unknownUser')
  const fallback = (displayName[0] ?? '?').toUpperCase()
  const avatarSrc =
    token?.image && /^https?:\/\//i.test(token.image)
      ? token.image
      : null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('account.openMenu')}
            title={displayName}
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Avatar className="size-10 rounded-md border-2 border-[#a80000] after:hidden">
              {avatarSrc ? (
                <AvatarImage src={avatarSrc} alt={displayName} className="rounded-md" />
              ) : null}
              <AvatarFallback className="rounded-md bg-muted text-sm font-semibold">
                {fallback}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="end" sideOffset={8} className="min-w-44">
          <DropdownMenuItem onSelect={() => setPanel('account')}>
            <UserCircle className="size-4" />
            <span>{t('account.menuItem')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel('settings')}>
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

      <AccountSettingsModal
        panel={panel}
        onOpenChange={(open) => {
          if (!open) setPanel(null)
        }}
      />
    </>
  )
}
