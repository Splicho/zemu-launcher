/**
 * Filter values for the clan directory page.
 *
 * Mirrors `apps/web/app/clans/filters-types.ts:FilterValues` so
 * both surfaces expose the same affordance.
 *
 * Lives in its own file (not co-located with the React component)
 * because the renderer's ESLint config has `react-refresh/only-export-components`
 * on — co-exporting a constant alongside a component breaks HMR for
 * that component, and the rule's preferred fix is "split into two
 * files". The component imports from here; the page imports both
 * from here.
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
