// 실시간 코칭 화면 문구 표. CoachMessage(태그+대상)를 연주 안내 칸에 띄울 제목·보조·모드로 바꾼다.
// 문구·톤은 이 파일에서만 고친다(모듈의 text는 플레이 로그 전용). 모드는 문자열만 돌려주고
// GuideSlot 컴포넌트를 가져오지 않는다. 제목은 "무엇을 하라"는 구령으로 쓰고(지적 8자, 칭찬과 세팅 안내 13자 안쪽),
// 이유·방법은 보조(16자 안쪽)에 둔다. 말투 원칙: 행동 먼저, "~해요" 존댓말, 점수·정확도·단정("틀렸어요")·영어 금지.
// 같은 태그가 다시 뜨면 repeat 순서대로 제목을 돌려 쓴다(난수를 쓰지 않아 재생 결과가 같다).
import { coachPadName, padMissHint } from './padName';
import type { CoachMessage } from './LiveCoach';
import type { CoachTarget } from './rules';

/** GuideSlot의 코칭 모드와 같은 문자열. components를 import하지 않으려고 여기서 따로 정의한다 */
export type CoachCopyMode = 'coach-info' | 'coach-warn' | 'coach-good';

export interface CoachCopy {
  title: string;
  sub: string;
  mode: CoachCopyMode;
  /** 키트에서 가리킬 대상. 해소 칭찬은 고쳐진 지적의 대상. 없으면 null */
  target: CoachTarget | null;
}

const HAND_LABEL = ['왼손', '오른손'] as const;

/** 화면 문구에 필요한 연주 정보 */
export interface CoachCopyContext {
  /** 키보드 입력이면 패드 안내에 키를 보여 준다 */
  keyboard?: boolean;
}

/** 해소 칭찬의 보조 문구. 무엇이 고쳐졌는지 이름을 붙인다 */
function recoveredSub(from: CoachMessage['recoveredFrom']): string {
  if (!from) return '방금처럼 계속 쳐요';
  const { tag, target } = from;
  const padLabel = target?.kind === 'pad' ? coachPadName(target.pad) : undefined;
  const handLabel = target?.kind === 'hand' ? HAND_LABEL[target.hand] : undefined;
  switch (tag) {
    case 'LIVE_LATE':
      return '늦던 박이 맞았어요';
    case 'LIVE_EARLY':
      return '급하던 박이 맞았어요';
    case 'LIVE_PAD_LATE':
    case 'LIVE_PAD_EARLY':
      return padLabel ? `${padLabel} 박이 맞아요` : '방금처럼 계속 쳐요';
    case 'LIVE_HAND_WEAK':
      return handLabel ? `${handLabel} 소리가 살았어요` : '방금처럼 계속 쳐요';
    case 'LIVE_UNSTEADY':
      return '박이 고르게 됐어요';
    case 'LIVE_PAD_MISS':
    case 'LIVE_MISS_STREAK':
      return '다시 잘 따라와요';
    default:
      return '방금처럼 계속 쳐요';
  }
}

/** 변환할 수 없으면(모르는 태그·필요한 대상 없음) null. 호출 쪽이 표시를 건너뛴다 */
export function coachCopy(message: CoachMessage, context: CoachCopyContext = {}): CoachCopy | null {
  const { tag, target, repeat } = message;
  const pad = target?.kind === 'pad' ? target.pad : undefined;
  const padLabel = pad ? coachPadName(pad) : undefined;
  const handLabel = target?.kind === 'hand' ? HAND_LABEL[target.hand] : undefined;
  const turn = (titles: readonly string[]): string => titles[repeat % titles.length];

  switch (tag) {
    case 'LIVE_SETUP_OFFSET':
      return { title: '소리가 밀려 들리나요?', sub: '끝나고 지연 보정을 맞춰요', mode: 'coach-info', target: null };
    case 'LIVE_SETUP_PADS':
      return { title: '패드 자리를 확인해요', sub: '끝나고 패드를 다시 잡아요', mode: 'coach-info', target: null };
    case 'LIVE_PAD_MISS':
      return pad && padLabel
        ? { title: turn([`${padLabel} 보세요`, `${padLabel} 챙겨요`]), sub: padMissHint(pad, context.keyboard === true), mode: 'coach-warn', target }
        : null;
    case 'LIVE_MISS_STREAK':
      return { title: turn(['다음 마디부터', '숨 고르고 다시']), sub: '놓친 건 잊고 다음 노트', mode: 'coach-warn', target: null };
    case 'LIVE_LATE':
      return { title: turn(['조금 일찍!', '미리 준비해요', '한발 앞서요']), sub: '스틱을 미리 올려 둬요', mode: 'coach-info', target: null };
    case 'LIVE_EARLY':
      return { title: turn(['기다렸다 쳐요', '서두르지 마요', '한 템포 쉬고']), sub: '판정선에 닿을 때 쳐요', mode: 'coach-info', target: null };
    case 'LIVE_PAD_LATE':
      return padLabel ? { title: turn([`${padLabel} 미리!`, `${padLabel} 준비!`]), sub: '치기 전에 손을 옮겨 둬요', mode: 'coach-info', target } : null;
    case 'LIVE_PAD_EARLY':
      return padLabel ? { title: turn([`${padLabel} 차분히`, `${padLabel} 천천히`]), sub: `${padLabel}만 서두르고 있어요`, mode: 'coach-info', target } : null;
    case 'LIVE_HAND_WEAK':
      return handLabel ? { title: turn([`${handLabel} 더 세게`, `${handLabel}도 똑같이`]), sub: '스틱을 조금 더 들어요', mode: 'coach-info', target } : null;
    case 'LIVE_UNSTEADY':
      return { title: turn(['박을 세면서', '일정하게 쳐요']), sub: '속으로 하나 둘 세어 봐요', mode: 'coach-info', target: null };
    case 'LIVE_GOOD_RECOVERED':
      return { title: turn(['그거예요!', '바로 그 느낌!']), sub: recoveredSub(message.recoveredFrom), mode: 'coach-good', target: message.recoveredFrom?.target ?? null };
    case 'LIVE_GOOD_STEADY':
      return { title: turn(['박이 딱 맞아요', '아주 안정적이에요', '이 느낌 그대로요']), sub: '지금처럼만 쳐요', mode: 'coach-good', target: null };
    case 'LIVE_GOOD_KEEP':
      return { title: turn(['좋아요, 계속 가요', '흐름 좋아요']), sub: '', mode: 'coach-good', target: null };
    default:
      return null;
  }
}
