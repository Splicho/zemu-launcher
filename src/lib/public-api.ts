import { invoke, isTauri } from '@tauri-apps/api/core'

interface NativeResponse {
  status: number
  body: string
}

/** Public, anonymous GETs. Linux uses Rust to avoid WebKitGTK's CORS origin.
 * Other desktop platforms and browser previews keep the existing fetch path.
 */
export async function fetchPublicApi(url: string): Promise<Pick<Response, 'ok' | 'status' | 'json'>> {
  if (isTauri()) {
    let response: NativeResponse | null
    try {
      // Rust chooses the transport using the actual OS, not the user agent.
      response = await invoke<NativeResponse | null>('public_api_get', { url })
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
  return fetch(url)
}
