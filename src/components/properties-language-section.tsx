import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_LOCALE_TAG,
  KNOWN_LOCALES,
  flagUrl,
  type GameLocale,
  type GameLocaleTag,
} from '@/lib/game-locales'

/**
 * Properties pane for the in-game language. Renders a single Select
 * of the H1Z1-supported locales (each with its flag via [FlagsAPI](https://flagsapi.com/))
 * and writes the choice through to `LauncherConfig.locale` immediately
 * on selection — no explicit Save button.
 *
 * The flag images are loaded from `flagsapi.com` over HTTPS — this
 * is the service the project uses for country flag artwork. If the
 * host is unreachable the flag just doesn't render (the locale name
 * still shows), so a network hiccup won't break the picker.
 *
 * We auto-persist on change (rather than waiting for an explicit
 * Save click) because the value is otherwise easy to lose: if the
 * user picks a language, navigates away to Play, and clicks Launch,
 * a separate Save step would silently drop the change. The Select
 * is a one-click control — there are no intermediate keystrokes
 * that justify a Save button (the Wine section still needs one
 * because it has free-form text fields).
 *
 * If the write fails we surface the error inline but leave the
 * dropdown at the user's chosen value so they can retry — the
 * in-memory selection is what they asked for, even if disk write
 * hasn't caught up yet.
 */
export function LanguageSection() {
  const { t } = useTranslation()
  const [locale, setLocale] = useState<GameLocaleTag>(DEFAULT_LOCALE_TAG)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hydrate the picker once on mount. We treat the Rust default
  // (`en_us`) as the in-memory default too so the UI is never
  // blank while the IPC round-trip is in flight.
  useEffect(() => {
    let cancelled = false
    window.launcherAPI
      .getLocale()
      .then((tag) => {
        if (cancelled) return
        setLocale(isKnown(tag) ? (tag as GameLocaleTag) : DEFAULT_LOCALE_TAG)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Don't blow up the section for a read error — fall back
        // to the default and surface the reason inline so the user
        // can still try to change the locale.
        setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleChange = (value: string) => {
    const tag = value as GameLocaleTag
    setLocale(tag)
    // Persist immediately. We don't gate on `loaded` because the
    // user can interact with the dropdown the moment it paints —
    // a stale-but-true "saved" value is fine; the IPC rejects
    // unknown tags and we surface the error inline below.
    setError(null)
    void window.launcherAPI
      .setLocale(tag)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Languages className="mt-0.5 size-5 text-muted-foreground" />
          <div className="space-y-1">
            <Label htmlFor="game-locale">{t('properties.language')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('properties.languageDescription')}
            </p>
          </div>
        </div>

        <Select
          value={locale}
          onValueChange={handleChange}
          disabled={!loaded}
        >
          <SelectTrigger id="game-locale" className="w-full">
            <SelectValue placeholder={t('properties.languagePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {KNOWN_LOCALES.map((entry) => (
              <LocaleOption key={entry.tag} entry={entry} />
            ))}
          </SelectContent>
        </Select>

        {error ? (
          <p className="text-xs text-destructive">
            {t('properties.languageSaveFailed', { error })}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One row in the language Select. Renders the flag (24×16 px, with
 * the country code as `alt` text for screen readers) next to the
 * localised language name. The tag (e.g. `de_de`) is intentionally
 * not shown — the picker surfaces flag + name only, since the tag
 * is implementation detail, not something the user needs to read.
 *
 * The flag image is decorative — the accessible name is the
 * language label, not the country.
 */
function LocaleOption({ entry }: { entry: GameLocale }) {
  return (
    <SelectItem value={entry.tag}>
      <span className="flex items-center gap-2">
        <img
          src={flagUrl(entry.country)}
          alt=""
          aria-hidden
          width={24}
          height={16}
          // `h-4 w-6` matches the 24×16 FlagsAPI size — keeps the
          // dropdown rows visually consistent without trusting the
          // image's intrinsic dimensions alone.
          className="h-4 w-6 shrink-0 rounded-sm object-cover ring-1 ring-border"
          loading="lazy"
          draggable={false}
        />
        <span>{entry.displayName}</span>
      </span>
    </SelectItem>
  )
}

/** Narrow a Rust-returned string to our tag union. */
function isKnown(tag: string): tag is GameLocaleTag {
  return KNOWN_LOCALES.some((l) => l.tag === tag)
}
