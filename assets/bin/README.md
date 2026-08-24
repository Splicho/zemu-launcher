# Place unarc.exe in this directory

The launcher's FreeArc extractor resolves `unarc.exe` from this path in
production builds:

- bundled into `resources/assets/bin/unarc.exe` (NSIS installer layout)
- resolved at runtime by `src-tauri/src/update.rs::resolve_unarc_path`

`unarc.exe` is the standalone FreeArc 0.666 unpacker. It is **not**
redistributed with this repo (FreeArc is GPL-licensed — including the
binary would force this project under GPL). Download the official
`freeArc-0.666-windows.zip` from
<https://sourceforge.net/projects/freearc/files/FreeArc/> and place
`unarc.exe` here before running `pnpm tauri build`.

The Rust extraction path will fail loudly if the binary is missing, so
nothing silently breaks.
