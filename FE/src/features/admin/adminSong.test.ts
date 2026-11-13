import { describe, expect, it } from 'vitest';
import {
  ADMIN_LICENSE_EXAMPLE,
  MAX_ACCOMPANIMENT_BYTES,
  MAX_OFFSET_MS,
  adminErrorText,
  adminSongFromDto,
  parseOffsetMs,
  precheckAccompaniment,
  validateAdminDraft,
  type AdminSongDraft,
} from './adminSong';
import { isAdmin } from '@/domain/account/auth';

const midi = new File(['abc'], 'a.mid');

function draft(over: Partial<AdminSongDraft> = {}): AdminSongDraft {
  return { file: midi, title: '곡', artist: '', license: '자작', offsetMs: '', published: true, accompaniment: null, ...over };
}

describe('parseOffsetMs', () => {
  it('빈 값은 생략(null)이다', () => {
    expect(parseOffsetMs('')).toBeNull();
    expect(parseOffsetMs('   ')).toBeNull();
  });

  it('0~30분 정수만 받는다', () => {
    expect(parseOffsetMs('0')).toBe(0);
    expect(parseOffsetMs(' 1226 ')).toBe(1226);
    expect(parseOffsetMs(String(MAX_OFFSET_MS))).toBe(MAX_OFFSET_MS);
  });

  it('음수·소수·부호·문자·범위 밖은 invalid', () => {
    for (const bad of ['-1', '1.5', '+5', 'abc', '1e3', String(MAX_OFFSET_MS + 1), '99999999999']) {
      expect(parseOffsetMs(bad), bad).toBe('invalid');
    }
  });
});

describe('precheckAccompaniment', () => {
  it('WAV·MP3를 확장자 또는 MIME으로 받는다', () => {
    expect(precheckAccompaniment(new File(['x'], 'a.mp3'))).toEqual({ ok: true });
    expect(precheckAccompaniment(new File(['x'], 'A.WAV'))).toEqual({ ok: true });
    expect(precheckAccompaniment(new File(['x'], 'noext', { type: 'audio/mpeg' }))).toEqual({ ok: true });
  });

  it('빈 파일·다른 형식·50 MiB 초과는 막는다', () => {
    expect(precheckAccompaniment(new File([], 'a.mp3'))).toEqual({ ok: false, reason: 'EMPTY' });
    expect(precheckAccompaniment(new File(['x'], 'a.flac'))).toEqual({ ok: false, reason: 'TYPE' });
    expect(precheckAccompaniment({ name: 'a.mp3', type: 'audio/mpeg', size: MAX_ACCOMPANIMENT_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'TOO_LARGE',
    });
  });
});

describe('validateAdminDraft', () => {
  it('MIDI·제목·라이선스가 있으면 통과', () => {
    expect(validateAdminDraft(draft())).toEqual({ ok: true });
    expect(validateAdminDraft(draft({ offsetMs: '1226', accompaniment: new File(['x'], 'a.mp3') }))).toEqual({ ok: true });
  });

  it('필수값·길이·offsetMs·반주를 검사한다', () => {
    expect(validateAdminDraft(draft({ file: null }))).toEqual({ ok: false, reason: 'NO_FILE' });
    expect(validateAdminDraft(draft({ file: new File([], 'a.mid') }))).toEqual({ ok: false, reason: 'MIDI_EMPTY' });
    expect(validateAdminDraft(draft({ title: '  ' }))).toEqual({ ok: false, reason: 'TITLE' });
    expect(validateAdminDraft(draft({ title: 'x'.repeat(101) }))).toEqual({ ok: false, reason: 'TITLE' });
    expect(validateAdminDraft(draft({ artist: 'x'.repeat(101) }))).toEqual({ ok: false, reason: 'ARTIST' });
    expect(validateAdminDraft(draft({ license: ' ' }))).toEqual({ ok: false, reason: 'LICENSE' });
    expect(validateAdminDraft(draft({ license: 'x'.repeat(201) }))).toEqual({ ok: false, reason: 'LICENSE' });
    expect(validateAdminDraft(draft({ offsetMs: '-3' }))).toEqual({ ok: false, reason: 'OFFSET' });
    expect(validateAdminDraft(draft({ accompaniment: new File(['x'], 'a.ogg') }))).toEqual({ ok: false, reason: 'ACCOMPANIMENT' });
  });
});

describe('adminSongFromDto', () => {
  it('관리자 곡 요약을 화면 타입으로 바꾼다', () => {
    const s = adminSongFromDto({
      id: '12',
      title: '거울',
      artist: '국카스텐',
      license: 'x',
      status: 'READY',
      hasAccompaniment: true,
      published: false,
      difficulties: ['EASY', 'NORMAL', 'HARD'],
    });
    expect(s).toEqual({
      id: 12,
      title: '거울',
      artist: '국카스텐',
      license: 'x',
      status: 'READY',
      hasAccompaniment: true,
      published: false,
      difficulties: ['EASY', 'NORMAL', 'HARD'],
    });
  });

  it('빠진 필드는 안전한 기본값', () => {
    const s = adminSongFromDto({ id: 1, title: 't' });
    expect(s.artist).toBeNull();
    expect(s.hasAccompaniment).toBe(false);
    expect(s.published).toBe(true);
    expect(s.difficulties).toEqual([]);
  });
});

describe('adminErrorText', () => {
  it('알려진 코드는 한국어 문구, 모르는 코드는 기본 문구', () => {
    expect(adminErrorText('ACCOMPANIMENT_UNSUPPORTED')).toContain('WAV');
    expect(adminErrorText('MIDI_UNSUPPORTED')).toContain('첫 박');
    expect(adminErrorText('FORBIDDEN')).toContain('관리자');
    expect(adminErrorText('WHATEVER')).toBe(adminErrorText('HTTP_ERROR'));
  });

  it('라이선스 예시 문구가 있다', () => {
    expect(ADMIN_LICENSE_EXAMPLE).toContain('비상업');
  });
});

describe('isAdmin', () => {
  it('role이 ADMIN일 때만 참', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({ role: 'USER' })).toBe(false);
    expect(isAdmin({ role: 'ADMIN' })).toBe(true);
  });
});
