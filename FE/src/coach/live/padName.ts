// 코칭 문구에 쓰는 패드 이름과 안내. 이름은 PAD_META.label 하나만 쓴다(드럼 키트 그림·결과 화면과 같다).
import { KEY_MAP } from '@/domain/kit/keyMap';
import { PAD_META, type PadId } from '@/domain/kit/pads';

/** 위치를 말로 구분할 수 있는 패드만 적는다 */
const POSITION: Partial<Record<PadId, string>> = { SMALL_TOM: '왼쪽 탐', MID_TOM: '오른쪽 탐' };

export function coachPadName(pad: PadId): string {
  return PAD_META[pad].label;
}

/** 패드 이름 뒤의 목적격 조사. 숫자는 읽는 소리로 본다(1 일, 2 이) */
export function objectParticle(word: string): '을' | '를' {
  const last = word[word.length - 1];
  if (last === '1') return '을';
  if (last === '2') return '를';
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '을' : '를';
}

/** 마지막 글자의 받침. 숫자는 읽는 소리로 본다(1 일: ㄹ, 2 이: 없음). 한글이 아니면 null */
function finalConsonant(word: string): 'none' | 'rieul' | 'other' | null {
  const last = word[word.length - 1];
  if (last === '1') return 'rieul';
  if (last === '2') return 'none';
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  const jong = code % 28;
  return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'other';
}

/** 주제 조사 */
export function topicParticle(word: string): '은' | '는' {
  const f = finalConsonant(word);
  return f === 'other' || f === 'rieul' ? '은' : '는';
}

/** 위치를 말로 알려 줄 수 있는 패드면 그 위치. 예: '왼쪽 탐' */
export function padPosition(pad: PadId): string | undefined {
  return POSITION[pad];
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
