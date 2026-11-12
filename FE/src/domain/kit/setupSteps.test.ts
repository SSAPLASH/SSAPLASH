// setupSteps 단위 테스트: 센서/키보드, 조건 조합, 한 손/양손, 문구, 조사.
import { describe, expect, it } from 'vitest';
import {
  dongleLine,
  returnBannerText,
  returnButtonText,
  returnTargetName,
  setupBarCleanText,
  setupBarView,
  setupSteps,
  realignText,
  CALIBRATION_NEEDED_TEXT,
  CALIBRATION_SYSTEM_TEXT,
  unsavedLeaveText,
  type SetupStepsInput,
} from './setupSteps';

const NOW = new Date(2026, 9, 30, 15, 0).getTime();
const base: SetupStepsInput = {
  sensorKind: 'pointer',
  connected: [false, false],
  pedal: [true, true],
  firstSetupDone: false,
  referenceSetAt: null,
};
const allDone: SetupStepsInput = {
  ...base,
  connected: [true, true],
  firstSetupDone: true,
  referenceSetAt: new Date(2026, 9, 30, 14, 2).getTime(),
  battery: [82, 64],
};

describe('setupSteps', () => {
  it('아무것도 없으면 두 단계 모두 필요, 첫 단계는 스틱(③ 프리셋 단계는 없다, UX-64)', () => {
    const r = setupSteps(base, NOW);
    expect(r.steps.map((s) => s.id)).toEqual(['stick', 'calibration']);
    expect(r.steps.map((s) => s.status)).toEqual(['needed', 'needed']);
    expect(r).toMatchObject({ doneCount: 0, total: 2, firstNeeded: 'stick' });
    expect(r.steps[0].summary).toBe('연결된 스틱이 없어요');
  });

  it('한 손만 연결되면 스틱은 필요이고 요약이 그 손을 말한다', () => {
    expect(setupSteps({ ...base, connected: [true, false] }, NOW).steps[0]).toMatchObject({ status: 'needed', summary: '오른손 연결 안 됨' });
    expect(setupSteps({ ...base, connected: [false, true] }, NOW).steps[0].summary).toBe('왼손 연결 안 됨');
  });

  it('동글 소스는 요약에 페달을 포함하고, 다른 소스는 페달을 넣지 않는다(E4)', () => {
    const dongle = { ...allDone, sensorKind: 'webserial' as const };
    expect(setupSteps({ ...dongle, pedal: [true, true] }, NOW).steps[0].summary).toBe('왼손·오른손·페달 연결됨 · 82% / 64%');
    expect(setupSteps({ ...dongle, pedal: [false, true] }, NOW).steps[0].summary).toBe('페달 연결 안 됨');
    expect(setupSteps({ ...dongle, connected: [true, false], pedal: [true, true] }, NOW).steps[0].summary).toBe('오른손 연결 안 됨');
    expect(setupSteps({ ...allDone, sensorKind: 'ble', pedal: [false, false] }, NOW).steps[0].summary).toBe('왼손·오른손 연결됨 · 82% / 64%');
  });

  it('동글 소스는 페달까지 붙어야 ① 연결이 끝나고, 다른 소스는 페달을 보지 않는다', () => {
    const dongle = { ...allDone, sensorKind: 'webserial' as const };
    const off = setupSteps({ ...dongle, pedal: [false, false] }, NOW);
    expect(off.steps[0]).toMatchObject({ status: 'needed', summary: '페달 연결 안 됨' });
    expect(off.firstNeeded).toBe('stick');
    expect(off.steps[1].status).toBe('done');
    expect(setupSteps({ ...dongle, pedal: [true, true] }, NOW).steps[0].status).toBe('done');
    expect(setupSteps({ ...allDone, sensorKind: 'ble', pedal: [false, false] }, NOW).steps[0].status).toBe('done');
  });

  it('동글 상태에 따라 스틱 요약이 바뀐다(Figma 264:8805·264:8855)', () => {
    const summary = (dongle: SetupStepsInput['dongle'], connected: [boolean, boolean] = [false, false]) =>
      setupSteps({ ...base, sensorKind: 'webserial', connected, dongle }, NOW).steps[0].summary;
    expect(summary('closed')).toBe('동글을 연결하면 스틱 상태가 보여요');
    expect(summary('ok')).toBe('동글이 연결됐어요 · 스틱 버튼을 눌러 켜 주세요');
    expect(summary('waiting')).toBe('동글이 연결됐어요 · 스틱 버튼을 눌러 켜 주세요');
    expect(summary('stale')).toBe('동글 응답이 없어요 · 동글을 다시 꽂아 주세요');
    // 한 손이라도 붙었으면 손을 짚는 요약이 우선
    expect(summary('ok', [false, true])).toBe('왼손 연결 안 됨');
  });

  it('전부 충족하면 완료 요약 문구', () => {
    const r = setupSteps(allDone, NOW);
    expect(r.steps.map((s) => s.summary)).toEqual(['왼손·오른손 연결됨 · 82% / 64%', '오늘 14:02에 보정했어요']);
    expect(r).toMatchObject({ doneCount: 2, total: 2, firstNeeded: null });
  });

  it('배터리가 null이면 –, 값을 안 넘기면 배터리를 붙이지 않는다', () => {
    expect(setupSteps({ ...allDone, battery: [null, 64] }, NOW).steps[0].summary).toBe('왼손·오른손 연결됨 · – / 64%');
    expect(setupSteps({ ...allDone, battery: undefined }, NOW).steps[0].summary).toBe('왼손·오른손 연결됨');
    // 배터리를 하나도 모르면(포인터 소스 등) 배터리 부분을 뺀다
    expect(setupSteps({ ...allDone, battery: [null, null] }, NOW).steps[0].summary).toBe('왼손·오른손 연결됨');
  });

  it('다른 날 보정은 날짜를 붙인다', () => {
    const r = setupSteps({ ...allDone, referenceSetAt: new Date(2026, 9, 29, 9, 5).getTime() }, NOW);
    expect(r.steps[1].summary).toBe('10월 29일 09:05에 보정했어요');
  });

  it('키보드 전용은 두 단계 모두 필요 없음이라 셀 단계가 없다', () => {
    const none = { ...base, sensorKind: 'none' as const };
    const r = setupSteps(none, NOW);
    expect(r.steps.map((s) => s.status)).toEqual(['skipped', 'skipped']);
    expect(r.steps[0].summary).toBe('키보드만 사용해 필요 없어요');
    expect(r).toMatchObject({ doneCount: 0, total: 0, firstNeeded: null });
  });
});

describe('returnBannerText', () => {
  it('모자라면 준비 중 제목(을/를 처리)', () => {
    expect(returnBannerText(['firstSetup'], [true, true], '악보 연습').title).toBe('악보 연습을 준비하고 있어요');
    expect(returnBannerText(['firstSetup'], [true, true], '리듬 게임').title).toBe('리듬 게임을 준비하고 있어요');
    expect(returnBannerText(['firstSetup'], [true, true], '홈').title).toBe('홈을 준비하고 있어요');
    expect(returnBannerText(['firstSetup'], [true, true], '자유 연습 모드').title).toBe('자유 연습 모드를 준비하고 있어요');
  });
  it('스틱만 한 손 빠지면 손을 짚는 한 줄', () => {
    expect(returnBannerText(['stick'], [true, false], '악보 연습').line).toBe('오른손 스틱만 연결하면 돌아갈 수 있어요');
    expect(returnBannerText(['stick'], [false, true], '악보 연습').line).toBe('왼손 스틱만 연결하면 돌아갈 수 있어요');
  });
  it('여러 조건이면 문구를 이어 붙인다', () => {
    expect(returnBannerText(['stick', 'firstSetup'], [false, false], 'x').line).toBe(
      '왼손·오른손 스틱을 연결해 주세요 · 최초 설정(드럼 위치 보정)이 필요합니다',
    );
    expect(returnBannerText(['stick', 'firstSetup'], [true, false], 'x').line).toContain('오른손 스틱을 연결해 주세요 · 최초 설정');
  });
  it('다 되면 준비 완료 + 돌아가기 안내(으로/로)', () => {
    expect(returnBannerText([], [true, true], '악보 연습')).toEqual({
      title: '준비가 끝났어요',
      line: '악보 연습으로 돌아가 바로 시작할 수 있어요 (Enter)',
    });
    expect(returnBannerText([], [true, true], '홈').line).toBe('홈으로 돌아가 바로 시작할 수 있어요 (Enter)');
    expect(returnBannerText([], [true, true], '리듬 게임').line).toContain('리듬 게임으로');
    // ㄹ 받침은 "로"
    expect(returnBannerText([], [true, true], '연주실').line).toContain('연주실로');
    expect(returnBannerText([], [true, true], '밀').line).toContain('밀로');
  });
});

describe('돌아갈 곳 이름·버튼 문구', () => {
  it('경로로 이름을 짓고 returnLabel이 우선', () => {
    expect(returnTargetName('/play?songId=1')).toBe('리듬 게임');
    expect(returnTargetName('/sheet/abc')).toBe('악보 연습');
    expect(returnTargetName('/free')).toBe('자유 연습');
    expect(returnTargetName('/')).toBe('홈');
    expect(returnTargetName('/sheet?x=1', '악보 연습 · 별빛 산책')).toBe('악보 연습 · 별빛 산책');
  });
  it('/play·/sheet는 연주 준비 문구, 그 밖은 이름 + 으로/로', () => {
    expect(returnButtonText('/play?x=1')).toBe('곡 선택으로 돌아가기');
    expect(returnButtonText('/sheet', '악보 연습 · 별빛 산책')).toBe('곡 선택으로 돌아가기');
    expect(returnButtonText('/free')).toBe('자유 연습으로 돌아가기');
    expect(returnButtonText('/')).toBe('홈으로 돌아가기');
  });
});

describe('하단 바·이탈 문구', () => {
  it('문구', () => {
    expect(setupBarCleanText('기본 배치')).toBe('「기본 배치」 사용 중');
    expect(unsavedLeaveText('기본 배치')).toContain('「기본 배치」의 패드 위치를 바꿨어요');
    expect(unsavedLeaveText(null)).toContain('프리셋으로 남지 않아요');
  });

  it('보정 중(UX-64): 새 프리셋 / 적용 프리셋 문구와 [저장] 비활성. 변경·이탈보다 우선', () => {
    const v = setupBarView({ activePresetName: '내 배치', system: false, dirty: true, leaving: true, calibrating: { target: 'new', index: 0, total: 7 } });
    expect(v).toEqual({ text: '새 프리셋 보정 중 · 7개 중 1번째', tone: 'caption', button: 'save', buttonEnabled: false });
    expect(setupBarView({ activePresetName: '내 배치', system: false, dirty: false, leaving: false, calibrating: { target: 'active', index: 2, total: 7 } }).text).toBe(
      '「내 배치」 보정 중 · 7개 중 3번째',
    );
    // 보정 중이 아니면 기존 4상태 그대로
    expect(setupBarView({ activePresetName: '내 배치', system: false, dirty: false, leaving: false, calibrating: null })).toMatchObject({
      text: '「내 배치」 사용 중',
      buttonEnabled: false,
    });
  });

  it('초안을 들고 슬롯·이름 창이 열린 동안(UX-64 Figma ④·⑤): 저장 안내에 [저장] 비활성', () => {
    expect(setupBarView({ activePresetName: '시스템 기본', system: false, dirty: false, leaving: false, draft: { slot: null } })).toMatchObject({
      text: '보정 완료 · 빈 슬롯을 눌러 저장해요',
      buttonEnabled: false,
    });
    expect(setupBarView({ activePresetName: '시스템 기본', system: false, dirty: false, leaving: false, draft: { slot: 3 } }).text).toBe('보정 완료 · 슬롯 3에 저장할 이름을 정해요');
  });
});

describe('dongleLine', () => {
  it('포트가 안 열렸으면 [동글 연결]과 처음 한 번 안내, 점 없음', () => {
    expect(dongleLine('closed', [false, false])).toEqual({
      dot: null,
      text: '처음 한 번만 동글이 꽂힌 포트를 골라요',
      action: '동글 연결',
    });
  });
  it('스틱 0개면 켜 달라는 안내, 붙어 있으면 연결됨만', () => {
    expect(dongleLine('ok', [false, false])).toMatchObject({ dot: 'on', text: '동글이 연결됐어요 · 스틱 버튼을 눌러 켜 주세요', action: '다른 동글 연결' });
    expect(dongleLine('ok', [true, false])).toMatchObject({ dot: 'on', text: '동글이 연결됐어요' });
  });
  it('LINK가 끊기면 빨간 점과 다시 꽂기 안내', () => {
    expect(dongleLine('stale', [false, false])).toMatchObject({ dot: 'off', action: '다른 동글 연결' });
  });
});

describe('setupSteps ② 보정 카드 문구(PLAY-004 4-5)', () => {
  it('앵커가 없으면 "드럼 위치를 아직 잡지 않았어요"', () => {
    expect(setupSteps({ ...allDone, firstSetupDone: false }, NOW).steps[1].summary).toBe(CALIBRATION_NEEDED_TEXT);
  });

  it('재정렬이 필요한 손이 있으면 그 손을 짚는 요약(앵커 없음 문구보다 우선). 상태는 firstSetupDone이 정한다(UX-64 D7)', () => {
    const r = setupSteps({ ...allDone, firstSetupDone: false, realignNeeded: [false, true] }, NOW).steps[1];
    expect(r).toEqual({ id: 'calibration', status: 'needed', summary: '오른손 스틱이 다시 켜졌어요 · 스네어를 한 번 쳐 주세요' });
    expect(setupSteps({ ...allDone, realignNeeded: [true, true] }, NOW).steps[1].summary).toBe(
      '스틱이 다시 켜졌어요 · 스네어를 왼손·오른손 한 번씩 쳐 주세요',
    );
  });

  it('시스템 기본 프리셋은 보정 시각이 없으면 "보정 없이" 요약, 있으면 시각', () => {
    expect(setupSteps({ ...allDone, referenceSetAt: null, systemPreset: true }, NOW).steps[1].summary).toBe(CALIBRATION_SYSTEM_TEXT);
    expect(setupSteps({ ...allDone, systemPreset: true }, NOW).steps[1].summary).toBe('오늘 14:02에 보정했어요');
    expect(setupSteps({ ...allDone, referenceSetAt: null }, NOW).steps[1].summary).toBe('보정했어요');
  });

  it('realignText 단독', () => {
    expect(realignText(undefined)).toBeNull();
    expect(realignText([false, false])).toBeNull();
    expect(realignText([true, false])).toBe('왼손 스틱이 다시 켜졌어요 · 스네어를 한 번 쳐 주세요');
  });
});
