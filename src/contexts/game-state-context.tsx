import { createContext } from 'react'
import { useGameState } from '@/hooks/use-game-state'

export type GameStateStore = ReturnType<typeof useGameState>

export const GameStateContext = createContext<GameStateStore | null>(null)

export function GameStateProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const store = useGameState()
  return <GameStateContext.Provider value={store}>{children}</GameStateContext.Provider>
}
