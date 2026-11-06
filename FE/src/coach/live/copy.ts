// 실시간 코칭 화면 문구 표. CoachMessage(태그+대상)를 연주 안내 칸에 띄울 제목·보조·모드로 바꾼다.
// 문구·톤은 이 파일에서만 고친다(모듈의 text는 플레이 로그 전용). 모드는 문자열만 돌려주고
// GuideSlot 컴포넌트를 가져오지 않는다. 지적 제목은 10자, 칭찬과 세팅 안내 제목은 13자, 보조는 16자 안쪽으로 쓴다.
// 같은 태그가 다시 뜨면 repeat 순서대로 제목을 돌려 쓴다(난수를 쓰지 않아 재생 결과가 같다).
import { coachPadName, objectParticle, padMissHint } from './padName';
import type { CoachMessage } from './LiveCoach';

/** GuideSlot의 코칭 모드와 같은 문자열. components를 import하지 않으려고 여기서 따로 정의한다 */
export type CoachCopyMode = 'coach-info' | 'coach-warn' | 'coach-good';

export interface CoachCopy {
  title: string;
  sub: string;
  mode: CoachCopyMode;
}

const HAND_LABEL = ['왼손', '오른손'] as const;

/** 화면 문구에 필요한 연주 정보 */
export interface CoachCopyContext {
  /** 키보드 입력이면 패드 안내에 키를 보여 준다 */
  keyboard?: boolean;
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
      return { title: '소리 타이밍을 확인해요', sub: '세팅에서 소리 지연을 맞춰요', mode: 'coach-info' };
    case 'LIVE_SETUP_PADS':
      return { title: '패드 위치를 확인해요', sub: '세팅에서 패드를 다시 잡아요', mode: 'coach-info' };
    case 'LIVE_PAD_MISS':
      return pad && padLabel
        ? {
            title: turn([`${padLabel}에 집중해요`, `${padLabel}${objectParticle(padLabel)} 놓쳤어요`, `${padLabel}${objectParticle(padLabel)} 챙겨요`]),
            sub: padMissHint(pad, context.keyboard === true),
            mode: 'coach-warn',
          }
        : null;
    case 'LIVE_MISS_STREAK':
      return { title: turn(['놓친 노트가 많아요', '노트를 잘 봐요', '다시 박을 잡아요']), sub: '다음 노트부터 맞춰요', mode: 'coach-warn' };
    case 'LIVE_LATE':
      return { title: turn(['조금씩 늦어요', '조금만 앞서 쳐요', '미리 준비해요']), sub: '박보다 살짝 앞서 쳐 보세요', mode: 'coach-info' };
    case 'LIVE_EARLY':
      return { title: turn(['조금씩 빨라요', '박을 기다려 보세요', '서두르지 않아요']), sub: '박을 끝까지 기다렸다 치세요', mode: 'coach-info' };
    case 'LIVE_PAD_LATE':
      return padLabel ? { title: turn([`${padLabel}만 늦어요`, `${padLabel} 조금 일찍`, `${padLabel} 미리 준비`]), sub: '손을 먼저 옮겨 두세요', mode: 'coach-info' } : null;
    case 'LIVE_PAD_EARLY':
      return padLabel ? { title: turn([`${padLabel}만 빨라요`, `${padLabel} 기다려요`, `${padLabel} 여유 있게`]), sub: '박에 맞춰 쳐요', mode: 'coach-info' } : null;
    case 'LIVE_HAND_WEAK':
      return handLabel ? { title: turn([`${handLabel}이 약해요`, `${handLabel}도 세게 쳐요`, `${handLabel}에 힘을 줘요`]), sub: '양손 세기를 맞춰 보세요', mode: 'coach-info' } : null;
    case 'LIVE_UNSTEADY':
      return { title: turn(['박자가 흔들려요', '같은 속도로 쳐요', '일정하게 쳐요']), sub: '같은 속도를 유지해 보세요', mode: 'coach-info' };
    case 'LIVE_GOOD_RECOVERED':
      return { title: turn(['좋아요! 고쳐졌어요', '훨씬 나아졌어요']), sub: '지금 느낌을 기억해요', mode: 'coach-good' };
    case 'LIVE_GOOD_STEADY':
      return { title: turn(['좋아요! 이대로만 치세요', '박이 딱 맞아요', '아주 안정적이에요', '이 느낌 그대로요']), sub: '지금 박자를 유지해요', mode: 'coach-good' };
    case 'LIVE_GOOD_KEEP':
      return { title: turn(['잘 따라오고 있어요', '그대로 이어가요', '좋아요, 계속 가요']), sub: '박에 맞춰 계속 쳐요', mode: 'coach-good' };
    default:
      return null;
  }
}
