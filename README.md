# ZEmu Launcher

A desktop gaming launcher for H1Z1, built with Tauri (Rust + React). Provides a full-featured UI for launching H1Z1, managing SteamCMD installs, matchmaking, and real-time friend synchronisation with the ZEmu platform.

## Features

- **Game Launcher** — Launch H1Z1 with custom launch parameters
- **SteamCMD Integration** — Automated depot download and validation
- **Friend System** — Real-time friend list, requests, and search via Socket.IO
- **Matchmaking** — Browser-based competitive matchmaking for H1Z1
- **Discord Rich Presence** — Shows current game status in Discord
- **Multi-Account** — Switch between multiple Steam accounts
- **In-game Language** — Pick the locale the game launches in (written into the game's `ClientConfig.ini` as `[Internationalization] Locale=`)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  ZEmu Launcher (Tauri 2.x)                             │
│                                                         │
│  ┌─────────────────┐   ┌─────────────────────────────┐ │
│  │  Rust Backend   │   │   React Renderer             │ │
│  │                 │   │                             │ │
│  │  • Auth store   │   │  • TanStack Query v5         │ │
│  │  • SteamCMD     │   │  • shadcn/ui components     │ │
│  │  • Discord RPC  │   │  • react-i18next (i18n)      │ │
│  │  • Socket.IO    │   │                             │ │
│  └────────┬────────┘   └──────────────┬──────────────┘ │
│           │ Tauri events / invoke     │               │
│           └──────────────┬─────────────┘               │
│                          │                              │
└──────────────────────────┼──────────────────────────────┘
                           │ HTTPS / WebSocket
                           ▼
              ┌──────────────────────────┐
              │   ZEmu Platform          │
              │                          │
              │  apps/api     :3002      │
              │  apps/realtime :3007     │
              │  apps/web     :3000      │
              └──────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Tauri 2.x (Rust + WebView2) |
| Renderer | React 19 + Vite + TypeScript |
| State / caching | TanStack Query v5 |
| Desktop backend | Rust (auth, SteamCMD, Discord RPC, Socket.IO) |
| UI components | shadcn/ui |
| i18n | react-i18next |
| Realtime | Socket.IO v4 client |

## Prerequisites

- **Node.js** 20+ (npm 10+)
- **Rust** 1.77+
- **pnpm** (`npm install -g pnpm`)
- **Git**

## Setup

### 1. Clone

```bash
git clone https://github.com/Splicho/zemu-launcher.git
cd zemu-launcher
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
cp .env.example .env.local
```

Required variables:

```env
# URL of the realtime Socket.IO server
VITE_LAUNCHER_REALTIME_URL=ws://localhost:3007

# URL of the ZEmu API
VITE_API_URL=http://localhost:3002
```

For production builds, set `VITE_LAUNCHER_REALTIME_URL` to `wss://socket.zemu.uk`.

### 4. Run in development

```bash
npm run dev
```

### 5. Build for production

```bash
npm run tauri build
```

The installer/executable will be output to `src-tauri/target/release/bundle/`.

## Project Structure

```
zemu-launcher/
├── src/
│   ├── components/       React UI components
│   ├── hooks/            Custom React hooks
│   ├── lib/              Utilities and Tauri bridge
│   ├── locales/          i18n translation files
│   ├── config/           App configuration
│   └── main.tsx          React entry point
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs        Tauri app entry + command registration
│   │   ├── commands.rs   Tauri command handlers
│   │   ├── auth.rs      Steam auth and JWT management
│   │   ├── friends_realtime.rs  Socket.IO client (Rust)
│   │   └── state.rs     App shared state
│   └── Cargo.toml
├── .env.example          Environment variable template
└── package.json
```

## Environment Variables

> **⚠️ Security note:** Variables prefixed with `VITE_` are bundled into the frontend JavaScript and are **public**. Only use `VITE_` for URLs that are already public (e.g. public API endpoints). Secrets and credentials must use the `ZEMU_` prefix, which stays in the Rust backend and is never bundled into the renderer.

### Frontend / Vite (public — bundled into renderer)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | Auth service base URL (OAuth initiate/introspect) |
| `VITE_LAUNCHER_REALTIME_URL` | Yes | WebSocket URL for realtime friend updates |
| `VITE_API_URL` | Yes | Base URL of the ZEmu REST API |

### Backend / Rust (private — never bundled)

| Variable | Required | Description |
|---|---|---|
| `ZEMU_GAME_SERVER` | No | Game server `hostname:port` passed to the game at launch. Defaults to `eu.zemu.uk:1115`. |

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request. All contributors must agree to the [CONTRIBUTOR_LICENSE_AGREEMENT.md](CONTRIBUTOR_LICENSE_AGREEMENT.md).

## License

See [LICENSE](LICENSE). By contributing to this project, you agree to the [CONTRIBUTOR_LICENSE_AGREEMENT.md](CONTRIBUTOR_LICENSE_AGREEMENT.md).
