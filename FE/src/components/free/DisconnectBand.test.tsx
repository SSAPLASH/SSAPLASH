import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DisconnectBand } from './DisconnectBand';

const idle = { status: 'idle' as const, attempt: 0, max: 3 };

describe('DisconnectBand 제목(끊김 카드와 같은 함수)', () => {
  it('양손이 끊기면 「양손 스틱」(U4)', () => {
    expect(renderToStaticMarkup(<DisconnectBand left={false} right={false} reconnect={idle} />)).toContain('양손 스틱 연결이 끊겼어요');
  });

  it('한 손이 끊기면 그 손', () => {
    expect(renderToStaticMarkup(<DisconnectBand left right={false} reconnect={idle} />)).toContain('오른손 스틱 연결이 끊겼어요');
  });

  it('페달만 끊기면 페달, 손과 같이 끊기면 스틱·페달이고 P 점이 나온다', () => {
    const pedalOnly = renderToStaticMarkup(<DisconnectBand left right pedal={false} reconnect={idle} />);
    expect(pedalOnly).toContain('페달 연결이 끊겼어요');
    expect(pedalOnly).toContain('>P<');
    expect(renderToStaticMarkup(<DisconnectBand left={false} right pedal={false} reconnect={idle} />)).toContain('스틱·페달 연결이 끊겼어요');
  });
});
