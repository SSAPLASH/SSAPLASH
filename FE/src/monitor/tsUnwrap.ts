// 스틱 시계 u32 µs 펼치기. 랩어라운드(약 71.6분)를 넘어도 시각이 단조 증가하도록 스틱별로 오프셋을 누적하고,
// 펼친 µs를 브라우저 시계(ms)로 환산하는 순수 함수를 함께 둔다. 판정 경로(ClockSync)와는 독립이다.

/** u32 µs 한 주기 */
export const WRAP_US = 2 ** 32;

interface StickState {
  /** 직전 원시값(펼치기 전). 아직 없으면 null */
  lastUs: number | null;
  /** 지금까지 더해진 랩 보정(µs) */
  offsetUs: number;
}

const fresh = (): StickState => ({ lastUs: null, offsetUs: 0 });

export class TsUnwrap {
  private states: [StickState, StickState] = [fresh(), fresh()];

  /**
   * 원시 µs를 펼친다. 직전보다 주기의 절반 넘게 작아지면 랩으로 보고 주기를 더한다.
   * 반대로 절반 넘게 크면 랩 직전에 보낸 늦은 패킷이므로 이번 값에만 주기를 빼고 상태는 유지한다.
   */
  feed(stick: 0 | 1, us: number): number {
    const s = this.states[stick];
    if (s.lastUs !== null) {
      if (us < s.lastUs - WRAP_US / 2) {
        s.offsetUs += WRAP_US;
      } else if (us > s.lastUs + WRAP_US / 2) {
        return us + s.offsetUs - WRAP_US;
      }
    }
    s.lastUs = us;
    return us + s.offsetUs;
  }

  /** 스틱을 지정하면 그 스틱만, 생략하면 둘 다 초기화 */
  reset(stick?: 0 | 1): void {
    if (stick === undefined) this.states = [fresh(), fresh()];
    else this.states[stick] = fresh();
  }
}

/** 펼친 µs → 브라우저 시각(ms). 시계 오프셋(센서 ms + offset = 브라우저 ms)이 아직 없으면 null */
export function toBrowserMs(unwrappedUs: number, clockOffsetMs: number | null): number | null {
  return clockOffsetMs === null ? null : unwrappedUs / 1000 + clockOffsetMs;
}

/** 브라우저 시각 기준 "수신 시각보다 얼마나 미래인가"(ms). 양수면 미래. 시각을 모르면 null */
export function futureMs(tBrowser: number | null, recvTime: number): number | null {
  return tBrowser === null ? null : tBrowser - recvTime;
}
