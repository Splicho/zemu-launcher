import { ReactNode, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

import { AppSidebar } from '@/components/app-sidebar'
import { SettingsSidebar } from '@/components/settings-sidebar'
import { AccountSidebar } from '@/components/account-sidebar'
import { Header } from '@/components/header'
import { TitleBar } from '@/components/title-bar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  OpenPropertiesProvider,
  type OpenProperties,
} from '@/contexts/open-properties-context'

export type SidebarType = 'app' | 'settings' | 'account'

const EASING = [0.25, 0.46, 0.45, 0.94] as const

const backgroundVariants = {
  enter: { opacity: 0, scale: 1.005, filter: 'blur(4px)' },
  center: {
    opacity: 0.5,
    scale: 1.0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: EASING },
  },
  exit: {
    opacity: 0,
    scale: 0.995,
    filter: 'blur(2px)',
    transition: { duration: 0.4, ease: EASING },
  },
}

const sidebarVariants = {
  enter: { x: '-100%', opacity: 0 },
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.3, ease: EASING },
  },
  exit: {
    x: '-100%',
    opacity: 0,
    transition: { duration: 0.3, ease: EASING },
  },
}

export function MainLayout({
  children,
  backgroundSrc,
  routeKey,
  sidebarType = 'app',
}: {
  children: ReactNode
  backgroundSrc?: string
  routeKey?: string
  sidebarType?: SidebarType
}) {
  // `AppSidebar` mounts the actual `PropertiesModal`. Other components
  // (notably `GameActionButton` for the "License required" CTA) need a
  // way to ask the sidebar to open that modal pinned to a specific
  // section. We bridge the two with `OpenPropertiesProvider`: the
  // sidebar registers itself via `setOpener` on mount, and any
  // consumer (in any sibling subtree) can call `open()` to trigger
  // it.
  const [opener, setOpener] = useState<OpenProperties | null>(null)
  const handleRegister = useCallback((fn: OpenProperties) => {
    setOpener(() => fn)
  }, [])

  return (
    <TooltipProvider delayDuration={150}>
      <SidebarProvider>
        <OpenPropertiesProvider open={opener ?? (() => {})}>
          <div className="flex h-screen w-screen flex-col bg-background">
            <TitleBar />
            <div className="relative flex min-h-0 flex-1">
              <AnimatePresence>
                {backgroundSrc && (
                  <motion.div
                    key={`bg-image-${routeKey}`}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    variants={backgroundVariants}
                    className="pointer-events-none absolute inset-0"
                  >
                    <img
                      src={backgroundSrc}
                      alt=""
                      className="h-full w-full object-cover"
                      aria-hidden="true"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {backgroundSrc && (
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background from-30% via-background/95"
                  aria-hidden="true"
                />
              )}
              <div className="relative z-10 flex min-h-0 flex-1">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={sidebarType}
                    variants={sidebarVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="flex min-h-0"
                  >
                    {sidebarType === 'settings' ? (
                      <SettingsSidebar />
                    ) : sidebarType === 'account' ? (
                      <AccountSidebar />
                    ) : (
                      <AppSidebar registerOpener={handleRegister} />
                    )}
                  </motion.div>
                </AnimatePresence>
                <div className="flex flex-1 flex-col overflow-hidden">
                  <Header />
                  <motion.main
                    key={`content-${routeKey}`}
                    className="flex flex-1 flex-col overflow-y-auto px-6 sm:px-8"
                    initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.35, ease: EASING }}
                  >
                    {children}
                  </motion.main>
                </div>
              </div>
            </div>
          </div>
        </OpenPropertiesProvider>
      </SidebarProvider>
    </TooltipProvider>
  )
}
