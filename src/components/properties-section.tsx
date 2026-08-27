import { useEffect, useState } from 'react'
import { FolderInput, FolderOpen } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PROPERTIES_SECTIONS,
  type PropertiesSectionId,
} from '@/components/properties-sidebar'
import { LicenseSection } from '@/components/properties-license-section'
import { useLicenseContext } from '@/contexts/license-context'
import { formatBytes } from '@/lib/format'

interface PropertiesSectionProps {
  /** The currently active section. Drives both the heading and which
   *  body block to render. Unknown ids fall back to a placeholder. */
  activeId: PropertiesSectionId
  /** Absolute path to the user's chosen install folder, or null when
   *  no folder has been selected yet (or has been cleared). The
   *  Installed Files body needs this to compute size and locate. */
  gameDirectory: string | null
  /** Trigger the Steam-instructions-aware folder picker. Mirrors the
   *  sidebar's "Locate game files" handler so behavior is identical
   *  between the main install flow and the Properties entry point. */
  onChangeFolder: () => void
}

/**
 * Right pane of the Properties modal. A small switch dispatches per
 * section id — today `install` has a real body, `license` and any
 * future ids fall through to the shared placeholder. The dispatch
 * table makes adding bodies straightforward without touching the modal
 * shell or the rail.
 */
export function PropertiesSection({
  activeId,
  gameDirectory,
  onChangeFolder,
}: PropertiesSectionProps) {
  const activeLabel =
    PROPERTIES_SECTIONS.find((section) => section.id === activeId)
      // `install` is the first rail entry today, so it doubles as a
      // safe fallback if an unknown id ever sneaks through.
      ?.label ?? 'Installed Files'

  // `useLicenseContext` is called unconditionally so the rules of
  // hooks are satisfied. The license body itself only renders for
  // the `license` rail id; the hook's overhead is negligible on the
  // other branches.
  const license = useLicenseContext()

  return (
    <ScrollArea className="flex-1">
      <div className="p-6">
        {/* Heading bumped from text-sm to text-base so the section
          title reads as a peer of the now-larger rail links on the
          left instead of feeling undersized next to them. */}
        <h3 className="text-base font-medium text-foreground">
          {activeLabel}
        </h3>
        <Separator className="my-3" />

        {activeId === 'install' ? (
          <InstalledFilesSection
            gameDirectory={gameDirectory}
            onChangeFolder={onChangeFolder}
          />
        ) : activeId === 'license' ? (
          <LicenseSection
            status={license.status}
            record={license.record}
            redeemError={license.redeemError}
            revalidateError={license.revalidateError}
            isBinding={license.status === 'binding'}
            onRedeem={license.redeem}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Settings for this section will appear here. This is a
            placeholder while the section content is being designed.
          </p>
        )}
      </div>
    </ScrollArea>
  )
}

interface InstalledFilesSectionProps {
  gameDirectory: string | null
  onChangeFolder: () => void
}

/**
 * Body for the "Installed Files" rail entry. Shows the on-disk size
 * of whatever the user has in their chosen game folder (base game +
 * any patches + saves), plus a Locate button that opens the OS file
 * manager and a Change button that re-runs the folder picker.
 *
 * Size is recomputed every time this body mounts so users see a
 * fresh number if they drop new files in via the Steam instructions
 * flow between sessions.
 */
function InstalledFilesSection({
  gameDirectory,
  onChangeFolder,
}: InstalledFilesSectionProps) {
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  // Re-walk the folder on mount or whenever the path changes. Skipping
  // the fetch when gameDirectory is null lets the empty-state render
  // without an unnecessary round-trip.
  useEffect(() => {
    if (!gameDirectory) {
      setSizeBytes(null)
      setSizeError(null)
      return
    }
    let cancelled = false
    setSizeBytes(null)
    setSizeError(null)
    window.gameAPI
      .getFolderSize(gameDirectory)
      .then((bytes) => {
        if (!cancelled) setSizeBytes(bytes)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setSizeError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [gameDirectory])

  const handleBrowse = async () => {
    if (!gameDirectory) return
    setIsLocating(true)
    setLocateError(null)
    try {
      await window.gameAPI.openInFileManager(gameDirectory)
    } catch (error) {
      setLocateError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLocating(false)
    }
  }

  if (!gameDirectory) {
    return (
      <p className="text-sm text-muted-foreground">
        No installation folder has been selected yet. Use{' '}
        <span className="font-medium text-foreground">Change</span>{' '}
        below to pick one.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
        <dt className="text-muted-foreground">Size on disk</dt>
        <dd className="font-medium tabular-nums">
          {sizeError ? (
            <span className="font-normal text-destructive">
              Unable to calculate size
            </span>
          ) : sizeBytes === null ? (
            <Skeleton className="inline-block h-4 w-20 align-middle" />
          ) : (
            formatBytes(sizeBytes)
          )}
          {sizeError ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {sizeError}
            </span>
          ) : null}
        </dd>

        <dt className="text-muted-foreground">Location</dt>
        <dd
          className="truncate font-mono text-xs"
          title={gameDirectory}
        >
          {gameDirectory}
        </dd>
      </dl>

      {locateError ? (
        <p className="text-xs text-destructive">Browse failed: {locateError}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="gradient"
          onClick={() => {
            void handleBrowse()
          }}
          disabled={isLocating}
        >
          <FolderOpen />
          {/* Ellipsis follows the Windows convention for "opens
            something else" — here, the OS file manager. */}
          {isLocating ? 'Opening…' : 'Browse...'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onChangeFolder}
        >
          <FolderInput />
          Change
        </Button>
      </div>
    </div>
  )
}