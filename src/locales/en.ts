export default {
  translation: {
    common: {
      loading: 'Loading…',
      error: 'An error occurred',
      retry: 'Retry',
      cancel: 'Cancel',
      save: 'Save',
      close: 'Close',
      back: 'Back',
      selectLanguage: 'Select language',
      minimize: 'Minimize',
      maximize: 'Maximize',
      restore: 'Restore',
    },
    // Actionable copy for the coded errors emitted by
    // `src-tauri/src/errors.rs`. One block per `ErrorCode`; the wizard's
    // `ErrorCard` renders `.title` / `.description` and hides the raw Rust
    // chain behind "Technical details". Missing blocks degrade to the
    // backend's English message (`AppError.message`), so adding a code on
    // the Rust side is never a hard break — just untranslated until it
    // lands here.
    errors: {
      actions: {
        details: 'Technical details',
        copy: 'Copy details',
        copied: 'Copied',
        useAnotherAccount: 'Sign in with another account',
        openStore: 'Open Z1 Battle Royale on Steam',
      },
      steam_depot_not_owned: {
        title: "Your Steam account doesn't own H1Z1: King of the Kill",
        description:
          'Sign in with the account that owns the game, or add Z1 Battle Royale to this account (it is free). If you do own it, wait a moment and retry — Steam also refuses the depot key when it is busy.',
      },
      steam_not_signed_in: {
        title: 'Sign in with Steam to download the game',
        description:
          'The launcher has no saved Steam login yet. Scan the QR code with the Steam Mobile app to continue.',
      },
      steam_session_expired: {
        title: 'Your Steam sign-in expired',
        description:
          'Steam no longer accepts the saved login. Sign out and scan the QR code again.',
      },
      steam_login_failed: {
        title: 'Steam rejected the sign-in',
        description:
          'Sign out and try again. If it keeps failing, check the account status on Steam and the launcher log.',
      },
      steam_account_missing: {
        title: 'The saved Steam account details are incomplete',
        description:
          'Sign out, then scan the QR code again so the launcher can store the account name.',
      },
      steam_busy: {
        title: 'Steam is busy right now',
        description:
          'Steam did not answer the download request in time. Wait a few seconds and retry.',
      },
      steam_rate_limited: {
        title: 'Steam is rate-limiting download requests',
        description:
          'Too many requests reached Steam in a short time. Wait a minute, then retry.',
      },
      steam_network: {
        title: 'Could not reach Steam',
        description:
          'Check your internet connection, VPN and firewall, then retry.',
      },
      steam_cdn_auth: {
        title: "Steam's download server rejected the request",
        description:
          'The CDN token was refused. Start the download again; if it keeps happening, sign out and back in.',
      },
      steam_manifest_unavailable: {
        title: 'Steam is no longer serving this H1Z1 build',
        description:
          'The pinned 2017 manifest is no longer available. Use the manual Steam depot instructions under Properties → Installation Guide.',
      },
      disk_full: {
        title: 'Not enough free disk space',
        description:
          'Free up space on the install drive (H1Z1 needs about 20 GB), then retry.',
      },
      disk_permission: {
        title: 'The install folder is not writable',
        description:
          'Choose a folder outside Program Files, or fix its permissions, then retry.',
      },
      disk_error: {
        title: 'Writing the game files failed',
        description:
          'Check free space and folder permissions, then retry. The technical details below name the exact file and error.',
      },
      keychain_error: {
        title: 'Could not save the Steam login',
        description:
          'The system keychain refused the write. Unlock the keychain (or Windows Credential Manager) and sign in again.',
      },
      unknown: {
        title: 'The Steam download failed',
        description:
          'An unexpected error stopped the download. Share the technical details below with support.',
      },
    },
    bootstrap: {
      status: 'Checking launcher updates',
      detail: 'Looking for a newer launcher build before opening the app.',
      openingLauncher: 'Opening launcher',
      bootstrappingComplete: 'Bootstrapping complete.',
      couldNotOpenLauncher: 'Could not open launcher',
      launcherWindowFailed: 'The main launcher window could not be created.',
      updaterSkipped: 'Automatic updates disabled',
      devBuildNote: 'Opening the launcher directly.',
      checkFailed: 'Could not check launcher updates',
      checkFailedDetail: 'GitHub release metadata could not be fetched.',
      upToDate: 'Launcher is up to date',
      upToDateDetail: 'No newer launcher build is available.',
      downloading: 'Downloading launcher {{version}}',
      downloadingDetail: 'The launcher will restart automatically after the update finishes.',
      restarting: 'Restarting launcher',
      restartingDetail: 'Installing the new build and reopening the launcher.',
      updateFailed: 'Launcher update failed',
      installFailed: 'Install failed',
      updateFailedDetail: 'The update could not be downloaded or installed.',
      splashChecking: 'Checking for updates...',
      splashStarting: 'Starting...',
      openLauncher: 'Open launcher',
      unexpectedError: 'Unexpected updater error',
    },
    // Pre-onboarding screen. Mounts between the landing page
    // (`/`) and `#/onboarding` — asks returning users if they
    // already have the Pre-Season 3 client installed so they can
    // skip the wizard. Lives at `#/install-check`.
    installCheck: {
      title: 'Do you have the Pre-Season 3 Client already installed?',
      description:
        'If you already downloaded the game from Steam, you can skip the setup wizard. Otherwise we will walk you through downloading and patching it.',
      // Shown when the disk check already sees an install —
      // reassures the user the "Yes" branch won't strand them.
      detectedHint:
        'We detected an existing install — looks like you are set.',
      // Primary "skip wizard" branch. Two labels depending on
      // whether the install folder is already chosen by the gate
      // (one-click skip) or whether we need to open the picker
      // first so the user can point us at their moved/dropped
      // folder.
      alreadyInstalled: 'Yes, I already have it',
      chooseFolder: 'Yes — let me pick the folder',
      needToDownload: 'No, I need to download it',
    },
    account: {
      openMenu: 'Open account menu',
      menuItem: 'Account',
      signOut: 'Sign out',
      unknownUser: 'Unknown user',
      title: 'Account',
      // Sidebar entry for the launcher's local auth-key surface.
      // The launcher only owns this one slice of account
      // management — profile/security/connected-accounts live on
      // the web under `/settings/account`, reached via the
      // "Account" external link above this entry.
      authKey: 'Auth Key',
      description:
        'View the auth key currently synced from your account. To rotate the key, visit your account settings on the website.',
      keyLabel: 'Auth key',
      keyDescription:
        'Synced from the server when you open this page and stored locally so launches do not require the network.',
      revealKey: 'Reveal key',
      hideKey: 'Hide key',
      copyKey: 'Copy key',
      copied: 'Auth key copied to clipboard.',
      noKey:
        'No auth key is set yet. Re-run the launcher setup to fetch one from your account.',
      // Banner above the key panel when the launcher's server-side
      // fetch returned a `revoked` row. Mirrors the onboarding
      // banner — the user has to walk over to the website to ask
      // an admin to restore their key.
      revokedBanner:
        'Your auth key has been revoked. Contact an admin via the website to restore it.',
      revokedBannerLink: 'Open account settings',
      // Soft note when the auto-fetch failed. We surface the
      // upstream reason so the bug report has something useful in
      // it; the key field below keeps showing whatever was last
      // saved on disk.
      fetchFallback:
        'Could not sync your auth key from the server ({{reason}}). The value shown is what was last saved on disk.',
      errors: {
        unavailable: 'Launcher bridge is unavailable.',
      },
    },
    nav: {
      home: 'Home',
      news: 'News',
      streams: 'Streams',
      leaderboard: 'Leaderboard',
      clans: 'Clans',
      servers: 'Servers',
      play: 'Play',
      settings: 'Settings',
      socialize: 'Socialize',
      help: 'Help',
      friends: 'Friends',
      account: 'Account',
    },
    settings: {
      general: {
        title: 'General',
        description: 'General launcher preferences.',
        discordRichPresence: 'Discord Rich Presence',
        discordRichPresenceDesc: 'Show your activity on Discord when you are in the launcher or in-game.',
        discordAlways: 'Always',
        discordAlwaysDesc: 'Show activity in Discord when browsing the launcher and while in-game.',
        discordPlayingOnly: 'Only when playing',
        discordPlayingOnlyDesc: 'Only show activity when the game is running.',
        startOnStartup: 'Start ZEmu Launcher on startup',
        startOnStartupDesc: 'Automatically launch ZEmu when you sign in to Windows.',
        language: 'Language',
        languageDesc: 'Choose your preferred language for the launcher.',
        activitySetting: 'Activity setting',
        rpcAlways: 'Always',
        rpcAlwaysDesc: 'Show activity in Discord when browsing the launcher and while in-game.',
        rpcPlayingOnly: 'Only when playing',
        rpcPlayingOnlyDesc: 'Only show activity when the game is running.',
        languageEnglish: 'English',
        languageFrench: 'Français',
        languageChinese: '中文',
        languagePortuguese: 'Português (Brasil)',
        rerunSetup: 'Re-run setup',
        rerunSetupDesc: 'Walk through the auth key, install folder, and H1Z1: King of the Kill steps again.',
      },
      advanced: {
        title: 'Advanced',
        description:
          'Internal locations for the launcher. Useful when filing a bug report or moving your install to a new machine.',
        appDataLabel: 'App data folder',
        appDataDescription:
          'Where the launcher stores its config, the rolling debug log, and cached update metadata.',
        openFolder: 'Open folder',
        copyPath: 'Copy path',
        copied: 'Path copied to clipboard.',
        pathLoading: 'Resolving path…',
        pathUnavailable:
          'The app data folder could not be located. Restart the launcher; if this keeps failing, reinstall.',
      },
    },
    friends: {
        title: 'Friends',
        refresh: 'Refresh',
        addFriend: 'Add a friend',
        addFriendHeading: 'Add friends',
        friendRequests: 'Friend requests',
        friendRequestsHeading: 'Friend requests',
        requestsEmpty: 'No pending friend requests right now.',
        searchPlaceholder: 'Search for players...',
        searchHint: 'Type at least 2 characters to search for players.',
        loading: 'Loading friends…',
        empty: 'Nothing here yet.',
      sections: {
        resultsFound_one: '{{count}} player found',
        resultsFound_other: '{{count}} players found',
        incoming: 'Friend requests',
        outgoing: 'Sent requests',
        friends: 'Your friends',
      },
      actions: {
        add: 'Add',
        remove: 'Remove',
        accept: 'Accept',
        decline: 'Decline',
        cancel: 'Cancel',
        search: 'Search',
        back: 'Back',
        requestSent: 'Friend request sent',
      },
      status: {
        online: 'Online',
        away: 'Away',
        busy: 'Busy',
        in_game: 'In game',
        offline: 'Offline',
        // Shown under a friend's display name when their launcher's
        // heartbeat reports `status === 'in_game'`. `{{game}}` is the
        // `currentGame` value the launcher's heartbeat sent (today
        // hardcoded to `'ZEmu'`).
        currentlyPlaying: 'Currently playing {{game}}',
      },
      errors: {
        network: 'Could not reach the friends service.',
        notFound: 'Player not found.',
        forbidden: 'You do not have permission for that.',
        rateLimited: 'Slow down — try again in a moment.',
        conflict: 'Already pending.',
        server: 'Friends service is unavailable.',
        notImplemented: 'Friends API not connected yet.',
        unknown: 'Something went wrong.',
        unauthenticated: 'Please sign in to manage friends.',
        // 401 with `error` body "unknown key - the account has not
        // logged into the game yet". The user has a valid ZEmu key
        // but the game server has no row for them yet, because the
        // game hasn't been launched with that key. Per the API doc,
        // the fix is to launch the game once so the account shows
        // up on the server.
        key_never_played:
          'Launch the game once with this auth key before using friends.',
        // 401 with `error` body "that account has no character yet".
        // The player signed in but hasn't created an in-game
        // character yet.
        no_character: 'Create a character in-game before using friends.',
        // 401 with `error` body "<header> is required". This points
        // at our own code (the Authorization header didn't go out)
        // — the user can't fix it; log + telemetry should catch it.
        missing_auth_header: 'Friends service rejected the request.',
        network_error: 'Could not reach the friends service. Check your connection and try again.',
        missing_target: 'Pick a player first.',
        unknown_action: 'That action is not supported yet.',
      },
      toast: {
        incomingRequest: '{{name}} sent you a friend request',
        accept: 'Accept',
        decline: 'Decline',
      },
  },
    appSidebar: {
      play: 'Play',
      checkForUpdates: 'Check for updates',
      browseGameFiles: 'Browse game files',
      propertiesAction: 'Properties…',
      gameName: 'ZEmu: King of the Kill',
    },
    play: {
      install: 'Install',
      play: 'Play',
      licenseRequired: 'License required',
      updating: 'Updating…',
      checking: 'Checking for updates…',
      properties: 'Properties',
      authKeyRequired: 'Auth Key Required',
      updateProgress: 'Updating…{{progress}}%',
      applyingPatch: 'Applying Patch…',
      locatePs3Folder: 'Locate PS3 Folder',
      installPatch: 'Install Patch',
      updateAvailable: 'Update available',
      // Short label for the footer's Play button when a patch is ready.
      update: 'Update',
      // Footer Play button while a patch downloads / applies.
      patching: 'Patching',
      // Footer label when an interrupted installation can be continued.
      resume: 'Resume',
      // Client (Steam depot) download stage, before the patch runs.
      downloading: 'Downloading',
      // Signed in, fetching the depot manifest (no bytes yet).
      preparing: 'Preparing…',
      // Footer download stats heading.
      network: 'Network',
      launchingGame: 'Launching game…',
      retry: 'Retry',
      // Footer label after a failed patch when the client is already on
      // disk: retries the patch only, never the 14 GB client download.
      retryPatch: 'Retry patch',
      // Footer label after the client (depot) download failed.
      retryInstall: 'Retry install',
      alreadyInstalled: 'Already installed?',
      locateFolder: 'Locate folder',
      cancelDownload: 'Cancel download',
      gameDescription: 'ZEmu: King of the Kill is a fast-paced, competitive battle royale shooter. Parachute in and search for weapons, ammo, vehicles and supplies to stay alive. As toxic gas compresses the map, develop a winning strategy and prepare for the final showdown.',
      checkingForUpdates: 'Checking…',
      playing: 'Playing',
      browseGameFiles: 'Browse game files',
      checkForUpdates: 'Check for updates',
      gameSize: '15GB',
      // Pre-launch patch integrity check. Surfaced on the Play button
      // between the click and the on-disk blake3 verification
      // completing (or starting its repair download).
      verifying: 'Verifying files…',
    },
    // Install destination dialog (new launcher flow). Only rendered when
    // no game directory is configured; everything after Install reports
    // progress in the footer.
    installDialog: {
      title: 'Install ZEmu',
      description:
        'Downloads the compatible game client and installs the latest ZEmu patch automatically.',
      location: 'Install location',
      locationLoading: 'Resolving default folder…',
      freeSpace: 'Free space',
      downloadSize: 'Download: {{size}}',
      change: 'Change',
      install: 'Install',
      locateExisting: 'Already installed? Locate existing game',
      buildMismatchTitle: 'This may not be the supported H1Z1 build',
      buildMismatch:
        'The executable does not match the version ZEmu is verified against. The launcher will still try to patch it, but a different build may fail to launch.',
      signIn: 'Sign in to Steam',
      signInDescription:
        'Open the Steam mobile app, scan this code, and approve the sign-in to download the compatible game files.',
      waiting: 'Waiting for approval…',
      connecting: 'Connecting to Steam…',
      retry: 'Retry',
    },
    eventPage: {
      back: 'Back',
      badge: 'Event',
      notFound: 'Event not found',
      notFoundDesc: 'This event may have been removed or is no longer published.',
      failedLoad: "Couldn't load this event: {{error}}",
      noDescription: 'No details have been posted for this event yet.',
    },
    eventsTable: {
      title: 'Upcoming Events',
      event: 'Event',
      starts: 'Starts',
      empty: 'No upcoming events.',
      emptyHint: "Check back soon.",
      error: "Couldn't load events.",
    },
    slayersTable: {
      title: 'Slayers of the Week',
      resetsIn: 'Resets in',
      unitDays: 'd',
      unitHours: 'h',
      unitMinutes: 'm',
      unitSeconds: 's',
      player: 'Player',
      kills: 'Kills',
      killsPerMatch: 'K/M',
      empty: 'No matches played this week.',
      emptyHint: "Play a few matches; the board updates when they finish.",
      error: "Couldn't load the leaderboard.",
    },
    authKey: {
      loadFailed: "Could not load the saved key.",
      saveFailed: "Could not save the key. Please try again.",
      // Surfaces when the modal's Save handler can't reach the auth
      // app's my-key endpoint (network down, token expired, 5xx).
      // We deliberately fail closed — a successful local save would
      // undermine the whole point of the validation. The user can
      // retry once the connection is back.
      verifyFailed: "Could not verify your key. Check your connection and try again.",
      // The typed value doesn't match the canonical key on file
      // for the signed-in user. Most often a typo, paste mishap, or
      // a key the user grabbed from somewhere other than their
      // account settings.
      mismatch: "This key doesn't match the one on your account. Double-check the value, or copy it again from your account settings.",
      // The user has no authkey row yet (fresh sign-up that
      // crossed the auto-assign path with a transient failure).
      // Surfaced as a dedicated message so the user knows the
      // resolution path is "wait for the auto-assign to land" or
      // "trigger a fresh generate from the website", not "type
      // the key again".
      noKeyOnServer: "Your account doesn't have an auth key yet. Sign out and back in to auto-assign one, or generate one from the website account settings.",
      // The user's authkey row exists but is in `status='revoked'`.
      // The same banner the Account page renders, surfaced inline
      // here so the user doesn't think they just mistyped.
      revoked: "Your auth key has been revoked. Contact an admin on the website to have it restored before you can save a new one.",
      modalTitle: 'Auth Key',
      description: 'Enter your auth key to play.',
      inputLabel: 'Auth Key',
      placeholder: 'Enter your auth key',
      save: 'Save',
      clear: 'Clear',
    },
    leaderboard: {
      topPlayers: 'Top 5 Players',
      allTiers: 'All Tiers',
      bronze: 'Bronze',
      silver: 'Silver',
      gold: 'Gold',
      platinum: 'Platinum',
      diamond: 'Diamond',
      master: 'Master',
      royalty: 'Royalty',
      regionEU: 'EU',
      regionNA: 'NA',
      regionAsia: 'ASIA (Soon)',
      modeAll: 'All modes',
      modeSolo: 'Solo',
      modeDuo: 'Duo',
      modeFives: 'Fives',
      colName: 'Name',
      colTier: 'Tier',
      colTotalScore: 'Total Score',
      noPlayersFound: 'No players found.',
      viewFull: 'View full leaderboard',
    },
    leaderboardPage: {
      title: 'Leaderboard',
      subtitle: 'Top players this season. Click a row to view their best matches.',
      searchPlaceholder: 'Search players…',
      countryAll: 'All countries',
      countryNone: 'No country data',
      rowsPerPage: 'Rows',
      empty: 'No players match your filters.',
      heroYou: 'You',
      expandingLoading: 'Loading matches…',
      expandingEmpty: 'No recent matches to show.',
      playerTier: 'Player tier',
    },
    properties: {
      wineConfiguration: 'Wine Configuration',
      wineEnable: 'Use Wine / Proton',
      wineEnableDesc: 'Launch the Windows game build through a Linux compatibility runtime.',
      wineRuntime: 'Wine / Proton version',
      wineRuntimePlaceholder: 'Choose a runtime',
      wineRuntimeAuto: 'Auto-detect',
      wineRuntimeCustom: 'Custom executable',
      wineCustomRuntimePlaceholder: '/path/to/wine or proton',
      wineNoRuntimes: 'No Wine or Proton runtime was detected on this system.',
      winePrefix: 'Wineprefix / compatdata',
      winePrefixPlaceholder: 'Leave empty to use the default',
      winePrefixDesc: 'For Proton, this directory is used as STEAM_COMPAT_DATA_PATH. For Wine, it is used as WINEPREFIX.',
      wineEnv: 'Environment variables',
      wineEnvEmpty: 'No custom variables.',
      addVariable: 'Add variable',
      removeVariable: 'Remove variable',
      envKey: 'Name',
      envValue: 'Value',
      refresh: 'Refresh',
      saving: 'Saving…',

      title: 'Properties',
      description: 'Configure ZEmu: King of the Kill',
      installedFiles: 'Installed Files',
      noFolderSelected: 'No installation folder has been selected yet. Use the Change button below to pick one.',
      change: 'Change',
      sizeOnDisk: 'Size on disk',
      unableToCalculateSize: 'Unable to calculate size',
      location: 'Location',
      browseFailed: 'Browse failed: {{error}}',
      browse: 'Browse...',
      opening: 'Opening…',
      accountKey: 'Account key',
      accountKeyLabel: 'Account key',
      status: 'Status',
      noAccountKeys: 'No account keys redeemed yet.',
      redeem: 'Redeem',
      redeemSuccess: 'Key redeemed.',
      redeemNotFound: 'This account key was not found. Please try again.',
      redeemRevoked: 'This account key has been revoked.',
      redeemAlreadyBound: 'This account key is bound to a different machine.',
      redeemUnreachable: "Couldn't reach the account key server.",
      statusActive: 'Active',
      statusRevoked: 'Revoked',
      statusChecking: 'Checking…',
      placeholderTitle: 'Game Settings',
      placeholderDesc: 'Settings for this section will appear here. This is a placeholder while the section content is being designed.',
      language: 'Language',
      languageDescription:
        'Choose the language the game launches in.',
      languagePlaceholder: 'Pick a language',
      languageSave: 'Save',
      languageSaving: 'Saving…',
      languageSaveFailed: 'Could not save the language: {{error}}',
    },
    login: {
      loggingIn: 'Logging in...',
      loginTo: 'Login to {{company}}',
      loginFailed: 'Login failed',
      continueDiscord: 'Continue with Discord',
      continueSteam: 'Continue with Steam',
      continueEmail: 'Continue with Email',
      email: 'Email',
      password: 'Password',
      forgotPassword: 'Forgot password?',
      pleaseWait: 'Please wait...',
      loginBtn: 'Login',
      noAccount: 'No account?',
      createAccount: 'Create new account',
      // Floating badge attached to the button the user picked last
      // time they signed in. Rendered above the top-right corner of
      // the matching Discord / Steam / Email button — see
      // `use-last-used-provider.ts` for the storage shape.
      lastUsed: 'Last used',
      // Server-side error codes returned by /api/launcher/oauth/complete
      // and /api/launcher/auth/login. Each code maps onto a `_title`
      // and an optional `_desc` key; the launcher renders the title in
      // `text-destructive` `font-medium` and the description (when
      // present) in `text-muted-foreground`, matching the website's
      // `<OAuthErrorBanner>` layout. Unknown codes fall through to
      // `fallback_*`, which surfaces the raw code in the description
      // so an unshipping bug is at least greppable from a screenshot.
      errors: {
        user_banned_title: 'Your account has been suspended',
        user_banned_desc:
          'If you believe this is a mistake, contact a staff member.',
        ban_reason_label: 'Reason:',
        ban_expires_label: 'Expires:',
        ban_duration_label: 'Duration:',
        ban_permanent: 'Permanent',
        session_missing_title:
          'Sign-in session expired before completion',
        session_missing_desc: 'Please try again.',
        token_mint_failed_title: 'Could not finalize sign-in',
        token_mint_failed_desc: 'Please try again in a moment.',
        session_lookup_failed_title:
          'Could not look up your sign-in session',
        session_lookup_failed_desc: 'Please try again.',
        invalid_callback_title: 'The login callback was rejected',
        invalid_callback_desc:
          'Please close the window and try again.',
        invalid_credentials_title: 'That email or password is incorrect',
        invalid_credentials_desc: 'Please try again.',
        email_unverified_title: 'Your email is not verified yet',
        email_unverified_desc:
          'Check your inbox for the verification link, or sign in with Discord/Steam to skip this step.',
        invalid_body_title: 'The sign-in request was rejected by the server',
        invalid_body_desc: 'Please try again.',
        internal_error_title: 'The server hit an unexpected error',
        internal_error_desc: 'Please try again in a moment.',
        fallback_title: 'Sign-in failed',
        fallback_desc: 'Unexpected error code: {{code}}.',
      },
    },
    news: {
      allNews: 'All news',
      subtitle: 'Latest updates and announcements from the ZEmu team.',
      failedLoadNews: "Couldn't load news: {{error}}",
      noNews: 'No news published yet — check back later.',
      backToNews: 'Back to news',
      failedLoadPost: "Couldn't load post: {{error}}",
      postNotFound: 'Post not found',
      postNotFoundDesc: "This post doesn't exist or hasn't been published yet.",
      readMore: 'Read more',
      noCoverImage: 'No cover image',
      showArticle: 'Show article {{index}}',
    },
    streams: {
      failedLoad: 'Could not load streams: {{error}}',
      title: 'Streams',
      subtitle: 'Watch live streams playing ZEmu on Twitch and Kick.',
      tabTwitch: 'Twitch',
      tabKick: 'Kick',
      noStreams: "Nobody is streaming ZEmu right now. Check back later!",
      liveBadge: 'LIVE',
    },
    servers: {
      placeholderSubtitle: 'Check out our servers and their status.',
      placeholderBody: 'The server browser is coming soon.',
      regions: {
        europe: { label: 'Europe' },
        northAmerica: { label: 'North America' },
        asia: { label: 'Asia' },
      },
    },
    download: {
      connecting: 'Connecting...',
      stalled: 'Stalled',
      calculating: 'Calculating…',
      remaining: '{{speed}} · {{eta}} remaining',
      etaRemaining: '{{eta}} remaining',
    },
    // Launcher notice bar (`/v1/site-notice?surface=launcher`).
    // Only chrome is translated — the notice's own `text` and
    // `linkLabel` are authored by an admin and arrive in the
    // launcher's UI language as written, exactly as on the website.
    siteNotice: {
      dismiss: 'Dismiss notice',
    },
    update: {
      updatingKotK: 'Updating KotK',
      updateComplete: 'Update complete',
      checking: 'Checking for updates...',
      downloading: 'Downloading update...',
      installing: 'Installing files...',
      verifying: 'Verifying integrity...',
      almostDone: 'Almost done...',
    },
    toasts: {
      cdnUnavailable: 'CDN unavailable',
      cdnUnavailableDescription: '{{error}}. You can still download H1Z1: King of the Kill. Patches will be applied when the CDN is back.',
      failedToSelectDirectory: 'Failed to select directory',
      patchApplicationFailed: 'Patch application failed',
      updateFailed: 'Update failed: {{error}}',
      gameLaunched: 'Game launched!',
      failedToLaunchGame: 'Failed to launch game',
      // Pre-launch integrity check toasts. Fired from
      // `useGameState.launchGame` after `gameAPI.verifyAndRepair`
      // returns. Count uses the i18next interpolation syntax so the
      // singular case ('file') can be split out later if needed.
      integrityRepaired: 'Re-downloaded {{count}} modified file(s) before launching',
      integrityCdnDown: 'Cannot launch — game files modified and CDN unavailable',
      integrityCdnDownDescription: 'Modified files: {{files}}. Reconnect to the internet and try again.',
    },
    videoPlayer: {
      ariaLabel: 'Video player',
      rewind: 'Rewind {{seconds}}s',
      rewindAria: 'Rewind {{seconds}} seconds',
      forward: 'Forward {{seconds}}s',
      forwardAria: 'Forward {{seconds}} seconds',
      seek: 'Seek',
      playbackTime: 'Playback time',
      unmute: 'Unmute',
      mute: 'Mute',
      unmuteAria: 'Unmute',
      muteAria: 'Mute',
      volume: 'Volume',
      exitFullscreen: 'Exit fullscreen',
      fullscreen: 'Fullscreen',
      exitFullscreenAria: 'Exit fullscreen',
      fullscreenAria: 'Fullscreen',
    },
    context: {
      toggleSidebar: 'Toggle Sidebar',
      more: 'More',
      close: 'Close',
      toggleDialog: 'Toggle dialog',
      previousSlide: 'Previous slide',
      nextSlide: 'Next slide',
      morePages: 'More pages',
      downloadProgress: 'Download progress',
      moreSettings: 'More',
      play: 'Play',
      pause: 'Pause',
      pauseKbd: 'Pause (K)',
    },
    player: {
      backToLeaderboard: 'Back to leaderboard',
      failedLoad: "Couldn't load player: {{error}}",
      notFound: 'Player not found',
      notFoundDesc: "We couldn't find a player called {{name}}.",
      joinedOn: 'Joined {{date}}',
      noSetup: 'This player has not published their setup yet.',
      setupTitle: 'Setup',
      downloadIni: 'Download useroptions.ini',
      linksTitle: 'Linked accounts',
      noLinks: 'No linked accounts.',
      discordProfile: 'Discord profile',
      steamProfile: 'Steam profile',
      matchHistory: {
        whenColumn: 'When (UTC)',
        modeColumn: 'Mode',
        regionColumn: 'Region',
        placementColumn: 'Placement',
        killsColumn: 'Kills',
        scoreColumn: 'Score',
        lobbyColumn: 'Lobby',
        winnerColumn: 'Winner',
        detailsColumn: 'Details',
        playerColumn: 'Player',
        playersLabel: 'Players',
        startedLabel: 'Started {{date}}',
        endedLabel: 'Ended {{time}}',
        detailError: "Couldn't load this match's details.",
        emptyTitle: 'No matches recorded',
        emptyDescription: 'This player has not played a recorded match yet.',
      },
      stats: {
        matches: 'Matches',
        winRate: 'Win Rate',
        kills: 'Kills',
        avgPlacement: 'Avg Placement',
        rank: 'Rank',
        notRanked: 'Not ranked yet.',
        killsPerMatch: 'Kills per match',
        rangeSummary: '{{count}} matches in the last {{days}} days',
        noMatches: 'No matches recorded yet.',
        noMatchesInRange: 'No matches in the last {{days}} days.',
        bans: 'Bans',
        noReason: 'No reason recorded',
        bannedOn: 'Banned on {{date}}',
        matchNumber: 'Match #{{number}}',
      },
      setup: {
        monitor: 'Monitor',
        cpu: 'CPU',
        gpu: 'GPU',
        ram: 'RAM',
        keyboard: 'Keyboard',
        mouse: 'Mouse',
        mousepad: 'Mousepad',
        headset: 'Headset',
        dpi: 'DPI',
        sensitivity: 'Sensitivity',
        resolution: 'In-game resolution',
      },
    },
    clan: {
      backToDirectory: 'Back to clans',
      failedLoad: "Couldn't load clan: {{error}}",
      notFound: 'Clan not found',
      notFoundDesc: "We couldn't find a clan with the slug {{slug}}.",
      memberCount: '{{count}} members',
      followerCount: '{{count}} followers',
      verified: 'Verified',
      aboutTitle: 'About',
      noDescription: 'This clan has not set a description yet.',
      topMembersTitle: 'Top members',
      noMembers: 'No members to show yet.',
      directoryTitle: 'Clans',
      directorySubtitle: 'Public community groups on ZEmu. Join one or create your own.',
      searchPlaceholder: 'Search clans…',
      sortLabel: 'Sort',
      sort: {
        members: 'Most members',
        followers: 'Most followers',
        newest: 'Newest',
        name: 'Name',
      },
      filter: {
        verified: 'Verified',
        visibility: 'Visibility',
        allClans: 'All clans',
        public: 'Public',
        private: 'Private',
        clear: 'Clear',
      },
      empty: 'No clans yet — be the first to create one.',
      emptySearch: 'No clans match "{{q}}".',
      noFollowers: 'No followers yet.',
      followingSince: 'Following since {{date}}',
      tabs: {
        members: 'Members',
        followers: 'Followers',
        about: 'About',
        matchHistory: 'Match history',
      },
      matchHistoryStub: "Match history isn't available yet. Check back later!",
      follow: 'Follow',
      following: 'Following',
      unfollowing: 'Unfollowing…',
      followError: 'Could not update follow state',
      requestToJoin: 'Request to join',
      manageClan: 'Manage clan',
      moreActions: 'More actions',
      leaveClan: 'Leave clan',
      leaving: 'Leaving…',
      leftClan: 'Left [{{clantag}}]',
      leaveError: 'Could not leave clan',
      leaveTitle: 'Leave {{clanName}}?',
      leaveDescription:
        'Your clantag will be removed from your name across the site. You can re-join if you get a new invite.',
      stats: {
        members: 'Members',
        followers: 'Followers',
        created: 'Created',
        foundedBy: 'Founded by',
      },
      memberJoined: 'Joined {{date}}',
      roles: {
        leader: 'Leader',
        officer: 'Officer',
        member: 'Member',
      },
    },
    clanManage: {
      title: 'Manage clan',
      subtitle: 'Configure your clan, review applications, and manage members.',
      signInRequired: 'Sign in required',
      signInRequiredDesc: 'You need to be signed in to manage a clan.',
      onlyLeadersOfficers: 'Leader or officer only',
      onlyLeadersOfficersDesc:
        'Only leaders and officers can manage this clan. Ask a member of the leadership to add you.',
      tabs: {
        identity: 'Identity',
        branding: 'Branding',
        members: 'Members',
        join: 'Join',
        requests: 'Requests',
        invites: 'Invites',
        about: 'About',
      },
      saveChanges: 'Save changes',
      cancel: 'Cancel',
      confirmCrop: 'Crop & upload',
      identitySaved: 'Identity updated',
      brandingSaved: 'Branding updated',
      joinSaved: 'Join settings updated',
      aboutSaved: 'Description updated',
      saveError: 'Could not save',
      uploadError: 'Could not upload image',
      cropError: 'Could not crop image',
      nameLabel: 'Clan name',
      tagLabel: 'Clantag',
      nameTooShort: 'Name must be at least {{min}} characters.',
      nameTooLong: 'Name must be at most {{max}} characters.',
      tagTooShort: 'Tag must be at least {{min}} characters.',
      tagTooLong: 'Tag must be at most {{max}} characters.',
      tagInvalid: 'Tag may only contain A-Z and 0-9.',
      coverLabel: 'Cover image',
      coverHint: '21:9 aspect ratio, max 8 MiB.',
      avatarLabel: 'Avatar',
      avatarHint: 'Square crop, max 4 MiB.',
      cropAvatar: 'Crop avatar',
      cropCover: 'Crop cover',
      cropDesc:
        'Pick an image to upload. The cropper will fit + centre it to the target aspect ratio.',
      change: 'Change',
      upload: 'Upload',
      remove: 'Remove',
      searchMembers: 'Search members…',
      clearSearch: 'Clear search',
      memberCol: 'Member',
      roleCol: 'Role',
      noMembers: 'No members match your search.',
      moreActions: 'More actions',
      memberRemoved: 'Member removed',
      removeError: 'Could not remove member',
      roleChanged: 'Role updated',
      roleError: 'Could not update role',
      inviteMember: 'Invite member',
      inviteMemberDesc:
        'Search for a player by display name to send them an invite.',
      inviteSearchPlaceholder: 'Display name…',
      inviteStartTyping: 'Start typing to search for a player.',
      inviteNoResults: 'No players match your search.',
      inviteSent: 'Invite sent',
      inviteError: 'Could not send invite',
      unknownPlayer: 'Unknown player',
      removeMember: 'Remove member',
      removeMemberTitle: 'Remove member?',
      removeMemberDesc: '{{name}} will be removed from the clan.',
      confirmRemove: 'Remove',
      roleLeader: 'Leader',
      roleOfficer: 'Officer',
      roleMember: 'Member',
      visibilityLabel: 'Visibility',
      visibilityPublic: 'Public (request to join)',
      visibilityPrivate: 'Private (invite only)',
      visibilityHint:
        'Private clans hide the "Request to join" button. Direct invites still work.',
      questionsLabel: 'Join questions',
      noQuestions: 'No join questions',
      noQuestionsDesc:
        'Add questions that applicants must answer when they request to join.',
      addQuestion: 'Add question',
      questionNumber: 'Question {{n}}',
      questionLabelField: 'Label',
      questionLabelRequired: 'Label is required.',
      questionLabelTooLong: 'Label must be at most {{max}} characters.',
      questionType: 'Type',
      questionTypeText: 'Short text',
      questionTypeTextarea: 'Long text',
      questionMaxLength: 'Max length',
      questionPlaceholder: 'Placeholder (optional)',
      questionRequired: 'Required',
      moveUp: 'Move up',
      moveDown: 'Move down',
      removeQuestion: 'Remove question',
      noApplications: 'No pending applications',
      noApplicationsDesc:
        'When a player requests to join your clan, their application shows up here.',
      submittedAgo: 'Submitted {{when}}',
      approve: 'Approve',
      deny: 'Deny',
      applicationApproved: 'Application approved',
      applicationDenied: 'Application denied',
      decideError: 'Could not decide application',
      denyTitle: 'Deny application?',
      denyDesc:
        '{{name}}\u2019s application will be denied. They can re-apply if you change your mind.',
      confirmDeny: 'Deny',
      invitesForMe: 'Invites for you',
      noInvitesForMe: 'No invites waiting',
      noInvitesForMeDesc:
        'When a leader or officer invites you to their clan, it\u2019ll show up here.',
      invitesISent: 'Invites you\u2019ve sent',
      noInvitesISent: 'No sent invites',
      noInvitesISentDesc:
        'Once you invite a player from the Members tab, you\u2019ll see it here until they accept or it expires.',
      inviteAccepted: 'Invite accepted',
      inviteDeclined: 'Invite declined',
      inviteCancelled: 'Invite cancelled',
      inviteActionError: 'Could not update invite',
      accept: 'Accept',
      decline: 'Decline',
      descriptionLabel: 'Description',
      justNow: 'just now',
      minutesAgo: '{{n}}m ago',
      hoursAgo: '{{n}}h ago',
      daysAgo: '{{n}}d ago',
    },
  },
}
