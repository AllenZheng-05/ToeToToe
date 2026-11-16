/** Address-bar helpers for rooms. The query string (debug, net, tunables) is always kept. */

/** `/CODE` plus the current query string. Pure. */
export function roomPathFor(code: string, search: string): string {
  return `/${encodeURIComponent(code)}${search}`;
}

/** `/` plus the current query string. Pure. */
export function titlePathFor(search: string): string {
  return `/${search}`;
}

/** Put the room code in the address bar without reloading. */
export function showRoomInAddress(code: string): void {
  try {
    history.pushState(null, '', roomPathFor(code, location.search));
  } catch {
    // history unavailable (sandboxed frame): the link can still be shared from the lobby
  }
}

/** Take the room code out of the address bar again. */
export function clearRoomFromAddress(): void {
  try {
    history.replaceState(null, '', titlePathFor(location.search));
  } catch {
    // see above
  }
}
