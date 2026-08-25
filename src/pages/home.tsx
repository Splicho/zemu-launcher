import { AppSidebar } from '@/components/app-sidebar'
import { Header } from '@/components/header'
import { NewsSlider } from '@/components/news-slider'
import { TitleBar } from '@/components/title-bar'
import { useHash } from '@/hooks/use-hash'
import { NewsPage } from '@/pages/news'
import { NewsSlugPage } from '@/pages/news-slug'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Home / launcher screen.
 *
 * Layout (top → bottom / left → right):
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ TitleBar (drag, min/close)                          │  ← row 1
 *   ├──────────┬─────────────────────────────────────────┤
 *   │ AppSidebar│           Header (account)              │  ← row 2
 *   │ (logo +  ├─────────────────────────────────────────┤
 *   │  nav)    │                                         │
 *   │          │           main — NewsSlider /            │
 *   │          │           NewsPage / NewsSlugPage        │
 *   │          │                                         │
 *   └──────────┴─────────────────────────────────────────┘
 *
 * The main window is frameless (`decorations: false` in
 * `tauri.conf.json`) so `TitleBar` doubles as the OS drag region
 * and the only place window controls live. It sits *above* the
 * sidebar/header row — that's the order that matches the
 * abyssal-gate launcher and reads naturally on a desktop window.
 *
 * Routing inside the home shell is hash-based (see
 * `src/hooks/use-hash.ts`). The main panel swaps based on the
 * current hash:
 *   - `#/`                 → default home content (news slider)
 *   - `#/news`             → full news grid (NewsPage)
 *   - `#/news/:slug`       → single post (NewsSlugPage)
 *
 * Anything else (including the deep-route catch-all in App.tsx)
 * falls through to the default home view. Sidebar/titlebar/header
 * stay mounted across all three — they're chrome, not content.
 *
 * `SidebarProvider` wraps everything because the shadcn Sidebar
 * primitives key their collapsible/offcanvas state off a React
 * context — having it at the root lets us add a collapse trigger
 * or other sidebar affordances later without restructuring.
 */
export function HomePage() {
  return (
    <TooltipProvider delayDuration={150}>
      <SidebarProvider>
        <div className="flex h-screen w-screen flex-col bg-background">
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <HomeMain />
            </div>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}

/**
 * The main panel's hash-based sub-router. Lives inside `HomePage` so
 * the chrome (sidebar/titlebar/header) doesn't unmount when the user
 * navigates between the home content and the news views.
 *
 * The route table is intentionally explicit — there's no regex
 * matching, just a couple of string checks. When a third news route
 * (search, tags, etc.) shows up, this is the place to add it.
 */
function HomeMain() {
  const hash = useHash()

  if (hash && hash.startsWith('/news/')) {
    const slug = hash.slice('/news/'.length)
    if (slug) {
      return (
        <main className="flex flex-1 flex-col overflow-hidden">
          <NewsSlugPage slug={slug} />
        </main>
      )
    }
  }

  if (hash === '/news') {
    return (
      <main className="flex flex-1 flex-col overflow-hidden">
        <NewsPage />
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <NewsSlider />
    </main>
  )
}