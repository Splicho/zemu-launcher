'use client'

import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Filter values for the clan directory page.
 *
 * Mirrors `apps/web/app/clans/filters-types.ts:FilterValues` so
 * both surfaces expose the same affordance.
 */
export type ClanFilters = {
  q: string
  visibility: 'all' | 'public' | 'private'
  verified: 'all' | 'verified'
  sort: 'members' | 'followers' | 'newest' | 'name'
}

export const DEFAULT_CLAN_FILTERS: ClanFilters = {
  q: '',
  visibility: 'all',
  verified: 'all',
  sort: 'members',
}

/**
 * Search + Verified + Visibility + Sort bar at the top of `/clans`.
 * Mirrors `apps/web/app/clans/filters-bar.tsx` 1:1.
 *
 * Render posture:
 *   - Search input with a clear button (the X icon).
 *   - Verified filter (`All clans` / `Verified`).
 *   - Visibility filter (`All clans` / `Public` / `Private`).
 *   - Sort dropdown on the right.
 *   - Clear button (shown only when any filter is non-default).
 *   - Layout is responsive: wraps on mobile, sits on one row on `sm:`+.
 *
 * Behaviour:
 *   - `onChange` fires after every keystroke for the search input
 *     and after every select change. The page wraps this in a
 *     debounce (300ms for `q`) so we don't refetch on every
 *     keystroke.
 *   - Clear button resets all filters to defaults and calls
 *     `onChange` once.
 */
export function ClanFiltersBar({
  value,
  onChange,
}: {
  value: ClanFilters
  onChange: (next: ClanFilters) => void
}) {
  const { t } = useTranslation()

  const isFilterActive =
    value.q.trim().length > 0 ||
    value.visibility !== 'all' ||
    value.verified !== 'all' ||
    value.sort !== 'members'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.q}
          onChange={(event) =>
            onChange({ ...value, q: event.target.value })
          }
          placeholder={t('clan.searchPlaceholder')}
          className="h-9 pr-9 pl-9"
        />
        {value.q.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onChange({ ...value, q: '' })}
            className="absolute top-1/2 right-1.5 -translate-y-1/2"
            aria-label={t('common.cancel')}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      {/* Verified filter */}
      <Select
        value={value.verified}
        onValueChange={(next: ClanFilters['verified']) =>
          onChange({ ...value, verified: next })
        }
      >
        <SelectTrigger
          size="default"
          aria-label={t('clan.filter.verified')}
          className="!h-9 min-w-32 py-0"
        >
          <SelectValue placeholder={t('clan.filter.verified')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('clan.filter.allClans')}</SelectItem>
          <SelectItem value="verified">
            {t('clan.filter.verified')}
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Visibility filter */}
      <Select
        value={value.visibility}
        onValueChange={(next: ClanFilters['visibility']) =>
          onChange({ ...value, visibility: next })
        }
      >
        <SelectTrigger
          size="default"
          aria-label={t('clan.filter.visibility')}
          className="!h-9 min-w-32 py-0"
        >
          <SelectValue placeholder={t('clan.filter.visibility')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('clan.filter.allClans')}</SelectItem>
          <SelectItem value="public">{t('clan.filter.public')}</SelectItem>
          <SelectItem value="private">{t('clan.filter.private')}</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort */}
      <Select
        value={value.sort}
        onValueChange={(next: ClanFilters['sort']) =>
          onChange({ ...value, sort: next })
        }
      >
        <SelectTrigger
          size="default"
          aria-label={t('clan.sortLabel')}
          className="!h-9 min-w-40 py-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="members">{t('clan.sort.members')}</SelectItem>
          <SelectItem value="followers">
            {t('clan.sort.followers')}
          </SelectItem>
          <SelectItem value="newest">{t('clan.sort.newest')}</SelectItem>
          <SelectItem value="name">{t('clan.sort.name')}</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear */}
      {isFilterActive ? (
        <Button
          type="button"
          variant="ghost"
          size="default"
          onClick={() => onChange(DEFAULT_CLAN_FILTERS)}
          className="!h-9 px-3 text-muted-foreground hover:text-foreground"
        >
          {t('clan.filter.clear')}
        </Button>
      ) : null}
    </div>
  )
}
