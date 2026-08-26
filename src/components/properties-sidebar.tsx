import type { ComponentType } from 'react'
import { FolderTree, ScrollText } from 'lucide-react'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

/**
 * Stable id for each section in the Properties rail. The id is the
 * public contract — `PropertiesModal` switches content on it, not on
 * the label — so adding/renaming sections never breaks the API.
 *
 * Currently just two sections: a file-management view and the game's
 * EULA. As real section content lands, this list grows and each
 * section body is rendered in `PropertiesSection`.
 */
export const PROPERTIES_SECTIONS = [
  { id: 'install', label: 'Installed Files', Icon: FolderTree },
  { id: 'license', label: 'License', Icon: ScrollText },
] as const satisfies ReadonlyArray<{
  id: string
  label: string
  Icon: ComponentType<{ className?: string }>
}>

export type PropertiesSectionId =
  (typeof PROPERTIES_SECTIONS)[number]['id']

interface PropertiesSidebarProps {
  /** Which section to mark as active. */
  activeId: PropertiesSectionId
  /** Notified when the user picks a different section. */
  onSelect: (id: PropertiesSectionId) => void
}

/**
 * Left rail of the Properties modal — a focused, decoupled navigation
 * surface for section switching. Deliberately standalone (no Dialog,
 * no sidebar provider) so it can be rendered into any container that
 * needs the same affordance without dragging in the modal's state.
 */
export function PropertiesSidebar({
  activeId,
  onSelect,
}: PropertiesSidebarProps) {
  return (
    <nav
      aria-label="Property categories"
      className="w-60 shrink-0 border-r bg-muted/30 p-2"
    >
      <SidebarMenu>
        {PROPERTIES_SECTIONS.map(({ id, label, Icon }) => {
          const isActive = id === activeId
          return (
            <SidebarMenuItem key={id}>
              {/* `size="lg"` (h-12, text-sm) over the rail default gives
                each section link enough vertical room to read as a
                real settings category rather than a tightly-packed
                nav row. Icon bumps from size-4 to size-5 to keep
                proportions — size-4 looked stranded against the
                taller button. */}
              <SidebarMenuButton
                size="lg"
                isActive={isActive}
                onClick={() => {
                  onSelect(id)
                }}
                className="w-full justify-start"
              >
                <Icon className="size-5" />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </nav>
  )
}