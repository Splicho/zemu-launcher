import { Box } from '@/components/icons'
import { GameActionButton } from '@/components/game-action-button'

export function PlayHeader() {
  return (
    <div className="flex h-full flex-col items-start justify-end pb-8 pl-8">
      <img
        src="/background/zemu_game_logo.png"
        alt="ZEmu: King of the Kill"
        className="h-32 object-contain"
      />
      <div className="mt-4 flex flex-col items-start">
        <h1 className="text-2xl font-bold">ZEmu: King of the Kill</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          ZEmu: King of the Kill is a fast-paced, competitive battle royale shooter. Parachute in and search for weapons, ammo, vehicles and supplies to stay alive. As toxic gas compresses the map, develop a winning strategy and prepare for the final showdown.
        </p>
        <div className="mt-6 flex items-center gap-6">
          <GameActionButton />
          <div className="flex items-center gap-2 text-muted-foreground">
            <Box className="size-5" />
            <span className="text-sm">100MB</span>
          </div>
        </div>
      </div>
    </div>
  )
}
