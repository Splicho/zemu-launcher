import { invoke, isTauri } from '@tauri-apps/api/core'

interface NativeResponse {
  status: number
  body: string
}

/**
 * Authenticated GETs against endpoints that the api gates with
 * `InternalApiGuard` (which accepts `Authorization: Bearer
 * API_INTERNAL_KEY`).
 *
 * Mirrors `fetchPublicApi` — Linux uses the native Rust transport
 * (no CORS issues), Windows/macOS and the browser preview fall
 * through to the renderer's `fetch`. The key is passed through to
 * both paths, so whichever transport runs ends up sending the
 * bearer.
 *
 * Trust model: the key comes from `VITE_LAUNCHER_INTERNAL_API_KEY`
 * (inlined at build time) and is therefore public to anyone with
 * a launcher binary. This is the same trust model the api uses for
 * the Discord bot, the moderation proxy, the authkeys proxy, and
 * every other internal service — `API_INTERNAL_KEY` is a shared
 * service secret, not a per-user secret.
 */
export async function fetchInternalApi(
  url: string,
  key: string,
): Promise<Pick<Response, 'ok' | 'status' | 'json'>> {
  if (isTauri()) {
    let response: NativeResponse | null
    try {
      response = await invoke<NativeResponse | null>('internal_api_get', {
        url,
        key,
      })
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
    if (response !== null) {
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        json: async () => JSON.parse(response.body),
      }
    }
  }
  return fetch(url, {
    headers: { authorization: `Bearer ${key}` },
  })
}
