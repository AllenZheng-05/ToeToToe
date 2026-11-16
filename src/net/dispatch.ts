/**
 * Calls every listener with `args`, even if one throws: a bad listener must not stop the others from
 * hearing a message. A throw is logged (development builds only) and the loop carries on.
 */
export function dispatch<A extends unknown[]>(listeners: Iterable<(...args: A) => void>, ...args: A): void {
  for (const cb of [...listeners]) {
    try {
      cb(...args);
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('A listener threw while handling a message', err);
    }
  }
}
