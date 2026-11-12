import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  defaultTitleFromFile,
  isRetryableUploadError,
  newIdempotencyKey,
  precheckAudio,
  songStatusToProgress,
  jobSnapshotToProgress,
  uploadErrorText,
} from './chartJob';

const f = (name: string, size: number, type = '') => ({ name, size, type });

describe('precheckAudio', () => {
  it('mp3·wav 확장자는 대소문자 무시하고 통과', () => {
    expect(precheckAudio(f('a.mp3', 10))).toEqual({ ok: true });
    expect(precheckAudio(f('A.WAV', 10))).toEqual({ ok: true });
  });
  it('확장자가 달라도 MIME이 맞으면 통과', () => {
    expect(precheckAudio(f('a', 10, 'audio/mpeg'))).toEqual({ ok: true });
    expect(precheckAudio(f('a.bin', 10, 'audio/x-wav'))).toEqual({ ok: true });
    expect(precheckAudio(f('a.bin', 10, 'audio/wave'))).toEqual({ ok: true });
  });
  it('m4a·opus·ogg 확장자는 통과(.ogg의 Vorbis 거절은 BE가 함)', () => {
    expect(precheckAudio(f('a.m4a', 10))).toEqual({ ok: true });
    expect(precheckAudio(f('a.opus', 10))).toEqual({ ok: true });
    expect(precheckAudio(f('a.ogg', 10, 'audio/ogg'))).toEqual({ ok: true });
  });
  it('확장자 없이 MIME만 m4a·opus여도 통과', () => {
    expect(precheckAudio(f('a', 10, 'audio/x-m4a'))).toEqual({ ok: true });
    expect(precheckAudio(f('a', 10, 'audio/opus'))).toEqual({ ok: true });
  });
  it('BE가 받지 않는 형식(flac 등)은 EXT', () => {
    expect(precheckAudio(f('a.flac', 10, 'audio/flac'))).toEqual({ ok: false, reason: 'EXT' });
  });
  it('빈 파일은 EMPTY', () => {
    expect(precheckAudio(f('a.mp3', 0))).toEqual({ ok: false, reason: 'EMPTY' });
  });
  it('50 MiB 정확히는 통과, 1 B 초과는 SIZE', () => {
    expect(precheckAudio(f('a.mp3', MAX_AUDIO_BYTES))).toEqual({ ok: true });
    expect(precheckAudio(f('a.mp3', MAX_AUDIO_BYTES + 1))).toEqual({ ok: false, reason: 'SIZE' });
  });
  it('검사 순서는 EMPTY → SIZE → EXT', () => {
    expect(precheckAudio(f('a.txt', 0))).toEqual({ ok: false, reason: 'EMPTY' });
    expect(precheckAudio(f('a.txt', MAX_AUDIO_BYTES + 1))).toEqual({ ok: false, reason: 'SIZE' });
  });
});

describe('defaultTitleFromFile', () => {
  it('확장자와 앞뒤 공백을 지운다', () => {
    expect(defaultTitleFromFile('  My Song .mp3')).toBe('My Song');
    expect(defaultTitleFromFile('a.b.wav')).toBe('a.b');
  });
  it('100자로 자른다', () => {
    expect(defaultTitleFromFile('가'.repeat(150) + '.mp3')).toHaveLength(100);
  });
  it('비면 제목 없음', () => {
    expect(defaultTitleFromFile('.mp3')).toBe('제목 없음');
    expect(defaultTitleFromFile('   .wav')).toBe('제목 없음');
  });
});

describe('songStatusToProgress', () => {
  it('PROCESSING은 단계를 모르는 SEPARATING', () => {
    expect(songStatusToProgress('PROCESSING')).toEqual({ stage: 'SEPARATING', stageKnown: false, percent: null, failReason: null });
  });
  it('READY는 DONE', () => {
    expect(songStatusToProgress('READY')).toMatchObject({ stage: 'DONE', stageKnown: true });
  });
  it('FAILED는 FAILED', () => {
    expect(songStatusToProgress('FAILED')).toMatchObject({ stage: 'FAILED', stageKnown: true, failReason: null });
  });
  it('그 외는 QUEUED', () => {
    expect(songStatusToProgress('???')).toMatchObject({ stage: 'QUEUED', stageKnown: true });
  });
});

describe('uploadErrorText', () => {
  it('detail이 우선', () => {
    expect(uploadErrorText('AUDIO_BUSY', '서버 문구')).toBe('서버 문구');
  });
  it('detail이 비면 표', () => {
    expect(uploadErrorText('AUDIO_BUSY', '  ')).toContain('진행 중인 곡');
    expect(uploadErrorText('NETWORK', null)).toContain('연결');
  });
  it('HTTP_ERROR·NETWORK는 FE가 채운 원문 대신 표 문구', () => {
    expect(uploadErrorText('HTTP_ERROR', 'HTTP 502 Bad Gateway')).not.toContain('502');
    expect(uploadErrorText('NETWORK', '서버에 연결할 수 없습니다.')).toContain('연결');
  });
  it('둘 다 없으면 기본 문구', () => {
    expect(uploadErrorText('???', null)).toBe('음원을 올리지 못했습니다.');
  });
});

describe('기타', () => {
  it('재시도 가능 코드', () => {
    expect(isRetryableUploadError('NETWORK')).toBe(true);
    expect(isRetryableUploadError('AUDIO_UNAVAILABLE')).toBe(true);
    expect(isRetryableUploadError('AUDIO_BUSY')).toBe(false);
  });
  it('멱등 키는 UUID 형식이고 매번 다르다', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});


describe('jobSnapshotToProgress', () => {
  it.each(['QUEUED', 'SEPARATING', 'TRANSCRIBING', 'DONE', 'FAILED'])('%s 단계를 그대로 반영한다', (status) => {
    expect(jobSnapshotToProgress({ status, progress: 0, error: null })).toMatchObject({ stage: status, stageKnown: true, percent: 0 });
  });
  it.each([null, -1, 101, 1.5, '50', NaN])('유효하지 않은 진행률 %s는 숨긴다', (progress) => {
    expect(jobSnapshotToProgress({ status: 'TRANSCRIBING', progress, error: null })?.percent).toBeNull();
  });
  it('100은 보존하고 모르는 단계는 반영하지 않는다', () => {
    expect(jobSnapshotToProgress({ status: 'DONE', progress: 100, error: null })?.percent).toBe(100);
    expect(jobSnapshotToProgress({ status: 'OTHER', progress: 20, error: null })).toBeNull();
  });
});
