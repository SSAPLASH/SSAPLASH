// 실시간 코칭 화면 문구 표. CoachMessage(태그+대상)를 연주 안내 칸에 띄울 제목·보조·모드로 바꾼다.
// 문구·톤은 이 파일에서만 고친다(모듈의 text는 플레이 로그 전용). 모드는 문자열만 돌려주고
// GuideSlot 컴포넌트를 가져오지 않는다. 제목 10자·보조 16자 안쪽으로 쓴다.
import { PAD_META } from '@/domain/pads';
import type { CoachMessage } from './LiveCoach';

/** GuideSlot의 코칭 모드와 같은 문자열. components를 import하지 않으려고 여기서 따로 정의한다 */
export type CoachCopyMode = 'coach-info' | 'coach-warn';

export interface CoachCopy {
  title: string;
  sub: string;
  mode: CoachCopyMode;
}

const HAND_LABEL = ['왼손', '오른손'] as const;

/** 변환할 수 없으면(모르는 태그·필요한 대상 없음) null. 호출 쪽이 표시를 건너뛴다 */
export function coachCopy(message: CoachMessage): CoachCopy | null {
  const { tag, target } = message;
  const padLabel = target?.kind === 'pad' ? PAD_META[target.pad]?.label : undefined;
  const handLabel = target?.kind === 'hand' ? HAND_LABEL[target.hand] : undefined;

  switch (tag) {
    case 'LIVE_MISS_STREAK':
      return { title: '놓친 노트가 많아요', sub: '박자에 맞춰 천천히 따라와요', mode: 'coach-warn' };
    case 'LIVE_LATE':
      return { title: '조금씩 늦어요', sub: '박보다 살짝 앞서 쳐 보세요', mode: 'coach-info' };
    case 'LIVE_EARLY':
      return { title: '조금씩 빨라요', sub: '박을 끝까지 기다렸다 치세요', mode: 'coach-info' };
    case 'LIVE_PAD_LATE':
      return padLabel ? { title: `${padLabel}만 늦어요`, sub: '그 패드는 조금 더 일찍', mode: 'coach-info' } : null;
    case 'LIVE_PAD_EARLY':
      return padLabel ? { title: `${padLabel}만 빨라요`, sub: '그 패드는 한 박 기다려요', mode: 'coach-info' } : null;
    case 'LIVE_HAND_WEAK':
      return handLabel ? { title: `${handLabel}이 약해요`, sub: '양손 세기를 맞춰 보세요', mode: 'coach-info' } : null;
    case 'LIVE_UNSTEADY':
      return { title: '박자가 흔들려요', sub: '같은 속도를 유지해 보세요', mode: 'coach-info' };
    default:
      return null;
  }
}
