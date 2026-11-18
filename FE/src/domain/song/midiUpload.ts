// MIDI·MusicXML 업로드 도메인 (설계 CHART-002 3-2, 293 MusicXML). 한도·사전 검사·오류 문구·제출 값 타입. 요청·상태는 다루지 않는다.
// 293: MusicXML 악보도 같은 폼·store로 올린다. 확장자로 종류를 가르고 상한·문구·호출 경로만 다르다.

/** BE 한도(MidiUploadService.LIMIT)와 같다: 1 MiB */
export const MAX_MIDI_BYTES = 1_048_576;
/** BE 한도(MusicXmlSniffer.MAX_BYTES)와 같다: 5 MiB */
export const MAX_MUSICXML_BYTES = 5 * 1024 * 1024;

export type UploadKind = 'MIDI' | 'MUSICXML';

const MIDI_EXTENSIONS = ['.mid', '.midi'];
const MUSICXML_EXTENSIONS = ['.musicxml', '.xml', '.mxl'];
/** 파일 선택 창 필터. 내용 판별은 BE가 한다 */
export const UPLOAD_ACCEPT = [...MIDI_EXTENSIONS, ...MUSICXML_EXTENSIONS, 'audio/midi', 'audio/x-midi'].join(',');

/** 파일 이름 확장자로 종류를 가른다(대소문자 무시). 모르는 확장자는 null */
export function uploadKindOf(name: string): UploadKind | null {
  const lower = name.toLowerCase();
  if (MIDI_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'MIDI';
  if (MUSICXML_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'MUSICXML';
  return null;
}

/** 멱등 키가 없다(중복 방지 키 없음, 설계 D5) */
export interface MidiDraft {
  file: File;
  title: string;
  artist: string;
}

export type MidiPrecheckReason = 'EMPTY' | 'TOO_LARGE' | 'TOO_LARGE_MUSICXML' | 'UNKNOWN_TYPE';
export type UploadPrecheck = { ok: true; kind: UploadKind } | { ok: false; reason: MidiPrecheckReason };

/** 전송 전 검사(MIDI·MusicXML). 확장자로 종류를 정하고 종류별 상한을 본다. 내용 판별은 BE가 한다 */
export function precheckUpload(file: { name: string; size: number }): UploadPrecheck {
  const kind = uploadKindOf(file.name);
  if (kind === null) return { ok: false, reason: 'UNKNOWN_TYPE' };
  if (file.size <= 0) return { ok: false, reason: 'EMPTY' };
  if (kind === 'MIDI' && file.size > MAX_MIDI_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  if (kind === 'MUSICXML' && file.size > MAX_MUSICXML_BYTES) return { ok: false, reason: 'TOO_LARGE_MUSICXML' };
  return { ok: true, kind };
}

export const MIDI_PRECHECK_TEXT: Record<MidiPrecheckReason, string> = {
  EMPTY: '빈 파일입니다. 다른 파일을 골라 주세요.',
  TOO_LARGE: '1 MiB 이하 MIDI만 올릴 수 있어요.',
  TOO_LARGE_MUSICXML: '5 MiB 이하 MusicXML만 올릴 수 있어요.',
  UNKNOWN_TYPE: 'MIDI(.mid, .midi)나 MusicXML(.musicxml, .xml, .mxl) 파일만 올릴 수 있어요. 악보 이미지·PDF는 받지 않아요.',
};

export const MIDI_UNCERTAIN_TEXT = '업로드 결과를 확인하지 못했습니다. 라이브러리를 확인한 뒤 필요하면 다시 올려 주세요.';

const MIDI_ERROR_TEXT: Record<string, string> = {
  MIDI_INVALID: '제목(1~100자)과 파일을 확인해 주세요.',
  MIDI_TOO_LARGE: '1 MiB 이하 MIDI만 올릴 수 있어요.',
  MIDI_NO_DRUM_NOTES: '드럼 채널(10)에 드럼 노트가 있는 MIDI를 올려 주세요.',
  MUSICXML_INVALID: '제목(1~100자)과 파일을 확인해 주세요.',
  MUSICXML_TOO_LARGE: '5 MiB 이하 MusicXML만 올릴 수 있어요.',
  MUSICXML_NO_DRUM_NOTES: '드럼 파트가 있는 MusicXML을 올려 주세요.',
  // 503이지만 BE가 곡을 만들지 않은 것이 확실한 오류(변환 서버 연결 불가·시간 초과)
  MUSICXML_UNAVAILABLE: '악보 변환 서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
};

const MIDI_UNSUPPORTED_DEFAULT = 'MIDI 파일이 아니거나 손상되었습니다.';
const MUSICXML_UNSUPPORTED_DEFAULT = 'MusicXML 파일이 아니거나 변환할 수 없어요.';
/** BE detail(AI 변환기 메시지)을 그대로 보여 주는 코드 */
const DETAIL_CODES = new Set(['MIDI_UNSUPPORTED', 'MUSICXML_UNSUPPORTED']);

/** 오류 코드가 "서버에 저장됐는지 모르는" 종류인가(네트워크·5xx·알 수 없는 코드). 이때 목록을 다시 읽는다(D6) */
export function isMidiUncertain(code: string): boolean {
  return !DETAIL_CODES.has(code) && !(code in MIDI_ERROR_TEXT);
}

/** `*_UNSUPPORTED`만 BE detail을 쓴다(비면 기본 문구). 그 밖은 표, 표에 없으면 "결과를 확인하지 못했다" */
export function midiErrorText(code: string, detail: string | null): string {
  if (DETAIL_CODES.has(code)) {
    if (detail !== null && detail.trim() !== '') return detail;
    return code === 'MUSICXML_UNSUPPORTED' ? MUSICXML_UNSUPPORTED_DEFAULT : MIDI_UNSUPPORTED_DEFAULT;
  }
  return MIDI_ERROR_TEXT[code] ?? MIDI_UNCERTAIN_TEXT;
}
