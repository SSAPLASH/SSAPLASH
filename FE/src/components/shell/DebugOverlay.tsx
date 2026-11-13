// MONITOR-02 라이브 디버그의 로컬 미니 버전. ` 키로 토글.
import { useEffect, useState } from 'react';
import { subscribeTelemetry, type TelemetryRow } from '@/engine/telemetry';
import { audioEngine } from '@/audio/AudioEngine';
import { useLive } from '@/store/liveStore';
import { TuningPanel } from './dock/TuningPanel';

export function DebugOverlay({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const pose = useLive((s) => s.pose);
  useEffect(() => subscribeTelemetry(setRows), []);
  const lat = audioEngine.latency();
  const f = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v.toFixed(1));
  return (
    <aside className="debug">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <strong>텔레메트리 (최근 타격)</strong>
        <button className="btn-ghost small" onClick={onClose}>
          닫기 ( ` )
        </button>
      </div>
      <div className="faint" style={{ marginBottom: 6 }}>
        오디오 base {lat ? f(lat.baseLatencyMs) : '–'}ms · output {lat ? f(lat.outputLatencyMs) : '–'}ms · 자세 L{' '}
        {pose[0].pitch.toFixed(0)}/{pose[0].yaw.toFixed(0)} R {pose[1].pitch.toFixed(0)}/{pose[1].yaw.toFixed(0)}
      </div>
      <TuningPanel rows={rows} />
      <table>
        <thead>
          <tr>
            <th>패드</th>
            <th>손</th>
            <th>vel</th>
            <th>g</th>
            <th>판정자</th>
            <th>거리°</th>
            <th>수신</th>
            <th>판정</th>
            <th>오디오</th>
            <th>Δ</th>
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.hitId}>
              <td>{r.pad ?? '(없음)'}</td>
              <td>{r.stickId === null ? '-' : r.stickId === 0 ? 'L' : 'R'}</td>
              <td>{r.velocity}</td>
              <td>{r.peakAccel.toFixed(1)}</td>
              <td>{r.judgedBy}</td>
              <td>{r.distanceDeg === null ? '–' : `${r.distanceDeg.toFixed(1)}${r.inside ? '' : '*'}`}</td>
              <td>{f(r.recvLagMs)}</td>
              <td>{f(r.resolveLagMs)}</td>
              <td>{f(r.audioLagMs)}</td>
              <td>{r.deltaMs === undefined ? '–' : `${r.deltaMs > 0 ? '+' : ''}${r.deltaMs.toFixed(0)}`}</td>
              <td>{r.judgement ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
