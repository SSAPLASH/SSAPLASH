// 실시간 코칭 화면 문구 표. CoachMessage(태그+대상)를 연주 안내 칸에 띄울 제목·보조·모드로 바꾼다.
// 문구·톤은 이 파일에서만 고친다(모듈의 text는 플레이 로그 전용). 모드는 문자열만 돌려주고
// GuideSlot 컴포넌트를 가져오지 않는다. 제목은 "무엇을 하라"는 구령으로 쓰고(지적 8자, 칭찬과 세팅 안내 13자 안쪽),
// 이유·방법은 보조(16자 안쪽)에 둔다. 말투 원칙: 행동 먼저, "~해요" 존댓말, 점수·정확도·단정("틀렸어요")·영어 금지.
// 같은 태그가 다시 뜨면 repeat 순서대로 제목을 돌려 쓴다(난수를 쓰지 않아 재생 결과가 같다).
// 문구는 상태 알림·격려보다 "몸의 어디를 어떻게"와 따라 할 기준(주먹 하나 높이, 마디 첫 박)을 말한다.
// 스틱 전용 지시(스틱 높이, 손목)는 키보드 입력이면 키보드에 맞는 지시(손가락, 키 이름)로 바꾼다.
// 지시 어휘는 QA 전 가정이다(설계 U6).
import { STICK_PADS } from '@/domain/kit/pads';
import { coachPadName, objectParticle, padKeys, padMissHint, padPosition, topicParticle } from './padName';
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

/**
 * 놓침 원인별 보조 문구. 원인이 없거나 UNKNOWN, 필요한 패드가 없으면 null(원래 보조 문구를 쓴다).
 * 제목(무엇을 하라)은 그대로 두고 보조(왜·어떻게)만 원인으로 바꾼다.
 * 어휘는 QA 전 가정이다(설계 U6). QA 결과로 이 함수만 고친다.
 */
function causeSub(cause: CoachMessage['cause'], keyboard: boolean): string | null {
  if (!cause) return null;
  switch (cause.cause) {
    case 'WRONG_PAD': {
      if (!cause.pad || !cause.intoPad) return null;
      const name = coachPadName(cause.pad);
      // 키보드는 그 패드의 키를 알려 준다(예: "스몰탐은 E·I 키예요")
      const keys = keyboard ? padKeys(cause.pad) : '';
      if (keys) return `${name}${topicParticle(name)} ${keys} 키예요`;
      // 스틱은 위치를 말할 수 있는 패드는 위치로(예: "스몰탐은 왼쪽 탐이에요"), 아니면 "미드탐 말고 스몰탐"
      const position = padPosition(cause.pad);
      return position ? `${name}${topicParticle(name)} ${position}이에요` : `${coachPadName(cause.intoPad)} 말고 ${name}`;
    }
    case 'TRANSITION': {
      // 손을 옮기는 지시라 도착이 페달(킥 등)이면 말하지 않는다. 출발은 원인 계산에서 이미 손 패드만이다
      if (!cause.fromPad || !cause.pad || !STICK_PADS.includes(cause.pad)) return null;
      // 시선이 먼저 가야 손이 따라간다(예: "스네어 치며 스몰탐을 봐요"). 손 패드끼리는 가장 긴 조합도 16자 안이다
      const to = coachPadName(cause.pad);
      return `${coachPadName(cause.fromPad)} 치며 ${to}${objectParticle(to)} 봐요`;
    }
    case 'DENSE':
      // 빠른 연타는 한 손(한 손가락)보다 번갈아 치는 게 기본이다
      return keyboard ? '빠른 곳은 손가락 번갈아요' : '빠른 곳은 양손 번갈아 쳐요';
    case 'DRIFT_LATE':
      // 밀린 박은 마디 첫 박에서 다시 맞추는 게 현실적이다
      return '마디 첫 박에 다시 맞춰요';
    default:
      return null;
  }
}

/** 놓침 지적의 보조 문구를 원인 문구로 바꾼다. 원인 문구가 없으면 그대로 */
function withCause(copy: CoachCopy | null, message: CoachMessage, keyboard: boolean): CoachCopy | null {
  const sub = causeSub(message.cause, keyboard);
  return copy && sub ? { ...copy, sub } : copy;
}

/** 변환할 수 없으면(모르는 태그·필요한 대상 없음) null. 호출 쪽이 표시를 건너뛴다 */
export function coachCopy(message: CoachMessage, context: CoachCopyContext = {}): CoachCopy | null {
  const { tag, target, repeat } = message;
  const pad = target?.kind === 'pad' ? target.pad : undefined;
  const padLabel = pad ? coachPadName(pad) : undefined;
  const handLabel = target?.kind === 'hand' ? HAND_LABEL[target.hand] : undefined;
  const otherHandLabel = target?.kind === 'hand' ? HAND_LABEL[1 - target.hand] : undefined;
  const turn = (titles: readonly string[]): string => titles[repeat % titles.length];
  const keyboard = context.keyboard === true;
  const keys = pad && keyboard ? padKeys(pad) : '';

  switch (tag) {
    case 'LIVE_SETUP_OFFSET':
      return { title: '소리가 밀려 들리나요?', sub: '끝나고 박자를 맞춰 보세요', mode: 'coach-info', target: null };
    case 'LIVE_SETUP_PADS':
      return { title: '패드 자리를 확인해요', sub: '끝나고 패드를 다시 잡아요', mode: 'coach-info', target: null };
    case 'LIVE_PAD_MISS':
      return pad && padLabel
        ? withCause({ title: turn([`${padLabel} 보세요`, `${padLabel} 챙겨요`]), sub: padMissHint(pad, keyboard), mode: 'coach-warn', target }, message, keyboard)
        : null;
    case 'LIVE_MISS_STREAK':
      // 놓쳐서 흐름을 잃으면 박의 뼈대(킥·스네어)만 치며 다시 잡는다
      return withCause(
        { title: turn(['킥·스네어만!', '발로 박을 세요']), sub: turn(['박이 잡히면 다시 다 쳐요', '킥 소리에 맞춰 들어가요']), mode: 'coach-warn', target: null },
        message,
        keyboard,
      );
    case 'LIVE_LATE':
      // 스틱: 높이 들수록 떨어지는 데 오래 걸려 늦기 쉽다. 키보드: 손가락이 키에서 떨어져 있으면 늦다
      return keyboard
        ? { title: turn(['키 위에 손가락', '살짝 먼저', '한발 먼저']), sub: '손가락을 키에 올려 둬요', mode: 'coach-info', target: null }
        : { title: turn(['스틱을 낮게', '낮게 들어요', '손목을 낮게']), sub: '높이는 주먹 하나만큼', mode: 'coach-info', target: null };
    case 'LIVE_EARLY':
      // 스틱: 팔로 누르듯 치면 앞서기 쉬워 무게로 떨어뜨린다. 키보드: 노트가 선에 닿는 걸 보고 누른다
      return keyboard
        ? { title: turn(['닿을 때 눌러요', '기다렸다 눌러요', '끝까지 봐요']), sub: '노트가 선에 닿을 때 눌러요', mode: 'coach-info', target: null }
        : { title: turn(['힘 빼고 떨궈요', '떨궈서 쳐요', '누르지 마요']), sub: '스틱 무게로 떨어뜨려요', mode: 'coach-info', target: null };
    case 'LIVE_PAD_LATE':
      // 치고 나서 옮기면 늦다. 치는 동작과 함께 옮긴다. 키보드는 그 키에 미리 손가락을 둔다
      return padLabel
        ? {
            title: turn([`${padLabel} 미리!`, `${padLabel} 쪽으로`]),
            sub: keys ? `${keys} 키에 손가락 대기` : '앞 노트 칠 때 손을 옮겨요',
            mode: 'coach-info',
            target,
          }
        : null;
    case 'LIVE_PAD_EARLY':
      return padLabel
        ? { title: turn([`${padLabel} 천천히`, `${padLabel} 차분히`]), sub: keyboard ? '박에 맞춰 눌러요' : '들고 있다 박에 떨궈요', mode: 'coach-info', target }
        : null;
    case 'LIVE_HAND_WEAK':
      // 양손 스틱 높이를 맞추면 소리 크기가 맞는다(키보드는 세기가 없어 이 지적이 나오지 않는다)
      return handLabel && otherHandLabel
        ? { title: turn([`${handLabel}도 높게`, `${handLabel}도 똑같이`]), sub: '양손 스틱 높이를 같게', mode: 'coach-info', target }
        : null;
    case 'LIVE_UNSTEADY':
      // 소리 내어 반박까지 세면 간격이 고르게 된다
      return { title: turn(['입으로 세요', '소리 내어 세요']), sub: '하나 그리고 둘 그리고', mode: 'coach-info', target: null };
    case 'LIVE_LLM':
      // LLM 구간 문구는 워커 가드레일(제목 8자·보조 16자, 숫자·금지어·키보드 표현)을 통과한 그대로 쓴다
      return message.llm?.title ? { title: message.llm.title, sub: message.llm.sub, mode: 'coach-info', target: null } : null;
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
