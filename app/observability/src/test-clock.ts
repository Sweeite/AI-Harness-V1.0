// A deterministic clock + id source for tests (no Date.now / no random in assertions — the house pattern,
// cf. app/release NOW=fixed epoch). Advances only when told; ids are sequential.

import type { WriterClock } from "./event-writer.ts";

export class TestClock implements WriterClock {
  private ms: number;
  private seq = 0;
  constructor(startMs = 1_800_000_000_000) {
    this.ms = startMs;
  }
  now(): Date {
    return new Date(this.ms);
  }
  nowMs(): number {
    return this.ms;
  }
  advance(deltaMs: number): void {
    this.ms += deltaMs;
  }
  set(ms: number): void {
    this.ms = ms;
  }
  newId(): string {
    this.seq += 1;
    return `evt-${String(this.seq).padStart(6, "0")}`;
  }
}
