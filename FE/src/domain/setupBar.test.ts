// 하단 바 4상태(설계 4-5)와 바뀐 문구 테스트.
import { describe, expect, it } from 'vitest';
import {
  SETUP_BAR_DIRTY_TEXT,
  SETUP_BAR_NO_PRESET_TEXT,
  setupBarChangedText,
  setupBarView,
  unsavedLeaveText,
} from './setupSteps';

describe('setupBarView 4상태', () => {
  it('변경 없음: 사용 중 문구, 보조색, [저장] 비활성', () => {
    expect(setupBarView({ activePresetName: '기본 배치', dirty: false, leaving: false })).toEqual({
      text: '「기본 배치」 사용 중',
      tone: 'caption',
      button: 'save',
      buttonEnabled: false,
    });
  });
  it('변경 있음: 노랑 점 문구, [저장] 활성', () => {
    const v = setupBarView({ activePresetName: '기본 배치', dirty: true, leaving: false });
    expect(v).toEqual({ text: '「기본 배치」 변경 있음 · 저장하지 않으면 다음에 사라져요', tone: 'changed', button: 'save', buttonEnabled: true });
    expect(v.text).toBe(setupBarChangedText('기본 배치'));
  });
  it('프리셋 없음: 안내 문구, [새 프리셋으로 저장] 활성(dirty 여부 무관)', () => {
    for (const dirty of [false, true]) {
      expect(setupBarView({ activePresetName: null, dirty, leaving: false })).toEqual({
        text: SETUP_BAR_NO_PRESET_TEXT,
        tone: 'caption',
        button: 'saveNew',
        buttonEnabled: true,
      });
    }
  });
  it('복귀 중 변경 있음: 빨강 문구, 버튼은 프리셋 유무에 따라', () => {
    expect(setupBarView({ activePresetName: '기본 배치', dirty: true, leaving: true })).toEqual({
      text: SETUP_BAR_DIRTY_TEXT,
      tone: 'leaving',
      button: 'save',
      buttonEnabled: true,
    });
    expect(setupBarView({ activePresetName: null, dirty: true, leaving: true }).button).toBe('saveNew');
    expect(SETUP_BAR_DIRTY_TEXT).toContain('저장하지 않고 나가면 원래대로 돌아가요');
  });
  it('변경이 없으면 leaving이어도 빨강이 아니다', () => {
    expect(setupBarView({ activePresetName: '기본 배치', dirty: false, leaving: true }).tone).toBe('caption');
  });
});

describe('이탈 확인 문구', () => {
  it('프리셋 있음/없음', () => {
    expect(unsavedLeaveText('내 배치')).toBe('「내 배치」의 패드 위치를 바꿨어요. 저장하지 않고 나가면 바꾼 내용이 사라져요.');
    expect(unsavedLeaveText(null)).toBe('아직 프리셋으로 저장하지 않았어요. 저장하지 않고 나가면 프리셋으로 남지 않아요.');
  });
});
