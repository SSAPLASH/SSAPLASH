import { describe, expect, it } from 'vitest';
import { kitSoundStage } from './kitSoundStage';

describe('kitSoundStage (QA 352)', () => {
  it('드럼 킷이 보이는 준비·연주 단계만 소리를 낸다', () => {
    expect(kitSoundStage('ready')).toBe(true);
    expect(kitSoundStage('play')).toBe(true);
  });

  it('곡 선택·불러오는 중에는 소리를 내지 않는다', () => {
    expect(kitSoundStage('select')).toBe(false);
    expect(kitSoundStage('loading')).toBe(false);
  });
});
