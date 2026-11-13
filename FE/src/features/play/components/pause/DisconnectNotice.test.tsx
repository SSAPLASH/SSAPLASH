import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DisconnectNotice, type ReconnectInfo } from './DisconnectNotice';

const idle: ReconnectInfo = { status: 'idle', attempt: 0, max: 3 };
const failed: ReconnectInfo = { status: 'failed', attempt: 3, max: 3 };
const noop = () => {};

function render(p: { left?: boolean; right?: boolean; pedal?: boolean; status?: ReconnectInfo; onReconnect?: () => void; onOpenSetup?: () => void }) {
  return renderToStaticMarkup(
    <DisconnectNotice
      left={p.left ?? false}
      right={p.right ?? false}
      pedal={p.pedal}
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
  it('연결은 on·연결됨, 끊긴 점은 off·연결 안 됨', () => {
    const html = render({ left: true, right: false });
    expect(html).toContain('stick-dot on');
    expect(html).toContain('stick-dot off');
    expect(html).toContain('연결됨');
    expect(html).toContain('연결 안 됨');
    expect(html).not.toContain('끊김');
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
    // 시도 중 [다시 연결]은 눌러도 된다(다음 시도를 바로 시작)
    expect(html).not.toContain('aria-disabled');
  });
  it('trying: 스피너와 끊긴 손 점 맥동', () => {
    const html = render({ left: true, right: false, status: { status: 'trying', attempt: 2, max: 3 }, onReconnect: noop });
    expect(html).toContain('stick-spinner');
    expect(html).toContain('stick-dot off pulse');
    // 연결된 손은 맥동하지 않는다
    expect(html).not.toContain('stick-dot on pulse');
  });
  it('trying이 아니면 스피너·맥동 없음', () => {
    expect(render({})).not.toContain('stick-spinner');
    expect(render({ status: failed })).not.toContain('pulse');
  });
  it('failed: hint가 없으면 기존 안내', () => {
    const html = render({ status: failed });
    expect(html).toContain('연결하지 못했어요.');
    expect(html).toContain('드럼 세팅에서 연결해 주세요.');
  });
  it('failed: hint가 있으면 그 문구', () => {
    const html = render({ status: { ...failed, hint: '동글을 뺐다 다시 꽂아 주세요' } });
    expect(html).toContain('연결하지 못했어요.');
    expect(html).toContain('동글을 뺐다 다시 꽂아 주세요');
    expect(html).not.toContain('드럼 세팅에서 연결해 주세요.');
  });
});

describe('DisconnectNotice reconnected', () => {
  const reconnected: ReconnectInfo = { status: 'reconnected', attempt: 0, max: 3 };
  it('제목·문구, 점 둘 모두 on(props와 무관), 버튼 없음, role=status', () => {
    const html = render({ left: false, right: false, status: reconnected, onReconnect: noop, onOpenSetup: noop });
    expect(html).toContain('재연결 성공!');
    expect(html).toContain('3초 뒤 이어서 연주해요');
    expect(html).not.toContain('stick-dot off');
    expect(html.match(/stick-dot on/g)).toHaveLength(2);
    expect(html).not.toContain('<button');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('alertdialog');
    expect(html).not.toContain('스틱 연결이 끊겼어요');
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

describe('DisconnectNotice 페달', () => {
  // 인수 조건: pedal이 undefined면 P 점·"페달" 문구가 없다
  it('pedal이 없으면 P 점과 페달 문구가 없다', () => {
    const html = render({ left: true, right: false });
    expect(html).not.toContain('>P<');
    expect(html).not.toContain('페달');
  });

  // 인수 조건: 페달만 끊기면(손 둘 연결) "페달 연결이 끊겼어요"와 꺼진 P 점
  it('손이 모두 연결이고 페달만 끊기면 페달 제목', () => {
    const html = render({ left: true, right: true, pedal: false });
    expect(html).toContain('페달 연결이 끊겼어요');
    expect(html).not.toContain('스틱·페달');
    expect(html).toContain('stick-dot off');
    expect(html).toContain('>P<');
  });

  // 인수 조건: 손이 하나라도 끊기면 "스틱·페달 연결이 끊겼어요"
  it('손도 끊겼으면 스틱·페달 제목', () => {
    expect(render({ left: false, right: true, pedal: false })).toContain('스틱·페달 연결이 끊겼어요');
    expect(render({ left: false, right: false, pedal: false })).toContain('스틱·페달 연결이 끊겼어요');
  });

  // 인수 조건: 페달이 붙어 있으면 P 점이 on이고 손 제목은 그대로
  it('페달이 연결이면 P 점이 on', () => {
    const html = render({ left: true, right: false, pedal: true });
    expect(html).toContain('오른손 스틱 연결이 끊겼어요');
    expect(html.match(/stick-dot on/g)).toHaveLength(2);
  });

  // 인수 조건: reconnected면 점 셋 모두 on
  it('reconnected면 P 점도 on', () => {
    const html = render({ left: false, right: false, pedal: false, status: { status: 'reconnected', attempt: 0, max: 3 } });
    expect(html.match(/stick-dot on/g)).toHaveLength(3);
    expect(html).not.toContain('stick-dot off');
  });
});

describe('DisconnectNotice 재정렬 프롬프트(PLAY-004 D12)', () => {
  const reconnected: ReconnectInfo = { status: 'reconnected', attempt: 0, max: 3 };
  it('reconnected + realign이면 「3초 뒤」 대신 스네어 프롬프트와 [건너뛰기]', () => {
    const html = renderToStaticMarkup(
      <DisconnectNotice left right status={reconnected} onExit={noop} realign={{ hands: [1], done: [false, false], onSkip: noop }} />,
    );
    expect(html).toContain('재연결 성공!');
    expect(html).toContain('오른손으로 스네어를 한 번 쳐 주세요');
    expect(html).toContain('건너뛰기');
    expect(html).not.toContain('3초 뒤 이어서 연주해요');
    expect(html).toContain('realign-prompt card');
  });
  it('reconnected가 아니면 realign을 줘도 프롬프트가 없다', () => {
    const html = renderToStaticMarkup(
      <DisconnectNotice left={false} right status={idle} onExit={noop} realign={{ hands: [1], done: [false, false], onSkip: noop }} />,
    );
    expect(html).not.toContain('realign-prompt');
  });
});
