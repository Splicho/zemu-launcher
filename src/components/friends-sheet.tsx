import { useTranslation } from 'react-i18next'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FriendsPanel } from '@/components/friends-panel'

interface FriendsSheetProps {
  /** Controlled by the parent (the sidebar). */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Right-side Sheet wrapper for the Friends panel. Owns the
 * `SheetHeader` (title only — no description) and forwards the rest
 * of the layout to `<FriendsPanel />`. The body is wrapped in a
 * single top-level `ScrollArea` so the sheet scrolls as a unit —
 * the page-level sticky headers inside `FriendsPanel` stick
 * relative to this viewport, so the back button + search input
 * stay pinned while the user scrolls through long friend lists or
 * search results. Previously the scroll lived inside each page
 * via a nested `ScrollArea`, which was redundant nesting (a
 * `ScrollArea` inside another `ScrollArea` doesn't measure its
 * viewport correctly) and made the sticky headers behave
 * unpredictably.
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
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <FriendsPanel active={open} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
