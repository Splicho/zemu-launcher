import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The framed card-table treatment used across the admin dashboard
 * (`apps/admin/components/card-table.tsx` in `zemu-website`).
 *
 * A muted rounded frame holds the column header, and each body row sits on
 * its own `bg-card` surface with rounded outer corners — so the rows read as
 * one continuous card rather than a striped list. Wrapping an existing
 * `<Table>` (instead of re-implementing rows) keeps both home-page tables
 * visually identical to the dashboard without duplicating the cell classes.
 *
 * These classes are copied verbatim from the dashboard component; change
 * them there first and mirror the change here.
 */
export function CardTable({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-2xl bg-muted/60 p-1', className)}>
      <div
        className={cn(
          '[&_table]:border-separate [&_table]:border-spacing-0',
          '[&_thead_tr]:border-0',
          '[&_th]:h-10 [&_th]:px-2.5 [&_th]:text-muted-foreground',
          '[&_tbody_tr]:border-0 [&_tbody_tr]:hover:bg-transparent',
          '[&_td]:border-b [&_td]:border-border/60 [&_td]:bg-card [&_td]:p-2.5',
          '[&_tbody_tr_td:first-child]:border-l',
          '[&_tbody_tr_td:last-child]:border-r',
          '[&_tbody_tr:first-child_td]:border-t',
          '[&_tbody_tr:first-child_td:first-child]:rounded-tl-xl',
          '[&_tbody_tr:first-child_td:last-child]:rounded-tr-xl',
          '[&_tbody_tr:last-child_td:first-child]:rounded-bl-xl',
          '[&_tbody_tr:last-child_td:last-child]:rounded-br-xl',
        )}
      >
        {children}
      </div>
    </div>
  )
}
