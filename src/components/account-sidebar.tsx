import { ChevronLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useHash, useHashRouter } from '@/hooks/use-hash'

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

const ACCOUNT_NAV = [
  { href: '#/account', labelKey: 'account.title' },
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
 * For now there's only one entry — "Account" — because the only
 * account-scoped surface is the auth key view. New panes (profile,
 * sessions, etc.) would just append entries here.
 */
export function AccountSidebar() {
  const { t } = useTranslation()
  const hash = useHash()
  const { navigate } = useHashRouter()
  const activeHref = hash ? `#${hash}` : '#/account'
  const activeId =
    ACCOUNT_NAV.find((n) => activeHref === n.href)?.href ?? '#/account'

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
              {ACCOUNT_NAV.map(({ href, labelKey }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={activeId === href}
                    size="lg"
                    className="px-4"
                  >
                    <a href={href}>
                      <span>{t(labelKey)}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
