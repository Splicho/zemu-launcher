import { AppSidebar } from '@/components/app-sidebar'
import { Header } from '@/components/header'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Home / launcher screen.
 *
 * Layout (top → bottom / left → right):
 *
 *   ┌─────────────────────────────────────────────┐
 *   │               Header (icon + user)          │
 *   ├──────────┬──────────────────────────────────┤
 *   │ AppSidebar│                                  │
 *   │ (nav)     │   main — Play button, version    │
 *   │           │   selector, download progress,   │
 *   │           │   news, etc.                     │
 *   └──────────┴──────────────────────────────────┘
 *
 * `SidebarProvider` wraps everything because the shadcn Sidebar
 * primitives key their collapsible/offcanvas state off a React
 * context — having it at the root lets us add a collapse trigger or
 * other sidebar affordances later without restructuring.
 *
 * The home window itself stays `bg-background`; the sidebar is
 * borderless (it sits on the same background as the rest of the
 * window — only its hover state provides any separation).
 */
export function HomePage() {
  return (
    <TooltipProvider delayDuration={150}>
      <SidebarProvider>
        <div className="flex h-screen w-screen flex-col bg-background">
          <Header />
          <div className="flex flex-1 overflow-hidden">
            <AppSidebar />
            <main className="flex flex-1" />
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}