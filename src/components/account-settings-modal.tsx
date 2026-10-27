import { useEffect, useState } from 'react'
import { ExternalLink, KeyRound, Palette, SlidersHorizontal, UserCircle, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { AccountPage } from '@/pages/account'
import { GeneralPage } from '@/pages/settings'
import { AppearancePage } from '@/pages/appearance'
import { AdvancedPage } from '@/pages/advanced'
import { LAUNCHER_CONFIG } from '@/config/launcher'

export type AccountSettingsPanel = 'account' | 'settings' | null

type AccountSection = 'auth-key'
type SettingsSection = 'general' | 'appearance' | 'advanced'

const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSection
  labelKey: string
  Icon: typeof SlidersHorizontal
}> = [
  { id: 'general', labelKey: 'settings.general.title', Icon: SlidersHorizontal },
  { id: 'appearance', labelKey: 'settings.appearance.title', Icon: Palette },
  { id: 'advanced', labelKey: 'settings.advanced.title', Icon: Wrench },
]

export function AccountSettingsModal({
  panel,
  onOpenChange,
}: {
  panel: AccountSettingsPanel
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [accountSection, setAccountSection] = useState<AccountSection>('auth-key')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')

  // Land on the first section each time the modal is opened.
  useEffect(() => {
    if (panel === 'account') setAccountSection('auth-key')
    if (panel === 'settings') setSettingsSection('general')
  }, [panel])

  const isAccount = panel === 'account'
  const title = isAccount ? t('account.menuItem') : t('nav.settings')
  const description = isAccount
    ? t('account.description')
    : settingsSection === 'general'
      ? t('settings.general.description')
      : settingsSection === 'appearance'
        ? t('settings.appearance.description')
        : t('settings.advanced.description')

  return (
    <Dialog open={panel !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b p-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav
            aria-label={isAccount ? t('account.menuItem') : t('nav.settings')}
            className="w-60 shrink-0 border-r bg-muted/30 p-2"
          >
            <SidebarMenu>
              {isAccount ? (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild size="lg" className="w-full justify-start px-4">
                      <a
                        href={LAUNCHER_CONFIG.accountSettingsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => {
                          event.preventDefault()
                          void openUrl(LAUNCHER_CONFIG.accountSettingsUrl).catch((error) => {
                            console.error('open account settings failed', error)
                          })
                        }}
                      >
                        <UserCircle className="size-5" />
                        <span>{t('account.title')}</span>
                        <ExternalLink className="ml-auto size-4 text-muted-foreground" />
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="lg"
                      isActive={accountSection === 'auth-key'}
                      onClick={() => setAccountSection('auth-key')}
                      className="w-full justify-start px-4"
                    >
                      <KeyRound className="size-5" />
                      <span>{t('account.authKey')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              ) : (
                SETTINGS_SECTIONS.map(({ id, labelKey, Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      size="lg"
                      isActive={settingsSection === id}
                      onClick={() => setSettingsSection(id)}
                      className="w-full justify-start px-4"
                    >
                      <Icon className="size-5" />
                      <span>{t(labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-6">
            {isAccount ? (
              <AccountPage />
            ) : settingsSection === 'general' ? (
              <GeneralPage />
            ) : settingsSection === 'appearance' ? (
              <AppearancePage />
            ) : (
              <AdvancedPage />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
