// 단계 카드·복귀 띠·대화상자 렌더 테스트(정적 렌더). Enter 조건은 순수 함수로 검증한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KitPreset } from '@/domain/kit/preset';
import { PresetNameDialog } from './preset/PresetNameDialog';
import { isEnterBlockedTarget, shouldReturnOnEnter } from './preset/enterKey';
import { ReturnBanner } from './ReturnBanner';
import { StepCard } from './StepCard';
import { UnsavedLeaveDialog } from './preset/UnsavedLeaveDialog';

const noop = () => {};

describe('StepCard', () => {
  const card = (status: 'needed' | 'done' | 'skipped', expanded: boolean, actionLabel?: string) =>
    renderToStaticMarkup(
      <StepCard id="step-stick" index={1} title="스틱 연결" status={status} summary="요약 문구" actionLabel={actionLabel} expanded={expanded} onCollapse={noop}>
        <p>본문</p>
      </StepCard>,
    );

  it('상태별 배지', () => {
    expect(card('needed', false)).toContain('>필요<');
    expect(card('done', false)).toContain('>완료<');
    expect(card('skipped', false)).toContain('>필요 없음<');
  });
  it('완료는 체크, 그 밖은 번호', () => {
    expect(card('done', false)).toContain('✓');
    expect(card('needed', false)).toContain('>1<');
  });
  it('접힘이면 본문 없이 동작 버튼, 펼침이면 본문과 접기', () => {
    const folded = card('done', false, '다시 연결');
    expect(folded).toContain('다시 연결');
    expect(folded).not.toContain('본문');
    const open = card('needed', true, '변경');
    expect(open).toContain('본문');
    expect(open).toContain('접기');
    expect(open).not.toContain('>변경<');
    expect(open).toContain('id="step-stick"');
  });
});

describe('ReturnBanner', () => {
  const banner = (ready: boolean) =>
    renderToStaticMarkup(<ReturnBanner title="제목" line="한 줄" buttonText="곡 선택으로 돌아가기" ready={ready} enterEnabled onReturn={noop} />);

  it('준비 전에는 버튼 비활성, 준비되면 활성', () => {
    expect(banner(false)).toMatch(/<button[^>]*disabled/);
    expect(banner(true)).not.toMatch(/<button[^>]*disabled/);
    expect(banner(true)).toContain('곡 선택으로 돌아가기');
  });
  it('Enter는 준비·허용·비입력 포커스일 때만', () => {
    expect(shouldReturnOnEnter(true, true, { tagName: 'DIV' })).toBe(true);
    expect(shouldReturnOnEnter(true, true, null)).toBe(true);
    expect(shouldReturnOnEnter(false, true, { tagName: 'DIV' })).toBe(false);
    expect(shouldReturnOnEnter(true, false, { tagName: 'DIV' })).toBe(false);
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']) {
      expect(isEnterBlockedTarget({ tagName })).toBe(true);
    }
    expect(isEnterBlockedTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
});

describe('UnsavedLeaveDialog', () => {
  const dlg = (open: boolean, busy = false, error: string | null = null) =>
    renderToStaticMarkup(<UnsavedLeaveDialog open={open} message="문구" busy={busy} error={error} onCancel={noop} onDiscard={noop} onSave={noop} />);

  it('닫히면 아무것도 그리지 않는다', () => {
    expect(dlg(false)).toBe('');
  });
  it('세 버튼과 문구', () => {
    const html = dlg(true);
    for (const t of ['문구', '취소', '저장 안 함', '저장하고 나가기']) expect(html).toContain(t);
  });
  it('저장 버튼 이름을 prop으로 바꾼다(시스템 기본)', () => {
    const html = renderToStaticMarkup(
      <UnsavedLeaveDialog open message="문구" busy={false} error={null} onCancel={noop} onDiscard={noop} onSave={noop} saveLabel="새 프리셋으로 저장하고 나가기" />,
    );
    expect(html).toContain('새 프리셋으로 저장하고 나가기');
    expect(html).not.toContain('>저장하고 나가기<');
  });
  it('saveDisabled면 저장 버튼만 잠근다', () => {
    const html = renderToStaticMarkup(<UnsavedLeaveDialog open message="문구" busy={false} error={null} onCancel={noop} onDiscard={noop} onSave={noop} saveDisabled />);
    expect((html.match(/disabled/g) ?? []).length).toBe(1);
  });
  it('저장 중이면 잠그고, 오류 문구를 보인다', () => {
    const html = dlg(true, true, '저장에 실패했어요');
    expect((html.match(/disabled/g) ?? []).length).toBe(3);
    expect(html).toContain('저장에 실패했어요');
  });
});

describe('PresetNameDialog', () => {
  const existing = [{ id: 'a', name: '기본 배치' }] as KitPreset[];
  const dlg = (initialValue: string, busy = false) =>
    renderToStaticMarkup(<PresetNameDialog open existing={existing} busy={busy} error={null} onSave={noop} onCancel={noop} initialValue={initialValue} />);
  const saveDisabled = (html: string) => /<button type="submit"[^>]*disabled/.test(html);

  it('빈 값은 오류 문구 없이 저장 비활성, 안내는 1~20자', () => {
    const html = dlg('');
    expect(saveDisabled(html)).toBe(true);
    expect(html).toContain('1~20자');
    expect(html).not.toContain('input-error');
  });
  it('유효하면 저장 활성', () => {
    expect(saveDisabled(dlg('새 배치'))).toBe(false);
  });
  it('20자 초과 오류', () => {
    const html = dlg('가'.repeat(21));
    expect(html).toContain('20자까지 입력할 수 있어요');
    expect(html).toContain('input-error');
    expect(saveDisabled(html)).toBe(true);
    expect(saveDisabled(dlg('가'.repeat(20)))).toBe(false);
  });
  it('같은 이름 오류', () => {
    const html = dlg(' 기본 배치 ');
    expect(html).toContain('같은 이름의 프리셋이 있어요');
    expect(saveDisabled(html)).toBe(true);
  });
  it('저장 중이면 입력·버튼 잠금', () => {
    const html = dlg('새 배치', true);
    expect(html).toMatch(/<input[^>]*disabled/);
    expect(saveDisabled(html)).toBe(true);
  });
});
