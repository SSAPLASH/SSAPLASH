import { useEffect, useRef, useState } from 'react';
import { KitCanvas } from '@/components/KitCanvas';
import { SensorOptionsPanel } from '@/components/SensorOptionsPanel';
import { KeyboardMappingCard } from '@/components/KeyboardMappingCard';
import { useHitFx } from '@/components/useHitFx';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { LANE_ORDER, PAD_META, type PadId } from '@/domain/pads';
import type { HitFx } from '@/domain/events';
import { KIT_LAYOUT_PRESET_LABELS, type KitLayoutPresetId } from '@/domain/kitLayout';
import { TUNING_RANGES } from '@/domain/tuning';
import { audioEngine } from '@/audio/AudioEngine';
import { SOUND_SET_LABELS, type SoundSetId } from '@/audio/soundSets';
import { sensorRegistry } from '@/app/sensorRegistry';
import { previewHit } from '@/app/bootstrap';
import { KEYBOARD_INPUT_ENABLED } from '@/app/sources';

// 키보드는 항상 켜져 있고(설계 D9), 여기서는 센서 소스만 고른다.
// 'none'(키보드만)은 예약어라 맨 앞에 직접 두고, 나머지는 레지스트리 등록 순서를 따른다
const PRESET_IDS: KitLayoutPresetId[] = ['basic', 'wide', 'tight'];
const VELOCITY_CHOICES: { v: 64 | 96 | 120; label: string }[] = [
  { v: 64, label: '약' },
  { v: 96, label: '보통' },
  { v: 120, label: '강' },
];

const NO_SENSOR = { id: 'none', label: '키보드만', description: '키 하나가 패드 하나. 캘리브레이션 없이 바로 플레이' };

export function SetupPage() {
  const s = useSettings();
  const live = useLive();
  const [presetName, setPresetName] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const lat = audioEngine.latency();
  void tick;

  // 타격 이펙트. 톡 치기·키보드·센서 타격 모두 live의 hitSeq로 들어온다
  const hits = useRef(new Map<PadId, HitFx>());
  useHitFx(hits);

  const testPad = (pad: PadId) => {
    void previewHit(pad, s.testVelocity);
  };

  const lastHit = live.lastHit;

  return (
    <main className="main">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1>세팅</h1>
        <div className="row">
          <input
            type="text"
            placeholder="프리셋 이름"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            style={{ width: 160 }}
          />
          <button
            className="btn-primary"
            disabled={!presetName.trim()}
            onClick={() => {
              s.savePreset(presetName.trim());
              setPresetName('');
            }}
          >
            프리셋 저장
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="col">
          <div className="card col">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>가상 키트 배치</h3>
              <button className="btn-ghost small" onClick={s.resetLayout}>
                기본 배치로
              </button>
            </div>
            <p className="small dim">
              패드를 끌어 원하는 자리에 둡니다. 포인터 모의 IMU는 이 화면 좌표를 그대로 자세로 쓰고, 센서가 오면 각도↔화면
              변환 규칙(kitMapping)으로 반영됩니다. 패드를 톡 치면 소리와 이펙트가 나고, 끌면 위치만 바뀝니다.
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
              keyMap={KEYBOARD_INPUT_ENABLED ? s.keyMap : undefined}
              anchors={s.profile?.anchors}
            />
            <p className="small dim">
              마지막 타격:{' '}
              {lastHit
                ? `${lastHit.pad ? PAD_META[lastHit.pad].label : '판정 없음'} · 세기 ${lastHit.velocity} · ${lastHit.source}`
                : '아직 없음'}
            </p>
            <div className="chips">
              {LANE_ORDER.map((pad) => (
                <button key={pad} className="chip" onClick={() => testPad(pad)}>
                  {PAD_META[pad].label} 소리
                </button>
              ))}
            </div>
          </div>

          {KEYBOARD_INPUT_ENABLED && <KeyboardMappingCard />}
        </div>

        <div className="col">
          <div className="card col">
            <h3>입력 방식</h3>
            <p className="small dim">키보드는 항상 켜져 있습니다. 센서를 고르면 센서 타격은 캘리브레이션으로, 키보드 타격은 키 매핑으로 패드가 정해집니다.</p>
            {[NO_SENSOR, ...sensorRegistry.list()].map((i) => (
              <label key={i.id} className="row sensor-choice">
                <input
                  type="radio"
                  name="sensor"
                  checked={s.sensorKind === i.id}
                  onChange={() => s.setSensorKind(i.id)}
                  style={{ marginTop: 5 }}
                />
                <span className="col" style={{ gap: 0 }}>
                  <strong>{i.label}</strong>
                  <span className="small dim">{i.description}</span>
                </span>
              </label>
            ))}
            {live.sourceMessage && <div className={`notice ${live.sourceState === 'error' ? 'error' : ''}`}>{live.sourceMessage}</div>}

            {s.sensorKind !== 'none' && <SensorOptionsPanel id={s.sensorKind} />}
          </div>

          <div className="card col">
            <h3>캘리브레이션 방식</h3>
            <div className="chips">
              <button className={`chip ${s.calibrationMode === 'hold' ? 'active' : ''}`} onClick={() => s.setCalibrationMode('hold')}>
                홀딩
              </button>
              <button className={`chip ${s.calibrationMode === 'hits' ? 'active' : ''}`} onClick={() => s.setCalibrationMode('hits')}>
                2타
              </button>
            </div>
            <div className="field">
              <label>홀딩 시간 {(s.holdMs / 1000).toFixed(1)}초</label>
              <input type="range" min={500} max={4000} step={100} value={s.holdMs} onChange={(e) => s.setHoldMs(+e.target.value)} />
            </div>
            <div className="field">
              <label>판정 반경 상한 {s.tuning.maxRadiusDeg}°</label>
              <input type="range" min={TUNING_RANGES.maxRadiusDeg.min} max={TUNING_RANGES.maxRadiusDeg.max} step={TUNING_RANGES.maxRadiusDeg.step} value={s.tuning.maxRadiusDeg} onChange={(e) => s.setTuning({ maxRadiusDeg: +e.target.value })} />
            </div>
          </div>

          <div className="card col">
            <h3>판정·사운드</h3>
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
                  : live.soundSetState === 'loading'
                    ? '샘플 불러오는 중… (그동안은 합성음)'
                    : live.soundSetState === 'error'
                      ? '샘플을 불러오지 못해 합성음을 씁니다.'
                      : live.soundSetState === 'ready'
                        ? live.soundSetMissing.length > 0
                          ? `샘플 준비됨 · 합성음으로 대체: ${live.soundSetMissing.map((p) => PAD_META[p].label).join(', ')}`
                          : '샘플 준비됨'
                        : '소리를 한 번 내면 샘플을 불러옵니다.'}
              </p>
            </div>
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

          <div className="card col">
            <h3>프리셋</h3>
            {s.presets.length === 0 && <p className="small dim">저장된 프리셋이 없습니다. 위에서 이름을 적고 저장하세요.</p>}
            {s.presets.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {p.name} <span className="small faint">{p.profile ? '· 캘리브레이션 포함' : ''}</span>
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="small" onClick={() => s.loadPreset(p.id)}>
                    불러오기
                  </button>
                  <button className="small btn-danger" onClick={() => s.deletePreset(p.id)}>
                    삭제
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
