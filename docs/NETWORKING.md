# Networking

## Transport and rooms

- **Transport:** WebRTC data channels through Trystero, behind the `Transport` interface (see `docs/ARCHITECTURE.md`). Use its default strategy; make the strategy a config value so my Supabase project can take over the handshake later.
- **Rooms.** The creator gets a short code (three short parts, such as `ROW-G-12`). The link is `toetotoe.allenzheng.com/ROW-G-12`; also accept `?room=ROW-G-12`. A room holds two players; a third visitor sees "this room is full".
- **Referee.** The room creator's browser owns the clock start, health, stamina and act state, and sends state after every phrase. The other browser renders from that.
- **Clock sync.** A handful of ping exchanges when the room fills estimate the offset between the two audio clocks. The creator then sends "the song starts at T". A strike has a whole phrase to arrive, so ordinary lag is invisible.
- **Messages** (typed, small): hello with display name; puppet drawings; theme offer and song data; ready; clock ping and pong; start time; strike planted (live preview); phrase committed; parry results; state after each phrase; rematch; leave.
- **Leaving.** If either player disconnects mid-match, show it plainly and return the other to the lobby.

Known limits, accepted:

- Two players who are both behind strict network address translation cannot connect without a relay. Ship without one; add a TURN relay only if friends report failures.
- The creator's browser is trusted. There is no cheat protection and no ranked play.

## Testing without two people

- **A swappable transport.** The game talks to the other player through one `Transport` interface with three implementations: the real peer-to-peer one, a **loopback** that connects two game instances in the same page or across two tabs (BroadcastChannel), and the bot.
- **Two-window checks with Playwright.** Open two pages on the loopback transport, script pointer input on both from a list of timed events, play a full act, and assert on the outcome (health totals, act winner, both pages agree). Fail on console errors. Save screenshots and compare them by eye against `design/screenshots/`.

The message and transport types are in `src/core/types.ts`; the event flow is in `docs/ARCHITECTURE.md`.
