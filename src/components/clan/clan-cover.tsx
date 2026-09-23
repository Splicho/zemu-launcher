/**
 * Cover banner rendered above the clan identity row. Mirrors the
 * website's `apps/web/app/clans/[slug]/page.tsx` cover element:
 *
 *   - `h-64` height with `brightness-50` overlay so the avatar
 *     still pops against busy covers without obscuring them.
 *   - `rounded-3xl` outer container.
 *   - Plain `<img>` rather than `next/image` — the launcher's
 *     Tauri webview can't dedupe remote image bytes the way
 *     next/image does, so we keep the bare element.
 *
 * When `coverImageUrl` is null the cover is omitted entirely so the
 * identity row never tries to overlap a non-existent banner.
 */
export function ClanCover({ coverImageUrl, name }: { coverImageUrl: string | null; name: string }) {
  if (!coverImageUrl) return null
  return (
    <div className="relative overflow-hidden rounded-3xl">
      <img
        src={coverImageUrl}
        alt={`${name}'s cover`}
        className="h-64 w-full object-cover brightness-50"
      />
    </div>
  )
}
