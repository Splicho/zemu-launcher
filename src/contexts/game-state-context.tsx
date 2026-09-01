import { createContext } from 'react'
import { useGameState } from '@/hooks/use-game-state'
import type { LicenseStatus } from '@/hooks/use-license'

export type GameStateStore = ReturnType<typeof useGameState>

export const GameStateContext = createContext<GameStateStore | null>(null)

export function GameStateProvider({
  children,
  licenseStatus,
}: {
  children: React.ReactNode
  /**
   * Current license gate status. Passed in from the top-level bridge
   * (`GameStateProviderBridge` in `main-app.tsx`) which reads the
   * license context once and feeds it down. Required — see
   * `useGameState` for why.
   */
  licenseStatus: LicenseStatus
}) {
  const store = useGameState({ licenseStatus })
  return <GameStateContext.Provider value={store}>{children}</GameStateContext.Provider>
}
