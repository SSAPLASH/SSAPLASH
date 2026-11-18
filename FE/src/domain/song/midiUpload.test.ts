import { describe, expect, it } from 'vitest';
import {
  MAX_MIDI_BYTES,
  MAX_MUSICXML_BYTES,
  MIDI_PRECHECK_TEXT,
  MIDI_UNCERTAIN_TEXT,
  isMidiUncertain,
  midiErrorText,
  precheckUpload,
  uploadKindOf,
} from './midiUpload';

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

// 293: MusicXML도 같은 폼·store로 올린다. 확장자로 종류를 가르고 상한·문구만 다르다.
describe('uploadKindOf', () => {
  it('확장자로 MIDI·MusicXML을 가른다(대소문자 무시)', () => {
    expect(uploadKindOf('a.mid')).toBe('MIDI');
    expect(uploadKindOf('A.MIDI')).toBe('MIDI');
    expect(uploadKindOf('score.musicxml')).toBe('MUSICXML');
    expect(uploadKindOf('s.xml')).toBe('MUSICXML');
    expect(uploadKindOf('s.MXL')).toBe('MUSICXML');
    expect(uploadKindOf('s.pdf')).toBeNull();
    expect(uploadKindOf('noext')).toBeNull();
  });
});

describe('precheckUpload', () => {
  it('종류별 상한과 알 수 없는 확장자', () => {
    expect(MAX_MUSICXML_BYTES).toBe(5 * 1024 * 1024);
    expect(precheckUpload({ name: 's.musicxml', size: MAX_MUSICXML_BYTES })).toEqual({ ok: true, kind: 'MUSICXML' });
    expect(precheckUpload({ name: 's.mxl', size: MAX_MUSICXML_BYTES + 1 })).toEqual({ ok: false, reason: 'TOO_LARGE_MUSICXML' });
    expect(precheckUpload({ name: 'a.mid', size: MAX_MIDI_BYTES + 1 })).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(precheckUpload({ name: 'a.mid', size: 10 })).toEqual({ ok: true, kind: 'MIDI' });
    expect(precheckUpload({ name: 'a.musicxml', size: 0 })).toEqual({ ok: false, reason: 'EMPTY' });
    expect(precheckUpload({ name: 'a.pdf', size: 10 })).toEqual({ ok: false, reason: 'UNKNOWN_TYPE' });
    expect(MIDI_PRECHECK_TEXT.TOO_LARGE_MUSICXML).toBe('5 MiB 이하 MusicXML만 올릴 수 있어요.');
    expect(MIDI_PRECHECK_TEXT.UNKNOWN_TYPE).toContain('.mid');
    expect(MIDI_PRECHECK_TEXT.UNKNOWN_TYPE).toContain('.mxl');
  });
});

describe('midiErrorText MusicXML', () => {
  it('MUSICXML 코드 문구와 확정 오류 구분', () => {
    expect(midiErrorText('MUSICXML_INVALID', 'x')).toBe('제목(1~100자)과 파일을 확인해 주세요.');
    expect(midiErrorText('MUSICXML_TOO_LARGE', null)).toBe('5 MiB 이하 MusicXML만 올릴 수 있어요.');
    expect(midiErrorText('MUSICXML_NO_DRUM_NOTES', null)).toBe('드럼 파트가 있는 MusicXML을 올려 주세요.');
    expect(midiErrorText('MUSICXML_UNAVAILABLE', null)).toBe('악보 변환 서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
    expect(midiErrorText('MUSICXML_UNSUPPORTED', 'score-timewise 형식은 받지 않음')).toBe('score-timewise 형식은 받지 않음');
    expect(midiErrorText('MUSICXML_UNSUPPORTED', '')).toBe('MusicXML 파일이 아니거나 변환할 수 없어요.');
    expect(isMidiUncertain('MUSICXML_UNSUPPORTED')).toBe(false);
    expect(isMidiUncertain('MUSICXML_UNAVAILABLE')).toBe(false);
    expect(isMidiUncertain('MUSICXML_INVALID')).toBe(false);
  });
});
