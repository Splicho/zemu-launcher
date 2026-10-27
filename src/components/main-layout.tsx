import { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ─────────────────────────────────────────────────────────────────
// UI REWORK (WIP)
//
// The launcher chrome is temporarily commented out so the new main
// page can be built on a blank canvas. Uncomment a group of imports
// here and its matching JSX block below to bring that piece back.
//
// import { AppSidebar } from '@/components/app-sidebar'
// import { SettingsSidebar } from '@/components/settings-sidebar'
// import { AccountSidebar } from '@/components/account-sidebar'
// import { SiteNoticeBar } from '@/components/site-notice-bar'
// import { TitleBar } from '@/components/title-bar'
// ─────────────────────────────────────────────────────────────────
import { Footer, Navbar, WindowBar } from '@/components/new-launcher'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { OpenPropertiesProvider } from '@/contexts/open-properties-context'

export type SidebarType = 'app' | 'settings' | 'account'

const EASING = [0.25, 0.46, 0.45, 0.94] as const

// `app-bg.png` is a near-black silhouette scene, so the layer is
// painted at full opacity (at the old 0.5 it was indistinguishable from
// the page background), lifted with `brightness-[1.5]` on the <img>
// below, and then dimmed back down with a light scrim so content stays
// readable.
const backgroundVariants = {
  enter: { opacity: 0, scale: 1.005, filter: 'blur(4px)' },
  center: {
    opacity: 1,
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

// UI REWORK: only used by the commented-out sidebar block below.
// const sidebarVariants = {
//   enter: { x: '-100%', opacity: 0 },
//   center: {
//     x: 0,
//     opacity: 1,
//     transition: { duration: 0.3, ease: EASING },
//   },
//   exit: {
//     x: '-100%',
//     opacity: 0,
//     transition: { duration: 0.3, ease: EASING },
//   },
// }

/**
 * Main layout shell.
 *
 * UI REWORK: currently renders the page content only. The window
 * title bar, the sidebar, the site-notice header and the
 * `OpenProperties` registration are commented out below — see the
 * `UI REWORK` markers. `sidebarType` is still accepted so
 * `main-app.tsx` doesn't have to change while the sidebar is gone.
 */
export function MainLayout({
  children,
  backgroundSrc,
  routeKey,
}: {
  children: ReactNode
  backgroundSrc?: string
  routeKey?: string
  sidebarType?: SidebarType
}) {
  // UI REWORK: `AppSidebar` used to register the Properties modal
  // opener here. Commented out together with the sidebar block below
  // so the provider still mounts with a no-op opener.
  //
  // const [opener, setOpener] = useState<OpenProperties | null>(null)
  // const handleRegister = useCallback((fn: OpenProperties) => {
  //   setOpener(() => fn)
  // }, [])

  return (
    <TooltipProvider delayDuration={150}>
      <SidebarProvider>
        <OpenPropertiesProvider open={() => {}}>
          <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
            {/* Launcher background. Lives at the root of the shell so it
                covers the entire window — including the window bar and
                navbar strip — instead of starting below them. Both
                layers are pointer-events-none so dragging and the
                window controls are unaffected. */}
            <AnimatePresence>
              {backgroundSrc && (
                <motion.div
                  // Keyed by the image, not the route: the launcher paints
                  // the same background on every page, so a route change
                  // must not remount it (that would replay the fade).
                  key={`bg-image-${backgroundSrc}`}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  variants={backgroundVariants}
                  className="pointer-events-none absolute inset-0"
                >
                  <img
                    src={backgroundSrc}
                    alt=""
                    className="h-full w-full object-cover brightness-[1.5]"
                    aria-hidden="true"
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {backgroundSrc && (
              <div
                className="pointer-events-none absolute inset-0 bg-background/25"
                aria-hidden="true"
              />
            )}

            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
              {/* Old `TitleBar` replaced by the new in-window bar. The
                  legacy component is still in the tree, commented out at
                  the import above, for reference. */}
              <WindowBar />
              {/* Navbar gets its own row below the bar: the window bar
                  keeps the drag region + window controls to itself, and
                  the navbar carries the links (centre) and the account
                  menu (right). */}
              <Navbar />
              {/* UI REWORK: window notice bar commented out.
              <SiteNoticeBar />
              */}
              <div className="flex min-h-0 flex-1 flex-col">
                {/* UI REWORK: sidebar commented out.
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
                */}
                <div className="flex flex-1 flex-col overflow-hidden">
                  {/* UI REWORK: new header goes here. */}
                  <motion.main
                    key={`content-${routeKey}`}
                    className="flex flex-1 flex-col"
                    initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.35, ease: EASING }}
                  >
                    {children}
                  </motion.main>
                  {/* Pinned to the bottom of the window, outside the
                      route transition so it doesn't re-animate on
                      navigation. */}
                  <Footer />
                </div>
              </div>
            </div>
          </div>
        </OpenPropertiesProvider>
      </SidebarProvider>
    </TooltipProvider>
  )
}
