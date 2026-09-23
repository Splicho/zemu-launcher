'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

import type { ClanProfile } from '@/lib/clan'

import { ClanAboutTab } from './clan-about-tab'
import { ClanFollowersTab } from './clan-followers-tab'
import { ClanMembersTab } from './clan-members-tab'

/**
 * Tabbed section on the public clan profile page.
 *
 * Mirrors the website's `ClanTabs` (`apps/web/app/clans/[slug]/
 * components/clan-tabs.tsx`):
 *
 *   - Underline-style tab list (radix-nova `line` variant — same
 *     `TabsList variant="underline"` look the web app uses against
 *     its shadcn `@workspace/ui/components/tabs` underline variant).
 *   - Four tabs: Members (default), Followers, Match history
 *     (stub, parity with the web app), About.
 *
 * The selected tab is reflected in the URL hash so deep links
 * (`#/clan/foo/about`) restore the right pane.
 */
export function ClanTabs({
  clan,
  defaultTab,
}: {
  clan: ClanProfile
  /**
   * Initial tab id. Defaults to `'members'`. Use this to override
   * the default from the URL hash without setting state first.
   */
  defaultTab?: string
}) {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<string>(defaultTab ?? 'members')

  // Optional hash-sync: if the URL hash changes externally
  // (e.g. user pastes `#/clan/foo/about`), pick it up.
  React.useEffect(() => {
    function onHashChange() {
      const fragment = window.location.hash
      const match = fragment.match(
        /^#\/clan\/[^/]+\/(members|followers|match-history|about)\/?$/,
      )
      if (match) setTab(match[1])
    }
    onHashChange()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <Tabs value={tab} onValueChange={setTab} className="mt-6 w-full">
      <div className="border-b">
        <TabsList variant="line">
          <TabsTrigger value="members">{t('clan.tabs.members')}</TabsTrigger>
          <TabsTrigger value="followers">
            {t('clan.tabs.followers')}
          </TabsTrigger>
          <TabsTrigger value="match-history">
            {t('clan.tabs.matchHistory')}
          </TabsTrigger>
          <TabsTrigger value="about">{t('clan.tabs.about')}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="members" className="mt-4 py-4">
        <ClanMembersTab slug={clan.slug} />
      </TabsContent>
      <TabsContent value="followers" className="mt-4 py-4">
        <ClanFollowersTab slug={clan.slug} />
      </TabsContent>
      <TabsContent value="match-history" className="mt-4 py-4">
        <p className="text-muted-foreground text-sm">
          {t('clan.matchHistoryStub')}
        </p>
      </TabsContent>
      <TabsContent value="about" className="mt-4 py-4">
        <ClanAboutTab clan={clan} />
      </TabsContent>
    </Tabs>
  )
}
