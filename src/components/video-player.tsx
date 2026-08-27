"use client"

/**
 * A custom-styled video player with shadcn-flavored controls.
 */

import * as React from "react"
import { useTranslation } from "react-i18next"
import { Volume2, VolumeX, Maximize, Minimize } from "lucide-react"
import { Play, Pause, Rewind10, Forward10 } from "@/components/icons"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SKIP_BACK_SECONDS = 10
const SKIP_FORWARD_SECONDS = 10
const VOLUME_STEP = 0.1
const AUTOHIDE_MS = 600

const SLIDER_CHROME_CLASSES =
  "[&_[data-slot=slider-track]]:bg-white/20 " +
  "[&_[data-slot=slider-range]]:bg-[linear-gradient(to_top,oklch(0.5_0.16_29.11)_0%,var(--primary)_100%)] " +
  "[&_[data-slot=slider-thumb]]:bg-white"

type VideoPlayerProps = React.ComponentProps<"video">

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function VideoPlayer({ className, ...videoProps }: VideoPlayerProps) {
  return (
    <VideoPlayerImpl
      key={typeof videoProps.src === "string" ? videoProps.src : ""}
      {...videoProps}
      className={className}
    />
  )
}

function VideoPlayerImpl({ className, ...videoProps }: VideoPlayerProps) {
  const { t } = useTranslation()
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const hideTimerRef = React.useRef<number | null>(null)

  const [isPlaying, setIsPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolume] = React.useState(1)
  const [isMuted, setIsMuted] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [controlsVisible, setControlsVisible] = React.useState(false)

  const stateRef = React.useRef({
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
  })
  React.useLayoutEffect(() => {
    stateRef.current = {
      isPlaying,
      currentTime,
      duration,
      volume,
      isMuted,
    }
  }, [isPlaying, currentTime, duration, volume, isMuted])

  const seekable = Number.isFinite(duration) && duration > 0

  const armedRef = React.useRef(false)

  const showControls = React.useCallback(() => {
    if (!armedRef.current) return
    setControlsVisible(true)
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const armControls = React.useCallback(() => {
    if (armedRef.current) return
    armedRef.current = true
    setControlsVisible(true)
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = React.useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
    }, AUTOHIDE_MS)
  }, [])

  React.useEffect(() => {
    if (!isPlaying) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    } else {
      scheduleHide()
    }
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
      }
    }
  }, [isPlaying, scheduleHide])

  React.useEffect(() => {
    function onChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  React.useEffect(() => {
    const el = videoRef.current
    if (!el) return
    setVolume(el.volume)
    setIsMuted(el.muted)
  }, [])

  function togglePlay() {
    const el = videoRef.current
    if (!el) return
    if (el.paused || el.ended) {
      void el.play()
    } else {
      el.pause()
    }
  }

  function skip(deltaSeconds: number) {
    const el = videoRef.current
    if (!el) return
    el.currentTime = Math.max(
      0,
      Math.min(el.currentTime + deltaSeconds, el.duration || Infinity)
    )
    setCurrentTime(el.currentTime)
  }

  function setTime(next: number) {
    const el = videoRef.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(next, el.duration || next))
    setCurrentTime(el.currentTime)
  }

  function changeVolume(next: number) {
    const el = videoRef.current
    if (!el) return
    const clamped = Math.max(0, Math.min(1, next))
    el.volume = clamped
    setVolume(clamped)
    if (clamped > 0 && el.muted) {
      el.muted = false
      setIsMuted(false)
    }
  }

  function toggleMute() {
    const el = videoRef.current
    if (!el) return
    const next = !el.muted
    el.muted = next
    setIsMuted(next)
  }

  async function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Swallow fullscreen errors
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.dataset.slot === "slider-thumb") return
    const onInteractiveChild =
      target.tagName === "BUTTON" || target.tagName === "A"
    if (e.altKey || e.ctrlKey || e.metaKey) return

    switch (e.key) {
      case " ":
      case "k":
      case "K":
        if (onInteractiveChild) return
        e.preventDefault()
        togglePlay()
        break
      case "ArrowLeft":
        e.preventDefault()
        skip(-SKIP_BACK_SECONDS)
        break
      case "ArrowRight":
        e.preventDefault()
        skip(SKIP_FORWARD_SECONDS)
        break
      case "ArrowUp":
        e.preventDefault()
        changeVolume(stateRef.current.volume + VOLUME_STEP)
        break
      case "ArrowDown":
        e.preventDefault()
        changeVolume(stateRef.current.volume - VOLUME_STEP)
        break
      case "m":
      case "M":
        e.preventDefault()
        toggleMute()
        break
      case "f":
      case "F":
        e.preventDefault()
        void toggleFullscreen()
        break
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={containerRef}
        role="region"
        aria-label={t('videoPlayer.ariaLabel')}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseEnter={armControls}
        onMouseMove={showControls}
        onMouseLeave={() => {
          if (stateRef.current.isPlaying) scheduleHide()
        }}
        onTouchStart={armControls}
        onFocus={armControls}
        onBlur={() => {
          if (stateRef.current.isPlaying) scheduleHide()
        }}
        className={cn(
          "group/player relative isolate overflow-hidden rounded-lg bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className
        )}
      >
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          {...videoProps}
          onLoadedMetadata={(e) => {
            videoProps.onLoadedMetadata?.(e)
            const el = e.currentTarget
            setDuration(el.duration)
            setVolume(el.volume)
            setIsMuted(el.muted)
          }}
          onCanPlay={(e) => {
            videoProps.onCanPlay?.(e)
            const el = e.currentTarget
            if (Number.isFinite(el.duration) && el.duration > 0) {
              setDuration(el.duration)
            }
          }}
          onDurationChange={(e) => {
            videoProps.onDurationChange?.(e)
            const el = e.currentTarget
            if (Number.isFinite(el.duration) && el.duration > 0) {
              setDuration(el.duration)
            }
          }}
          onTimeUpdate={(e) => {
            videoProps.onTimeUpdate?.(e)
            setCurrentTime(Math.round(e.currentTarget.currentTime * 10) / 10)
          }}
          onPlay={(e) => {
            videoProps.onPlay?.(e)
            setIsPlaying(true)
          }}
          onPause={(e) => {
            videoProps.onPause?.(e)
            setIsPlaying(false)
          }}
          onEnded={(e) => {
            videoProps.onEnded?.(e)
            setIsPlaying(false)
          }}
          onVolumeChange={(e) => {
            videoProps.onVolumeChange?.(e)
            setVolume(e.currentTarget.volume)
            setIsMuted(e.currentTarget.muted)
          }}
          onClick={togglePlay}
          className={cn("block h-full w-full object-contain", className)}
        >
          {videoProps.children}
        </video>

        <button
          type="button"
          aria-label={isPlaying ? t('context.pause') : t('context.play')}
          onClick={togglePlay}
          tabIndex={-1}
          className={cn(
            "absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-opacity duration-200",
            !isPlaying ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          <span
            className={cn(
              "flex size-20 items-center justify-center rounded-full bg-[linear-gradient(to_top,oklch(0.5_0.16_29.11)_0%,var(--primary)_100%)] text-white shadow-[0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1),inset_0_1px_0_oklch(1_0_0/0.15)] transition-transform duration-300 group-hover/player:scale-110"
            )}
          >
            {isPlaying ? (
              <Pause className="size-9" />
            ) : (
              <Play className="size-9 translate-x-[1px]" />
            )}
          </span>
        </button>

        <motion.div
          initial={false}
          animate={{
            y: controlsVisible ? "0%" : "100%",
            opacity: controlsVisible ? 1 : 0,
          }}
          transition={{ type: "tween", duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          style={{ willChange: "transform, opacity" }}
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 px-3 pt-12 pb-3",
            "bg-gradient-to-t from-black/70 via-black/30 to-transparent",
            !controlsVisible && "pointer-events-none"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 text-white">
            <ControlTooltip label={isPlaying ? t('context.pauseKbd') : t('context.play')}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={isPlaying ? t('context.pause') : t('context.play')}
                onClick={togglePlay}
                className="text-white hover:bg-white/15 hover:text-white"
              >
                {isPlaying ? (
                  <Pause className="size-5" />
                ) : (
                  <Play className="size-5" />
                )}
              </Button>
            </ControlTooltip>

            <ControlTooltip label={t('videoPlayer.rewind', { seconds: SKIP_BACK_SECONDS })}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('videoPlayer.rewindAria', { seconds: SKIP_BACK_SECONDS })}
                onClick={() => skip(-SKIP_BACK_SECONDS)}
                className="text-white hover:bg-white/15 hover:text-white"
              >
                <Rewind10 className="size-5" />
              </Button>
            </ControlTooltip>

            <ControlTooltip label={t('videoPlayer.forward', { seconds: SKIP_FORWARD_SECONDS })}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('videoPlayer.forwardAria', { seconds: SKIP_FORWARD_SECONDS })}
                onClick={() => skip(SKIP_FORWARD_SECONDS)}
                className="text-white hover:bg-white/15 hover:text-white"
              >
                <Forward10 className="size-5" />
              </Button>
            </ControlTooltip>

            <div className="mx-1 min-w-0 flex-1">
              <Slider
                value={[seekable ? currentTime : 0]}
                min={0}
                max={seekable ? duration : 1}
                step={0.1}
                disabled={!seekable}
                aria-label={t('videoPlayer.seek')}
                onValueChange={(v) => setTime(v[0] ?? 0)}
                className={SLIDER_CHROME_CLASSES}
              />
            </div>

            <span
              aria-label={t('videoPlayer.playbackTime')}
              className="font-mono text-xs whitespace-nowrap text-white/90 tabular-nums"
            >
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <ControlTooltip label={isMuted ? t('videoPlayer.unmute') : t('videoPlayer.mute')}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={isMuted ? t('videoPlayer.unmuteAria') : t('videoPlayer.muteAria')}
                aria-pressed={isMuted}
                onClick={toggleMute}
                className="text-white hover:bg-white/15 hover:text-white"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="size-5" />
                ) : (
                  <Volume2 className="size-5" />
                )}
              </Button>
            </ControlTooltip>

            <div className="hidden w-24 sm:block">
              <Slider
                value={[isMuted ? 0 : volume]}
                min={0}
                max={1}
                step={0.01}
                aria-label={t('videoPlayer.volume')}
                onValueChange={(v) => changeVolume(v[0] ?? 0)}
                className={SLIDER_CHROME_CLASSES}
              />
            </div>

            <ControlTooltip
              label={isFullscreen ? t('videoPlayer.exitFullscreen') : t('videoPlayer.fullscreen')}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={isFullscreen ? t('videoPlayer.exitFullscreenAria') : t('videoPlayer.fullscreenAria')}
                aria-pressed={isFullscreen}
                onClick={() => void toggleFullscreen()}
                className="text-white hover:bg-white/15 hover:text-white"
              >
                {isFullscreen ? (
                  <Minimize className="size-5" />
                ) : (
                  <Maximize className="size-5" />
                )}
              </Button>
            </ControlTooltip>
          </div>
        </motion.div>
      </div>
    </TooltipProvider>
  )
}

function ControlTooltip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export { VideoPlayer }
export type { VideoPlayerProps }
