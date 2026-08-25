import * as React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DiscordFilled,
  Home,
  Leaderboard,
  News,
  Socialize,
  Twitch,
  Twitter,
  YouTube,
} from '@/components/icons'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar'
import { LAUNCHER_CONFIG } from '@/config/launcher'

const SOCIAL_LINKS = [
  {
    label: 'Discord',
    href: 'https://discord.gg/h1z1kotk',
    Icon: DiscordFilled,
  },
  {
    label: 'X',
    href: 'https://x.com/H1Z1ZEMU',
    Icon: Twitter,
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@Ghostskappa',
    Icon: YouTube,
  },
  {
    label: 'Twitch',
    href: 'https://www.twitch.tv/ZEmu_KotK',
    Icon: Twitch,
  },
] as const

function useHashRoute() {
  const [hash, setHash] = React.useState(() => window.location.hash)

  React.useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return hash
}


function NavLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <motion.a
      href={href}
      className={className}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1 }}
    >
      {children}
    </motion.a>
  )
}

export function AppSidebar() {
  const [socialOpen, setSocialOpen] = React.useState(false)
  const hash = useHashRoute()

  const isActive = (path: string) => {
    const basePath = hash.replace(/#/, '') || '/'
    if (path === '/') return basePath === '/' || basePath === ''
    return basePath.startsWith(path)
  }

  return (
    <Sidebar collapsible="none" className="w-62 shrink-0 bg-transparent">
      <SidebarContent className="flex flex-col">
        <div className="flex justify-center px-5 pt-6 pb-4">
          <img
            src="../assets/icon/zemu-logo.png"
            alt={LAUNCHER_CONFIG.name}
            className="w-full max-w-32"
          />
        </div>
        <SidebarGroup className="px-5 pt-5 pb-2">
          <SidebarGroupLabel className="uppercase tracking-wider pl-4">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem className="space-y-px">
                <SidebarMenuButton asChild isActive={isActive('/')} size="lg" className="px-4">
                  <NavLink href="#/">
                    <Home className="size-5!" />
                    <span>Home</span>
                  </NavLink>
                </SidebarMenuButton>
                <SidebarMenuButton asChild isActive={isActive('/news')} size="lg" className="px-4">
                  <NavLink href="#/news">
                    <News className="size-5!" />
                    <span>News</span>
                  </NavLink>
                </SidebarMenuButton>
                <SidebarMenuButton asChild isActive={isActive('/leaderboard')} size="lg" className="px-4">
                  <NavLink href="#/leaderboard">
                    <Leaderboard className="size-5!" />
                    <span>Leaderboard</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="px-5 pb-2">
          <SidebarGroupLabel className="uppercase tracking-wider pl-4">
            Play
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive('/play')} size="lg" className="px-4">
                  <NavLink href="#/play">
                    <img
                      src="../assets/icon/app-icon.png"
                      alt=""
                      className="size-5 shrink-0 "
                    />
                    <span>ZEmu: King of the Kill</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Socialize footer */}
      <div className="mt-auto px-5 pb-6">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="px-4 cursor-pointer"
              onClick={() => setSocialOpen((o) => !o)}
              aria-expanded={socialOpen}
            >
              <Socialize className="size-5!" />
              <span>Socialize</span>
              <motion.div
                animate={{ rotate: socialOpen ? 90 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronRight className="ml-auto size-4 shrink-0" />
              </motion.div>
            </SidebarMenuButton>
            <AnimatePresence>
              {socialOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <SidebarMenuSub>
                    {SOCIAL_LINKS.map(({ label, href, Icon }, idx) => (
                      <motion.div
                        key={href}
                        initial={{ x: -10, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: idx * 0.05, duration: 0.15 }}
                      >
                        <SidebarMenuSubButton asChild>
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            <Icon className="size-4" />
                            <span>{label}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </motion.div>
                    ))}
                  </SidebarMenuSub>
                </motion.div>
              )}
            </AnimatePresence>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </Sidebar>
  )
}
