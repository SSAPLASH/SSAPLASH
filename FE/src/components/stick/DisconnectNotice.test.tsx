import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DisconnectNotice, type ReconnectInfo } from './DisconnectNotice';

const idle: ReconnectInfo = { status: 'idle', attempt: 0, max: 3 };
const failed: ReconnectInfo = { status: 'failed', attempt: 3, max: 3 };
const noop = () => {};

function render(p: { left?: boolean; right?: boolean; status?: ReconnectInfo; onReconnect?: () => void; onOpenSetup?: () => void }) {
  return renderToStaticMarkup(
    <DisconnectNotice
      left={p.left ?? false}
      right={p.right ?? false}
      status={p.status ?? idle}
      onExit={noop}
      onReconnect={p.onReconnect}
      onOpenSetup={p.onOpenSetup}
    />,
  );
}

describe('DisconnectNotice 제목', () => {
  it('왼손만 끊기면 왼손', () => {
    expect(render({ left: false, right: true })).toContain('왼손 스틱 연결이 끊겼어요');
  });
  it('오른손만 끊기면 오른손', () => {
    expect(render({ left: true, right: false })).toContain('오른손 스틱 연결이 끊겼어요');
  });
  it('둘 다 끊기면 양손', () => {
    expect(render({})).toContain('양손 스틱 연결이 끊겼어요');
  });
});

describe('DisconnectNotice 연결 점', () => {
  it('연결은 on·연결됨, 끊김은 off·끊김', () => {
    const html = render({ left: true, right: false });
    expect(html).toContain('stick-dot on');
    expect(html).toContain('stick-dot off');
    expect(html).toContain('연결됨');
    expect(html).toContain('끊김');
  });
  it('둘 다 연결이면 off 없음', () => {
    expect(render({ left: true, right: true })).not.toContain('stick-dot off');
  });
});

describe('DisconnectNotice 상태 문구', () => {
  it('idle', () => {
    expect(render({})).toContain('연주를 멈췄어요. 다시 연결되면 이어서 할 수 있어요.');
  });
  it('trying n/max', () => {
    const html = render({ status: { status: 'trying', attempt: 2, max: 3 }, onReconnect: noop });
    expect(html).toContain('다시 연결하는 중… (2/3)');
    expect(html).toContain('aria-disabled="true"');
  });
  it('failed', () => {
    expect(render({ status: failed })).toContain('연결하지 못했어요. 드럼 세팅에서 연결해 주세요.');
  });
});

describe('DisconnectNotice 버튼', () => {
  it('onReconnect가 없으면 [다시 연결]이 없고 [나가기]는 있다', () => {
    const html = render({});
    expect(html).not.toContain('다시 연결</button>');
    expect(html).toContain('나가기');
  });
  it('onReconnect가 있으면 [다시 연결]', () => {
    expect(render({ onReconnect: noop })).toContain('다시 연결</button>');
  });
  it('failed이고 onOpenSetup이 있으면 [드럼 세팅에서 연결하기]가 [다시 연결]을 대신한다', () => {
    const html = render({ status: failed, onReconnect: noop, onOpenSetup: noop });
    expect(html).toContain('드럼 세팅에서 연결하기</button>');
    expect(html).not.toContain('다시 연결</button>');
  });
  it('failed여도 onOpenSetup이 없으면 [다시 연결]', () => {
    const html = render({ status: failed, onReconnect: noop });
    expect(html).toContain('다시 연결</button>');
    expect(html).not.toContain('드럼 세팅에서 연결하기');
  });
  it('idle이면 [드럼 세팅에서 연결하기]가 없다', () => {
    expect(render({ onReconnect: noop, onOpenSetup: noop })).not.toContain('드럼 세팅에서 연결하기');
  });
});
