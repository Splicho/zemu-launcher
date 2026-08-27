import { useEffect, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'

export type AppTheme = 'system' | 'dark' | 'light'

const THEME_OPTIONS: { value: AppTheme; label: string; description: string }[] = [
  {
    value: 'system',
    label: 'System',
    description: 'Match your operating system\'s colour scheme.',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use a dark theme.',
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Always use a light theme.',
  },
]

export function AppearancePage() {
  const [theme, setTheme] = useState<AppTheme>('dark')

  useEffect(() => {
    if (!window.launcherAPI) return
    void window.launcherAPI.getTheme().then((t) => setTheme(t as AppTheme))
  }, [])

  useEffect(() => {
    const root = document.documentElement
    try {
      localStorage.setItem('zemu.theme', theme)
    } catch {
      // localStorage may be unavailable (private mode / sandboxed webview).
    }
    if (theme === 'system') {
      const prefersDark =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      if (prefersDark !== false) root.classList.add('dark')
      else root.classList.remove('dark')
    } else {
      root.classList.toggle('dark', theme === 'dark')
    }
  }, [theme])

  const handleThemeChange = (next: AppTheme) => {
    setTheme(next)
    window.launcherAPI?.setTheme(next)
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-2xl font-bold">Appearance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customise how ZEmu Launcher looks.
        </p>
      </header>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <Label className="text-sm font-medium">Theme</Label>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Choose your preferred colour scheme.
          </p>

          <div className="flex flex-col gap-2">
            {THEME_OPTIONS.map((opt) => {
              const isActive = theme === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => handleThemeChange(opt.value)}
                  className={`
                    flex items-center gap-4 rounded-lg border px-4 py-3 text-left
                    transition-all
                    ${
                      isActive
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-card hover:border-primary/50'
                    }
                  `}
                >
                  <span
                    className={`
                      flex size-5 shrink-0 items-center justify-center rounded-full border
                      ${isActive ? 'border-primary bg-primary' : 'border-muted-foreground/30'}
                    `}
                  >
                    {isActive && (
                      <span className="size-2 rounded-full bg-primary-foreground" />
                    )}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.description}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
