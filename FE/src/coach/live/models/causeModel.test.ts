// 놓침 원인 모델: AI와 같은 계산, 후보 안에서만 고르기, 서버에서 받기, 기록
import { beforeEach, describe, expect, it } from 'vitest';
import type { CauseCandidate, MissCause } from '../cause';
import { LIVE_ARM_TAG, LIVE_CAUSE_TAG, LiveCoach } from '../LiveCoach';
import type { JudgedNote, StrayHit } from '../window';
import fixture from './cause.parity.fixture.json';
import { parseManifest } from './manifest';
import { chooseCoachModel, refreshCoachModels, resetCoachModelsForTest, RULE_ARM } from './registry';
import {
  CAUSE_CLASSES,
  CAUSE_FEATURE_VERSION,
  causeProbs,
  createCauseModel,
  loadRemoteCause,
  parseCauseMeta,
  parseCauseWeights,
  type CauseModel,
  type CauseWeights,
} from './remoteCause';
import { FakeModelServer } from './testServer';

const weights = parseCauseWeights(fixture.model) as CauseWeights;
const cand = (cause: MissCause, strength = 1): CauseCandidate => ({ cause, strength, pad: 'SNARE' });

const causeMeta = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    task: 'cause',
    modelVersion: 'coach-cause-0.1',
    featureVersion: CAUSE_FEATURE_VERSION,
    inputNames: ['a', 'b', 'c', 'd', 'e', 'f'],
    runtime: [{ kind: 'json', path: 'coachCause.json' }],
    classes: CAUSE_CLASSES,
    trainedOn: 'SYNTHETIC',
    ...over,
  });

describe('원인 모델 계산', () => {
  it('AI에서 내보낸 모델과 확률·고른 원인이 같다', () => {
    expect(weights).not.toBeNull();
    const model = createCauseModel(weights, 'coach-cause-logistic@1');
    for (const s of fixture.samples) {
      const p = causeProbs(weights, s.input);
      p.forEach((v, i) => expect(Math.abs(v - s.probs[i])).toBeLessThan(1e-9));
      // 입력(후보 강도, 3단계 여부, 패드 놓침 여부)에서 후보·단계·지적을 되살려 고르기까지 같은지 본다
      const candidates = (s.candidates as MissCause[]).map((c) => cand(c, s.input[CAUSE_CLASSES.indexOf(c)]));
      const stage = s.input[4] === 1 ? 3 : 2;
      const tag = s.input[5] === 1 ? 'LIVE_PAD_MISS' : 'LIVE_MISS_STREAK';
      expect(model.pick(candidates, stage, tag).cause).toBe(s.picked);
    }
  });

  it('후보에 없는 원인은 고르지 않고, 후보가 없으면 UNKNOWN이다', () => {
    const model = createCauseModel(weights, 'm');
    const picked = model.pick([cand('DENSE')], 3, 'LIVE_MISS_STREAK').cause;
    expect(['DENSE', 'UNKNOWN']).toContain(picked);
    expect(model.pick([], 3, 'LIVE_MISS_STREAK').cause).toBe('UNKNOWN');
  });

  it('메타의 과제·입력 버전·클래스가 다르거나 층 모양이 맞지 않으면 쓰지 않는다', () => {
    expect(parseCauseMeta(JSON.parse(causeMeta()))).toBe('coachCause.json');
    expect(parseCauseMeta(JSON.parse(causeMeta({ task: 'gate' })))).toBeNull();
    expect(parseCauseMeta(JSON.parse(causeMeta({ featureVersion: 9 })))).toBeNull();
    expect(parseCauseMeta(JSON.parse(causeMeta({ classes: ['DENSE'] })))).toBeNull();
    expect(parseCauseWeights({ ...fixture.model, mean: [0] })).toBeNull();
    expect(parseCauseWeights({ ...fixture.model, layers: [{ w: [[1]], b: [1], act: 'none' }] })).toBeNull();
  });
});

function server(): FakeModelServer {
  const s = new FakeModelServer();
  s.models = [
    {
      name: 'coach-cause-logistic',
      current: '1',
      versions: [
        {
          version: '1',
          files: [
            { path: 'coachCause.json', body: JSON.stringify(fixture.model) },
            { path: 'meta.json', body: causeMeta() },
          ],
        },
      ],
    },
    {
      name: 'coach-live-config',
      current: '1',
      versions: [
        {
          version: '1',
          files: [
            {
              path: 'config.json',
              body: JSON.stringify({ gate: { mode: 'off', arms: [] }, cause: { arms: [{ model: 'coach-cause-logistic', share: 100 }] }, rolloutPercent: 100 }),
            },
          ],
        },
      ],
    },
  ];
  return s;
}

describe('서버 원인 모델', () => {
  beforeEach(() => resetCoachModelsForTest());

  it('검증해서 받고, 실험군으로 배정한다(거름이 off여도 원인 모델은 쓴다)', async () => {
    const s = server();
    expect(await loadRemoteCause(s.fetch, parseManifest(await s.manifest())!, 'coach-cause-logistic')).toMatchObject({ model: 'coach-cause-logistic@1' });
    await refreshCoachModels(s.fetch);
    const c = chooseCoachModel(5);
    expect(c.cause?.model).toBe('coach-cause-logistic@1');
    expect(c.causeArm).toBe('coach-cause-logistic');
    expect(c.arm).toBe(RULE_ARM);
  });

  it('파일이 손상됐으면 원인은 규칙으로 고르고 rule로 남긴다', async () => {
    const s = server();
    s.models[0].versions[0].files[0].badHash = true;
    await refreshCoachModels(s.fetch);
    expect(chooseCoachModel(5)).toMatchObject({ cause: null, causeArm: RULE_ARM });
  });
});

describe('원인 모델 기록', () => {
  const GAP = 500;
  function wrongPadCoach(opts: ConstructorParameters<typeof LiveCoach>[0]): LiveCoach {
    const coach = new LiveCoach(opts);
    for (let i = 0; i < 24; i++) {
      const noteTimeMs = 4000 + i * GAP;
      if (i % 2 === 1) {
        const stray: StrayHit = { pad: 'MID_TOM', songTimeMs: noteTimeMs + 10 };
        coach.pushStray(stray.pad, stray.songTimeMs);
        coach.push({ songTimeMs: noteTimeMs + 60, noteTimeMs, judgement: 'MISS', deltaMs: null, pad: 'SMALL_TOM', stickId: null, velocity: null } as JudgedNote);
      } else {
        coach.push({ songTimeMs: noteTimeMs, noteTimeMs, judgement: 'GOOD', deltaMs: 0, pad: 'SNARE', stickId: 0, velocity: 90 } as JudgedNote);
      }
    }
    return coach;
  }

  it('원인 모델이 고르면 LIVE_CAUSE에 by=MODEL과 모델 이름을 남기고, LIVE_ARM에 causeArm을 담는다', () => {
    const fake: CauseModel = { model: 'coach-cause-logistic@1', pick: (cands) => cands[0] };
    const coach = wrongPadCoach({ goodMs: 60, gate: null, noteGapMedianMs: GAP, causeModel: fake, causeArm: 'coach-cause-logistic' });
    const ev = coach.events();
    expect(JSON.parse(ev[0].text)).toEqual({ causeArm: 'coach-cause-logistic' });
    expect(ev[0].tag).toBe(LIVE_ARM_TAG);
    const cause = JSON.parse(ev.find((e) => e.tag === LIVE_CAUSE_TAG)!.text);
    expect(cause).toMatchObject({ picked: 'WRONG_PAD', by: 'MODEL', model: 'coach-cause-logistic@1' });
  });

  it('모델이 UNKNOWN을 고르면 화면 원인도 UNKNOWN이다', () => {
    const fake: CauseModel = { model: 'm@1', pick: () => ({ cause: 'UNKNOWN', strength: 0, pad: null }) };
    const coach = wrongPadCoach({ goodMs: 60, gate: null, noteGapMedianMs: GAP, causeModel: fake });
    expect(JSON.parse(coach.events().find((e) => e.tag === LIVE_CAUSE_TAG)!.text)).toMatchObject({ picked: 'UNKNOWN', by: 'MODEL' });
  });

  it('모델이 예외를 던지면 규칙으로 고르고 by=RULE로 남긴다', () => {
    const broken: CauseModel = {
      model: 'm@1',
      pick: () => {
        throw new Error('시험');
      },
    };
    const coach = wrongPadCoach({ goodMs: 60, gate: null, noteGapMedianMs: GAP, causeModel: broken });
    const cause = JSON.parse(coach.events().find((e) => e.tag === LIVE_CAUSE_TAG)!.text);
    expect(cause).toMatchObject({ picked: 'WRONG_PAD', by: 'RULE' });
    expect(cause).not.toHaveProperty('model');
  });
});
