// 서버 모델 받기·검증·실험군 배정(설계 6절 인수 조건)
// - 매니페스트의 current를 바꾸면 FE 배포 없이 다음 연주부터 새 모델을 쓴다
// - 같은 사용자는 같은 실험군에 배정되고, 로그에 실험군이 남는다
// - 파일을 못 받거나 sha256·featureVersion이 다르면 모델 없이 동작한다
import { beforeEach, describe, expect, it } from 'vitest';
import weights from '../gate/coachGate.json';
import { GATE_FEATURE_VERSION, GATE_INPUT_COUNT } from '../gate/gate';
import { LIVE_ARM_TAG, LIVE_GATE_KEEP_TAG, LiveCoach } from '../LiveCoach';
import type { JudgedNote } from '../window';
import { assignGateArm, bucketOf, parseCoachLiveConfig, type CoachLiveConfig } from './experiment';
import { currentModel, fetchVerified, parseManifest } from './manifest';
import { chooseCoachModel, refreshCoachModels, resetCoachModelsForTest, RULE_ARM } from './registry';
import { loadRemoteGate, parseGateMeta } from './remoteGate';
import { FakeModelServer, type FakeFile } from './testServer';

const meta = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    task: 'gate',
    modelVersion: 'coach-gate-0.1',
    featureVersion: GATE_FEATURE_VERSION,
    inputNames: Array.from({ length: GATE_INPUT_COUNT }, (_, i) => `f${i}`),
    runtime: [
      { kind: 'json', path: 'coachGate.json' },
      { kind: 'onnx', path: 'coachGate.onnx' },
    ],
    threshold: 0.4,
    trainedOn: 'SYNTHETIC',
    ...over,
  });
const gateFiles = (over: { meta?: string; weights?: string; badHash?: boolean } = {}): FakeFile[] => [
  { path: 'coachGate.json', body: over.weights ?? JSON.stringify(weights), badHash: over.badHash },
  { path: 'meta.json', body: over.meta ?? meta() },
];
const config = (c: Partial<CoachLiveConfig> & { gate: CoachLiveConfig['gate'] }) => JSON.stringify({ cause: { arms: [] }, rolloutPercent: 100, ...c });

function server(): FakeModelServer {
  const s = new FakeModelServer();
  s.models = [
    { name: 'coach-gate-mlp16', current: '1', versions: [{ version: '1', files: gateFiles() }] },
    { name: 'coach-gate-logistic', current: '3', versions: [{ version: '3', files: gateFiles({ meta: meta({ threshold: 0.7 }) }) }] },
    {
      name: 'coach-live-config',
      current: '1',
      versions: [{ version: '1', files: [{ path: 'config.json', body: config({ gate: { mode: 'on', arms: [{ model: 'coach-gate-mlp16', share: 100 }] } }) }] }],
    },
  ];
  return s;
}

describe('매니페스트', () => {
  it('형식이 틀린 모델·버전은 버리고 경로 이동 문자열을 받지 않는다', async () => {
    const m = parseManifest({
      models: [
        { name: 'ok', current: '1', versions: [{ version: '1', files: [{ path: 'a.json', sha256: 'a'.repeat(64), size: 1 }] }] },
        { name: '../etc', current: '1', versions: [] },
        { name: 'bad-path', current: '1', versions: [{ version: '1', files: [{ path: '../a.json', sha256: 'a'.repeat(64), size: 1 }] }] },
      ],
    });
    expect(m?.models.map((x) => x.name)).toEqual(['ok', 'bad-path']);
    expect(m && currentModel(m, 'bad-path')).toBeNull();
    expect(parseManifest({ nope: 1 })).toBeNull();
  });

  it('current가 게시된 버전이 아니면 쓰지 않는다', () => {
    const m = parseManifest({ models: [{ name: 'x', current: '9', versions: [{ version: '1', files: [] }] }] })!;
    expect(currentModel(m, 'x')).toBeNull();
  });

  it('받은 파일의 sha256이 다르면 버린다', async () => {
    const s = server();
    s.models[0].versions[0].files = gateFiles({ badHash: true });
    const m = parseManifest(await s.manifest())!;
    const cur = currentModel(m, 'coach-gate-mlp16')!;
    expect(await fetchVerified(s.fetch, cur, 'coachGate.json')).toBeNull();
    expect(await fetchVerified(s.fetch, cur, 'meta.json')).not.toBeNull();
    expect(await fetchVerified(s.fetch, cur, 'nope.json')).toBeNull();
  });
});

describe('서버 거름 모델', () => {
  it('meta.json과 가중치를 검증해 실행기를 만들고, 기록에는 이름@버전을 남긴다', async () => {
    const s = server();
    const gate = await loadRemoteGate(s.fetch, parseManifest(await s.manifest())!, 'coach-gate-mlp16');
    expect(gate).toMatchObject({ runtime: 'json', threshold: 0.4, model: 'coach-gate-mlp16@1' });
    const score = gate!.score(new Array(GATE_INPUT_COUNT).fill(0.5));
    expect(typeof score === 'number' && score > 0 && score < 1).toBe(true);
  });

  it('입력 버전·과제·입력 수가 다르면 쓰지 않는다', () => {
    expect(parseGateMeta(JSON.parse(meta()))).not.toBeNull();
    expect(parseGateMeta(JSON.parse(meta({ featureVersion: GATE_FEATURE_VERSION + 1 })))).toBeNull();
    expect(parseGateMeta(JSON.parse(meta({ task: 'cause' })))).toBeNull();
    expect(parseGateMeta(JSON.parse(meta({ inputNames: ['a'] })))).toBeNull();
  });

  it('입력 버전이 다르거나 가중치 모양이 틀리거나 파일이 손상됐으면 null', async () => {
    for (const files of [
      gateFiles({ meta: meta({ featureVersion: 99 }) }),
      gateFiles({ weights: JSON.stringify({ ...weights, mean: [1, 2] }) }),
      gateFiles({ badHash: true }),
      gateFiles({ meta: meta({ runtime: [{ kind: 'onnx', path: 'coachGate.onnx' }] }) }),
    ]) {
      const s = server();
      s.models[0].versions[0].files = files;
      expect(await loadRemoteGate(s.fetch, parseManifest(await s.manifest())!, 'coach-gate-mlp16')).toBeNull();
    }
  });
});

describe('실험 설정과 배정', () => {
  const two: CoachLiveConfig = {
    gate: {
      mode: 'shadow',
      arms: [
        { model: 'coach-gate-mlp16', share: 50 },
        { model: 'coach-gate-logistic', share: 50 },
      ],
    },
    cause: { arms: [] },
    rolloutPercent: 100,
    llm: { mode: 'off', rolloutPercent: 0 },
  };

  it('비율 합이 100이 아니거나 모드가 틀리면 설정을 쓰지 않는다', () => {
    expect(parseCoachLiveConfig(two)).toEqual(two);
    expect(parseCoachLiveConfig({ ...two, gate: { mode: 'shadow', arms: [{ model: 'coach-gate-mlp16', share: 60 }] } })).toBeNull();
    expect(parseCoachLiveConfig({ ...two, gate: { ...two.gate, mode: 'maybe' } })).toBeNull();
    expect(parseCoachLiveConfig({ ...two, rolloutPercent: 101 })).toBeNull();
  });

  it('같은 사용자는 늘 같은 실험군이고, 사용자들은 비율대로 나뉜다', () => {
    expect(assignGateArm(two, 42)).toEqual(assignGateArm(two, 42));
    const counts = new Map<string, number>();
    for (let id = 1; id <= 2000; id++) {
      const a = assignGateArm(two, id).arm!.model;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    expect(counts.get('coach-gate-mlp16')!).toBeGreaterThan(850);
    expect(counts.get('coach-gate-logistic')!).toBeGreaterThan(850);
  });

  it('비율을 올려도 이미 들어온 사용자의 실험군은 그대로다', () => {
    const at = (p: number) => ({ ...two, rolloutPercent: p });
    for (let id = 1; id <= 300; id++) {
      const before = assignGateArm(at(30), id);
      if (before.inRollout) expect(assignGateArm(at(80), id).arm).toEqual(before.arm);
    }
  });

  it('비로그인은 판마다 무작위로, off면 아무도 모델을 쓰지 않는다', () => {
    expect(assignGateArm(two, null, () => 0.1).arm?.model).toBe('coach-gate-mlp16');
    expect(assignGateArm(two, null, () => 0.9).arm?.model).toBe('coach-gate-logistic');
    expect(assignGateArm({ ...two, gate: { ...two.gate, mode: 'off' } }, 1).arm).toBeNull();
    expect(bucketOf('gate:1')).toBe(bucketOf('gate:1'));
  });
});

describe('연주마다 고르기', () => {
  beforeEach(() => resetCoachModelsForTest());

  it('설정을 받기 전이나 매니페스트가 없으면 빌드 기본값을 쓴다', async () => {
    expect(chooseCoachModel(1)).toEqual({ gate: undefined, mode: undefined, arm: null, cause: null, causeArm: null, llm: null, llmArm: null });
    const s = server();
    s.down = true;
    await refreshCoachModels(s.fetch);
    expect(chooseCoachModel(1)).toEqual({ gate: undefined, mode: undefined, arm: null, cause: null, causeArm: null, llm: null, llmArm: null });
  });

  it('설정을 받으면 실험군의 서버 모델과 모드를 쓴다', async () => {
    await refreshCoachModels(server().fetch);
    const c = chooseCoachModel(7);
    expect(c.arm).toBe('coach-gate-mlp16');
    expect(c.mode).toBe('on');
    expect(c.gate?.model).toBe('coach-gate-mlp16@1');
  });

  it('매니페스트의 current를 바꾸면 다음에 받을 때부터 새 버전을 쓰고, 받은 버전은 다시 받지 않는다', async () => {
    const s = server();
    await refreshCoachModels(s.fetch);
    s.models[0].versions.push({ version: '2', files: gateFiles({ meta: meta({ threshold: 0.55 }) }) });
    s.models[0].current = '2';
    await refreshCoachModels(s.fetch);
    expect(chooseCoachModel(7).gate).toMatchObject({ model: 'coach-gate-mlp16@2', threshold: 0.55 });
    // 롤백
    s.models[0].current = '1';
    const before = s.requests.length;
    await refreshCoachModels(s.fetch);
    expect(chooseCoachModel(7).gate?.model).toBe('coach-gate-mlp16@1');
    expect(s.requests.slice(before).filter((u) => u.includes('/coach-gate-mlp16/1/'))).toEqual([]);
  });

  it('실험군 모델을 검증하지 못했거나 비율 밖이면 그 판은 규칙만 쓰고 rule로 남긴다', async () => {
    const s = server();
    s.models[0].versions[0].files = gateFiles({ badHash: true });
    await refreshCoachModels(s.fetch);
    expect(chooseCoachModel(7)).toEqual({ gate: null, mode: 'on', arm: RULE_ARM, cause: null, causeArm: null, llm: null, llmArm: null });

    const s2 = server();
    s2.models[2].versions[0].files = [{ path: 'config.json', body: config({ gate: { mode: 'on', arms: [{ model: 'coach-gate-mlp16', share: 100 }] }, rolloutPercent: 0 }) }];
    resetCoachModelsForTest();
    await refreshCoachModels(s2.fetch);
    expect(chooseCoachModel(7)).toEqual({ gate: null, mode: 'on', arm: RULE_ARM, cause: null, causeArm: null, llm: null, llmArm: null });
  });

  it('설정이 off면 거름 없이 규칙만 쓴다', async () => {
    const s = server();
    s.models[2].versions[0].files = [{ path: 'config.json', body: config({ gate: { mode: 'off', arms: [] } }) }];
    await refreshCoachModels(s.fetch);
    expect(chooseCoachModel(7)).toEqual({ gate: null, mode: undefined, arm: RULE_ARM, cause: null, causeArm: null, llm: null, llmArm: null });
  });
});

describe('실험군 기록', () => {
  const late = (i: number): JudgedNote => ({ songTimeMs: 4000 + i * 500 + 40, noteTimeMs: 4000 + i * 500, judgement: 'GOOD', deltaMs: 40, pad: 'SNARE', stickId: (i % 2) as 0 | 1, velocity: 90 });

  it('판 시작에 LIVE_ARM을 남기고, 거름 기록에도 arm을 담는다. 재시작해도 다시 남긴다', () => {
    const gate = { runtime: 'json' as const, threshold: 0.5, model: 'coach-gate-mlp16@1', score: () => 0.9 };
    const coach = new LiveCoach({ goodMs: 60, gate, gateMode: 'on', arm: 'coach-gate-mlp16' });
    for (let i = 0; i < 12; i++) coach.push(late(i));
    const ev = coach.events();
    expect(ev[0]).toEqual({ tMs: 0, tag: LIVE_ARM_TAG, text: '{"arm":"coach-gate-mlp16"}' });
    expect(JSON.parse(ev.find((e) => e.tag === LIVE_GATE_KEEP_TAG)!.text)).toMatchObject({ arm: 'coach-gate-mlp16', model: 'coach-gate-mlp16@1' });
    coach.reset();
    expect(coach.events()).toEqual([{ tMs: 0, tag: LIVE_ARM_TAG, text: '{"arm":"coach-gate-mlp16"}' }]);
  });

  it('규칙만 쓰는 판도 rule로 남고, 서버 설정을 따르지 않은 판은 남기지 않는다', () => {
    expect(new LiveCoach({ goodMs: 60, gate: null, arm: RULE_ARM }).events()[0].tag).toBe(LIVE_ARM_TAG);
    expect(new LiveCoach({ goodMs: 60, gate: null }).events()).toEqual([]);
  });
});
