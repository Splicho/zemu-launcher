import * as React from 'react'
import { useTranslation } from 'react-i18next'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { FriendsPanel } from '@/components/friends-panel'

interface FriendsSheetProps {
  /** Controlled by the parent (the sidebar). */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Right-side Sheet wrapper for the Friends panel. Owns the
 * `SheetHeader` (title only — no description) and forwards the rest
 * of the layout to `<FriendsPanel />`.
 */
export function FriendsSheet({ open, onOpenChange }: FriendsSheetProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b">
          <SheetTitle>{t('friends.title')}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <FriendsPanel active={open} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
