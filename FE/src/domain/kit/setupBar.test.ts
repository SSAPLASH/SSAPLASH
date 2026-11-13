// 하단 바 4상태(설계 4-5)와 바뀐 문구 테스트.
import { describe, expect, it } from 'vitest';
import {
  SETUP_BAR_DIRTY_TEXT,
  SETUP_BAR_NO_PRESET_TEXT,
  setupBarChangedText,
  setupBarView,
  unsavedLeaveText,
} from './calibration/setupSteps';

describe('setupBarView 4상태', () => {
  it('변경 없음: 사용 중 문구, 보조색, [저장] 비활성', () => {
    expect(setupBarView({ activePresetName: '기본 배치', system: false, dirty: false, leaving: false })).toEqual({
      text: '「기본 배치」 사용 중',
      tone: 'caption',
      button: 'save',
      buttonEnabled: false,
    });
  });
  it('변경 있음: 노랑 점 문구, [저장] 활성', () => {
    const v = setupBarView({ activePresetName: '기본 배치', system: false, dirty: true, leaving: false });
    expect(v).toEqual({ text: '「기본 배치」 변경 있음 · 저장하지 않으면 다음에 사라져요', tone: 'changed', button: 'save', buttonEnabled: true });
    expect(v.text).toBe(setupBarChangedText('기본 배치'));
  });
  it('프리셋 없음: 안내 문구, [새 프리셋으로 저장] 활성(dirty 여부 무관)', () => {
    for (const dirty of [false, true]) {
      expect(setupBarView({ activePresetName: null, system: false, dirty, leaving: false })).toEqual({
        text: SETUP_BAR_NO_PRESET_TEXT,
        tone: 'caption',
        button: 'saveNew',
        buttonEnabled: true,
      });
    }
  });
  it('복귀 중 변경 있음: 빨강 문구, 버튼은 프리셋 유무에 따라', () => {
    expect(setupBarView({ activePresetName: '기본 배치', system: false, dirty: true, leaving: true })).toEqual({
      text: SETUP_BAR_DIRTY_TEXT,
      tone: 'leaving',
      button: 'save',
      buttonEnabled: true,
    });
    expect(setupBarView({ activePresetName: null, system: false, dirty: true, leaving: true }).button).toBe('saveNew');
    expect(SETUP_BAR_DIRTY_TEXT).toContain('저장하지 않고 나가면 원래대로 돌아가요');
  });
  it('변경이 없으면 leaving이어도 빨강이 아니다', () => {
    expect(setupBarView({ activePresetName: '기본 배치', system: false, dirty: false, leaving: true }).tone).toBe('caption');
  });
});

describe('setupBarView 시스템 기본(kit-drag D10·D11)', () => {
  const base = { activePresetName: '시스템 기본', system: true, leaving: false };
  it('끌지 않았으면 지금과 같다: 사용 중, [저장] 비활성', () => {
    expect(setupBarView({ ...base, dirty: false })).toEqual({ text: '「시스템 기본」 사용 중', tone: 'caption', button: 'save', buttonEnabled: false });
  });
  it('끌었으면 새 프리셋 저장 안내 + [새 프리셋으로 저장] 활성', () => {
    expect(setupBarView({ ...base, dirty: true })).toEqual({
      text: '시스템 기본은 바꿀 수 없어요 · 새 프리셋으로 저장해야 남아요',
      tone: 'changed',
      button: 'saveNew',
      buttonEnabled: true,
    });
  });
  it('끌고 나가려 하면 기존 이탈 문구·빨강, 버튼은 saveNew', () => {
    expect(setupBarView({ ...base, dirty: true, leaving: true })).toEqual({ text: SETUP_BAR_DIRTY_TEXT, tone: 'leaving', button: 'saveNew', buttonEnabled: true });
  });
  it('슬롯이 가득 차면 [새 프리셋으로 저장] 비활성(D12)', () => {
    expect(setupBarView({ ...base, dirty: true, full: true })).toMatchObject({ button: 'saveNew', buttonEnabled: false });
    expect(setupBarView({ ...base, dirty: true, leaving: true, full: true }).buttonEnabled).toBe(false);
  });
  it('보정 중·초안이 우선한다', () => {
    expect(setupBarView({ ...base, dirty: true, calibrating: { target: 'new', index: 0, total: 7 } }).buttonEnabled).toBe(false);
    expect(setupBarView({ ...base, dirty: true, draft: { slot: null } }).text).toBe('보정 완료 · 빈 슬롯을 눌러 저장해요');
  });
});

describe('이탈 확인 문구', () => {
  it('시스템 기본이면 새 프리셋 안내 문구', () => {
    expect(unsavedLeaveText('시스템 기본', true)).toBe('시스템 기본은 바꿀 수 없어요. 새 프리셋으로 저장하지 않고 나가면 옮긴 배치가 사라져요.');
  });
  it('프리셋 있음/없음', () => {
    expect(unsavedLeaveText('내 배치')).toBe('「내 배치」의 패드 위치를 바꿨어요. 저장하지 않고 나가면 바꾼 내용이 사라져요.');
    expect(unsavedLeaveText(null)).toBe('아직 프리셋으로 저장하지 않았어요. 저장하지 않고 나가면 프리셋으로 남지 않아요.');
  });
});
