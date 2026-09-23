import { invoke, isTauri } from '@tauri-apps/api/core'

export type HttpFetchInit = Pick<RequestInit, 'method' | 'headers' | 'body'> & {
  credentials?: 'omit'
  redirect?: 'follow' | 'error'
}

interface NativeResponse {
  status: number
  statusText: string
  headers: [string, string][]
  body: number[]
  url: string
}

/**
 * Shared HTTP transport: Rust on desktop (no WebView CORS), fetch in browsers.
 * Accepts fetch-style methods, headers and bodies, and returns a Response.
 * Requests/responses are buffered; streaming, AbortSignal and browser-managed
 * cookies/cache options are intentionally outside this API. Supply bearer
 * headers explicitly: this transport never reads or adds an auth token.
 */
export async function httpFetch(url: string | URL, init: HttpFetchInit = {}): Promise<Response> {
  if (!isTauri()) return fetch(url, { ...init, credentials: 'omit' })

  // Request normalizes headers and serializes JSON strings, FormData, blobs,
  // URLSearchParams and binary bodies using the browser's standard encoding.
  const request = new Request(url, { ...init, credentials: 'omit' })
  const body = request.body === null ? null : Array.from(new Uint8Array(await request.arrayBuffer()))
  let native: NativeResponse
  try {
    native = await invoke<NativeResponse>('http_fetch', {
      url: request.url,
      method: request.method,
      headers: Array.from(request.headers.entries()),
      body,
      redirect: request.redirect,
    })
  } catch (error) {
    // IPC rejects with strings; expose a normal fetch-style network error.
    throw new TypeError(error instanceof Error ? error.message : String(error))
  }
  const response = new Response(
    request.method === 'HEAD' || [204, 205, 304].includes(native.status) ? null : new Uint8Array(native.body),
    { status: native.status, statusText: native.statusText, headers: native.headers },
  )
  return withResponseMetadata(response, native.url, native.url !== request.url)
}

function withResponseMetadata(response: Response, url: string, redirected: boolean): Response {
  const clone = response.clone.bind(response)
  Object.defineProperties(response, {
    url: { value: url },
    redirected: { value: redirected },
    clone: { value: () => withResponseMetadata(clone(), url, redirected) },
  })
  return response
}
