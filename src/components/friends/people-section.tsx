import * as React from 'react'

import { cn } from '@/lib/utils'
import { PlayerResultRow } from '@/components/friends/player-result-row'

/** Narrow interface — only the fields `PeopleSection` actually needs. */
interface PersonLike {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
  status: string
}

interface PeopleSectionProps<T extends PersonLike> {
  title: string
  /** Optional count shown as a chip next to the heading. */
  badge?: number
  people: T[]
  emptyMessage: string
  /** Renders the trailing action slot of each row. */
  renderActions?: (person: T) => React.ReactNode
}

/**
 * One labelled group of people (search results / incoming / outgoing /
 * friends). Renders the heading + count, an empty-state line, and a
 * row per person whose action buttons are decided by `renderActions`.
 */
export function PeopleSection<T extends PersonLike>({
  title,
  badge,
  people,
  emptyMessage,
  renderActions,
}: PeopleSectionProps<T>) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {typeof badge === 'number' ? (
          <span
            className={cn(
              'min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none',
              badge > 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {badge}
          </span>
        ) : null}
      </header>
      {people.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground/80">
          {emptyMessage}
        </p>
      ) : (
        <ul className="flex flex-col">
          {people.map((person) => (
            <PlayerResultRow key={person.id} person={person}>
              {renderActions ? renderActions(person) : null}
            </PlayerResultRow>
          ))}
        </ul>
      )}
    </section>
  )
}
