import { ChevronLeft } from 'lucide-react'
import { motion } from 'framer-motion'
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
  { href: '#/settings', label: 'General' },
  { href: '#/settings/appearance', label: 'Appearance' },
] as const

export function SettingsSidebar() {
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
            Settings
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SETTINGS_NAV.map(({ href, label }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={activeId === href}
                    size="lg"
                    className="px-4"
                  >
                    <a href={href}>
                      <span>{label}</span>
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
              <a href="#/">
                <motion.span
                  animate={{ x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronLeft className="size-5!" />
                </motion.span>
                <span>Back</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </Sidebar>
  )
}
