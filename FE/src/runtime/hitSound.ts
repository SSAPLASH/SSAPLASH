// 공용 타격음 스위치(QA 352). 타격이 오면 공용 경로(bootstrap onHit)가 소리·텔레메트리를 낼지 정한다.
// 기본은 끔 — 드럼을 치는 화면(자유 모드·장비 설정)만 들어올 때 켜고 떠날 때 끈다. 리듬게임·악보 연습은 끈 채로 자체 처리한다.
// 곡 목록·기록 같은 화면에서는 스틱을 휘둘러도 울리지 않는다.

let screenOn = false;
// 보정 세션이 받는 동안 잠시 막는다. 화면 스위치와 따로 두어 보정이 끝나도 화면 설정을 덮어쓰지 않는다
let calibrationMuted = false;

/** 화면이 들어올 때 켜고 떠날 때 끈다 */
export function setSoundOnHit(v: boolean): void {
  screenOn = v;
}

/** 보정 세션 의존(CalibrationDeps.setSoundOnHit). false면 보정 중이라 막고, true면 막음을 푼다 */
export function setCalibrationSound(v: boolean): void {
  calibrationMuted = !v;
}

/** 지금 공용 경로가 타격음을 낼지 */
export function hitSoundActive(): boolean {
  return screenOn && !calibrationMuted;
}

/** 테스트용 초기화 */
export function resetHitSoundForTest(): void {
  screenOn = false;
  calibrationMuted = false;
}
