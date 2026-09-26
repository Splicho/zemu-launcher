import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  CLANTAG_MAX,
  CLANTAG_MIN,
  CLAN_NAME_MAX,
  CLAN_NAME_MIN,
  type ClanProfile,
  type ClanRole,
  type JoinQuestion,
} from '@/lib/clan'
import { useHashRouter } from '@/hooks/use-hash'
import { useAuthContext } from '@/contexts/auth-context'
import {
  useAcceptInvite,
  useCancelInvite,
  useClanApplications,
  useClanApplicationsCount,
  useClanMembers,
  useClanProfile,
  useDeclineInvite,
  useDecideApplication,
  useInviteMember,
  useInvitesForMe,
  useInvitesISent,
  useRemoveMember,
  useSetMemberRole,
  useUpdateClan,
  useUploadClanAsset,
  type ClanApplication,
  type ClanInviteForMe,
  type ClanSentInvite,
} from '@/hooks/use-clan'
import { httpFetch } from '@/lib/http-fetch'
import { CLAN_API_BASE } from '@/lib/clan'

/**
 * Manage page — mounted at `#/clan/<slug>/manage`.
 *
 * Mirrors the website's `/settings/clans/[clanId]/edit` 1:1:
 *
 *   Tabs (line variant, matching the website's "underline"):
 *     1. Identity    — name + clantag
 *     2. Branding    — cover + avatar with R2-presigned uploads
 *     3. Members     — sortable roster, role select, remove action,
 *                      invite-member dialog
 *     4. Join        — visibility toggle + per-clan join questions
 *                      editor
 *     5. Requests    — pending applications queue (badge =
 *                      pendingApplicationsCount)
 *     6. Invites     — pending invites for me + invites I've sent
 *                      (cross-clan)
 *     7. About       — description textarea
 *
 *   Gate: `clan.callerRole` must be `leader` or `officer`. Otherwise
 *   we show a 403-style empty state (member) or a sign-in prompt
 *   (anonymous) and stop rendering the tabs.
 *
 *   Hash-routed + Tauri-friendly. Image cropping uses a small
 *   `<canvas>`-based wrapper (no `react-image-crop` dependency) —
 *   the same `useUploadClanAsset` hook drives both the cover and
 *   the avatar upload.
 */
export function ClanManagePage({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const { navigate } = useHashRouter()
  const { status } = useAuthContext()
  const decoded = decodeURIComponent(slug)
  const clanQuery = useClanProfile(decoded)
  const clan: ClanProfile | null | undefined = clanQuery.data
  const isLoading = clanQuery.isLoading

  if (status !== 'authed') {
    return (
      <ManageShell
        title={t('clanManage.title')}
        onBack={() => navigate(`/clan/${encodeURIComponent(decoded)}`)}
      >
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('clanManage.signInRequired')}</EmptyTitle>
            <EmptyDescription>
              {t('clanManage.signInRequiredDesc')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ManageShell>
    )
  }

  if (isLoading) {
    return (
      <ManageShell
        title={t('clanManage.title')}
        onBack={() => navigate(`/clan/${encodeURIComponent(decoded)}`)}
      >
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
      </ManageShell>
    )
  }

  if (!clan) {
    return (
      <ManageShell
        title={t('clanManage.title')}
        onBack={() => navigate(`/clan/${encodeURIComponent(decoded)}`)}
      >
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('clan.notFound')}</EmptyTitle>
            <EmptyDescription>
              {t('clan.notFoundDesc', { slug: decoded })}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ManageShell>
    )
  }

  const role = clan.callerRole ?? null
  if (role !== 'leader' && role !== 'officer') {
    return (
      <ManageShell
        title={t('clanManage.title')}
        onBack={() => navigate(`/clan/${encodeURIComponent(decoded)}`)}
      >
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('clanManage.onlyLeadersOfficers')}</EmptyTitle>
            <EmptyDescription>
              {t('clanManage.onlyLeadersOfficersDesc')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ManageShell>
    )
  }

  return <ClanManageClient clan={clan} />
}

/**
 * Common chrome (back button + page title) shared by every
 * branch of the gate above. Keeps the empty / loading states
 * visually consistent with the main client.
 */
function ManageShell({
  title,
  onBack,
  children,
}: {
  title: string
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-8 py-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {title}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-4">
        <div className="flex flex-col gap-6">{children}</div>
      </div>
    </div>
  )
}

/**
 * Loaded manage page. Renders the 7-tab shell, parallel-fetches
 * the supporting data (members / applications / invites), and
 * hands each tab its own narrow subset.
 */
function ClanManageClient({ clan }: { clan: ClanProfile }) {
  const { t } = useTranslation()
  const membersQuery = useClanMembers(clan.slug)
  const applicationsQuery = useClanApplications(clan.slug)
  const applicationsCountQuery = useClanApplicationsCount(clan.slug)
  const invitesForMeQuery = useInvitesForMe()
  const invitesISentQuery = useInvitesISent()

  const role = (clan.callerRole ?? 'member') as ClanRole
  const isLeader = role === 'leader'

  const requestsCount = applicationsCountQuery.data ?? 0
  const invitesCount =
    (invitesForMeQuery.data?.length ?? 0) +
    (invitesISentQuery.data?.length ?? 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{clan.name}</h1>
        <p className="text-sm text-muted-foreground">{t('clanManage.subtitle')}</p>
      </div>

      <Tabs defaultValue="identity" className="flex flex-col gap-6">
        <TabsList variant="line">
          <TabsTrigger value="identity">{t('clanManage.tabs.identity')}</TabsTrigger>
          <TabsTrigger value="branding">{t('clanManage.tabs.branding')}</TabsTrigger>
          <TabsTrigger value="members">{t('clanManage.tabs.members')}</TabsTrigger>
          <TabsTrigger value="join">{t('clanManage.tabs.join')}</TabsTrigger>
          <TabsTrigger value="requests" className="flex items-center gap-2">
            {t('clanManage.tabs.requests')}
            {requestsCount > 0 ? (
              <Badge variant="secondary">{requestsCount}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="invites" className="flex items-center gap-2">
            {t('clanManage.tabs.invites')}
            {invitesCount > 0 ? (
              <Badge variant="secondary">{invitesCount}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="about">{t('clanManage.tabs.about')}</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <IdentityTab clan={clan} />
        </TabsContent>
        <TabsContent value="branding">
          <BrandingTab clan={clan} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab
            clan={clan}
            isLeader={isLeader}
            members={membersQuery.data?.rows ?? []}
            isLoading={membersQuery.isLoading}
          />
        </TabsContent>
        <TabsContent value="join">
          <JoinTab clan={clan} />
        </TabsContent>
        <TabsContent value="requests">
          <RequestsTab
            clan={clan}
            applications={applicationsQuery.data ?? []}
            isLoading={applicationsQuery.isLoading}
          />
        </TabsContent>
        <TabsContent value="invites">
          <InvitesTab
            invitesForMe={invitesForMeQuery.data ?? []}
            invitesISent={invitesISentQuery.data ?? []}
            isLoading={
              invitesForMeQuery.isLoading || invitesISentQuery.isLoading
            }
          />
        </TabsContent>
        <TabsContent value="about">
          <AboutTab clan={clan} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Identity tab ────────────────────────────────────────────────────────

function IdentityTab({ clan }: { clan: ClanProfile }) {
  const { t } = useTranslation()
  const [name, setName] = useState(clan.name)
  const [clantag, setClantag] = useState(clan.clantag)
  const update = useUpdateClan(clan.slug)

  useEffect(() => {
    setName(clan.name)
    setClantag(clan.clantag)
  }, [clan.name, clan.clantag])

  const nameError = useMemo(() => {
    if (name.length < CLAN_NAME_MIN) return t('clanManage.nameTooShort', { min: CLAN_NAME_MIN })
    if (name.length > CLAN_NAME_MAX) return t('clanManage.nameTooLong', { max: CLAN_NAME_MAX })
    return null
  }, [name, t])
  const tagError = useMemo(() => {
    if (clantag.length < CLANTAG_MIN) return t('clanManage.tagTooShort', { min: CLANTAG_MIN })
    if (clantag.length > CLANTAG_MAX) return t('clanManage.tagTooLong', { max: CLANTAG_MAX })
    if (!/^[A-Za-z0-9]+$/.test(clantag)) return t('clanManage.tagInvalid')
    return null
  }, [clantag, t])

  const dirty =
    name.trim() !== clan.name || clantag.trim().toUpperCase() !== clan.clantag
  const canSave = dirty && !nameError && !tagError && !update.isPending

  const onSave = async () => {
    try {
      await update.mutateAsync({
        name: name.trim(),
        clantag: clantag.trim().toUpperCase(),
      })
      toast.success(t('clanManage.identitySaved'))
    } catch (err) {
      toast.error(t('clanManage.saveError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('clanManage.tabs.identity')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="clan-name">{t('clanManage.nameLabel')}</Label>
          <Input
            id="clan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={CLAN_NAME_MAX}
            aria-invalid={nameError !== null}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{nameError ?? ''}</span>
            <span>
              {name.length}/{CLAN_NAME_MAX}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="clan-tag">{t('clanManage.tagLabel')}</Label>
          <Input
            id="clan-tag"
            value={clantag}
            onChange={(e) => setClantag(e.target.value.toUpperCase())}
            maxLength={CLANTAG_MAX}
            aria-invalid={tagError !== null}
            className="uppercase"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{tagError ?? ''}</span>
            <span>
              {clantag.length}/{CLANTAG_MAX}
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canSave}>
            {update.isPending ? (
              <Spinner className="size-4" />
            ) : (
              t('clanManage.saveChanges')
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Branding tab ────────────────────────────────────────────────────────

function BrandingTab({ clan }: { clan: ClanProfile }) {
  const { t } = useTranslation()
  const update = useUpdateClan(clan.slug)
  const upload = useUploadClanAsset()
  const [avatarKey, setAvatarKey] = useState<string | null>(clan.avatarUrl)
  const [coverKey, setCoverKey] = useState<string | null>(clan.coverImageUrl)
  const [touched, setTouched] = useState(false)
  const [cropping, setCropping] = useState<'clan-avatar' | 'clan-cover' | null>(
    null,
  )

  useEffect(() => {
    setAvatarKey(clan.avatarUrl)
    setCoverKey(clan.coverImageUrl)
    setTouched(false)
  }, [clan.avatarUrl, clan.coverImageUrl])

  const avatarChanged = avatarKey !== clan.avatarUrl
  const coverChanged = coverKey !== clan.coverImageUrl
  const dirty = touched && (avatarChanged || coverChanged)
  const canSave = dirty && !update.isPending && !upload.isPending

  const onUpload = async (
    kind: 'clan-avatar' | 'clan-cover',
    blob: Blob,
    filename: string,
  ) => {
    try {
      const objectKey = await upload.mutateAsync({
        kind,
        clanId: clan.id,
        blob,
        filename,
      })
      // The objectKey is a path like
      // `clans/avatars/<id>/<hash>.png` — store it in local state,
      // commit via `updateClan` on Save.
      if (kind === 'clan-avatar') {
        setAvatarKey(objectKey)
      } else {
        setCoverKey(objectKey)
      }
      setTouched(true)
      setCropping(null)
    } catch (err) {
      toast.error(t('clanManage.uploadError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const onSave = async () => {
    try {
      await update.mutateAsync({
        avatarObjectKey: avatarChanged ? avatarKey : undefined,
        coverObjectKey: coverChanged ? coverKey : undefined,
      })
      toast.success(t('clanManage.brandingSaved'))
      setTouched(false)
    } catch (err) {
      toast.error(t('clanManage.saveError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const removeAvatar = () => {
    setAvatarKey(null)
    setTouched(true)
  }
  const removeCover = () => {
    setCoverKey(null)
    setTouched(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('clanManage.tabs.branding')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <BrandingSlot
          label={t('clanManage.coverLabel')}
          hint={t('clanManage.coverHint')}
          imageUrl={coverKey}
          aspect="21 / 9"
          onChange={() => setCropping('clan-cover')}
          onRemove={coverKey ? removeCover : null}
          empty={
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-8" />
            </div>
          }
        />
        <BrandingSlot
          label={t('clanManage.avatarLabel')}
          hint={t('clanManage.avatarHint')}
          imageUrl={avatarKey}
          aspect="1 / 1"
          rounded
          onChange={() => setCropping('clan-avatar')}
          onRemove={avatarKey ? removeAvatar : null}
          empty={
            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground">
              {clan.clantag.charAt(0).toUpperCase()}
            </div>
          }
        />
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canSave}>
            {update.isPending || upload.isPending ? (
              <Spinner className="size-4" />
            ) : (
              t('clanManage.saveChanges')
            )}
          </Button>
        </div>
      </CardContent>
      {cropping ? (
        <ImageCropperDialog
          kind={cropping}
          onClose={() => setCropping(null)}
          onConfirm={(blob, filename) => onUpload(cropping, blob, filename)}
        />
      ) : null}
    </Card>
  )
}

function BrandingSlot({
  label,
  hint,
  imageUrl,
  aspect,
  rounded,
  onChange,
  onRemove,
  empty,
}: {
  label: string
  hint: string
  imageUrl: string | null
  aspect: string
  rounded?: boolean
  onChange: () => void
  onRemove: (() => void) | null
  empty: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <button
        type="button"
        onClick={onChange}
        className={`group relative flex w-full overflow-hidden border border-dashed border-border bg-muted/30 transition-colors hover:bg-muted/50 ${
          rounded ? 'rounded-2xl' : 'rounded-md'
        }`}
        style={{ aspectRatio: aspect }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={label}
            className={`h-full w-full object-cover ${rounded ? 'rounded-2xl' : ''}`}
          />
        ) : (
          empty
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Camera className="mr-2 size-4" />
          {imageUrl ? t('clanManage.change') : t('clanManage.upload')}
        </div>
      </button>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{hint}</span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-destructive hover:underline"
          >
            {t('clanManage.remove')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Tiny canvas-based image cropper — drop-in replacement for
 * `react-image-crop`. We don't pull a heavy dep into the Tauri
 * webview; the simple "fit + centre" auto-crop is good enough for
 * the avatar (square) and cover (21:9) aspect ratios and keeps
 * the bundle small.
 */
function ImageCropperDialog({
  kind,
  onClose,
  onConfirm,
}: {
  kind: 'clan-avatar' | 'clan-cover'
  onClose: () => void
  onConfirm: (blob: Blob, filename: string) => void
}) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [cropping, setCropping] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const aspect = kind === 'clan-avatar' ? 1 : 21 / 9

  const confirm = async () => {
    if (!file || !preview) return
    setCropping(true)
    try {
      const blob = await autoCropToBlob(preview, aspect)
      onConfirm(blob, file.name)
    } catch (err) {
      toast.error(t('clanManage.cropError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setCropping(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === 'clan-avatar'
              ? t('clanManage.cropAvatar')
              : t('clanManage.cropCover')}
          </DialogTitle>
          <DialogDescription>{t('clanManage.cropDesc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {preview ? (
            <div
              className="overflow-hidden rounded-md border border-border bg-muted/30"
              style={{ aspectRatio: aspect }}
            >
              <img
                src={preview}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('clanManage.cancel')}
          </Button>
          <Button onClick={confirm} disabled={!file || cropping}>
            {cropping ? <Spinner className="size-4" /> : t('clanManage.confirmCrop')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

async function autoCropToBlob(
  imageUrl: string,
  aspect: number,
): Promise<Blob> {
  const img = await loadImage(imageUrl)
  const sourceAspect = img.width / img.height
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height
  if (sourceAspect > aspect) {
    // Source is wider — crop the sides.
    sw = img.height * aspect
    sx = (img.width - sw) / 2
  } else if (sourceAspect < aspect) {
    // Source is taller — crop the top/bottom.
    sh = img.width / aspect
    sy = (img.height - sh) / 2
  }
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable.')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas export failed.'))
      },
      'image/png',
      0.92,
    )
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image.'))
    img.crossOrigin = 'anonymous'
    img.src = src
  })
}

// ─── Members tab ─────────────────────────────────────────────────────────

type MemberRow = {
  userId: string
  displayName: string | null
  avatarUrl: string | null
  role: ClanRole
  joinedAt: string
}

function MembersTab({
  clan,
  isLeader,
  members,
  isLoading,
}: {
  clan: ClanProfile
  isLeader: boolean
  members: MemberRow[]
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [inviting, setInviting] = useState(false)
  const removeMember = useRemoveMember(clan.slug)
  const setMemberRole = useSetMemberRole(clan.slug)

  const filtered = useMemo(() => {
    if (!query.trim()) return members
    const q = query.trim().toLowerCase()
    return members.filter((m) =>
      (m.displayName ?? '').toLowerCase().includes(q),
    )
  }, [members, query])

  const onRemove = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId)
      toast.success(t('clanManage.memberRemoved'))
    } catch (err) {
      toast.error(t('clanManage.removeError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const onRoleChange = async (userId: string, role: ClanRole) => {
    try {
      await setMemberRole.mutateAsync({ userId, role })
      toast.success(t('clanManage.roleChanged'))
    } catch (err) {
      toast.error(t('clanManage.roleError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t('clanManage.tabs.members')}</CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setInviting(true)}
        >
          <Plus className="size-4" />
          {t('clanManage.inviteMember')}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('clanManage.searchMembers')}
            className="pl-9 pr-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('clanManage.clearSearch')}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : filtered.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('clanManage.noMembers')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('clanManage.memberCol')}</TableHead>
                <TableHead>{t('clanManage.roleCol')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-8">
                        {m.avatarUrl ? (
                          <AvatarImage src={m.avatarUrl} alt={m.displayName ?? ''} />
                        ) : null}
                        <AvatarFallback>
                          {(m.displayName ?? '?').charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate font-medium">
                        {m.displayName ?? t('clanManage.unknownPlayer')}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isLeader && m.userId !== clan.createdByUserId ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => onRoleChange(m.userId, v as ClanRole)}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="leader">
                            {t('clanManage.roleLeader')}
                          </SelectItem>
                          <SelectItem value="officer">
                            {t('clanManage.roleOfficer')}
                          </SelectItem>
                          <SelectItem value="member">
                            {t('clanManage.roleMember')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{labelForRole(m.role, t)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isLeader && m.userId !== clan.createdByUserId ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('clanManage.moreActions')}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <RemoveMemberItem
                            memberName={m.displayName ?? t('clanManage.unknownPlayer')}
                            onConfirm={() => onRemove(m.userId)}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {inviting ? (
        <InviteMemberDialog
          clan={clan}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </Card>
  )
}

function labelForRole(
  role: ClanRole,
  t: (k: string, options?: Record<string, unknown>) => string,
): string {
  switch (role) {
    case 'leader':
      return t('clanManage.roleLeader')
    case 'officer':
      return t('clanManage.roleOfficer')
    case 'member':
      return t('clanManage.roleMember')
  }
}

function RemoveMemberItem({
  memberName,
  onConfirm,
}: {
  memberName: string
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 size-4" />
        {t('clanManage.removeMember')}
      </DropdownMenuItem>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('clanManage.removeMemberTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('clanManage.removeMemberDesc', { name: memberName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('clanManage.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>
              {t('clanManage.confirmRemove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function InviteMemberDialog({
  clan,
  onClose,
}: {
  clan: ClanProfile
  onClose: () => void
}) {
  const { t } = useTranslation()
  const invite = useInviteMember(clan.slug)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Array<{ id: string; displayName: string | null; avatarUrl: string | null }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (query.trim().length === 0) {
      setHits([])
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const url = `${CLAN_API_BASE}/search-users?q=${encodeURIComponent(query.trim())}`
        const res = await httpFetch(url, { headers: { Accept: 'application/json' } })
        if (cancelled) return
        if (!res.ok) {
          setHits([])
          return
        }
        const body = (await res.json()) as { users: typeof hits }
        setHits(body.users ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const onPick = async (userId: string) => {
    try {
      await invite.mutateAsync(userId)
      toast.success(t('clanManage.inviteSent'))
      onClose()
    } catch (err) {
      toast.error(t('clanManage.inviteError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clanManage.inviteMember')}</DialogTitle>
          <DialogDescription>{t('clanManage.inviteMemberDesc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('clanManage.inviteSearchPlaceholder')}
            autoFocus
          />
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <Skeleton className="m-2 h-8" />
            ) : hits.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {query.trim().length === 0
                  ? t('clanManage.inviteStartTyping')
                  : t('clanManage.inviteNoResults')}
              </p>
            ) : (
              hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onPick(h.id)}
                  className="flex items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                >
                  <Avatar className="size-8">
                    {h.avatarUrl ? (
                      <AvatarImage src={h.avatarUrl} alt={h.displayName ?? ''} />
                    ) : null}
                    <AvatarFallback>
                      {(h.displayName ?? '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm font-medium">
                    {h.displayName ?? t('clanManage.unknownPlayer')}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('clanManage.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Join tab ────────────────────────────────────────────────────────────

const JOIN_QUESTION_TYPES = ['text', 'textarea'] as const

const JOIN_QUESTIONS_MAX = 10
const JOIN_QUESTION_LABEL_MAX = 80
const JOIN_QUESTION_PLACEHOLDER_MAX = 80
const JOIN_QUESTION_TEXT_DEFAULT_MAX_LENGTH = 200
const JOIN_QUESTION_TEXTAREA_DEFAULT_MAX_LENGTH = 1000
const JOIN_QUESTION_TEXT_MAX_LENGTH_MAX = 500
const JOIN_QUESTION_TEXTAREA_MAX_LENGTH_MAX = 4000

function JoinTab({ clan }: { clan: ClanProfile }) {
  const { t } = useTranslation()
  const update = useUpdateClan(clan.slug)
  const [isPrivate, setIsPrivate] = useState(clan.isPrivate)
  const [questions, setQuestions] = useState<JoinQuestion[]>(
    clan.joinQuestions ?? [],
  )
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setIsPrivate(clan.isPrivate)
    setQuestions(clan.joinQuestions ?? [])
    setTouched(false)
  }, [clan.isPrivate, clan.joinQuestions])

  const dirty =
    touched && (isPrivate !== clan.isPrivate || questions !== clan.joinQuestions)
  const canSave = dirty && !update.isPending

  const addQuestion = () => {
    if (questions.length >= JOIN_QUESTIONS_MAX) return
    setQuestions((qs) => [
      ...qs,
      {
        id: crypto.randomUUID(),
        label: '',
        type: 'text',
        required: false,
        maxLength: JOIN_QUESTION_TEXT_DEFAULT_MAX_LENGTH,
        placeholder: null,
      },
    ])
    setTouched(true)
  }

  const removeQuestion = (id: string) => {
    setQuestions((qs) => qs.filter((q) => q.id !== id))
    setTouched(true)
  }

  const moveQuestion = (id: string, direction: -1 | 1) => {
    setQuestions((qs) => {
      const idx = qs.findIndex((q) => q.id === id)
      if (idx < 0) return qs
      const target = idx + direction
      if (target < 0 || target >= qs.length) return qs
      const copy = qs.slice()
      const [item] = copy.splice(idx, 1)
      copy.splice(target, 0, item!)
      return copy
    })
    setTouched(true)
  }

  const updateQuestion = (id: string, patch: Partial<JoinQuestion>) => {
    setQuestions((qs) =>
      qs.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    )
    setTouched(true)
  }

  const onSave = async () => {
    try {
      await update.mutateAsync({
        isPrivate,
        joinQuestions: questions,
      })
      toast.success(t('clanManage.joinSaved'))
      setTouched(false)
    } catch (err) {
      toast.error(t('clanManage.saveError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('clanManage.tabs.join')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label>{t('clanManage.visibilityLabel')}</Label>
          <Select
            value={isPrivate ? 'private' : 'public'}
            onValueChange={(v) => {
              setIsPrivate(v === 'private')
              setTouched(true)
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">{t('clanManage.visibilityPublic')}</SelectItem>
              <SelectItem value="private">{t('clanManage.visibilityPrivate')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('clanManage.visibilityHint')}
          </p>
        </div>
        <Separator />
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label>{t('clanManage.questionsLabel')}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addQuestion}
              disabled={questions.length >= JOIN_QUESTIONS_MAX}
              className="gap-2"
            >
              <Plus className="size-4" />
              {t('clanManage.addQuestion')}
            </Button>
          </div>
          {questions.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('clanManage.noQuestions')}</EmptyTitle>
                <EmptyDescription>{t('clanManage.noQuestionsDesc')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {questions.map((q, idx) => (
                <QuestionEditor
                  key={q.id}
                  question={q}
                  index={idx}
                  total={questions.length}
                  onChange={(patch) => updateQuestion(q.id, patch)}
                  onRemove={() => removeQuestion(q.id)}
                  onMove={(dir) => moveQuestion(q.id, dir)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canSave}>
            {update.isPending ? <Spinner className="size-4" /> : t('clanManage.saveChanges')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function QuestionEditor({
  question,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  question: JoinQuestion
  index: number
  total: number
  onChange: (patch: Partial<JoinQuestion>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const { t } = useTranslation()
  const labelError =
    question.label.trim().length === 0
      ? t('clanManage.questionLabelRequired')
      : question.label.length > JOIN_QUESTION_LABEL_MAX
        ? t('clanManage.questionLabelTooLong', { max: JOIN_QUESTION_LABEL_MAX })
        : null
  const maxLen = question.type === 'text'
    ? JOIN_QUESTION_TEXT_MAX_LENGTH_MAX
    : JOIN_QUESTION_TEXTAREA_MAX_LENGTH_MAX
  const defaultMax = question.type === 'text'
    ? JOIN_QUESTION_TEXT_DEFAULT_MAX_LENGTH
    : JOIN_QUESTION_TEXTAREA_DEFAULT_MAX_LENGTH

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {t('clanManage.questionNumber', { n: index + 1 })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onMove(-1)}
              disabled={index === 0}
              aria-label={t('clanManage.moveUp')}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              aria-label={t('clanManage.moveDown')}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label={t('clanManage.removeQuestion')}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('clanManage.questionLabelField')}</Label>
          <Input
            value={question.label}
            onChange={(e) => onChange({ label: e.target.value })}
            maxLength={JOIN_QUESTION_LABEL_MAX}
            aria-invalid={labelError !== null}
          />
          {labelError ? (
            <p className="text-xs text-destructive">{labelError}</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t('clanManage.questionType')}</Label>
            <Select
              value={question.type}
              onValueChange={(v) => {
                const type = v as JoinQuestion['type']
                onChange({
                  type,
                  maxLength:
                    question.maxLength && question.maxLength <= maxLen
                      ? question.maxLength
                      : defaultMax,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
                <ChevronDown className="size-4 opacity-50" />
              </SelectTrigger>
              <SelectContent>
                {JOIN_QUESTION_TYPES.map((qt) => (
                  <SelectItem key={qt} value={qt}>
                    {qt === 'text' ? t('clanManage.questionTypeText') : t('clanManage.questionTypeTextarea')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('clanManage.questionMaxLength')}</Label>
            <Input
              type="number"
              min={1}
              max={maxLen}
              value={question.maxLength ?? defaultMax}
              onChange={(e) =>
                onChange({
                  maxLength: Math.min(maxLen, Number(e.target.value) || defaultMax),
                })
              }
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('clanManage.questionPlaceholder')}</Label>
          <Input
            value={question.placeholder ?? ''}
            onChange={(e) =>
              onChange({ placeholder: e.target.value.slice(0, JOIN_QUESTION_PLACEHOLDER_MAX) })
            }
            maxLength={JOIN_QUESTION_PLACEHOLDER_MAX}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`q-${question.id}-required`}
            checked={question.required}
            onCheckedChange={(checked) => onChange({ required: checked === true })}
          />
          <Label htmlFor={`q-${question.id}-required`} className="cursor-pointer">
            {t('clanManage.questionRequired')}
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Requests tab ────────────────────────────────────────────────────────

function RequestsTab({
  clan,
  applications,
  isLoading,
}: {
  clan: ClanProfile
  applications: ClanApplication[]
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const decide = useDecideApplication(clan.slug)

  const onDecide = async (
    applicationId: string,
    decision: 'approved' | 'denied',
  ) => {
    try {
      await decide.mutateAsync({ applicationId, decision })
      toast.success(
        decision === 'approved'
          ? t('clanManage.applicationApproved')
          : t('clanManage.applicationDenied'),
      )
    } catch (err) {
      toast.error(t('clanManage.decideError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (applications.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('clanManage.tabs.requests')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('clanManage.noApplications')}</EmptyTitle>
              <EmptyDescription>
                {t('clanManage.noApplicationsDesc')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    )
  }

  // Project the surviving answers against the clan's *current*
  // question schema. Stale question ids (a leader removed a
  // question between the application being submitted and now)
  // are silently dropped — matches the website's behaviour.
  const currentQuestionLabels = new Map(
    (clan.joinQuestions ?? []).map((q) => [q.id, q.label]),
  )

  return (
    <div className="flex flex-col gap-4">
      {applications.map((app) => (
        <ApplicationCard
          key={app.id}
          application={app}
          questionLabels={currentQuestionLabels}
          onDecide={onDecide}
        />
      ))}
    </div>
  )
}

function ApplicationCard({
  application,
  questionLabels,
  onDecide,
}: {
  application: ClanApplication
  questionLabels: Map<string, string>
  onDecide: (
    applicationId: string,
    decision: 'approved' | 'denied',
  ) => void
}) {
  const { t } = useTranslation()
  const [denyOpen, setDenyOpen] = useState(false)
  const survivingAnswers = Object.entries(application.answers).filter(
    ([id]) => questionLabels.has(id),
  )
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              {application.applicantAvatarUrl ? (
                <AvatarImage
                  src={application.applicantAvatarUrl}
                  alt={application.applicantDisplayName ?? ''}
                />
              ) : null}
              <AvatarFallback>
                {(application.applicantDisplayName ?? '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium">
                {application.applicantDisplayName ?? t('clanManage.unknownPlayer')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('clanManage.submittedAgo', {
                  when: formatRelative(application.createdAt, t),
                })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDenyOpen(true)}
              className="gap-2"
            >
              <X className="size-4" />
              {t('clanManage.deny')}
            </Button>
            <Button
              size="sm"
              onClick={() => onDecide(application.id, 'approved')}
              className="gap-2"
            >
              <Check className="size-4" />
              {t('clanManage.approve')}
            </Button>
          </div>
        </div>
        {survivingAnswers.length > 0 ? (
          <dl className="grid gap-2 text-sm">
            {survivingAnswers.map(([id, value]) => (
              <div key={id} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">
                  {questionLabels.get(id)}
                </dt>
                <dd className="whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </CardContent>
      <AlertDialog open={denyOpen} onOpenChange={setDenyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clanManage.denyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('clanManage.denyDesc', {
                name: application.applicantDisplayName ?? t('clanManage.unknownPlayer'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('clanManage.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setDenyOpen(false)
              onDecide(application.id, 'denied')
            }}>
              {t('clanManage.confirmDeny')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ─── Invites tab ─────────────────────────────────────────────────────────

function InvitesTab({
  invitesForMe,
  invitesISent,
  isLoading,
}: {
  invitesForMe: ClanInviteForMe[]
  invitesISent: ClanSentInvite[]
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const accept = useAcceptInvite()
  const decline = useDeclineInvite()
  const cancel = useCancelInvite()

  const onAccept = async (inviteId: string) => {
    try {
      await accept.mutateAsync(inviteId)
      toast.success(t('clanManage.inviteAccepted'))
    } catch (err) {
      toast.error(t('clanManage.inviteActionError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const onDecline = async (inviteId: string) => {
    try {
      await decline.mutateAsync(inviteId)
      toast.success(t('clanManage.inviteDeclined'))
    } catch (err) {
      toast.error(t('clanManage.inviteActionError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const onCancel = async (inviteId: string) => {
    try {
      await cancel.mutateAsync(inviteId)
      toast.success(t('clanManage.inviteCancelled'))
    } catch (err) {
      toast.error(t('clanManage.inviteActionError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('clanManage.invitesForMe')}</CardTitle>
        </CardHeader>
        <CardContent>
          {invitesForMe.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('clanManage.noInvitesForMe')}</EmptyTitle>
                <EmptyDescription>
                  {t('clanManage.noInvitesForMeDesc')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {invitesForMe.map((inv) => (
                <InviteForMeRow
                  key={inv.id}
                  invite={inv}
                  onAccept={onAccept}
                  onDecline={onDecline}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('clanManage.invitesISent')}</CardTitle>
        </CardHeader>
        <CardContent>
          {invitesISent.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('clanManage.noInvitesISent')}</EmptyTitle>
                <EmptyDescription>
                  {t('clanManage.noInvitesISentDesc')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {invitesISent.map((inv) => (
                <SentInviteRow
                  key={inv.id}
                  invite={inv}
                  onCancel={onCancel}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InviteForMeRow({
  invite,
  onAccept,
  onDecline,
}: {
  invite: ClanInviteForMe
  onAccept: (id: string) => void
  onDecline: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-10">
          {invite.clanAvatarUrl ? (
            <AvatarImage src={invite.clanAvatarUrl} alt={invite.clanName} />
          ) : null}
          <AvatarFallback>{invite.clanName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="font-medium">{invite.clanName}</span>
          <span className="text-xs text-muted-foreground">
            {invite.invitedByDisplayName ?? t('clanManage.unknownPlayer')}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDecline(invite.id)}
        >
          {t('clanManage.decline')}
        </Button>
        <Button size="sm" onClick={() => onAccept(invite.id)}>
          {t('clanManage.accept')}
        </Button>
      </div>
    </div>
  )
}

function SentInviteRow({
  invite,
  onCancel,
}: {
  invite: ClanSentInvite
  onCancel: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-10">
          {invite.invitedUserAvatarUrl ? (
            <AvatarImage src={invite.invitedUserAvatarUrl} alt={invite.invitedUserDisplayName ?? ''} />
          ) : null}
          <AvatarFallback>
            {(invite.invitedUserDisplayName ?? '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="font-medium">
            {invite.invitedUserDisplayName ?? t('clanManage.unknownPlayer')}
          </span>
          <span className="text-xs text-muted-foreground">{invite.clanName}</span>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => onCancel(invite.id)}>
        {t('clanManage.cancel')}
      </Button>
    </div>
  )
}

// ─── About tab ───────────────────────────────────────────────────────────

function AboutTab({ clan }: { clan: ClanProfile }) {
  const { t } = useTranslation()
  const [description, setDescription] = useState(clan.description ?? '')
  const update = useUpdateClan(clan.slug)
  const DESC_MAX = 2000

  useEffect(() => {
    setDescription(clan.description ?? '')
  }, [clan.description])

  const dirty = (description ?? '') !== (clan.description ?? '')
  const canSave = dirty && description.length <= DESC_MAX && !update.isPending

  const onSave = async () => {
    try {
      await update.mutateAsync({
        description: description.trim() === '' ? null : description.trim(),
      })
      toast.success(t('clanManage.aboutSaved'))
    } catch (err) {
      toast.error(t('clanManage.saveError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('clanManage.tabs.about')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="clan-description">{t('clanManage.descriptionLabel')}</Label>
          <Textarea
            id="clan-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            maxLength={DESC_MAX}
          />
          <div className="flex justify-end text-xs text-muted-foreground">
            {description.length}/{DESC_MAX}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canSave}>
            {update.isPending ? <Spinner className="size-4" /> : t('clanManage.saveChanges')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatRelative(iso: string, t: (k: string, options?: Record<string, unknown>) => string): string {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('clanManage.justNow')
  if (minutes < 60) return t('clanManage.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('clanManage.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  return t('clanManage.daysAgo', { n: days })
}
