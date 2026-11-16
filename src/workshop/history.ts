import { cloneBitmap, type Bitmap } from './bitmap';

/** Undo/redo of whole-bitmap snapshots, capped (default 30 steps). */
export class History {
  private undoStack: Bitmap[] = [];
  private redoStack: Bitmap[] = [];
  private readonly limit: number;

  constructor(limit = 30) {
    this.limit = limit;
  }

  /** Record the state as it is BEFORE a change. Clears redo. */
  push(b: Bitmap): void {
    this.undoStack.push(cloneBitmap(b));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the previous snapshot (and keeps `current` for redo), or null. */
  undo(current: Bitmap): Bitmap | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(cloneBitmap(current));
    return prev;
  }

  redo(current: Bitmap): Bitmap | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneBitmap(current));
    return next;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
