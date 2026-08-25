import * as React from 'react'

export interface UpdateState {
  isUpdating: boolean
  progress: number
  phase: string
}

interface UpdateContextValue extends UpdateState {
  startDemo: () => void
  stopDemo: () => void
}

const UpdateContext = React.createContext<UpdateContextValue | null>(null)

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [isUpdating, setIsUpdating] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [phase, setPhase] = React.useState('')
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const stopDemo = React.useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsUpdating(false)
    setProgress(0)
    setPhase('')
  }, [])

  const startDemo = React.useCallback(() => {
    setIsUpdating(true)
    setProgress(0)
    setPhase('Checking for updates...')

    const phases = [
      'Downloading update...',
      'Installing files...',
      'Verifying integrity...',
      'Almost done...',
    ]

    let phaseIndex = 0
    intervalRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 8 + 2
        if (next >= 100) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setTimeout(stopDemo, 500)
          return 100
        }
        return next
      })

      if (phaseIndex < phases.length && progress > (phaseIndex + 1) * 25) {
        phaseIndex++
        setPhase(phases[phaseIndex])
      }
    }, 200)
  }, [progress, stopDemo])

  React.useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return (
    <UpdateContext.Provider value={{ isUpdating, progress, phase, startDemo, stopDemo }}>
      {children}
    </UpdateContext.Provider>
  )
}

export function useUpdate() {
  const ctx = React.useContext(UpdateContext)
  if (!ctx) throw new Error('useUpdate must be used within UpdateProvider')
  return ctx
}
