import { ChevronLeft, ExternalLink, KeyRound } from 'lucide-react'
import { motion } from 'framer-motion'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useHash, useHashRouter } from '@/hooks/use-hash'
import { LAUNCHER_CONFIG } from '@/config/launcher'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

type AccountNavItem =
  | {
      kind: 'internal'
      href: `#/account`
      labelKey: string
      icon: typeof KeyRound
    }
  | {
      kind: 'external'
      href: string
      labelKey: string
      icon: typeof ExternalLink
    }

const ACCOUNT_NAV: ReadonlyArray<AccountNavItem> = [
  // External link → web's `/settings/account`. Owned by the
  // website because profile/security/connected-accounts all live
  // there; the launcher's job is to launch games, not host OAuth
  // flows. We open it via Tauri's opener plugin so the system
  // browser handles it instead of navigating the webview.
  {
    kind: 'external',
    href: LAUNCHER_CONFIG.accountSettingsUrl,
    labelKey: 'account.title',
    icon: ExternalLink,
  },
  // Internal launcher surface — the on-disk auth key that gates
  // game launch. Editing it requires the launcher's local Rust
  // process so it can never live on the web.
  {
    kind: 'internal',
    href: '#/account',
    labelKey: 'account.authKey',
    icon: KeyRound,
  },
] as const

/**
 * Left rail of the Account section.
 *
 * Mirrors the visual structure and animation contract of
 * `SettingsSidebar`: same width, same padding, same `motion` chevron,
 * same back-link footer. The mount/unmount transition is driven by
 * `MainLayout`'s `AnimatePresence` keyed off `sidebarType === 'account'`,
 * so swapping from the app sidebar to this one (or vice versa)
 * plays the same slide-in / slide-out as the settings rail.
 *
 * Two entries live here:
 *   - **Account** (external) — opens the website's
 *     `/settings/account` in the system browser. That's where
 *     profile / security / connected-accounts management lives;
 *     the launcher has no business hosting OAuth or password
 *     flows.
 *   - **Auth Key** (internal) — the launcher's local auth key
 *     panel at `#/account`. Editing it requires the launcher's
 *     Rust process to read/write disk, so it never leaves the
 *     launcher.
 *
 * Future launcher-native account panes (sessions, devices, etc.)
 * would just append internal entries here.
 */
export function AccountSidebar() {
  const { t } = useTranslation()
  const hash = useHash()
  const { navigate } = useHashRouter()
  const activeHref = hash ? `#${hash}` : '#/account'
  const activeId =
    ACCOUNT_NAV.find(
      (n) => n.kind === 'internal' && activeHref === n.href,
    )?.href ?? '#/account'

  return (
    <Sidebar collapsible="none" className="w-62 shrink-0 bg-transparent">
      <SidebarContent className="flex flex-col">
        <div className="flex justify-center pt-5 pb-2">
          <img
            src="../assets/icon/zemu-logo.png"
            alt=""
            className="h-8 object-contain"
          />
        </div>
        <SidebarGroup className="px-5 pb-2">
          <SidebarGroupLabel className="uppercase tracking-wider pl-4">
            {t('nav.account')}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ACCOUNT_NAV.map((item) => {
                const Icon = item.icon
                if (item.kind === 'external') {
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        size="lg"
                        className="px-4"
                      >
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => {
                            // Same pattern as `app-sidebar`: let
                            // plugin-opener handle the URL in the
                            // system browser instead of letting the
                            // anchor navigate the webview.
                            event.preventDefault()
                            void openUrl(item.href).catch((error) => {
                              toast.error(t('common.error'), {
                                description: String(error),
                              })
                            })
                          }}
                        >
                          <Icon className="size-5" aria-hidden="true" />
                          <span>{t(item.labelKey)}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                }
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeId === item.href}
                      size="lg"
                      className="px-4"
                    >
                      <a href={item.href}>
                        <Icon className="size-5" aria-hidden="true" />
                        <span>{t(item.labelKey)}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Back link — same pattern as SettingsSidebar. */}
      <div className="mt-auto px-5 pb-6">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="px-4">
              <button type="button" onClick={() => navigate('/')}>
                <motion.span
                  animate={{ x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronLeft className="size-5!" />
                </motion.span>
                <span>{t('common.back')}</span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </Sidebar>
  )
}
