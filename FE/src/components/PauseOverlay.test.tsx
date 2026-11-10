import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setReconnectHandler } from '@/store/reconnectStore';
import { useSettings } from '@/store/settingsStore';
import { PauseOverlay, type PauseReason } from './PauseOverlay';

const noop = () => {};

function render(reason: PauseReason, canResume: boolean) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PauseOverlay reason={reason} canResume={canResume} onResume={noop} onRestart={noop} onLeave={noop} returnTo="/play" />
    </MemoryRouter>,
  );
}

beforeEach(() => setReconnectHandler(null));

describe('PauseOverlay 일시정지', () => {
  it('제목·부제', () => {
    const html = render('user', true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('>일시정지</h2>');
    expect(html).toContain('잠시 쉬어가도 괜찮아요');
  });

  it('버튼 3개가 계속 → 다시 시작 → 나가기 순서', () => {
    const html = render('user', true);
    expect(html.match(/<button/g)).toHaveLength(3);
    const a = html.indexOf('계속</button>');
    const b = html.indexOf('다시 시작</button>');
    const c = html.indexOf('나가기</button>');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('다시 시작만 브랜드 틴트 클래스를 갖는다', () => {
    const html = render('user', true);
    expect(html.match(/play-pause-restart/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*play-pause-restart[^>]*>다시 시작<\/button>/);
  });

  it('음량 줄마다 장식 아이콘(끔·켬)이 aria-hidden으로 앞뒤에 있고, 슬라이더 이름은 라벨 그대로다', () => {
    const html = render('user', true);
    expect(html.match(/ui-slider-track-row/g)).toHaveLength(2);
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(4);
    expect(html).toContain('>드럼 음량</label>');
    expect(html).toContain('>노래 음량(반주)</label>');
    expect(html).toContain('play-pause-sound-divider');
    expect(html).not.toContain('play-pause-sound-off');
  });

  it('canResume이면 [계속]이 활성이고 준비 문구가 없다', () => {
    const html = render('user', true);
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('play-pause-warn');
  });

  // 준비 문구 내용(ReadinessNotice)은 스토어 의존이라 마크업 테스트에서 비어 있다 — 경고 영역 존재만 확인
  it('canResume=false면 [계속]이 비활성이고 준비 문구 영역을 함께 보인다', () => {
    const html = render('menu', false);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>계속<\/button>/);
    expect(html).toContain('play-pause-warn');
  });
});

describe('PauseOverlay 연결 끊김', () => {
  it('reason=disconnected면 DisconnectNotice 마크업', () => {
    const html = render('disconnected', false);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('stick-disconnect');
    expect(html).not.toContain('잠시 쉬어가도 괜찮아요');
  });

  it('reason=reconnected면 「재연결 성공!」 카드(버튼 없음)', () => {
    const html = render('reconnected', true);
    expect(html).toContain('재연결 성공!');
    expect(html).toContain('3초 뒤 이어서 연주해요');
    expect(html).not.toContain('<button');
  });

  it('재연결 핸들러가 없으면 [다시 연결]이 없다', () => {
    expect(render('disconnected', false)).not.toContain('다시 연결</button>');
  });

  // renderToStaticMarkup은 zustand 서버 스냅샷(초기 상태)을 읽어 available=true를 반영하지 못한다 — 건너뜀
});

// zustand v5는 서버 렌더에서 getInitialState()를 읽으므로(setState가 반영되지 않는다) 초기 상태 객체에도 값을 넣고 끝나면 되돌린다
const restores: Array<() => void> = [];
function putSettings(patch: Record<string, unknown>): void {
  const initial = useSettings.getInitialState() as unknown as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const prev = initial[key];
    restores.push(() => {
      initial[key] = prev;
    });
  }
  Object.assign(initial, patch);
  useSettings.setState(patch);
}
afterEach(() => {
  while (restores.length) restores.pop()?.();
});

describe('PauseOverlay 페달 점', () => {
  // 인수 조건: 동글(webserial) 소스일 때만 끊김 카드에 P 점
  it('webserial이면 끊김 카드에 P 점이 있다', () => {
    putSettings({ sensorKind: 'webserial' });
    const html = render('disconnected', false);
    expect(html).toContain('>P<');
  });

  // 인수 조건: 동글이 아닌 소스(키보드 전용·BLE)는 P 점·페달 문구가 없다
  it('webserial이 아니면 P 점과 페달 문구가 없다', () => {
    for (const kind of ['none', 'ble']) {
      putSettings({ sensorKind: kind });
      const html = render('disconnected', false);
      expect(html).not.toContain('>P<');
      expect(html).not.toContain('페달');
    }
  });
});
