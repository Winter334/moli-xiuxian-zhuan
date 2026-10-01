export interface WorldClockCheckpoint {
  timeMs: number;
  wallMs: number;
}

// This clock supplies dates, never simulation elapsed time.
export class WorldClock {
  private anchorMs: number;
  private anchorMono: number;

  constructor(private readonly wallNow: () => number, private readonly monotonicNow: () => number) {
    this.anchorMs = wallNow();
    this.anchorMono = monotonicNow();
  }

  now() {
    return this.anchorMs + Math.max(0, Math.floor(this.monotonicNow() - this.anchorMono));
  }

  calibrate(timeMs: number) {
    if (!Number.isSafeInteger(timeMs) || timeMs < 0) throw new Error('Invalid world time');
    this.anchorMs = timeMs;
    this.anchorMono = this.monotonicNow();
  }

  restore(checkpoint: WorldClockCheckpoint) {
    this.calibrate(checkpoint.timeMs + Math.max(0, this.wallNow() - checkpoint.wallMs));
  }

  checkpoint(): WorldClockCheckpoint {
    return { timeMs: this.now(), wallMs: this.wallNow() };
  }
}
