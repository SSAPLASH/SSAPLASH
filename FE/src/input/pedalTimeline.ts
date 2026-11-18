// 페달 상태를 브라우저 시각순으로 보관한다. 같은 시각은 마지막 수신값이 우선한다.
export class PedalTimeline {
  private events: { timestamp: number; closed: boolean }[] = [];

  clear(): void { this.events = []; }

  add(timestamp: number, closed: boolean): void {
    if (!Number.isFinite(timestamp)) return;
    const i = this.events.findIndex((e) => e.timestamp >= timestamp);
    if (i < 0) this.events.push({ timestamp, closed });
    else if (this.events[i].timestamp === timestamp) this.events[i] = { timestamp, closed };
    else this.events.splice(i, 0, { timestamp, closed });
    if (this.events.length > 32) this.events.shift();
  }

  stateAt(timestamp: number): boolean | null {
    if (!Number.isFinite(timestamp)) return null;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].timestamp <= timestamp) return this.events[i].closed;
    }
    return null;
  }
}
