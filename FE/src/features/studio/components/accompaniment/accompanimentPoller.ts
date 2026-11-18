// 반주 생성 중 곡 폴링 (설계 CHART-002 반주 상태 4-2). React와 무관한 타이머·조회 순서만 맡고, 화면 연결은 useAccompanimentPolling이 한다.
// 3초 뒤 대상 곡을 한 곡씩 다시 읽어 넘기고, 회차가 끝나면 남은 대상이 있을 때 다음 회차를 건다. 인스턴스당(화면 진입당) 최대 20회.
import { ApiError } from '@/api/http';
import type { SongSummary } from '@/domain/song/songCatalog';

export const ACC_POLL_INTERVAL_MS = 3000;
export const ACC_POLL_MAX_TRIES = 20;

export interface AccompanimentPollerDeps {
  fetchSong: (id: number, signal: AbortSignal) => Promise<SongSummary>;
  onSong: (song: SongSummary) => void;
  intervalMs?: number;
  maxTries?: number;
}

export class AccompanimentPoller {
  private tries = 0;
  /** 그 사이 삭제(404)된 곡. 다시 읽지 않는다 */
  private readonly gone = new Set<number>();
  private ids: number[] = [];
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 진행 중 회차의 중단 신호. 회차가 없으면 null */
  private ctrl: AbortController | null = null;

  private readonly deps: AccompanimentPollerDeps;

  constructor(deps: AccompanimentPollerDeps) {
    this.deps = deps;
  }

  /** 끝낸 회차 수 */
  get triesUsed(): number {
    return this.tries;
  }

  /**
   * 대상 곡 id와 활성 여부(화면에 있고 탭이 보임)를 알린다. 비활성이면 대기·진행 중 회차를 멈춘다.
   * 활성이면 대기 중 타이머나 진행 중 회차는 그대로 두고(새 대상은 다음 회차에 읽는다), 아무것도 없을 때만 회차를 건다.
   */
  update(ids: readonly number[], active: boolean): void {
    this.ids = ids.filter((id) => !this.gone.has(id));
    this.active = active;
    if (!active) {
      this.cancel();
      return;
    }
    if (this.timer === null && this.ctrl === null) this.schedule();
  }

  /** 사용자가 재시도한 곡은 화면을 오래 열어 폴링 횟수를 소진했어도 다시 확인한다. */
  restart(id: number): void {
    this.gone.delete(id);
    this.tries = 0;
    if (this.timer === null && this.ctrl === null) this.schedule();
  }

  dispose(): void {
    this.active = false;
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.ctrl?.abort();
    this.ctrl = null;
  }

  private schedule(): void {
    const max = this.deps.maxTries ?? ACC_POLL_MAX_TRIES;
    if (!this.active || this.ids.length === 0 || this.tries >= max) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const ctrl = new AbortController();
      this.ctrl = ctrl;
      void this.round(ctrl);
    }, this.deps.intervalMs ?? ACC_POLL_INTERVAL_MS);
  }

  private async round(ctrl: AbortController): Promise<void> {
    // 동시 요청 없이 한 곡씩. 한 곡 조회 실패는 그 회차만 건너뛴다
    for (const id of [...this.ids]) {
      if (ctrl.signal.aborted) return;
      try {
        const song = await this.deps.fetchSong(id, ctrl.signal);
        if (ctrl.signal.aborted) return;
        this.deps.onSong(song);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) this.gone.add(id);
      }
    }
    if (ctrl.signal.aborted) return;
    this.ctrl = null;
    this.tries += 1;
    this.ids = this.ids.filter((id) => !this.gone.has(id));
    this.schedule();
  }
}
