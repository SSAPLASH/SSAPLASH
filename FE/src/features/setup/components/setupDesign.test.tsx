// Figma 반영 후 세팅 컴포넌트 테스트(HitLog·hitLogFormat·StepCard·ReturnBanner·PresetNameDialog 마크업).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KitPreset } from '@/domain/kit/preset';
import type { RecentHit } from '@/components/drum/useRecentHits';
import { HitLog } from './HitLog';
import { HIT_LOG_FLOAT_ROWS, HIT_LOG_ROWS, hitAgoText } from './hitLogFormat';
import { PresetNameDialog } from './preset/PresetNameDialog';
import { ReturnBanner } from './ReturnBanner';
import { StepCard } from './StepCard';

const noop = () => {};

describe('hitLogFormat', () => {
  const now = 100_000;
  it('최대 5행', () => {
    expect(HIT_LOG_ROWS).toBe(5);
  });
  it('경과 문구: 방금(<2초) · n초 전 · n분 전', () => {
    expect(hitAgoText(now, now)).toBe('방금');
    expect(hitAgoText(now - 1999, now)).toBe('방금');
    expect(hitAgoText(now - 2000, now)).toBe('2초 전');
    expect(hitAgoText(now - 59_999, now)).toBe('59초 전');
    expect(hitAgoText(now - 60_000, now)).toBe('1분 전');
    expect(hitAgoText(now - 150_000, now)).toBe('2분 전');
  });
  it('시계가 어긋나 미래 시각이어도 방금', () => {
    expect(hitAgoText(now + 5000, now)).toBe('방금');
  });
  it('무대 위 떠 있는 카드는 3행', () => {
    expect(HIT_LOG_FLOAT_ROWS).toBe(3);
  });
});

describe('HitLog', () => {
  const now = 1_000_000;
  const hit = (id: number, over: Partial<RecentHit> = {}): RecentHit => ({ id, pad: 'SNARE', hand: 0, velocity: 80.4, at: now, ...over });

  it('빈 목록이면 안내 문구, 행 목록 없음', () => {
    const html = renderToStaticMarkup(<HitLog hits={[]} now={now} />);
    expect(html).toContain('패드를 치면 여기에 기록돼요');
    expect(html).not.toContain('setup-hitlog-list');
  });
  it('패드·세기(반올림)·경과를 보인다(손 열은 없다)', () => {
    const html = renderToStaticMarkup(<HitLog hits={[hit(1, { pad: 'HIHAT', hand: 1, velocity: 80.6, at: now - 5000 })]} now={now} />);
    expect(html).toContain('하이햇');
    expect(html).not.toContain('오른손');
    expect(html).toContain('>81<');
    expect(html).toContain('5초 전');
  });
  it('판정 없음 패드', () => {
    const html = renderToStaticMarkup(<HitLog hits={[hit(1), hit(2, { hand: null, pad: null })]} now={now} />);
    expect(html).not.toContain('왼손');
    expect(html).toContain('판정 없음');
  });
  it('6건을 주면 5행만, 순서는 받은 그대로(새 것이 위)', () => {
    const hits = [6, 5, 4, 3, 2, 1].map((id) => hit(id, { velocity: id }));
    const html = renderToStaticMarkup(<HitLog hits={hits} now={now} />);
    expect((html.match(/<li /g) ?? []).length).toBe(5);
    expect(html.indexOf('>6<')).toBeGreaterThan(-1);
    expect(html.indexOf('>6<')).toBeLessThan(html.indexOf('>5<'));
    expect(html).not.toContain('>1<');
  });
  it('rows를 주면 그 수만큼만(3이면 3행)', () => {
    const hits = [6, 5, 4, 3, 2, 1].map((id) => hit(id, { velocity: id }));
    const html = renderToStaticMarkup(<HitLog hits={hits} now={now} rows={3} />);
    expect((html.match(/<li /g) ?? []).length).toBe(3);
  });
});

describe('StepCard Figma 상태', () => {
  const card = (status: 'needed' | 'done' | 'skipped', expanded: boolean, urgent = false) =>
    renderToStaticMarkup(
      <StepCard id="s" index={2} title="시작 위치 보정" status={status} summary="요약" actionLabel="보정하기" expanded={expanded} onCollapse={noop} urgent={urgent}>
        <p>본문</p>
      </StepCard>,
    );

  it('필요는 danger 알약과 is-needed', () => {
    const html = card('needed', false);
    expect(html).toContain('ui-pill-danger');
    expect(html).toContain('is-needed');
    expect(html).toContain('보정하기');
  });
  it('완료는 ok 알약, ✓, is-done, 번호 없음', () => {
    const html = card('done', false);
    expect(html).toContain('ui-pill-ok');
    expect(html).toContain('is-done');
    expect(html).toContain('✓');
    expect(html).not.toContain('>2<');
  });
  it('필요 없음은 neutral 알약', () => {
    const html = card('skipped', false);
    expect(html).toContain('ui-pill-neutral');
    expect(html).toContain('>필요 없음<');
  });
  it('필요 단계를 펼치면 「진행 중」(accent), 복귀 중(urgent)이면 「필요」 유지', () => {
    const open = card('needed', true);
    expect(open).toContain('ui-pill-accent');
    expect(open).toContain('>진행 중<');
    expect(open).toContain('is-progress');
    const urgent = card('needed', true, true);
    expect(urgent).toContain('ui-pill-danger');
    expect(urgent).toContain('>필요<');
  });
  it('펼치면 접기 버튼이 동작 버튼을 대신한다', () => {
    const open = card('needed', true);
    expect(open).toContain('접기');
    expect(open).not.toContain('>보정하기<');
    expect(open).toContain('본문');
  });
  it('제목이 aria-labelledby로 연결된다', () => {
    const html = card('done', false);
    expect(html).toContain('aria-labelledby="s-title"');
    expect(html).toContain('id="s-title"');
  });
});

describe('ReturnBanner Figma 상태', () => {
  const banner = (ready: boolean) =>
    renderToStaticMarkup(<ReturnBanner title="제목" line="한 줄" buttonText="돌아가기" ready={ready} enterEnabled onReturn={noop} />);

  it('blocked: 클래스·버튼 비활성, 제목·한 줄', () => {
    const html = banner(false);
    expect(html).toContain('setup-banner blocked');
    expect(html).not.toContain('setup-banner ready');
    expect(html).toContain('<strong>제목</strong>');
    expect(html).toContain('<span>한 줄</span>');
    expect(html).toMatch(/<button[^>]*disabled/);
  });
  it('ready: 클래스·버튼 활성', () => {
    const html = banner(true);
    expect(html).toContain('setup-banner ready');
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).toContain('role="status"');
  });
});

describe('PresetNameDialog Figma 입력', () => {
  const existing = [{ id: 'a', name: '기본 배치' }] as KitPreset[];
  const dlg = (initialValue: string, error: string | null = null) =>
    renderToStaticMarkup(<PresetNameDialog open existing={existing} busy={false} error={error} onSave={noop} onCancel={noop} initialValue={initialValue} />);

  it('카운터 n/20은 글자 수(코드포인트)로 센다', () => {
    expect(dlg('')).toContain('0/20');
    expect(dlg('새 배치')).toContain('4/20');
    expect(dlg('😀😀')).toContain('2/20');
    expect(dlg('가'.repeat(21))).toContain('21/20');
  });
  it('도움말은 오류와 함께 보이고 aria 연결', () => {
    const html = dlg('가'.repeat(21));
    expect(html).toContain('1~20자');
    expect(html).toContain('20자까지 입력할 수 있어요');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/aria-describedby="[^"]*-help [^"]*-error"/);
  });
  it('오류가 없으면 aria-invalid·alert 없음', () => {
    const html = dlg('새 배치');
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('role="alert"');
  });
  it('서버 오류 문구', () => {
    expect(dlg('새 배치', '저장에 실패했어요')).toContain('저장에 실패했어요');
  });
});
