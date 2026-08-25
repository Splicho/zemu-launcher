import { ReactNode } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { Header } from '@/components/header'
import { TitleBar } from '@/components/title-bar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Main-window layout.
 *
 * Wraps the launcher window's chrome (title bar, sidebar, header)
 * around any page content. Pages are passed in as `children`.
 *
 * Layout (top → bottom / left → right):
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ TitleBar (drag, min/close)                         │  ← row 1
 *   ├──────────┬─────────────────────────────────────────┤
 *   │ AppSidebar│           Header (account)             │  ← row 2
 *   │ (logo +  ├─────────────────────────────────────────┤
 *   │  nav)    │           main — children              │
 *   │          │                                         │
 *   └──────────┴─────────────────────────────────────────┘
 *
 * Sidebar + TitleBar stay mounted across pages. The main content
 * swaps below the header. TitleBar + Sidebar are window chrome —
 * they live in the layout, never in the pages.
 */
export function MainLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <SidebarProvider>
        <div className="flex h-screen w-screen flex-col bg-background">
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <main className="flex flex-1 flex-col overflow-y-auto px-8 py-5">
                {children}
              </main>
            </div>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
