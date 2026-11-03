import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccompanimentBar } from './AccompanimentBar';
import { DisconnectBand, type BandReconnect } from './DisconnectBand';

const noop = () => {};
const idle: BandReconnect = { status: 'idle', attempt: 0, max: 3 };

describe('AccompanimentBar', () => {
  it('none 문구를 보여준다', () => {
    const html = renderToStaticMarkup(<AccompanimentBar />);
    expect(html).toContain('반주 없이 연습 중');
    expect(html).toContain('반주 고르기');
  });

  it('onPick이 없으면 비활성 + title 곧 지원', () => {
    const html = renderToStaticMarkup(<AccompanimentBar />);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('title="곧 지원"');
  });

  it('onPick이 있으면 활성', () => {
    const html = renderToStaticMarkup(<AccompanimentBar onPick={noop} />);
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain('곧 지원');
  });
});

describe('DisconnectBand', () => {
  it('끊긴 손을 제목에 쓴다', () => {
    expect(renderToStaticMarkup(<DisconnectBand left={true} right={false} reconnect={idle} />)).toContain('오른손 스틱 연결이 끊겼어요');
    expect(renderToStaticMarkup(<DisconnectBand left={false} right={true} reconnect={idle} />)).toContain('왼손 스틱 연결이 끊겼어요');
  });

  it('role=status', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).toContain('role="status"');
  });

  it('idle: 살아있는 손은 계속 칠 수 있다는 문구', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).toContain('왼손은 계속 칠 수 있어요');
    expect(renderToStaticMarkup(<DisconnectBand left={false} right reconnect={idle} />)).toContain('오른손은 계속 칠 수 있어요');
  });

  it('trying: 시도 횟수 표시', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'trying', attempt: 2, max: 3 }} onReconnect={noop} />,
    );
    expect(html).toContain('다시 연결하는 중');
    expect(html).toContain('(2/3)');
    expect(html).not.toContain('aria-disabled');
    expect(html).toContain('stick-spinner');
    expect(html).toContain('free-band-dot off pulse');
  });

  it('failed: hint를 문구 뒤에 보인다', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'failed', attempt: 3, max: 3, hint: '동글을 뺐다 다시 꽂아 주세요' }} />,
    );
    expect(html).toContain('연결하지 못했어요. 동글을 뺐다 다시 꽂아 주세요');
  });

  it('reconnected: 「재연결 성공!」만, 버튼 없음', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'reconnected', attempt: 0, max: 3 }} onReconnect={noop} />,
    );
    expect(html).toContain('재연결 성공!');
    expect(html).not.toContain('다시 연결');
    expect(html).not.toContain('free-band-dot off');
  });

  it('failed: 드럼 세팅 안내', () => {
    const html = renderToStaticMarkup(
      <DisconnectBand left right={false} reconnect={{ status: 'failed', attempt: 3, max: 3 }} />,
    );
    expect(html).toContain('연결하지 못했어요');
    expect(html).toContain('드럼 세팅');
  });

  it('onReconnect가 없으면 다시 연결 버튼이 없다', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).not.toContain('다시 연결');
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} onReconnect={noop} />)).toContain('다시 연결');
  });
});
