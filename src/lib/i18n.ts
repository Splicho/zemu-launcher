import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from '@/locales/en'
import fr from '@/locales/fr'
import zh from '@/locales/zh'
import ptBR from '@/locales/pt-BR'

export const SUPPORTED_LANGUAGES = [
  { code: 'en', labelKey: 'settings.general.languageEnglish' },
  { code: 'fr', labelKey: 'settings.general.languageFrench' },
  { code: 'zh', labelKey: 'settings.general.languageChinese' },
  { code: 'pt-BR', labelKey: 'settings.general.languagePortuguese' },
] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code']

const LANGUAGE_STORAGE_KEY = 'zemu-launcher.language'

/** Normalize a full locale (e.g. "zh-CN", "pt-BR") to a supported base code. */
export function normalizeLanguageCode(code: string): SupportedLanguage {
  const base = code.split('-')[0]!

  // pt-BR needs special handling since "pt" matches but base is "pt"
  if (code.startsWith('pt')) return 'pt-BR'

  const match = SUPPORTED_LANGUAGES.find((l) => l.code === base)
  return match ? match.code : 'en'
}

/** Read the user-persisted language preference. */
export function getPersistedLanguage(): SupportedLanguage | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) as SupportedLanguage | null
  } catch {
    return null
  }
}

/** Persist the user's language choice. */
export function setPersistedLanguage(code: SupportedLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
  } catch {
    // ignore
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en,
      fr,
      zh,
      'pt-BR': ptBR,
    },
    fallbackLng: 'en',

    // Language detector order: user-persisted → OS language → English
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },

    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
