// 기기 사이 도착 지연 감시(PLAY-006). 센서 타격마다 표본을 모으고, 차이가 한도를 넘은 채 30초 이어지면 경고 상태로 본다.
// 화면은 모른다. bootstrap이 onChange로 받아 liveStore·진단 줄에 옮긴다.
import { isSensorSource, type ResolvedHit } from '@/domain/events';
import {
  ARRIVAL_SKEW_HOLD_MS,
  ARRIVAL_SKEW_KEEP,
  ARRIVAL_SKEW_LIMIT_MS,
  ARRIVAL_SKEW_WINDOW_MS,
  evaluateArrivalSkew,
  type ArrivalDevice,
  type ArrivalSample,
  type ClockSkew,
} from '@/domain/kit/device/arrivalSkew';

export type SkewPhase = 'start' | 'update' | 'end';
type Listener = (skew: ClockSkew | null, phase: SkewPhase) => void;

function emptySamples(): Record<ArrivalDevice, ArrivalSample[]> {
  return { left: [], right: [], pedal: [] };
}

/** 타격이 어느 기기에서 왔는지. 센서 타격이 아니면 null */
function deviceOf(hit: ResolvedHit): ArrivalDevice | null {
  if (!isSensorSource(hit.source)) return null;
  if (hit.foot !== undefined || hit.stickId === null) return 'pedal';
  return hit.stickId === 0 ? 'left' : 'right';
}

class ArrivalSkewWatch {
  private samples = emptySamples();
  private listener: Listener | null = null;
  /** 한도 초과가 처음 나온 시각(시작 대기 중). 아니면 null */
  private overSince: number | null = null;
  /** 경고 중 한도 이하가 처음 나온 시각(끝 대기 중). 아니면 null */
  private underSince: number | null = null;
  private latest: ClockSkew | null = null;
  private active = false;

  /** 지금 경고 중인 값. 경고가 아니면 null */
  get current(): ClockSkew | null {
    return this.active ? this.latest : null;
  }

  onChange(cb: Listener | null): void {
    this.listener = cb;
  }

  observe(hit: ResolvedHit, now: number = performance.now()): void {
    const device = deviceOf(hit);
    if (device === null) return;
    const lagMs = hit.tRecv - hit.tHit;
    if (!Number.isFinite(lagMs)) return;
    const list = this.samples[device];
    list.push({ at: now, lagMs });
    // 창 밖과 60개 넘은 옛 표본은 버린다
    while (list.length > 0 && now - list[0].at > ARRIVAL_SKEW_WINDOW_MS) list.shift();
    if (list.length > ARRIVAL_SKEW_KEEP) list.splice(0, list.length - ARRIVAL_SKEW_KEEP);
    this.advance(now, false);
  }

  /** 그 기기가 다시 연결됨: 표본을 비운다. 그 결과 비교할 기기가 모자라면 경고를 바로 끝낸다 */
  resetDevice(device: ArrivalDevice, now: number = performance.now()): void {
    this.samples[device] = [];
    this.advance(now, true);
  }

  /** 전부 비운다. 경고 중이었으면 끝낸다 */
  reset(): void {
    this.samples = emptySamples();
    this.overSince = null;
    this.underSince = null;
    const was = this.active;
    const last = this.latest;
    this.active = false;
    this.latest = null;
    if (was) this.listener?.(last, 'end');
  }

  private advance(now: number, endOnNoData: boolean): void {
    const skew = evaluateArrivalSkew(this.samples, now);
    if (!this.active) {
      if (skew !== null && skew.spreadMs > ARRIVAL_SKEW_LIMIT_MS) {
        this.overSince ??= now;
        if (now - this.overSince >= ARRIVAL_SKEW_HOLD_MS) {
          this.active = true;
          this.overSince = null;
          this.underSince = null;
          this.latest = skew;
          this.listener?.(skew, 'start');
        }
      } else {
        this.overSince = null;
      }
      return;
    }
    // 경고 중
    if (skew === null) {
      // 비교할 기기가 모자란다. 다시 연결돼 비웠다면 끝내고, 그냥 표본이 뜸한 것이면 판단을 미룬다
      this.underSince = null;
      if (endOnNoData) this.finish();
      return;
    }
    const prev = this.latest;
    this.latest = skew;
    if (skew.spreadMs <= ARRIVAL_SKEW_LIMIT_MS) {
      this.underSince ??= now;
      if (now - this.underSince >= ARRIVAL_SKEW_HOLD_MS) {
        this.finish();
        return;
      }
    } else {
      this.underSince = null;
    }
    if (prev !== null && prev.outlier !== skew.outlier) this.listener?.(skew, 'update');
  }

  private finish(): void {
    const last = this.latest;
    this.active = false;
    this.overSince = null;
    this.underSince = null;
    this.latest = null;
    this.listener?.(last, 'end');
  }
}

export const arrivalSkewWatch = new ArrivalSkewWatch();
