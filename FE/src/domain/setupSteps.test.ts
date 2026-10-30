// setupSteps 단위 테스트: 센서/키보드, 조건 조합, 한 손/양손, 문구, 조사.
import { describe, expect, it } from 'vitest';
import {
  dongleLine,
  returnBannerText,
  returnButtonText,
  returnTargetName,
  setupBarCleanText,
  setupSteps,
  unsavedLeaveText,
  type SetupStepsInput,
} from './setupSteps';

const NOW = new Date(2026, 9, 30, 15, 0).getTime();
const base: SetupStepsInput = {
  sensorKind: 'pointer',
  connected: [false, false],
  firstSetupDone: false,
  activePresetId: null,
  referenceSetAt: null,
  activePresetName: null,
};
const allDone: SetupStepsInput = {
  ...base,
  connected: [true, true],
  firstSetupDone: true,
  activePresetId: 'p1',
  referenceSetAt: new Date(2026, 9, 30, 14, 2).getTime(),
  activePresetName: '기본 배치',
  battery: [82, 64],
};

describe('setupSteps', () => {
  it('아무것도 없으면 세 단계 모두 필요, 첫 단계는 스틱', () => {
    const r = setupSteps(base, NOW);
    expect(r.steps.map((s) => s.status)).toEqual(['needed', 'needed', 'needed']);
    expect(r).toMatchObject({ doneCount: 0, total: 3, firstNeeded: 'stick' });
    expect(r.steps[0].summary).toBe('연결된 스틱이 없어요');
  });

  it('한 손만 연결되면 스틱은 필요이고 요약이 그 손을 말한다', () => {
    expect(setupSteps({ ...base, connected: [true, false] }, NOW).steps[0]).toMatchObject({ status: 'needed', summary: '왼손만 연결됨' });
    expect(setupSteps({ ...base, connected: [false, true] }, NOW).steps[0].summary).toBe('오른손만 연결됨');
  });

  it('동글 상태에 따라 스틱 요약이 바뀐다(Figma 264:8805·264:8855)', () => {
    const summary = (dongle: SetupStepsInput['dongle'], connected: [boolean, boolean] = [false, false]) =>
      setupSteps({ ...base, sensorKind: 'webserial', connected, dongle }, NOW).steps[0].summary;
    expect(summary('closed')).toBe('동글을 연결하면 스틱 상태가 보여요');
    expect(summary('ok')).toBe('동글이 연결됐어요 · 스틱 버튼을 눌러 켜 주세요');
    expect(summary('waiting')).toBe('동글이 연결됐어요 · 스틱 버튼을 눌러 켜 주세요');
    expect(summary('stale')).toBe('동글 응답이 없어요 · 동글을 다시 꽂아 주세요');
    // 한 손이라도 붙었으면 손을 짚는 요약이 우선
    expect(summary('ok', [false, true])).toBe('오른손만 연결됨');
  });

  it('전부 충족하면 완료 요약 문구', () => {
    const r = setupSteps(allDone, NOW);
    expect(r.steps.map((s) => s.summary)).toEqual(['왼손·오른손 연결됨 · 82% / 64%', '오늘 14:02에 보정했어요', '「기본 배치」 사용 중']);
    expect(r).toMatchObject({ doneCount: 3, total: 3, firstNeeded: null });
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

  it('양손·보정만 끝나면 프리셋이 첫 필요 단계', () => {
    const r = setupSteps({ ...allDone, activePresetId: null, activePresetName: null }, NOW);
    expect(r).toMatchObject({ doneCount: 2, firstNeeded: 'preset' });
  });

  it('키보드 전용은 스틱·보정이 필요 없음, 프리셋만 센다', () => {
    const none = { ...base, sensorKind: 'none' as const };
    const r = setupSteps(none, NOW);
    expect(r.steps.map((s) => s.status)).toEqual(['skipped', 'skipped', 'needed']);
    expect(r.steps[0].summary).toBe('키보드만 사용해 필요 없어요');
    expect(r).toMatchObject({ doneCount: 0, total: 1, firstNeeded: 'preset' });
    expect(setupSteps({ ...none, activePresetId: 'p', activePresetName: 'A' }, NOW)).toMatchObject({ doneCount: 1, total: 1, firstNeeded: null });
  });
});

describe('returnBannerText', () => {
  it('모자라면 준비 중 제목(을/를 처리)', () => {
    expect(returnBannerText(['preset'], [true, true], '악보 연습').title).toBe('악보 연습을 준비하고 있어요');
    expect(returnBannerText(['preset'], [true, true], '리듬 게임').title).toBe('리듬 게임을 준비하고 있어요');
    expect(returnBannerText(['preset'], [true, true], '홈').title).toBe('홈을 준비하고 있어요');
    expect(returnBannerText(['preset'], [true, true], '자유 연습 모드').title).toBe('자유 연습 모드를 준비하고 있어요');
  });
  it('스틱만 한 손 빠지면 손을 짚는 한 줄', () => {
    expect(returnBannerText(['stick'], [true, false], '악보 연습').line).toBe('오른손 스틱만 연결하면 돌아갈 수 있어요');
    expect(returnBannerText(['stick'], [false, true], '악보 연습').line).toBe('왼손 스틱만 연결하면 돌아갈 수 있어요');
  });
  it('여러 조건이면 문구를 이어 붙인다', () => {
    expect(returnBannerText(['stick', 'preset'], [false, false], 'x').line).toBe('왼손·오른손 스틱을 연결하세요 · 사용할 프리셋을 적용하세요');
    expect(returnBannerText(['stick', 'firstSetup'], [true, false], 'x').line).toContain('오른손 스틱을 연결하세요 · 최초 설정');
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
    expect(returnButtonText('/play?x=1')).toBe('연주 준비로 돌아가기');
    expect(returnButtonText('/sheet', '악보 연습 · 별빛 산책')).toBe('연주 준비로 돌아가기');
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
