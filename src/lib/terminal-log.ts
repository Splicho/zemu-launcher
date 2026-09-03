import { invoke } from '@tauri-apps/api/core'

type TerminalLogMetadata = Record<string, unknown> | undefined

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function logToTerminal(
  source: string,
  message: string,
  metadata?: TerminalLogMetadata,
): void {
  const content = metadata ? `${message} | ${safeStringify(metadata)}` : message
  const line = `[${source}] ${content}`

  console.info(line)
  if (!isTauriRuntime()) return

  void invoke('log_to_terminal', { message: line }).catch(() => undefined)
}
