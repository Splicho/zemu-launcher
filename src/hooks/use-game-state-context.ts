import { useContext } from 'react'
import { GameStateContext, type GameStateStore } from '@/contexts/game-state-context'

export function useGameStateContext(): GameStateStore {
  const ctx = useContext(GameStateContext)
  if (!ctx) {
    throw new Error('useGameStateContext must be used within <GameStateProvider />')
  }
  return ctx
}
