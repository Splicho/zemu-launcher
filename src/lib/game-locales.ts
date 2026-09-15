/**
 * Canonical list of locales the H1Z1 game exe accepts via its
 * `[Internationalization] Locale=` block in `ClientConfig.ini`.
 *
 * The Rust side enforces the exact same set in `commands.rs`
 * (`SUPPORTED_LAUNCHER_LOCALES`). If you add or remove a tag here,
 * mirror the change there — the renderer surfaces the picker, but
 * the Rust command rejects unknown values, so they need to stay in
 * lockstep.
 *
 * `tag` is the lowercase `xx_yy` string passed to the exe. `country`
 * is the upper-case ISO-3166-1 alpha-2 code the [FlagsAPI](https://flagsapi.com/)
 * image URLs use, so we can show a small flag next to each option.
 * `displayName` is the user-facing label (the language name itself,
 * rendered in the locale's native form where it's recognisable —
 * e.g. `Português (Brasil)`, not `Brazilian Portuguese`).
 */
export type GameLocaleTag =
  | 'en_us'
  | 'de_de'
  | 'fr_fr'
  | 'es_es'
  | 'ru_ru'
  | 'pt_br'
  | 'it_it'
  | 'tr_tr'
  | 'pl_pl'
  | 'zh_cn'
  | 'zh_tw'
  | 'ja_jp'
  | 'ko_kr'

export interface GameLocale {
  tag: GameLocaleTag
  country: string
  displayName: string
}

export const KNOWN_LOCALES: ReadonlyArray<GameLocale> = [
  { tag: 'en_us', country: 'US', displayName: 'English (US)' },
  { tag: 'de_de', country: 'DE', displayName: 'Deutsch' },
  { tag: 'fr_fr', country: 'FR', displayName: 'Français' },
  { tag: 'es_es', country: 'ES', displayName: 'Español' },
  { tag: 'ru_ru', country: 'RU', displayName: 'Русский' },
  { tag: 'pt_br', country: 'BR', displayName: 'Português (Brasil)' },
  { tag: 'it_it', country: 'IT', displayName: 'Italiano' },
  { tag: 'tr_tr', country: 'TR', displayName: 'Türkçe' },
  { tag: 'pl_pl', country: 'PL', displayName: 'Polski' },
  { tag: 'zh_cn', country: 'CN', displayName: '简体中文' },
  { tag: 'zh_tw', country: 'TW', displayName: '繁體中文' },
  { tag: 'ja_jp', country: 'JP', displayName: '日本語' },
  { tag: 'ko_kr', country: 'KR', displayName: '한국어' },
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
  // Fall back to the default record rather than returning `undefined`
  // — callers can rely on this being safe to render.
  const fallback = KNOWN_LOCALES.find((l) => l.tag === DEFAULT_LOCALE_TAG)
  // `KNOWN_LOCALES` always contains the default, so this is a true
  // invariant, not a runtime fallback. The unwrap keeps the signature
  // clean for callers.
  return fallback!
}
