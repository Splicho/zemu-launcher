export default function SeasonBanner() {
  return (
    <section
      aria-label="Current season"
      className="relative h-48 w-full overflow-hidden border-y border-foreground/10 sm:h-56 md:h-64"
    >
      <img
        src="/images/background/season-banner.jpg"
        alt=""
        loading="eager"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-transparent to-background/60">
        <h2 className="text-4xl font-extrabold tracking-tight uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] sm:text-6xl md:text-7xl lg:text-8xl">
          Playtests
        </h2>
      </div>
    </section>
  )
}
