import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { TIER_VALUES } from '@/lib/leaderboard'
import { cn } from '@/lib/utils'

import { DEFAULT_FILTERS, type LeaderboardFilters } from './leaderboard-filters'

/**
 * Accent used by every filter control. Kept in one place so the search
 * field, the five selects and any future control stay in sync — this is the
 * only surface in the app that tints its inputs (global inputs stay
 * `text-foreground`).
 */
// Bold + accent text; `[&_svg]` also repaints the chevron inside each select
// trigger, which the shared `SelectTrigger` paints `text-muted-foreground`.
const FILTER_TEXT = 'text-[#c73e3e] font-bold [&_svg]:text-[#c73e3e]'

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

function countryLabel(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

function CountryFlag({ code }: { code: string }) {
  return (
    <img
      src={`https://flagsapi.com/${code.toUpperCase()}/flat/32.png`}
      alt=""
      aria-hidden
      loading="lazy"
      className="h-3 w-4 shrink-0 rounded-[2px] object-cover"
      draggable={false}
      style={{ pointerEvents: 'none' }}
    />
  )
}

export default function Filter({
  onFilterChange,
  availableCountries = [],
}: {
  onFilterChange?: (filters: LeaderboardFilters) => void
  availableCountries?: ReadonlyArray<string>
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState('all')
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState(DEFAULT_FILTERS.region)
  const [teamMode, setTeamMode] = useState(DEFAULT_FILTERS.teamMode)
  const [pageSize, setPageSize] = useState(DEFAULT_FILTERS.pageSize)

  const emit = (patch: Partial<LeaderboardFilters>) => {
    onFilterChange?.({
      search,
      tier,
      country,
      region,
      teamMode,
      pageSize,
      ...patch,
    })
  }

  const countryOptions = [...availableCountries].sort()

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-foreground/10 bg-background/50 px-4 py-3">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[#c73e3e]" />
        <Input
          placeholder={t('leaderboardPage.searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            emit({ search: e.target.value })
          }}
          className={cn('w-52 pr-3 pl-9', FILTER_TEXT, 'placeholder:text-[#c73e3e]')}
        />
      </div>

      {/* Tier Select */}
      <Select
        value={tier}
        onValueChange={(v) => {
          setTier(v)
          emit({ tier: v })
        }}
      >
        <SelectTrigger className={cn('w-32', FILTER_TEXT)} size="sm">
          <SelectValue placeholder={t('leaderboard.allTiers')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('leaderboard.allTiers')}</SelectItem>
          {TIER_VALUES.map((tier) => (
            <SelectItem key={tier} value={tier}>
              {t(`leaderboard.${tier}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Country Select */}
      <Select
        value={country || 'all'}
        onValueChange={(v) => {
          const next = v === 'all' ? '' : v
          setCountry(next)
          emit({ country: next })
        }}
      >
        <SelectTrigger className={cn('w-40', FILTER_TEXT)} size="sm">
          <SelectValue placeholder={t('leaderboardPage.countryAll')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('leaderboardPage.countryAll')}</SelectItem>
          {countryOptions.length === 0 ? (
            <SelectItem value="__empty__" disabled>
              {t('leaderboardPage.countryNone')}
            </SelectItem>
          ) : (
            countryOptions.map((code) => (
              <SelectItem key={code} value={code}>
                <span className="flex items-center gap-2">
                  <CountryFlag code={code} />
                  <span>{countryLabel(code)}</span>
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      {/* Region Select — EU is the default. There is no global-region
          option: the season board is global, so the region only scopes
          the Solo/Duo/Fives recent-match views. */}
      <Select
        value={region}
        onValueChange={(v) => {
          setRegion(v)
          emit({ region: v })
        }}
      >
        <SelectTrigger className={cn('w-32', FILTER_TEXT)} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="EU">{t('leaderboard.regionEU')}</SelectItem>
          <SelectItem value="NA">{t('leaderboard.regionNA')}</SelectItem>
          <SelectItem value="ASIA" disabled>
            {t('leaderboard.regionAsia')}
          </SelectItem>
        </SelectContent>
      </Select>

        {/* Team Mode — "All modes" is the global season board, the same
            default the website opens on. */}
        <Select
          value={teamMode}
          onValueChange={(v) => {
            setTeamMode(v)
            emit({ teamMode: v })
          }}
        >
          <SelectTrigger className={cn('w-28', FILTER_TEXT)} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('leaderboard.modeAll')}</SelectItem>
            <SelectItem value="Solo">{t('leaderboard.modeSolo')}</SelectItem>
            <SelectItem value="Duo">{t('leaderboard.modeDuo')}</SelectItem>
            <SelectItem value="Fives">{t('leaderboard.modeFives')}</SelectItem>
          </SelectContent>
        </Select>

      {/* Rows per page */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs tracking-wide text-foreground/60 uppercase">{t('leaderboardPage.rowsPerPage')}</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const parsed = Number(v)
            if (Number.isFinite(parsed) && parsed > 0) {
              setPageSize(parsed)
              emit({ pageSize: parsed })
            }
          }}
        >
          <SelectTrigger className={cn('w-20', FILTER_TEXT)} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100, 200].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

