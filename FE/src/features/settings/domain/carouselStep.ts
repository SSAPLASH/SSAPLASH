// 설정 캐러셀(드럼 모양·타격 이펙트)이 공유하는 순환 이동 순수 함수.
import { KIT_SKINS } from '@/domain/kit/drumKit';
import type { KitSkin } from '@/domain/kit/drumKit';
import { HIT_FX_THEMES } from '@/domain/hitFx/themes';
import type { HitFxTheme } from '@/domain/hitFx/types';

/** 목록에서 이전(-1)·다음(1) 항목. 끝에서 넘기면 반대편 끝으로 순환한다 */
function stepCycle<T>(list: readonly T[], cur: T, dir: 1 | -1): T {
  const n = list.length;
  const i = list.indexOf(cur);
  return list[(i + dir + n) % n] ?? cur;
}

/** 이전(-1)·다음(1) 스킨. 끝에서 넘기면 반대편 끝으로 순환한다 */
export function nextSkin(cur: KitSkin, dir: 1 | -1): KitSkin {
  return stepCycle(KIT_SKINS, cur, dir);
}

/** 이전(-1)·다음(1) 테마. 끝에서 넘기면 반대편 끝으로 순환한다 */
export function nextFxTheme(cur: HitFxTheme, dir: 1 | -1): HitFxTheme {
  return stepCycle(HIT_FX_THEMES, cur, dir);
}
