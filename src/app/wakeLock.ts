/** Keeps the screen on during a match where the browser allows it. Failures are ignored silently. */
export function holdWakeLock(): () => void {
  let sentinel: WakeLockSentinel | null = null;
  let held = true;

  const acquire = (): void => {
    if (!held || sentinel !== null || document.hidden) return;
    try {
      const wakeLock = navigator.wakeLock;
      if (!wakeLock) return;
      wakeLock
        .request('screen')
        .then((s) => {
          if (!held) {
            void s.release().catch(() => undefined);
            return;
          }
          sentinel = s;
          s.addEventListener('release', () => {
            if (sentinel === s) sentinel = null;
          });
        })
        .catch(() => undefined);
    } catch {
      /* not available */
    }
  };
  // A hidden page loses its lock; ask again when it is shown.
  const onVisible = (): void => {
    if (!document.hidden) acquire();
  };
  document.addEventListener('visibilitychange', onVisible);
  acquire();

  return () => {
    held = false;
    document.removeEventListener('visibilitychange', onVisible);
    const s = sentinel;
    sentinel = null;
    if (s) void s.release().catch(() => undefined);
  };
}
