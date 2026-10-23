// 통합 설정 페이지(/setup). 스틱 연결·시작 위치 보정·프리셋·배치·타격 확인·저장·설정 완료를 한 화면에 둔다.
// 판정은 배치(kitLayout)에서 유도되므로 편집 중 배치가 곧 판정이다. 저장은 presetStore, 보정은 ReferenceCapture가 맡고
// 이 페이지는 조립과 표시만 한다. 디자인은 Figma 이후 교체 예정이라 기존 클래스로 둔다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { KitCanvas } from '@/components/KitCanvas';
import { SensorOptionsPanel } from '@/components/SensorOptionsPanel';
import { useHitFx } from '@/components/useHitFx';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { selectDirty, usePresets } from '@/store/presetStore';
import { LANE_PADS, PAD_META, type PadId } from '@/domain/pads';
import type { HitFx } from '@/domain/events';
import { KEY_MAP } from '@/domain/keyMap';
import { layoutToProfile } from '@/domain/kitJudge';
import { KIT_LAYOUT_PRESET_LABELS, type KitLayoutPresetId } from '@/domain/kitLayout';
import { PRESET_NAME_MAX, validatePresetName, type PresetErrorCode } from '@/domain/preset';
import { sanitizeReturnTo } from '@/domain/auth';
import { READINESS_MESSAGES, readiness } from '@/domain/readiness';
import { TUNING_RANGES } from '@/domain/tuning';
import { audioEngine } from '@/audio/AudioEngine';
import { SOUND_SET_LABELS, type SoundSetId } from '@/audio/soundSets';
import { ReferenceCapture, type ReferenceSnapshot } from '@/engine/ReferenceCapture';
import { sensorRegistry } from '@/app/sensorRegistry';
import { bindSensorSurface, previewHit, setSoundOnHit } from '@/app/bootstrap';
import { inputManager, KEYBOARD_INPUT_ENABLED } from '@/app/sources';

const PRESET_IDS: KitLayoutPresetId[] = ['basic', 'wide', 'tight'];
const VELOCITY_CHOICES: { v: 64 | 96 | 120; label: string }[] = [
  { v: 64, label: '약' },
  { v: 96, label: '보통' },
  { v: 120, label: '강' },
];

const NO_SENSOR = { id: 'none', label: '키보드만', description: '키 하나가 패드 하나. 보정 없이 바로 플레이' };

const ERROR_TEXT: Record<PresetErrorCode, string> = {
  NAME_DUPLICATE: '같은 이름의 프리셋이 있습니다',
  LIMIT_EXCEEDED: '프리셋은 10개까지 저장할 수 있습니다',
  CONFLICT: '동시에 변경되어 저장하지 못했습니다. 다시 시도해 주세요',
  NOT_FOUND: '프리셋을 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요',
  NETWORK: '저장하지 못했습니다. 다시 시도해 주세요',
};

const NAME_TEXT = {
  EMPTY: '이름을 입력하세요',
  TOO_LONG: `이름은 ${PRESET_NAME_MAX}자 이하여야 합니다`,
  DUPLICATE: '같은 이름의 프리셋이 있습니다',
} as const;

const clock = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

export function SetupPage() {
  const s = useSettings();
  const presets = usePresets();
  const connected = useLive((l) => l.connected);
  const pose = useLive((l) => l.pose);
  const lastHit = useLive((l) => l.lastHit);
  const sourceState = useLive((l) => l.sourceState);
  const sourceMessage = useLive((l) => l.sourceMessage);
  const referenceSetAt = useLive((l) => l.referenceSetAt);
  const referenceStale = useLive((l) => l.referenceStale);
  const soundSetState = useLive((l) => l.soundSetState);
  const soundSetMissing = useLive((l) => l.soundSetMissing);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? null;

  const [tick, setTick] = useState(0);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const sensorMode = s.sensorKind !== 'none';
  const anyConnected = connected[0] || connected[1];
  const dirty = selectDirty(s, presets);
  const activePreset = presets.items.find((p) => p.id === s.activePresetId) ?? null;
  const saving = presets.status === 'saving';

  // 진입: 프리셋 목록 읽기, 센서 타격이 바로 울리게
  useEffect(() => {
    void usePresets.getState().refresh();
    setSoundOnHit(true);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // 판정 원은 배치에서 유도한 프로필로 그린다(판정과 같은 규칙)
  const anchors = useMemo(
    () =>
      layoutToProfile(s.kitLayout, s.tuning.angleRange, { maxRadiusDeg: s.tuning.maxRadiusDeg, radiusFactor: s.tuning.radiusFactor }).anchors,
    [s.kitLayout, s.tuning.angleRange, s.tuning.maxRadiusDeg, s.tuning.radiusFactor],
  );

  const lat = audioEngine.latency();
  void tick;

  // 타격 이펙트. 톡 치기·키보드·센서 타격 모두 live의 hitSeq로 들어온다
  const hits = useRef(new Map<PadId, HitFx>());
  useHitFx(hits);
  const testPad = (pad: PadId) => {
    void previewHit(pad, s.testVelocity);
  };

  // ---- ② 시작 위치 보정 (capturing 모드) ----
  const [capturing, setCapturing] = useState(false);
  const [snap, setSnap] = useState<ReferenceSnapshot>({ phase: 'idle', progress: 0, spread: 0 });
  const [capNote, setCapNote] = useState<string | null>(null);
  const capRef = useRef<ReferenceCapture | null>(null);
  const capCleanup = useRef<(() => void) | null>(null);

  const stopCapture = useCallback(() => {
    capCleanup.current?.();
    capCleanup.current = null;
    capRef.current = null;
    setCapturing(false);
  }, []);

  const startCapture = () => {
    stopCapture();
    const cap = new ReferenceCapture();
    capRef.current = cap;
    setCapNote(null);
    inputManager.setPoseStream(true);
    const offSnap = cap.subscribe((sn) => {
      setSnap(sn);
      if (sn.phase === 'done') {
        // 완료: 지금 자세를 기준으로 삼고 보정 시각을 남긴다
        inputManager.resetPose();
        useLive.setState({ referenceSetAt: Date.now(), referenceStale: false });
        setCapNote('시작 위치를 맞췄습니다');
        // 구독 콜백 안에서 해제하면 반복 중 변경이라 다음 틱에 정리한다
        window.setTimeout(() => {
          if (capRef.current === cap) stopCapture();
        }, 0);
      }
    });
    // 보정 대상은 0번 스틱 자세. 모의 IMU는 두 스틱이 같은 자세를 쓴다
    const offPose = inputManager.onPose((stickId, p) => {
      if (stickId === 0) cap.onPose(p, performance.now());
    });
    capCleanup.current = () => {
      offSnap();
      offPose();
    };
    setCapturing(true);
  };

  // 보정 중 연결이 모두 끊기면 처음부터 다시
  useEffect(() => {
    if (capturing && !anyConnected) capRef.current?.restart();
  }, [capturing, anyConnected]);

  // 언마운트 시 구독 해제. 자세 스트림은 다른 화면의 자세 마커가 쓰므로 켠 채 둔다
  useEffect(() => () => capCleanup.current?.(), []);

  // ---- ⑦ 저장 ----
  const flashSaved = () => {
    setSavedFlash(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
  };

  const onSaveChanges = () => {
    void presets.saveChanges().then((ok) => ok && flashSaved());
  };

  const onSaveAs = () => {
    const verdict = validatePresetName(newName, presets.items);
    if (verdict) {
      setNameError(NAME_TEXT[verdict]);
      return;
    }
    setNameError(null);
    void presets.saveAs(newName).then((ok) => {
      if (ok) {
        setNewName('');
        flashSaved();
      }
    });
  };

  // ---- ⑧ 설정 완료 ----
  // 설정 페이지에서는 "이 세션에서 보정했는가"를 묻는다(firstSetupDone 대신 referenceSetAt)
  const { ready: canFinish, missing } = readiness({
    sensorKind: s.sensorKind,
    connected,
    firstSetupDone: referenceSetAt !== null,
    activePresetId: s.activePresetId,
  });
  const leaving = useRef(false);

  const finish = () => {
    s.setFirstSetupDone(true);
    leaving.current = true;
    navigate(sanitizeReturnTo(returnTo));
  };

  // 미저장 변경이 있으면 다른 화면으로 가기 전에 확인한다(보정 중이거나 설정 완료 이동은 제외)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !capturing && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );

  // ---- ① 연결 상태 문구(자유 연주와 같은 표현) ----
  const sensorDesc = sensorRegistry.get(s.sensorKind);
  let connText: string;
  if (!sensorMode) connText = '키보드만 사용합니다.';
  else if (sourceState === 'error') connText = `오류: ${sourceMessage ?? '알 수 없음'}`;
  else if (sourceState === 'connecting') connText = '연결 중…';
  else if (anyConnected)
    connText = `연결됨 (${connected[0] ? '왼손' : ''}${connected[0] && connected[1] ? '·' : ''}${connected[1] ? '오른손' : ''})`;
  else connText = '연결 안 됨';

  const lastHitText = lastHit
    ? `${lastHit.pad ? PAD_META[lastHit.pad].label : '판정 없음'} · 세기 ${lastHit.velocity} · ${lastHit.source}`
    : '아직 없음';

  return (
    <main className="main wide">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1>설정</h1>
        <span className="small dim">연결 → 시작 위치 → 배치 → 쳐 보기 → 저장 → 설정 완료</span>
      </div>

      <div className="setup-grid">
        {/* 좌: ④ 드럼 배치 + ⑤ 타격 확인 */}
        <div className="col">
          <div className="card col">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>드럼 배치</h3>
              <button className="btn-ghost small" onClick={s.resetLayout}>
                기본 배치로
              </button>
            </div>
            <p className="small dim">
              패드를 끌어 원하는 자리에 둡니다. 배치가 곧 판정 영역이라 바로 쳐 보며 확인할 수 있습니다. 패드를 톡 치면 소리와 이펙트가
              나고, 끌면 위치만 바뀝니다.
            </p>
            <div className="chips">
              {PRESET_IDS.map((id) => (
                <button key={id} className="chip" onClick={() => s.applyLayoutPreset(id)}>
                  {KIT_LAYOUT_PRESET_LABELS[id]}
                </button>
              ))}
              <span className="small dim" style={{ marginLeft: 8 }}>
                세기
              </span>
              {VELOCITY_CHOICES.map((c) => (
                <button
                  key={c.v}
                  className={`chip ${s.testVelocity === c.v ? 'active' : ''}`}
                  onClick={() => s.setTestVelocity(c.v)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <KitCanvas
              layout={s.kitLayout}
              draggable
              onMovePad={s.movePad}
              onTapPad={testPad}
              hits={hits}
              keyMap={KEYBOARD_INPUT_ENABLED ? KEY_MAP : undefined}
              anchors={anchors}
              angleRange={s.tuning.angleRange}
              poses={pose}
              showPoses={sensorMode}
              surfaceRef={bindSensorSurface}
            />
            <div className="field">
              <label>사운드 세트</label>
              <select value={s.soundSetId} onChange={(e) => s.setSoundSetId(e.target.value as SoundSetId)}>
                {(['ssaplash', 'synth'] as SoundSetId[]).map((id) => (
                  <option key={id} value={id}>
                    {SOUND_SET_LABELS[id]}
                  </option>
                ))}
              </select>
              <p className="small faint">
                {s.soundSetId === 'synth'
                  ? '합성음을 씁니다.'
                  : soundSetState === 'loading'
                    ? '샘플 불러오는 중… (그동안은 합성음)'
                    : soundSetState === 'error'
                      ? '샘플을 불러오지 못해 합성음을 씁니다.'
                      : soundSetState === 'ready'
                        ? soundSetMissing.length > 0
                          ? `샘플 준비됨 · 합성음으로 대체: ${soundSetMissing.map((p) => PAD_META[p].label).join(', ')}`
                          : '샘플 준비됨'
                        : '소리를 한 번 내면 샘플을 불러옵니다.'}
              </p>
            </div>
          </div>

          <div className="card col">
            <h3>타격 확인</h3>
            {sensorMode && !anyConnected && <div className="notice error">스틱 입력 중단 — 연결을 확인하세요. 편집은 계속할 수 있습니다.</div>}
            <p className="small dim">마지막 타격: {lastHitText}</p>
            <div className="chips">
              {LANE_PADS.map((pad) => (
                <button key={pad} className="chip" onClick={() => testPad(pad)}>
                  {PAD_META[pad].label} 소리
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 우: ① ② ③ ⑦ ⑧ 카드(⑥은 ② 카드의 버튼) */}
        <div className="col">
          <div className="card col">
            <h3>스틱 연결</h3>
            <p className="small dim">키보드는 항상 켜져 있습니다. 센서를 고르면 센서 타격은 가상 키트 배치로 판정됩니다.</p>
            {[NO_SENSOR, ...sensorRegistry.list()].map((i) => (
              <label key={i.id} className="row sensor-choice">
                <input
                  type="radio"
                  name="sensor"
                  checked={s.sensorKind === i.id}
                  onChange={() => {
                    if (i.id === 'none') stopCapture(); // 키보드만으로 돌리면 보정 중단
                    s.setSensorKind(i.id);
                  }}
                  style={{ marginTop: 5 }}
                />
                <span className="col" style={{ gap: 0 }}>
                  <strong>{i.label}</strong>
                  <span className="small dim">{i.description}</span>
                </span>
              </label>
            ))}
            {sensorMode && <SensorOptionsPanel id={s.sensorKind} />}
            <p className="small">
              {sensorDesc?.label ?? '입력'} · {connText}
            </p>
            {sourceMessage && <div className={`notice ${sourceState === 'error' ? 'error' : ''}`}>{sourceMessage}</div>}
            {sensorMode && referenceStale && anyConnected && (
              <div className="notice">다시 연결됐습니다. 쳐 보고 필요하면 시작 위치를 다시 맞추세요</div>
            )}
          </div>

          <div className="card col">
            <h3>시작 위치 보정</h3>
            {!sensorMode ? (
              <p className="small dim">키보드 입력은 보정이 필요 없습니다.</p>
            ) : (
              <>
                <p className={referenceSetAt === null ? 'ref-status ref-need' : 'ref-status'}>
                  {referenceSetAt === null ? '최초 설정 필요' : `보정됨 ${clock(referenceSetAt)}`}
                </p>
                {capturing ? (
                  <div className="col">
                    <p className="small">스틱을 들고 3초간 자세를 유지하세요</p>
                    <div className="progress ref-progress">
                      <div style={{ width: `${Math.round(snap.progress * 100)}%` }} />
                    </div>
                    <p className="small dim">
                      {snap.phase === 'holding' ? `유지 중 ${(snap.progress * 3).toFixed(1)}초` : '자세가 흔들리면 처음부터 다시 셉니다'}
                      {' · '}퍼짐 {snap.spread.toFixed(1)}°
                    </p>
                    {!anyConnected && <div className="notice error">스틱 연결이 끊겼습니다. 다시 연결되면 처음부터 진행합니다</div>}
                    <div className="row">
                      <button onClick={stopCapture}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div className="col">
                    {capNote && <div className="notice">{capNote}</div>}
                    <div className="row">
                      <button className={referenceSetAt === null ? 'btn-primary' : ''} onClick={startCapture} disabled={!anyConnected}>
                        {referenceSetAt === null ? '시작 위치 맞추기' : '다시 맞추기'}
                      </button>
                    </div>
                    {!anyConnected && <p className="small faint">스틱을 연결하면 보정할 수 있습니다.</p>}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="card col">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>프리셋</h3>
              {presets.status === 'loading' && <span className="spinner" aria-label="불러오는 중" />}
            </div>
            {presets.items.length === 0 && presets.status !== 'loading' && (
              <p className="small dim">저장된 프리셋이 없습니다. 배치를 정하고 아래에서 이름을 붙여 저장하세요.</p>
            )}
            <div className="preset-list">
              {presets.items.map((p) => (
                <div key={p.id} className="preset-row">
                  <span className="preset-name">
                    {p.isDefault && (
                      <span className="preset-star" title="기본 프리셋">
                        ★
                      </span>
                    )}
                    {p.name}
                    {p.id === s.activePresetId && <span className="preset-badge">적용 중</span>}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <button className="small" onClick={() => presets.apply(p.id)} disabled={saving}>
                      적용
                    </button>
                    <button className="small" onClick={() => void presets.setDefault(p.id)} disabled={saving || p.isDefault}>
                      기본으로
                    </button>
                    <button className="small btn-danger" onClick={() => void presets.remove(p.id)} disabled={saving}>
                      삭제
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card col">
            <h3>저장·적용</h3>
            <p className="small">
              {activePreset ? (
                <>
                  적용 중: <strong>{activePreset.name}</strong>
                  {dirty && <span className="preset-badge preset-dirty">변경됨</span>}
                </>
              ) : (
                <>
                  적용된 프리셋 없음
                  {dirty && <span className="preset-badge preset-dirty">저장 안 됨</span>}
                </>
              )}
            </p>
            <div className="row">
              <button className="btn-primary" disabled={!s.activePresetId || !dirty || saving} onClick={onSaveChanges}>
                변경사항 저장
              </button>
              {saving && <span className="spinner" aria-label="저장 중" />}
              {savedFlash && <span className="small preset-saved">저장됨</span>}
            </div>
            <div className="row">
              <input
                type="text"
                placeholder="새 프리셋 이름"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveAs();
                }}
                style={{ width: 180 }}
              />
              <button disabled={saving} onClick={onSaveAs}>
                다른 이름으로 저장
              </button>
            </div>
            {nameError && <p className="small preset-name-error">{nameError}</p>}
            {presets.status === 'error' && presets.error && (
              <div className="notice error row" style={{ justifyContent: 'space-between' }}>
                <span>{ERROR_TEXT[presets.error]}</span>
                <button className="small" onClick={presets.clearError}>
                  닫기
                </button>
              </div>
            )}
          </div>

          <div className="card col">
            <h3>설정 완료</h3>
            <button className="btn-primary" disabled={!canFinish} onClick={finish}>
              설정 완료
            </button>
            {!canFinish && <p className="small faint">남은 조건: {missing.map((m) => READINESS_MESSAGES[m]).join(' · ')}</p>}
          </div>

          <div className="card col">
            <h3>판정 반경</h3>
            <div className="field">
              <label>판정 반경 상한 {s.tuning.maxRadiusDeg}°</label>
              <input type="range" min={TUNING_RANGES.maxRadiusDeg.min} max={TUNING_RANGES.maxRadiusDeg.max} step={TUNING_RANGES.maxRadiusDeg.step} value={s.tuning.maxRadiusDeg} onChange={(e) => s.setTuning({ maxRadiusDeg: +e.target.value })} />
            </div>
          </div>

          <div className="card col">
            <h3>연주 환경</h3>
            <div className="field">
              <label>
                판정 폭 Perfect ±{s.timing.perfectMs}ms · Good ±{s.timing.goodMs}ms
              </label>
              <input type="range" min={10} max={60} step={5} value={s.timing.perfectMs} onChange={(e) => s.setTiming({ ...s.timing, perfectMs: +e.target.value })} />
              <input type="range" min={30} max={150} step={5} value={s.timing.goodMs} onChange={(e) => s.setTiming({ ...s.timing, goodMs: +e.target.value })} />
            </div>
            <div className="field">
              <label>오디오 오프셋 {s.audioOffsetMs}ms (양수 = 소리가 늦게 들릴 때)</label>
              <input type="range" min={-100} max={200} step={5} value={s.audioOffsetMs} onChange={(e) => s.setAudioOffsetMs(+e.target.value)} />
            </div>
            <div className="field">
              <label>노트 낙하 시간 {s.scrollMs}ms</label>
              <input type="range" min={600} max={3000} step={100} value={s.scrollMs} onChange={(e) => s.setScrollMs(+e.target.value)} />
            </div>
            <div className="field">
              <label>볼륨 {Math.round(s.volume * 100)}%</label>
              <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => s.setVolume(+e.target.value)} />
            </div>
            <label className="row">
              <input type="checkbox" checked={s.metronome} onChange={(e) => s.setMetronome(e.target.checked)} /> 플레이 중 메트로놈
            </label>
            <div className="field">
              <label>카운트인 마디</label>
              <select value={s.countInBars} onChange={(e) => s.setCountInBars(+e.target.value)}>
                <option value={0}>없음</option>
                <option value={1}>1마디</option>
                <option value={2}>2마디</option>
              </select>
            </div>
            <p className="small faint">
              오디오 지연 실측: {lat ? `base ${lat.baseLatencyMs.toFixed(1)}ms · output ${lat.outputLatencyMs.toFixed(1)}ms · ${lat.sampleRate}Hz` : '소리를 한 번 내면 표시됩니다'}
            </p>
          </div>
        </div>
      </div>

      {blocker.state === 'blocked' && (
        <div className="overlay setup-leave" role="alertdialog" aria-modal="true" aria-label="저장하지 않은 변경">
          <h2>저장하지 않은 변경이 있습니다</h2>
          <p className="dim">나갈까요?</p>
          <div className="row">
            <button className="btn-danger" onClick={() => blocker.proceed()}>
              나가기
            </button>
            <button className="btn-primary" onClick={() => blocker.reset()}>
              계속 편집
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
