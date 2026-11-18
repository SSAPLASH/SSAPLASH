// 디버그 창 안의 센서 튜닝 패널(PLAY-002 센서 튜닝 설계 4-3). 접힘이 기본.
// 슬라이더는 setTuning으로 설정을 바꾸고, 반영은 bootstrap이 다음 타격부터 한다. 이 파일은 계산·판정을 하지 않는다.
// 옆의 읽기 값은 텔레메트리 링버퍼(최근 타격)에서만 뽑는다.
import { useState } from 'react';
import { useSettings } from '@/store/settingsStore';
import type { TelemetryRow } from '@/engine/telemetry';
import { PAD_META } from '@/domain/kit/pads';
import { anchorsToProfile } from '@/domain/kit/kitJudge';
import {
  TUNING_RANGES,
  countChangedTuning,
  type OutsidePolicy,
  type TuningRange,
} from '@/domain/kit/calibration/tuning';

interface SliderProps {
  label: string;
  value: number;
  range: TuningRange;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
}

function TuningSlider({ label, value, range, unit = '', digits = 0, onChange }: SliderProps) {
  return (
    <div className="field">
      <label>
        {label} {value.toFixed(digits)}
        {unit}
      </label>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </div>
  );
}

const POLICIES: { id: OutsidePolicy; label: string }[] = [
  { id: 'mute', label: '무음' },
  { id: 'nearest', label: '가장 가까운 패드' },
];

/** 최근 게임 판정 Δ 평균에 쓰는 타수 */
const DELTA_WINDOW = 10;

export function TuningPanel({ rows }: { rows: TelemetryRow[] }) {
  const [open, setOpen] = useState(false);
  const tuning = useSettings((s) => s.tuning);
  const stickAnchors = useSettings((s) => s.stickAnchors);
  const setTuning = useSettings((s) => s.setTuning);
  const resetTuning = useSettings((s) => s.resetTuning);

  const changed = countChangedTuning(tuning);
  const v = tuning.velocity;
  const setVelocity = (patch: Partial<typeof v>) => setTuning({ velocity: patch });

  // 읽기 값 — 모두 텔레메트리 링버퍼(최신이 앞)에서
  const lastHit = rows[0];
  const lastPose = rows.find((r) => r.distanceDeg !== null);
  const deltas = rows.filter((r) => r.deltaMs !== undefined).slice(0, DELTA_WINDOW);
  const deltaAvg = deltas.length ? deltas.reduce((s, r) => s + (r.deltaMs ?? 0), 0) / deltas.length : null;
  // 앵커별 반경은 손별 판정 프로필 기준(PLAY-004 D1). 왼손·오른손이 다르면 "왼/오"로 보여 준다
  const derived = [anchorsToProfile(stickAnchors[0], tuning, 0), anchorsToProfile(stickAnchors[1], tuning, 1)];
  const radii = Object.values(derived[0].anchors)
    .filter((a) => !!a)
    .map((a) => {
      const r = derived[1].anchors[a.pad];
      const same = r && Math.abs(r.radius - a.radius) < 0.05;
      return `${PAD_META[a.pad].label} ${same || !r ? a.radius.toFixed(1) : `${a.radius.toFixed(1)}/${r.radius.toFixed(1)}`}`;
    })
    .join(' · ');

  return (
    <section className="tuning">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn-ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} 튜닝 {changed > 0 ? `(기본값과 다른 항목 ${changed}개)` : ''}
        </button>
        {open && (
          <button className="btn-ghost small" onClick={resetTuning} disabled={changed === 0}>
            기본값으로
          </button>
        )}
      </div>
      {open && (
        <div className="col tuning-body">
          <div className="tuning-group">
            <strong>판정 반경</strong>
            <TuningSlider
              label="반경 계수"
              value={tuning.radiusFactor}
              range={TUNING_RANGES.radiusFactor}
              digits={2}
              onChange={(radiusFactor) => setTuning({ radiusFactor })}
            />
            <TuningSlider
              label="반경 하한"
              value={tuning.minRadiusDeg}
              range={TUNING_RANGES.minRadiusDeg}
              unit="°"
              onChange={(minRadiusDeg) => setTuning({ minRadiusDeg })}
            />
            <TuningSlider
              label="반경 상한"
              value={tuning.maxRadiusDeg}
              range={TUNING_RANGES.maxRadiusDeg}
              unit="°"
              onChange={(maxRadiusDeg) => setTuning({ maxRadiusDeg })}
            />
            <div className="faint">앵커별 반경(°): {radii}</div>
          </div>

          <div className="tuning-group">
            <strong>각도 범위</strong>
            <TuningSlider
              label="가로(yaw) ±"
              value={tuning.angleRange.yawDeg}
              range={TUNING_RANGES.angleRange.yawDeg}
              unit="°"
              onChange={(yawDeg) => setTuning({ angleRange: { yawDeg } })}
            />
            <TuningSlider
              label="세로(pitch) ±"
              value={tuning.angleRange.pitchDeg}
              range={TUNING_RANGES.angleRange.pitchDeg}
              unit="°"
              onChange={(pitchDeg) => setTuning({ angleRange: { pitchDeg } })}
            />
            <div className="faint">화면 가로·세로 전체가 몇 도의 팔 움직임인지</div>
          </div>

          <div className="tuning-group">
            <strong>세기 곡선 (포인터·키보드용, 스틱은 펌웨어 곡선)</strong>
            <TuningSlider
              label="최소 가속도(→1)"
              value={v.minAccelG}
              range={TUNING_RANGES.minAccelG}
              unit="g"
              digits={1}
              onChange={(minAccelG) => setVelocity({ minAccelG })}
            />
            <TuningSlider
              label="최대 가속도(→127)"
              value={v.maxAccelG}
              range={TUNING_RANGES.maxAccelG}
              unit="g"
              digits={1}
              onChange={(maxAccelG) => setVelocity({ maxAccelG })}
            />
            <TuningSlider
              label="감마"
              value={v.gamma}
              range={TUNING_RANGES.gamma}
              digits={2}
              onChange={(gamma) => setVelocity({ gamma })}
            />
            <div className="faint">
              {!lastHit
                ? '최근 타격 없음'
                : lastHit.peakSpeedDps !== undefined
                  ? `최근 타격 peakSpeed ${lastHit.peakSpeedDps}°/s → vel ${lastHit.velocity} (스틱)`
                  : `최근 타격 peakAccel ${lastHit.peakAccel.toFixed(1)}g → vel ${lastHit.velocity}`}
            </div>
          </div>

          <div className="tuning-group">
            <strong>시각 보정</strong>
            <TuningSlider
              label="센서 시각 보정"
              value={tuning.sensorOffsetMs}
              range={TUNING_RANGES.sensorOffsetMs}
              unit="ms"
              onChange={(sensorOffsetMs) => setTuning({ sensorOffsetMs })}
            />
            <div className="faint">
              {deltaAvg === null
                ? '게임 판정 Δ 없음'
                : `최근 게임 판정 Δ 평균 ${deltaAvg > 0 ? '+' : ''}${deltaAvg.toFixed(0)}ms (최근 ${deltas.length}타)`}
              {' · 키보드 타격에는 적용되지 않음'}
            </div>
          </div>

          <div className="tuning-group">
            <strong>앵커 밖 타격</strong>
            <div className="chips">
              {POLICIES.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${tuning.outsidePolicy === p.id ? 'active' : ''}`}
                  onClick={() => setTuning({ outsidePolicy: p.id })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="faint">
              {lastPose && lastPose.distanceDeg !== null
                ? `최근 타격 거리 ${lastPose.distanceDeg.toFixed(1)}° · ${lastPose.inside ? '안' : '밖'}`
                : '최근 센서 타격 없음'}
            </div>
          </div>

        </div>
      )}
    </section>
  );
}
