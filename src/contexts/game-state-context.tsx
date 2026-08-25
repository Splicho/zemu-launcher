import { createContext, useContext } from 'react'
import { useGameState } from '@/hooks/use-game-state'

type GameStateStore = ReturnType<typeof useGameState>

const GameStateContext = createContext<GameStateStore | null>(null)

export function GameStateProvider({ children }: { children: React.ReactNode }) {
  const store = useGameState()
  return <GameStateContext.Provider value={store}>{children}</GameStateContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGameStateContext(): GameStateStore {
  const ctx = useContext(GameStateContext)
  if (!ctx) {
    throw new Error('useGameStateContext must be used within <GameStateProvider />')
  }
  return ctx
}
