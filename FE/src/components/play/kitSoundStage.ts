// 리듬 게임·악보 연습에서 타격음을 낼 단계(QA 352). 드럼 킷이 보이는 단계(준비 미리보기·연주)만 소리를 낸다.
// 곡 선택·불러오는 중에는 키보드·스틱·포인터 어떤 입력으로 쳐도 울리지 않는다. 판정·기록은 원래 연주 단계에서만 한다.

export type PlayStageName = 'select' | 'loading' | 'ready' | 'play';

/** 이 단계에서 타격음을 내는가 */
export function kitSoundStage(stage: PlayStageName): boolean {
  return stage === 'ready' || stage === 'play';
}
