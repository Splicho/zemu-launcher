/**
 * Canonical list of locales the H1Z1 game exe accepts via its
 * `[Internationalization] Locale=` block in `ClientConfig.ini`.
 *
 * Trimmed to the eight languages this client actually ships text for:
 * English, French, German, Spanish (Spain), Korean, Portuguese (Brazil),
 * Russian and Simplified Chinese. The other tags the exe understands
 * (Italian, Turkish, Polish, Traditional Chinese, Japanese) were removed from
 * the picker — they loaded untranslated or with broken glyph tables.
 *
 * The Rust side enforces the exact same set in `commands.rs`
 * (`SUPPORTED_LAUNCHER_LOCALES`). If you add or remove a tag here, mirror the
 * change there — the renderer surfaces the picker, but the Rust command
 * rejects unknown values, so they need to stay in lockstep.
 *
 * `tag` is the lowercase `xx_yy` string passed to the exe. `country` is the
 * upper-case ISO-3166-1 alpha-2 code the FlagsAPI image URLs use, so we can
 * show a small flag next to each option. `displayName` is the user-facing
 * label (the language name itself, rendered in the locale's native form
 * where it's recognisable — e.g. `Português (Brasil)`).
 */
export type GameLocaleTag =
  | 'en_us'
  | 'fr_fr'
  | 'de_de'
  | 'es_es'
  | 'ko_kr'
  | 'pt_br'
  | 'ru_ru'
  | 'zh_cn'

export interface GameLocale {
  tag: GameLocaleTag
  country: string
  displayName: string
}

export const KNOWN_LOCALES: ReadonlyArray<GameLocale> = [
  { tag: 'en_us', country: 'US', displayName: 'English (US)' },
  { tag: 'fr_fr', country: 'FR', displayName: 'Français' },
  { tag: 'de_de', country: 'DE', displayName: 'Deutsch' },
  { tag: 'es_es', country: 'ES', displayName: 'Español' },
  { tag: 'ko_kr', country: 'KR', displayName: '한국어' },
  { tag: 'pt_br', country: 'BR', displayName: 'Português (Brasil)' },
  { tag: 'ru_ru', country: 'RU', displayName: 'Русский' },
  { tag: 'zh_cn', country: 'CN', displayName: '简体中文' },
]

/** Default tag the Rust side also falls back to. */
export const DEFAULT_LOCALE_TAG: GameLocaleTag = 'en_us'

/** Build the FlagsAPI image URL for a given country code. */
export function flagUrl(country: string, size = 24): string {
  return `https://flagsapi.com/${country}/flat/${size}.png`
}

/** Find the locale record for a tag, returning a sensible default if unknown. */
export function localeByTag(tag: string | null | undefined): GameLocale {
  if (tag) {
    const match = KNOWN_LOCALES.find((l) => l.tag === tag)
    if (match) return match
  }
  // Fall back to the default record rather than returning `undefined` —
  // callers can rely on this being safe to render.
  const fallback = KNOWN_LOCALES.find((l) => l.tag === DEFAULT_LOCALE_TAG)
  // `KNOWN_LOCALES` always contains the default, so this is a true
  // invariant, not a runtime fallback. The unwrap keeps the signature
  // clean for callers.
  return fallback!
}
