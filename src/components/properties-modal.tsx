import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PropertiesSidebar } from '@/components/properties-sidebar'
import { PropertiesSection } from '@/components/properties-section'
import type { PropertiesSectionId } from '@/components/properties-sidebar'

interface PropertiesModalProps {
  /** Controlled by the parent (sidebar context menu). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Section to land on when the modal opens. Defaults to `'install'`.
   * Used by the "License required" CTA to land directly on the License
   * tab; ignored on subsequent opens (the modal resets to `defaultSection`
   * every time it closes, so the same default applies on re-open).
   */
  defaultSection?: PropertiesSectionId
  /** Absolute path to the user's chosen install folder, or null when
   *  none is set. Drives the Installed Files size + Locate buttons. */
  gameDirectory: string | null
  /** Triggers the Steam-instructions-aware folder picker. Mirrors
   *  the main sidebar's Locate handler. */
  onChangeFolder: () => void
}

const DEFAULT_SECTION: PropertiesSectionId = 'install'

export function PropertiesModal({
  open,
  onOpenChange,
  defaultSection = DEFAULT_SECTION,
  gameDirectory,
  onChangeFolder,
}: PropertiesModalProps) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] =
    useState<PropertiesSectionId>(defaultSection)

  const handleSectionSelect = useCallback((id: PropertiesSectionId) => {
    setActiveSection(id)
  }, [])

  // Sync `activeSection` to `defaultSection` whenever the dialog is open
  // and `defaultSection` changes (e.g. user clicks "License required" while
  // the modal is closed — the sidebar sets `defaultSection='license'` and
  // opens it; the modal lands on the right pane immediately). Without this
  // effect, the stale `defaultSection` baked into the close-reset callback
  // would win on the next close/open cycle.
  useEffect(() => {
    if (open) {
      setActiveSection(defaultSection)
    }
  }, [open, defaultSection])

  // Reset the active section on close so reopening always lands the
  // user on `defaultSection` (Install by default; License when the
  // modal was opened from the "License required" CTA) rather than
  // wherever they last left off.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setActiveSection(defaultSection)
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange, defaultSection],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>{t('properties.title')}</DialogTitle>
          <DialogDescription>
            {t('properties.description')}
          </DialogDescription>
        </DialogHeader>

        {/* `min-h-[36rem]` gives the dialog real vertical presence so
          the rail and content area both have room to breathe. The
          Installation Guide pane (five numbered steps) drove the bump
          from 28rem — without it, the last step hovered right at the
          bottom edge. */}
        <div className="flex min-h-[36rem] max-h-[calc(100vh-9rem)] min-h-0">
          <PropertiesSidebar
            activeId={activeSection}
            onSelect={handleSectionSelect}
          />
          <PropertiesSection
            activeId={activeSection}
            gameDirectory={gameDirectory}
            onChangeFolder={onChangeFolder}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}