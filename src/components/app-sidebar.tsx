import * as React from 'react'
import { ChevronRight, RefreshCw, FolderSearch, Settings } from 'lucide-react'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { SteamInstructionsModal } from '@/components/steam-instructions-modal'
import { PropertiesModal } from '@/components/properties-modal'
import {
  hasSeenSteamInstructions,
  markSteamInstructionsSeen,
} from '@/lib/steam-instructions'
import { useUpdate } from '@/contexts/update-context'
import { useGameStateContext } from '@/contexts/game-state-context'
import { CircularProgress } from '@/components/circular-progress'

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

export function AppSidebar() {
  const [socialOpen, setSocialOpen] = React.useState(false)
  const [hasAcknowledgedSteamInstructions, setHasAcknowledgedSteamInstructions] =
    React.useState<boolean>(hasSeenSteamInstructions)
  const [showSteamModal, setShowSteamModal] = React.useState(false)
  const [showPropertiesModal, setShowPropertiesModal] = React.useState(false)
  const { isUpdating, progress } = useUpdate()
  const { checkForUpdates, selectDirectory, isChecking, gameDirectory } =
    useGameStateContext()
  const hash = useHashRoute()

  const isActive = (path: string) => {
    const basePath = hash.replace(/#/, '') || '/'
    if (path === '/') return basePath === '/' || basePath === ''
    return basePath.startsWith(path)
  }

  const handleLocateGameFiles = React.useCallback(() => {
    // First-time users get the Steam instructions modal first — same
    // gate as the main "Install" button. Returning users (flag set)
    // skip the modal and go straight to the folder picker.
    if (!hasAcknowledgedSteamInstructions) {
      setShowSteamModal(true)
      return
    }
    void selectDirectory()
  }, [hasAcknowledgedSteamInstructions, selectDirectory])

  const handleCheckForUpdates = React.useCallback(() => {
    // A menu-driven "Check for updates" is always an explicit user
    // request, so force a fresh CDN check — the
    // `lastCheckedDirectoryRef` short-circuit in `checkForUpdates`
    // would otherwise skip the second click after the auto-check on
    // mount. When there's no folder yet, route through the locate
    // flow (which honors the Steam modal gate for first-time users)
    // so the menu item does something visible instead of being an
    // invisible no-op while the hook returns early.
    if (!gameDirectory) {
      if (!hasAcknowledgedSteamInstructions) {
        setShowSteamModal(true)
        return
      }
      void selectDirectory()
      return
    }
    void checkForUpdates(true)
  }, [
    checkForUpdates,
    gameDirectory,
    hasAcknowledgedSteamInstructions,
    selectDirectory,
  ])

  const handleAcknowledgeSteamInstructions = React.useCallback(() => {
    // Same persistence pattern as `game-action-button`: write the flag
    // synchronously so a mid-handler crash still leaves the user on the
    // fast path next launch. Then drop the modal. We don't auto-launch
    // the picker — the user explicitly opened the menu, so they decide
    // when to pick a folder.
    markSteamInstructionsSeen()
    setHasAcknowledgedSteamInstructions(true)
    setShowSteamModal(false)
  }, [])

  const isCheckDisabled = isChecking || isUpdating

  return (
    <Sidebar collapsible="none" className="w-62 shrink-0 bg-transparent">
      <SidebarContent className="flex flex-col">
        <SidebarGroup className="px-5 pt-5 pb-2">
          <SidebarGroupLabel className="uppercase tracking-wider pl-4">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem className="space-y-px">
                <SidebarMenuButton asChild isActive={isActive('/')} size="lg" className="px-4">
                  <a href="#/">
                    <Home className="size-5!" />
                    <span>Home</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuButton asChild isActive={isActive('/news')} size="lg" className="px-4">
                  <a href="#/news">
                    <News className="size-5!" />
                    <span>News</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuButton asChild isActive={isActive('/leaderboard')} size="lg" className="px-4">
                  <a href="#/leaderboard">
                    <Leaderboard className="size-5!" />
                    <span>Leaderboard</span>
                  </a>
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
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive('/play')}
                      size="lg"
                      className="px-4"
                    >
                      <a href="#/play">
                        <span className="w-5 flex shrink-0 justify-center">
                          <AnimatePresence mode="wait">
                            {isUpdating ? (
                              <motion.div
                                key="progress"
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                <CircularProgress
                                  progress={progress}
                                  size={16}
                                  strokeWidth={2}
                                />
                              </motion.div>
                            ) : (
                              <motion.img
                                key="icon"
                                src="../assets/icon/app-icon.png"
                                alt=""
                                className="size-5"
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 2, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                              />
                            )}
                          </AnimatePresence>
                        </span>
                        <span>ZEmu: King of the Kill</span>
                      </a>
                    </SidebarMenuButton>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem
                      disabled={isCheckDisabled}
                      onSelect={(event) => {
                        // `onSelect` fires after the menu closes by
                        // default — perfect for triggering a one-shot
                        // action. We still prevent the default so the
                        // menu doesn't auto-close on disabled items
                        // (Radix swallows the click, but only when the
                        // item is *enabled*; on disabled it leaves the
                        // menu open, which would be wrong here).
                        event.preventDefault()
                        handleCheckForUpdates()
                      }}
                    >
                      <RefreshCw className="size-4" />
                      <span>Check for updates</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={(event) => {
                        event.preventDefault()
                        handleLocateGameFiles()
                      }}
                    >
                      <FolderSearch className="size-4" />
                      <span>Locate game files</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => {
                        // "Properties…" is a passive, always-available
                        // configuration entry — no domain guards needed.
                        // Letting Radix close the menu on select (i.e.
                        // NOT calling preventDefault) keeps it from
                        // lingering behind the modal.
                        setShowPropertiesModal(true)
                      }}
                    >
                      <Settings className="size-4" />
                      <span>Properties…</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
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

      {/*
        Same Steam-instructions gate the main "Install" button uses —
        surfacing "Locate game files" from the sidebar's context menu
        means a first-time user could otherwise reach the picker
        without ever seeing how to grab the base game. Mounting the
        modal here keeps both entry points consistent.
      */}
      <SteamInstructionsModal
        open={showSteamModal}
        onOpenChange={setShowSteamModal}
        onAcknowledge={handleAcknowledgeSteamInstructions}
      />
      <PropertiesModal
        open={showPropertiesModal}
        onOpenChange={setShowPropertiesModal}
        gameDirectory={gameDirectory}
        onChangeFolder={handleLocateGameFiles}
      />
    </Sidebar>
  )
}
