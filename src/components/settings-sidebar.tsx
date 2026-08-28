import { ChevronLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useHash } from '@/hooks/use-hash'

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

const SETTINGS_NAV = [
  { href: '#/settings', labelKey: 'settings.general.title' },
  { href: '#/settings/appearance', labelKey: 'settings.appearance.title' },
] as const

export function SettingsSidebar() {
  const { t } = useTranslation()
  const hash = useHash()
  const activeHref = hash ? `#${hash}` : '#/settings'
  const activeId = SETTINGS_NAV.find((n) => activeHref === n.href)?.href ?? '#/settings'

  return (
    <Sidebar collapsible="none" className="w-62 shrink-0 bg-transparent">
      <SidebarContent className="flex flex-col">
        <div className="flex justify-center pt-5 pb-2">
          <img src="../assets/icon/zemu-logo.png" alt="" className="h-8 object-contain" />
        </div>
        <SidebarGroup className="px-5 pb-2">
          <SidebarGroupLabel className="uppercase tracking-wider pl-4">
            {t('nav.settings')}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SETTINGS_NAV.map(({ href, labelKey }) => (
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

      {/* Back link */}
      <div className="mt-auto px-5 pb-6">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="px-4">
              <button type="button" onClick={() => window.history.back()}>
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
