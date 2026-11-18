// 자유 연습 실측 섹션: 최근 타격 상세(소스·가장 가까운 패드·앵커 거리)와 타격 통계 표.
// 판정 반경(U6)·앵커 밖 처리(U11)를 하드웨어로 실측할 때 쓰던 UI를 자유 연습 화면에서 옮겨 왔다(설계 U11).
// 집계는 모듈에 둬서 섹션을 오가도 이어진다. 구독은 섹션이 열려 있는 동안만 건다.
import { useEffect, useSyncExternalStore } from 'react';
import { inputManager } from '@/runtime/sources';
import { addHit, emptyHitStats, meanSensorDistance, type HitStats } from '@/domain/play/hitStats';
import { ALL_PADS, PAD_META } from '@/domain/kit/pads';
import { useLive } from '@/store/liveStore';
import { isSensorSource } from '@/domain/events';

let tally: HitStats = emptyHitStats();
const listeners = new Set<() => void>();
const setTally = (next: HitStats) => {
  tally = next;
  listeners.forEach((l) => l());
};

export function FreeMeasureSection() {
  const stats = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tally,
  );
  const lastHit = useLive((s) => s.lastHit);
  // 섹션을 보는 동안의 타격만 집계한다. 자세(60Hz)와 분리하려고 store를 직접 구독한다
  useEffect(() => {
    return useLive.subscribe((s, prev) => {
      if (s.hitSeq === prev.hitSeq || !s.lastHit) return;
      setTally(addHit(tally, s.lastHit));
    });
  }, []);

  const nearest = lastHit && isSensorSource(lastHit.source) ? inputManager.previewPad(lastHit.pose) : null;
  const meanDist = meanSensorDistance(stats);

  return (
    <div className="mon-section">
      <h2 className="mon-section-title">자유 연습 실측</h2>
      <div className="mon-summary-line">
        판정 반경(U6)·앵커 밖 처리(U11) 실측용입니다. 이 섹션이 열려 있는 동안의 타격을 세고, 다른 섹션으로 가도 이어집니다.
      </div>

      <section className="mon-panel">
        <div className="mon-panel-head">
          <h4 className="mon-h">최근 타격</h4>
        </div>
        {lastHit ? (
          <table className="mon-table">
            <tbody>
              <tr>
                <td>패드</td>
                <td className="num" style={{ color: lastHit.pad ? PAD_META[lastHit.pad].color : undefined }}>
                  {lastHit.pad ? PAD_META[lastHit.pad].label : '판정 없음'}
                </td>
              </tr>
              <tr>
                <td>손</td>
                <td className="num">{lastHit.stickId === null ? '-' : lastHit.stickId === 0 ? 'L' : 'R'}</td>
              </tr>
              <tr>
                <td>벨로시티</td>
                <td className="num">{lastHit.velocity}</td>
              </tr>
              <tr>
                <td>소스</td>
                <td className="num">{lastHit.source}</td>
              </tr>
              {nearest && (
                <tr>
                  <td>{nearest.inside ? '앵커 안' : '가장 가까운 패드 (앵커 밖)'}</td>
                  <td className="num">
                    {PAD_META[nearest.pad].label} {nearest.distanceDeg.toFixed(1)}°
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="mon-empty">아직 타격이 없습니다. 쳐 보세요.</div>
        )}
      </section>

      <section className="mon-panel">
        <div className="mon-panel-head">
          <h4 className="mon-h">타격 통계</h4>
          <button className="btn-ghost small" onClick={() => setTally(emptyHitStats())}>
            초기화
          </button>
        </div>
        <table className="mon-table">
          <tbody>
            {ALL_PADS.map((pad) => (
              <tr key={pad}>
                <td style={{ color: PAD_META[pad].color }}>{PAD_META[pad].label}</td>
                <td className="num">{stats.byPad[pad]}</td>
              </tr>
            ))}
            <tr>
              <td>판정 없음</td>
              <td className="num">{stats.unresolved}</td>
            </tr>
            <tr>
              <td>합계</td>
              <td className="num">{stats.total}</td>
            </tr>
            <tr>
              <td>센서 타격 평균 앵커 거리</td>
              <td className="num">{meanDist === null ? '–' : `${meanDist.toFixed(1)}°`}</td>
            </tr>
          </tbody>
        </table>
        <div className="mon-summary-line faint">앵커 거리는 센서 타격(키보드 제외)만 셉니다.</div>
      </section>
    </div>
  );
}
