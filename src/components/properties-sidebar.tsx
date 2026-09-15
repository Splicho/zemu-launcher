import type { ComponentType } from 'react'
import { BookOpen, FolderTree, Languages, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
 * Available sections:
 *  - `install`:  file-management view (size, locate, change).
 *  - `wine`:     compatibility runtime, prefix, and environment variables.
 *  - `language`: in-game language picker (writes `[Internationalization] Locale=` into the game's `ClientConfig.ini`).
 *  - `guide`:    read-only copy of the Steam depot install steps.
 *
 * The license tab has been removed as part of the auth key rework —
 * the auth key is now entered through the in-game Auth Key modal
 * rather than a Properties sidebar entry.
 */
export const PROPERTIES_SECTIONS = [
  { id: 'install', labelKey: 'properties.installedFiles', Icon: FolderTree },
  { id: 'wine', labelKey: 'properties.wineConfiguration', Icon: Settings2 },
  { id: 'language', labelKey: 'properties.language', Icon: Languages },
  { id: 'guide', labelKey: 'properties.installationGuide', Icon: BookOpen },
] as const satisfies ReadonlyArray<{
  id: string
  labelKey: string
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
  const { t } = useTranslation()
  return (
    <nav
      aria-label="Property categories"
      className="w-60 shrink-0 border-r bg-muted/30 p-2"
    >
      <SidebarMenu>
        {PROPERTIES_SECTIONS.map(({ id, labelKey, Icon }) => {
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
                <span>{t(labelKey)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </nav>
  )
}