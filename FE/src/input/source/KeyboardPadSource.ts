// PLAY-10 키보드 입력. 키 코드를 실은 타격 이벤트만 낸다 — 어느 패드인지는 키 매퍼(padMapper)가 정한다.
// 항상 켜진 보조 소스(설계 D9). 센서 소스가 있어도 킥(Space)·시연 안전망으로 쓴다.
import type { StickId } from '@/domain/events';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/kit/keyTarget';
import { BaseInputSource } from './InputSource';

/** 키보드 타격의 가속도 모사값. 벨로시티 ≈ 100 / Shift 누르면 악센트 */
const NORMAL_ACCEL_G = 6.3;
const ACCENT_ACCEL_G = 8.0;

export class KeyboardPadSource extends BaseInputSource {
  readonly kind = 'keyboard' as const;
  readonly label = '키보드';
  /** 반응할 키 코드. 비어 있으면 모든 키를 무시한다 */
  private keys = new Set<string>();
  /** 꺼져 있으면 keydown을 치지도 막지도 않는다. 클래스 기본은 켬(기존 동작), 앱 인스턴스는 꺼진 채로 시작한다 */
  private enabled = true;

  /** 키보드 드럼을 켜고 끈다. 연주 중인 화면만 켜고, 그 밖에서는 브라우저 기본 동작(스크롤·단축키)을 건드리지 않는다 */
  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  /** 매핑된 키 목록만 받는다. 패드 정보는 받지 않는다 */
  setKeys(codes: Iterable<string>): void {
    this.keys = new Set(codes);
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (ev.repeat) return;
    // Ctrl/Alt/Meta 조합은 브라우저·OS 단축키(개발자 도구 Ctrl+Shift+I 등)라 치지도 막지도 않는다. Shift는 악센트로 허용
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (!this.keys.has(ev.code)) return;
    // D7: 입력 칸·다이얼로그, 버튼·링크의 Enter/Space는 그 요소가 쓰는 키라 치지도 막지도 않는다
    if (isKeyOwnedByTarget(ev.target as KeyTarget, ev.code)) return;
    ev.preventDefault();
    const now = performance.now();
    // stickId는 키 매퍼가 바인딩으로 덮어쓴다. 여기선 자리만 채운다
    const stickId: StickId = 0;
    this.emit({
      kind: 'hit',
      stickId,
      timestamp: now,
      recvTime: now,
      peakAccel: ev.shiftKey ? ACCENT_ACCEL_G : NORMAL_ACCEL_G,
      pitch: 0,
      yaw: 0,
      keyCode: ev.code,
    });
  };

  async connect(): Promise<void> {
    window.addEventListener('keydown', this.onKeyDown);
    this.setState('connected');
    this.emit({ kind: 'status', stickId: 0, connected: true });
    this.emit({ kind: 'status', stickId: 1, connected: true });
  }

  async disconnect(): Promise<void> {
    window.removeEventListener('keydown', this.onKeyDown);
    this.setState('disconnected');
  }
}
