import { Home } from 'lucide-react'

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

/**
 * App sidebar — the navigation rail on the left of the home window.
 *
 * Top-level sections (each its own `<SidebarGroup>`):
 *   - Menu  → top-level navigation (Home)
 *   - Games → launcher-managed emulators / game shortcuts
 *
 * Top-level Menu entries link to the launcher's hash router
 * (`#/<route>`); Games entries are server-titled shortcuts that link
 * out to per-server launch flows (e.g. `#/games/king-of-the-kill`).
 * "Test Server" is rendered disabled until its launch flow is wired
 * up — the `disabled` prop on `SidebarMenuButton` handles the
 * visual + `aria-disabled` treatment for us.
 *
 * Rendered with `collapsible="none"` because the launcher's main
 * window is fixed at 1280×800 (see `tauri.conf.json`) — there's no
 * mobile breakpoint and no need for an icon-collapsed mode. That
 * drops all the offcanvas/icon scaffolding built into the shadcn
 * Sidebar primitive.
 *
 * This component assumes it's already inside a `<SidebarProvider>`
 * (which the home page provides so it can wrap header + sidebar +
 * main together — that's the shadcn convention for the
 * offcanvas/collapsible variants).
 */
export function AppSidebar() {
  return (
    <Sidebar collapsible="none" className="w-56 shrink-0 bg-transparent">
      <SidebarContent>
        <SidebarGroup className="px-5 pt-5 pb-2">
          <SidebarGroupLabel className="uppercase tracking-wider pl-4">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive size="lg">
                  <a href="#/">
                    <Home />
                    <span>Home</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="px-5 pb-2">
          <SidebarGroupLabel className="uppercase tracking-wider pl-4">
            Games
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="lg">
                  <a href="#/games/king-of-the-kill">
                    <img
                      src="./assets/icon/app-icon.png"
                      alt=""
                      className="size-8 shrink-0 rounded-md"
                    />
                    <span>ZEmu: King of the Kill</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  disabled
                  size="lg"
                  tooltip="This server isn't ready yet."
                >
                  <img
                    src="./assets/icon/app-icon.png"
                    alt=""
                    className="size-8 shrink-0 rounded-md"
                  />
                  <span>ZEmu: Test Server</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}