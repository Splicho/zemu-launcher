import { AppSidebar } from '@/components/app-sidebar'
import { Header } from '@/components/header'
import { TitleBar } from '@/components/title-bar'
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
 *   │          │           main — Play button, version   │
 *   │          │           selector, download progress,  │
 *   │          │           news, etc.                    │
 *   └──────────┴─────────────────────────────────────────┘
 *
 * The main window is frameless (`decorations: false` in
 * `tauri.conf.json`) so `TitleBar` doubles as the OS drag region
 * and the only place window controls live. It sits *above* the
 * sidebar/header row — that's the order that matches the
 * abyssal-gate launcher and reads naturally on a desktop window.
 *
 * `SidebarProvider` wraps everything because the shadcn Sidebar
 * primitives key their collapsible/offcanvas state off a React
 * context — having it at the root lets us add a collapse trigger
 * or other sidebar affordances later without restructuring.
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
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <main className="flex flex-1" />
            </div>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}