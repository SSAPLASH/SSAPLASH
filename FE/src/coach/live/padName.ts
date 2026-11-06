// 코칭 문구에 쓰는 패드 이름과 안내. 화면의 드럼 키트가 쓰는 이름과 맞춘다(drumKit.ts의 탐1·탐2).
import { KEY_MAP } from '@/domain/keyMap';
import { PAD_META, type PadId } from '@/domain/pads';

const KIT_NAME: Partial<Record<PadId, string>> = { SMALL_TOM: '탐1', MID_TOM: '탐2' };

/** 위치를 말로 구분할 수 있는 패드만 적는다 */
const POSITION: Partial<Record<PadId, string>> = { SMALL_TOM: '왼쪽 탐', MID_TOM: '오른쪽 탐' };

export function coachPadName(pad: PadId): string {
  return KIT_NAME[pad] ?? PAD_META[pad].label;
}

/** 패드 이름 뒤의 목적격 조사. 숫자는 읽는 소리로 본다(1 일, 2 이) */
export function objectParticle(word: string): '을' | '를' {
  const last = word[word.length - 1];
  if (last === '1') return '을';
  if (last === '2') return '를';
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '을' : '를';
}

/** 이 패드를 치는 키 이름. 예: 'E·I' */
export function padKeys(pad: PadId): string {
  return Object.entries(KEY_MAP)
    .filter(([, binding]) => binding.pad === pad)
    .map(([code]) => code.replace('Key', ''))
    .join('·');
}

/** 패드를 놓칠 때 보조 문구. 키보드는 키를, 스틱은 위치를 알려 준다 */
export function padMissHint(pad: PadId, keyboard: boolean): string {
  if (keyboard) return `${padKeys(pad)} 키를 쳐 보세요`;
  const position = POSITION[pad];
  return position ? `${position}을 보고 쳐요` : '그 패드를 보고 쳐요';
}
