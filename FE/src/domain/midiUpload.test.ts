import { describe, expect, it } from 'vitest';
import { MAX_MIDI_BYTES, MIDI_UNCERTAIN_TEXT, isMidiUncertain, midiErrorText, precheckMidi } from './midiUpload';

describe('precheckMidi', () => {
  it('빈 파일은 EMPTY', () => {
    expect(precheckMidi({ size: 0 })).toEqual({ ok: false, reason: 'EMPTY' });
  });
  it('1 MiB 초과는 TOO_LARGE, 정확히 1 MiB는 통과', () => {
    expect(MAX_MIDI_BYTES).toBe(1_048_576);
    expect(precheckMidi({ size: MAX_MIDI_BYTES + 1 })).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(precheckMidi({ size: MAX_MIDI_BYTES })).toEqual({ ok: true });
  });
});

describe('midiErrorText', () => {
  it('표의 코드는 고정 문구', () => {
    expect(midiErrorText('MIDI_INVALID', 'x')).toBe('제목(1~100자)과 파일을 확인해 주세요.');
    expect(midiErrorText('MIDI_TOO_LARGE', null)).toBe('1 MiB 이하 MIDI만 올릴 수 있어요.');
    expect(midiErrorText('MIDI_NO_DRUM_NOTES', null)).toBe('드럼 채널(10)에 드럼 노트가 있는 MIDI를 올려 주세요.');
    expect(midiErrorText('UNAUTHORIZED', null)).toBe('로그인이 필요합니다. 다시 로그인해 주세요.');
  });
  it('MIDI_UNSUPPORTED만 BE detail을 쓰고 비면 기본 문구', () => {
    expect(midiErrorText('MIDI_UNSUPPORTED', '지원하지 않는 형식')).toBe('지원하지 않는 형식');
    expect(midiErrorText('MIDI_UNSUPPORTED', '  ')).toBe('MIDI 파일이 아니거나 손상되었습니다.');
    expect(midiErrorText('MIDI_UNSUPPORTED', null)).toBe('MIDI 파일이 아니거나 손상되었습니다.');
  });
  it('네트워크·5xx·알 수 없는 코드는 확인 불가 문구', () => {
    expect(midiErrorText('NETWORK', 'x')).toBe(MIDI_UNCERTAIN_TEXT);
    expect(midiErrorText('HTTP_ERROR', 'HTTP 502')).toBe(MIDI_UNCERTAIN_TEXT);
  });
  it('isMidiUncertain은 확정 오류와 구분한다', () => {
    expect(isMidiUncertain('NETWORK')).toBe(true);
    expect(isMidiUncertain('HTTP_ERROR')).toBe(true);
    expect(isMidiUncertain('MIDI_INVALID')).toBe(false);
    expect(isMidiUncertain('MIDI_UNSUPPORTED')).toBe(false);
  });
});
