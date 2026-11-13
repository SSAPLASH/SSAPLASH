// 명령 바. 명령 인코더로 바이트를 만들어 페이지가 준 send로 보낸다. 적용 확인은 ParamStore가 쌓은 줄을 보여 준다.
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import {
  encodeHaptic,
  encodeResetPose,
  encodeSetMode,
  encodeSetPadTable,
  encodeSetYawOffset,
  encodeSync,
  StreamMode,
} from '@/input/stickProtocol';
import type { Confirmation, ParamStore } from '@/features/monitor/core/params';
import { profileToEntries, quantizeRadius, RADIUS_MAX_DEG, type SendFn } from './monitorTypes';

const MODE_LABEL: Record<number, string> = { 0: 'HIT_ONLY', 1: 'HIT_AND_POSE', 2: 'RAW_COLLECT' };
const CONFIRM_SHOW = 5;

const KIND_LABEL: Record<Confirmation['kind'], string> = {
  padTable: 'SET_PAD_TABLE',
  yawOffset: 'SET_YAW_OFFSET',
  resetPose: 'RESET_POSE',
};

function confirmText(c: Confirmation): string {
  if (c.source === 'button') return `스틱 버튼 정면 보정(요청 없음) 고도각 ${((c.value ?? 0) / 100).toFixed(2)}°`;
  if (c.open && c.value === null) return `${KIND_LABEL[c.kind]} 대기 중…`;
  if (c.value === null) return `${KIND_LABEL[c.kind]} 확인 없음`;
  switch (c.kind) {
    case 'padTable':
      return `SET_PAD_TABLE 적용됨 ${c.value}개`;
    case 'yawOffset':
      return `SET_YAW_OFFSET ${(c.value / 100).toFixed(2)}°`;
    case 'resetPose':
      return `RESET_POSE 고도각 ${(c.value / 100).toFixed(2)}°`;
  }
}

export const CommandBar = memo(function CommandBar({
  send,
  store,
  profile,
  canSend,
}: {
  send: SendFn;
  store: ParamStore;
  profile: CalibrationProfile;
  canSend: boolean;
}) {
  useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.version,
  );
  const [mode, setMode] = useState<number>(StreamMode.HIT_AND_POSE);
  const [hapticStrength, setHapticStrength] = useState(200);
  const [hapticMs, setHapticMs] = useState(100);
  const [yawDeg, setYawDeg] = useState(0);
  const [syncLeft, setSyncLeft] = useState(0);
  const syncTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (syncTimer.current !== null) clearInterval(syncTimer.current);
    },
    [],
  );

  const entries = useMemo(() => profileToEntries(profile), [profile]);
  const clipped = entries.filter((e) => e.radiusDeg > RADIUS_MAX_DEG).length;

  const sendPadTable = () => {
    // 확인 창을 먼저 연다 — 응답이 send 안에서 동기로 돌아와도 놓치지 않게
    store.expectConfirmation('padTable');
    for (const bytes of encodeSetPadTable(entries, true)) send(bytes);
  };

  /** 관찰용: 100ms 간격 5회. 소스 ClockSync의 pending과는 짝이 맞지 않으므로 오프셋 갱신에는 쓰이지 않는다 */
  const sendSync5 = () => {
    if (syncTimer.current !== null) return;
    let n = 0;
    setSyncLeft(5);
    const fire = () => {
      send(encodeSync(Math.floor(performance.now())));
      n++;
      setSyncLeft(5 - n);
      if (n >= 5 && syncTimer.current !== null) {
        clearInterval(syncTimer.current);
        syncTimer.current = null;
      }
    };
    fire();
    syncTimer.current = setInterval(fire, 100);
  };

  const confirms = store.confirmations().slice(0, CONFIRM_SHOW);

  return (
    <section className="mon-panel">
      <h4 className="mon-h">명령</h4>
      <div className="mon-cmds">
        <div className="mon-cmd">
          <select value={mode} onChange={(e) => setMode(Number(e.target.value))}>
            {Object.values(StreamMode).map((v) => (
              <option key={v} value={v}>
                {MODE_LABEL[v]}
              </option>
            ))}
          </select>
          <button className="btn-ghost small" disabled={!canSend} onClick={() => send(encodeSetMode(mode))}>
            SET_MODE
          </button>
        </div>
        <div className="mon-cmd">
          <button
            className="btn-ghost small"
            disabled={!canSend}
            onClick={() => {
              store.expectConfirmation('resetPose');
              send(encodeResetPose());
            }}
          >
            RESET_POSE
          </button>
        </div>
        <div className="mon-cmd">
          세기
          <input type="number" className="mon-input" min={0} max={255} value={hapticStrength} onChange={(e) => setHapticStrength(Number(e.target.value))} />
          ms
          <input type="number" className="mon-input" min={0} max={2550} step={10} value={hapticMs} onChange={(e) => setHapticMs(Number(e.target.value))} />
          <button className="btn-ghost small" disabled={!canSend} onClick={() => send(encodeHaptic(hapticStrength, hapticMs))}>
            HAPTIC
          </button>
        </div>
        <div className="mon-cmd">
          <input type="number" className="mon-input" step={0.5} value={yawDeg} onChange={(e) => setYawDeg(Number(e.target.value))} />°
          <button
            className="btn-ghost small"
            disabled={!canSend}
            onClick={() => {
              store.expectConfirmation('yawOffset');
              send(encodeSetYawOffset(yawDeg));
            }}
          >
            SET_YAW_OFFSET
          </button>
        </div>
        <div className="mon-cmd">
          <button className="btn-ghost small" disabled={!canSend || entries.length === 0} onClick={sendPadTable}>
            SET_PAD_TABLE
          </button>
          <span className="faint small">
            현재 프로필 {entries.length}개를 {Math.ceil(entries.length / 3)}패킷으로(첫 패킷 clear)
          </span>
        </div>
        <div className="mon-cmd">
          <button className="btn-ghost small" disabled={!canSend || syncLeft > 0} onClick={sendSync5}>
            SYNC 5회{syncLeft > 0 ? ` (${syncLeft})` : ''}
          </button>
          <span className="faint small">관찰용 — 오프셋 갱신은 소스 주기 루틴이 한다</span>
        </div>
      </div>

      <table className="mon-table">
        <caption className="faint small" style={{ textAlign: 'left' }}>
          패드 테이블 미리보기(반경은 0.5° 단위 반올림, 상한 {RADIUS_MAX_DEG}°{clipped > 0 ? ` — ${clipped}개가 상한에 걸림` : ''})
        </caption>
        <thead>
          <tr>
            <th>패드</th>
            <th>elev</th>
            <th>azim</th>
            <th>반경(FE)</th>
            <th>반경(전송)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.pad}>
              <td>{e.pad}</td>
              <td className="num">{e.elevationDeg.toFixed(2)}</td>
              <td className="num">{e.azimuthDeg.toFixed(2)}</td>
              <td className="num">{e.radiusDeg.toFixed(2)}</td>
              <td className={`num${e.radiusDeg > RADIUS_MAX_DEG ? ' warn' : ''}`}>{quantizeRadius(e.radiusDeg).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="mon-h">적용 확인</h4>
      {confirms.length === 0 ? (
        <p className="faint small">아직 보낸 명령이 없습니다.</p>
      ) : (
        <ul className="mon-confirms">
          {confirms.map((c, i) => (
            <li key={`${c.t}-${i}`} className={c.value === null && !c.open ? 'bad' : c.value !== null ? 'ok' : 'faint'}>
              {confirmText(c)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
