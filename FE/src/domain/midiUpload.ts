// MIDI 업로드 도메인 (설계 CHART-002 3-2). 한도·사전 검사·오류 문구·제출 값 타입. 요청·상태는 다루지 않는다.

/** BE 한도(MidiUploadService.LIMIT)와 같다: 1 MiB */
export const MAX_MIDI_BYTES = 1_048_576;

/** 멱등 키가 없다(중복 방지 키 없음, 설계 D5) */
export interface MidiDraft {
  file: File;
  title: string;
  artist: string;
}

export type MidiPrecheckReason = 'EMPTY' | 'TOO_LARGE';
export type MidiPrecheck = { ok: true } | { ok: false; reason: MidiPrecheckReason };

/** 전송 전 검사. 크기만 본다 — 확장자는 파일 선택 창 필터로만 걸고 내용 판별은 BE에 맡긴다(D7) */
export function precheckMidi(file: { size: number }): MidiPrecheck {
  if (file.size <= 0) return { ok: false, reason: 'EMPTY' };
  if (file.size > MAX_MIDI_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true };
}

export const MIDI_PRECHECK_TEXT: Record<MidiPrecheckReason, string> = {
  EMPTY: '빈 파일입니다. 다른 파일을 골라 주세요.',
  TOO_LARGE: '1 MiB 이하 MIDI만 올릴 수 있어요.',
};

export const MIDI_UNCERTAIN_TEXT = '업로드 결과를 확인하지 못했습니다. 라이브러리를 확인한 뒤 필요하면 다시 올려 주세요.';

const MIDI_ERROR_TEXT: Record<string, string> = {
  MIDI_INVALID: '제목(1~100자)과 파일을 확인해 주세요.',
  MIDI_TOO_LARGE: '1 MiB 이하 MIDI만 올릴 수 있어요.',
  MIDI_NO_DRUM_NOTES: '드럼 채널(10)에 드럼 노트가 있는 MIDI를 올려 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
};

const MIDI_UNSUPPORTED_DEFAULT = 'MIDI 파일이 아니거나 손상되었습니다.';

/** 오류 코드가 "서버에 저장됐는지 모르는" 종류인가(네트워크·5xx·알 수 없는 코드). 이때 목록을 다시 읽는다(D6) */
export function isMidiUncertain(code: string): boolean {
  return code !== 'MIDI_UNSUPPORTED' && !(code in MIDI_ERROR_TEXT);
}

/** `MIDI_UNSUPPORTED`만 BE detail을 쓴다(비면 기본 문구). 그 밖은 표, 표에 없으면 "결과를 확인하지 못했다" */
export function midiErrorText(code: string, detail: string | null): string {
  if (code === 'MIDI_UNSUPPORTED') return detail !== null && detail.trim() !== '' ? detail : MIDI_UNSUPPORTED_DEFAULT;
  return MIDI_ERROR_TEXT[code] ?? MIDI_UNCERTAIN_TEXT;
}
