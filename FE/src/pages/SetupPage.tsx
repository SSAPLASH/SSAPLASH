import { useEffect, useState } from 'react';
import { KitCanvas } from '@/components/KitCanvas';
import { useSettings, type SensorKind } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { LANE_ORDER, PAD_META, type PadId } from '@/domain/pads';
import { audioEngine } from '@/audio/AudioEngine';
import { bleSource, isBleSupported } from '@/app/sources';
import { unlockAudio } from '@/app/bootstrap';

// 키보드는 항상 켜져 있고(설계 D9), 여기서는 센서 소스만 고른다
const SENSORS: { kind: SensorKind; label: string; desc: string }[] = [
  { kind: 'none', label: '키보드만', desc: '키 하나가 패드 하나. 캘리브레이션 없이 바로 플레이' },
  { kind: 'pointer', label: '포인터 모의 IMU', desc: '마우스 위치가 스틱 자세. 캘리브레이션·판정 흐름 개발용. 키보드도 같이 동작' },
  { kind: 'ble', label: 'BLE 스틱', desc: 'Web Bluetooth로 스틱 2개를 직접 연결 (하드웨어 필요)' },
  { kind: 'websocket', label: 'WebSocket 브리지', desc: '임베디드 PC 브리지·허브·폰 IMU에서 받기' },
];

export function SetupPage() {
  const s = useSettings();
  const live = useLive();
  const [bindTarget, setBindTarget] = useState<{ pad: PadId; stickId: 0 | 1 } | null>(null);
  const [presetName, setPresetName] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!bindTarget) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setBindTarget(null);
        return;
      }
      s.bindKey(e.code, bindTarget.pad, bindTarget.stickId);
      setBindTarget(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [bindTarget, s]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const lat = audioEngine.latency();
  void tick;

  const testPad = async (pad: PadId) => {
    await unlockAudio();
    audioEngine.trigger(pad, 100);
  };

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
              변환 규칙(kitMapping)으로 반영됩니다. 클릭하면 소리가 납니다.
            </p>
            <KitCanvas layout={s.kitLayout} draggable onMovePad={s.movePad} keyMap={s.keyMap} anchors={s.profile?.anchors} />
            <div className="chips">
              {LANE_ORDER.map((pad) => (
                <button key={pad} className="chip" onClick={() => void testPad(pad)}>
                  {PAD_META[pad].label} 소리
                </button>
              ))}
            </div>
          </div>

          <div className="card col">
            <h3>키 매핑</h3>
            <p className="small dim">
              "추가"를 누른 뒤 키를 누르면 바인딩됩니다. 왼손 키는 스틱 0, 오른손 키는 스틱 1로 기록됩니다. Esc로 취소.
            </p>
            <div className="keymap-list">
              {LANE_ORDER.map((pad) => {
                const keys = Object.entries(s.keyMap).filter(([, b]) => b.pad === pad);
                const active = bindTarget?.pad === pad;
                return (
                  <div key={pad} className={`keymap-row ${active ? 'active' : ''}`}>
                    <span className="swatch" style={{ background: PAD_META[pad].color }} />
                    <span>{PAD_META[pad].label}</span>
                    <span className="keys">
                      {keys.map(([code, b]) => (
                        <button key={code} title="클릭하면 해제" onClick={() => s.unbindKey(code)}>
                          <kbd className="kbd" style={{ borderColor: b.stickId === 0 ? 'var(--left)' : 'var(--right)' }}>
                            {code.replace('Key', '').replace('Digit', '')}
                          </kbd>
                        </button>
                      ))}
                      {active && <span className="small dim">키를 누르세요…</span>}
                    </span>
                    <span className="row" style={{ gap: 4 }}>
                      <button className="small" onClick={() => setBindTarget({ pad, stickId: 0 })}>
                        왼손 추가
                      </button>
                      <button className="small" onClick={() => setBindTarget({ pad, stickId: 1 })}>
                        오른손 추가
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <div>
              <button className="btn-ghost small" onClick={s.resetKeyMap}>
                기본 매핑으로
              </button>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card col">
            <h3>입력 방식</h3>
            <p className="small dim">키보드는 항상 켜져 있습니다. 센서를 고르면 센서 타격은 캘리브레이션으로, 키보드 타격은 키 매핑으로 패드가 정해집니다.</p>
            {SENSORS.map((i) => (
              <label key={i.kind} className="row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="sensor"
                  checked={s.sensorKind === i.kind}
                  onChange={() => s.setSensorKind(i.kind)}
                  style={{ marginTop: 5 }}
                />
                <span className="col" style={{ gap: 0 }}>
                  <strong>{i.label}</strong>
                  <span className="small dim">{i.desc}</span>
                </span>
              </label>
            ))}
            {live.sourceMessage && <div className={`notice ${live.sourceState === 'error' ? 'error' : ''}`}>{live.sourceMessage}</div>}

            {s.sensorKind === 'pointer' && (
              <div className="small dim">
                타격 키: 왼손 <kbd className="kbd">{s.pointerHitKeys.left.replace('Key', '')}</kbd> 오른손{' '}
                <kbd className="kbd">{s.pointerHitKeys.right.replace('Key', '')}</kbd> · 좌클릭 = 왼손, 우클릭 = 오른손 · 방향키로도
                자세 이동
              </div>
            )}
            {s.sensorKind === 'ble' && (
              <div className="col">
                {!isBleSupported() && <div className="notice error">이 브라우저는 Web Bluetooth를 지원하지 않습니다. Chrome 또는 Edge를 쓰세요.</div>}
                <div className="row">
                  <button onClick={() => bleSource.pair(0).catch(() => {})}>왼손 스틱 페어링</button>
                  <button onClick={() => bleSource.pair(1).catch(() => {})}>오른손 스틱 페어링</button>
                </div>
                <p className="small faint">서비스 UUID a7d50001-… 를 광고하는 기기만 목록에 뜹니다.</p>
              </div>
            )}
            {s.sensorKind === 'websocket' && (
              <div className="field">
                <label>브리지 주소 (바꾸면 입력 방식을 다시 선택)</label>
                <input type="text" value={s.wsUrl} onChange={(e) => s.setWsUrl(e.target.value)} />
              </div>
            )}
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
              <label>판정 반경 상한 {s.maxRadiusDeg}°</label>
              <input type="range" min={8} max={40} step={1} value={s.maxRadiusDeg} onChange={(e) => s.setMaxRadiusDeg(+e.target.value)} />
            </div>
          </div>

          <div className="card col">
            <h3>판정·사운드</h3>
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
