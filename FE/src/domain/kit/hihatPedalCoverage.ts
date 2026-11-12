export type HihatPedalCoverage = 'NONE' | 'COMPLETE' | 'PARTIAL';

/** 연주 시작부터 종료까지 연결 여부를 추적한다. 재시작마다 새 인스턴스를 만든다. */
export class HihatPedalCoverageTracker {
  private coverage: HihatPedalCoverage;
  constructor(connected: boolean, known: boolean) {
    this.coverage = connected ? (known ? 'COMPLETE' : 'PARTIAL') : 'NONE';
  }
  connection(connected: boolean): void {
    if (connected && this.coverage === 'NONE') this.coverage = 'PARTIAL';
    if (!connected && this.coverage === 'COMPLETE') this.coverage = 'PARTIAL';
  }
  unknownHit(): void {
    if (this.coverage !== 'NONE') this.coverage = 'PARTIAL';
  }
  value(): HihatPedalCoverage { return this.coverage; }
}

/** 열린 노트의 성공 판정에 닫힌 페달을 사용한 경우만 강조한다. */
export function shouldWarnOpenHihat(open: boolean, judgement: string | undefined, closed: boolean | null | undefined, connected: boolean): boolean {
  return open && (judgement === 'PERFECT' || judgement === 'GOOD') && closed === true && connected;
}
