/**
 * TanStack Query hooks for the clan pages.
 *
 * Wraps every read endpoint under `api.zemu.uk/v1/clans` in a query
 * hook keyed by its input (slug, page). Mutations follow the same
 * pattern as `use-leaderboard.ts`: a thin `useMutation` wrapper
 * that invalidates the matching read queries on settle.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  acceptInvite,
  cancelInvite,
  countClanApplications,
  decideApplication,
  declineInvite,
  fetchClanApplications,
  fetchClanBySlug,
  fetchClanDirectory,
  fetchClanFollowers,
  fetchClanFounder,
  fetchClanMembers,
  fetchInvitesForMe,
  fetchInvitesISent,
  followClan,
  inviteMember,
  leaveClan,
  presignClanAsset,
  removeMember,
  requestJoinClan,
  setMemberRole,
  unfollowClan,
  updateClan,
  uploadClanAsset,
} from '@/lib/clan'
import type { ClanRole, ClanSort, UpdateClanPatch } from '@/lib/clan'

/**
 * Read a clan's full public profile by slug. Cached aggressively
 * (5 min) — the tooltip is mostly static (counts / cover / avatar)
 * and the launcher re-renders after a successful mutation, which
 * invalidates the key in the mutation hooks below.
 */
export function useClanProfile(slug: string | null) {
  return useQuery({
    queryKey: ['clan', 'profile', slug],
    queryFn: () => fetchClanBySlug(slug ?? ''),
    enabled: slug !== null && slug.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/**
 * Paged member roster. Lazy via `enabled` so the Members tab
 * doesn't fetch until the user opens it.
 */
export function useClanMembers(
  slug: string | null,
  options: { page?: number; pageSize?: number } = {},
) {
  return useQuery({
    queryKey: ['clan', 'members', slug, options.page ?? 1, options.pageSize ?? 100],
    queryFn: () => fetchClanMembers(slug ?? '', options),
    enabled: slug !== null && slug.length > 0,
    staleTime: 60_000,
    retry: 1,
  })
}

/**
 * Paged follower list. Same lazy posture as `useClanMembers`.
 */
export function useClanFollowers(
  slug: string | null,
  options: { page?: number; pageSize?: number } = {},
) {
  return useQuery({
    queryKey: ['clan', 'followers', slug, options.page ?? 1, options.pageSize ?? 100],
    queryFn: () => fetchClanFollowers(slug ?? '', options),
    enabled: slug !== null && slug.length > 0,
    staleTime: 60_000,
    retry: 1,
  })
}

/**
 * Founder badge (display name + avatar URL). Lazy via `enabled`
 * — only the About tab fetches this. The hook returns the raw
 * nullable payload; the caller decides whether to render `—`
 * (deleted account) or the avatar+name row.
 */
export function useClanFounder(slug: string | null) {
  return useQuery({
    queryKey: ['clan', 'founder', slug],
    queryFn: () => fetchClanFounder(slug ?? ''),
    enabled: slug !== null && slug.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/**
 * Paged directory search.
 *
 * Search input is the query key — typing in the filter bar flips
 * the key and the directory re-fetches. Pagination is part of the
 * key too so a back-button doesn't accidentally show the new
 * page-1 results with the old search input.
 */
export function useClanDirectory(
  options: { page?: number; pageSize?: number; q?: string; sort?: ClanSort } = {},
) {
  return useQuery({
    queryKey: [
      'clan',
      'directory',
      options.page ?? 1,
      options.pageSize ?? 24,
      options.q ?? '',
      options.sort ?? 'members',
    ],
    queryFn: () => fetchClanDirectory(options),
    staleTime: 60_000,
    retry: 1,
  })
}

// ─── Mutations ──────────────────────────────────────────────────────────
//
// Every mutation invalidates the matching read keys on settle so
// the UI stays consistent (follow button label flips back, member
// count refreshes, etc.). The `slug` parameter is the canonical
// invalidation scope.

function invalidateClan(qc: ReturnType<typeof useQueryClient>, slug: string) {
  void qc.invalidateQueries({ queryKey: ['clan', 'profile', slug] })
  void qc.invalidateQueries({ queryKey: ['clan', 'members', slug] })
  void qc.invalidateQueries({ queryKey: ['clan', 'followers', slug] })
  void qc.invalidateQueries({ queryKey: ['clan', 'founder', slug] })
  void qc.invalidateQueries({ queryKey: ['clan', 'directory'] })
}

/** Follow a clan. Invalidates the profile cache so the button
 *  label flips to "Following" without a manual refresh. */
export function useFollowClan(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => followClan(slug),
    onSettled: () => invalidateClan(qc, slug),
  })
}

/** Unfollow a clan. Same invalidation posture as `useFollowClan`. */
export function useUnfollowClan(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unfollowClan(slug),
    onSettled: () => invalidateClan(qc, slug),
  })
}

/** Leave a clan. Same invalidation posture. */
export function useLeaveClan(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => leaveClan(slug),
    onSettled: () => invalidateClan(qc, slug),
  })
}

/** Submit a request-to-join application. Invalidates the profile so
 *  the `Request to join` button hides once a pending application
 *  exists (the server doesn't expose "I have a pending application"
 *  on the profile payload today, but invalidating keeps the cache
 *  fresh for future fields). */
export function useRequestJoinClan(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (answers: Record<string, string>) =>
      requestJoinClan(slug, answers),
    onSettled: () => invalidateClan(qc, slug),
  })
}

// ─── Manage-page hooks ──────────────────────────────────────────────────

/**
 * Pending applications for a clan (manage page Requests tab).
 * Lazy via `enabled` so the tab doesn't fetch until the user opens
 * it.
 */
export function useClanApplications(slug: string | null) {
  return useQuery({
    queryKey: ['clan', 'applications', slug],
    queryFn: () => fetchClanApplications(slug ?? ''),
    enabled: slug !== null && slug.length > 0,
    staleTime: 30_000,
    retry: 1,
  })
}

/**
 * Cheap pending-count for the Requests tab badge.
 */
export function useClanApplicationsCount(slug: string | null) {
  return useQuery({
    queryKey: ['clan', 'applications-count', slug],
    queryFn: () => countClanApplications(slug ?? ''),
    enabled: slug !== null && slug.length > 0,
    staleTime: 30_000,
    retry: 1,
  })
}

/**
 * Pending invites addressed to the caller (cross-clan).
 */
export function useInvitesForMe() {
  return useQuery({
    queryKey: ['clan', 'invites-for-me'],
    queryFn: fetchInvitesForMe,
    staleTime: 30_000,
    retry: 1,
  })
}

/**
 * Pending invites the caller issued (cross-clan).
 */
export function useInvitesISent() {
  return useQuery({
    queryKey: ['clan', 'invites-i-sent'],
    queryFn: fetchInvitesISent,
    staleTime: 30_000,
    retry: 1,
  })
}

/**
 * Patch a clan's editable fields. On settle, invalidates the
 * profile cache so the public page (and the manage page's
 * Identity / Branding / About tabs) reflect the change.
 */
export function useUpdateClan(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateClanPatch) => updateClan(slug, patch),
    onSettled: () => {
      invalidateClan(qc, slug)
      // The manage page reads the profile via `useClanProfile`,
      // same key — invalidation covers the manage surface too.
    },
  })
}

/**
 * Change a member's role. Invalidates the members list + the
 * profile (so the caller's `callerRole` flips after a
 * self-promotion).
 */
export function useSetMemberRole(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; role: ClanRole }) =>
      setMemberRole(slug, input.userId, input.role),
    onSettled: () => invalidateClan(qc, slug),
  })
}

/**
 * Remove a member from the clan. Same invalidation posture as
 * `useSetMemberRole`.
 */
export function useRemoveMember(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => removeMember(slug, userId),
    onSettled: () => invalidateClan(qc, slug),
  })
}

/**
 * Invite a player to the clan. Invalidates the members list (so
 * the row appears) and the sent-invites cache.
 */
export function useInviteMember(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invitedUserId: string) => inviteMember(slug, invitedUserId),
    onSettled: () => {
      invalidateClan(qc, slug)
      void qc.invalidateQueries({ queryKey: ['clan', 'invites-i-sent'] })
    },
  })
}

/**
 * Approve or deny a pending application. Invalidates the
 * applications list, the members list (on approve), and the
 * profile (so the count refreshes).
 */
export function useDecideApplication(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      applicationId: string
      decision: 'approved' | 'denied'
    }) => decideApplication(input.applicationId, input.decision),
    onSettled: () => {
      invalidateClan(qc, slug)
      void qc.invalidateQueries({ queryKey: ['clan', 'applications', slug] })
      void qc.invalidateQueries({
        queryKey: ['clan', 'applications-count', slug],
      })
    },
  })
}

/**
 * Accept an invite addressed to the caller. Invalidates
 * invites-for-me + profile (so the membership appears).
 */
export function useAcceptInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) => acceptInvite(inviteId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['clan', 'invites-for-me'] })
      void qc.invalidateQueries({ queryKey: ['clan', 'invites-i-sent'] })
      void qc.invalidateQueries({ queryKey: ['clan'] })
    },
  })
}

/**
 * Decline an invite addressed to the caller. Invalidates
 * invites-for-me.
 */
export function useDeclineInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) => declineInvite(inviteId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['clan', 'invites-for-me'] })
    },
  })
}

/**
 * Cancel an invite the caller issued. Invalidates invites-i-sent.
 */
export function useCancelInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) => cancelInvite(inviteId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['clan', 'invites-i-sent'] })
    },
  })
}

/**
 * Presign + upload a clan avatar / cover asset. Returns the
 * `objectKey` the caller hands to `useUpdateClan` to commit the
 * change. Does NOT invalidate anything on its own — the consumer
 * wires `updateClan` immediately after.
 */
export function useUploadClanAsset() {
  return useMutation({
    mutationFn: async (input: {
      kind: 'clan-avatar' | 'clan-cover'
      clanId: string
      blob: Blob
      filename: string
    }) => {
      const presigned = await presignClanAsset({
        kind: input.kind,
        clanId: input.clanId,
        filename: input.filename,
        contentType: input.blob.type || 'application/octet-stream',
        contentLength: input.blob.size,
      })
      return uploadClanAsset(presigned, input.blob)
    },
  })
}

// Re-export the manage-page types so consumers can `import` them
// from a single hook surface (matches the pattern of the existing
// reads above).
export type {
  ClanApplication,
  ClanInviteForMe,
  ClanSentInvite,
  JoinQuestion,
} from '@/lib/clan'
