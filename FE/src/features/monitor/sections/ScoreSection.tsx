// ⑤ 채점: 연주 중일 때만. 세션 정보 줄 + 지표 줄(M) + 최근 판정 목록(M) + delta 히스토그램(N, 접힘).
// 직접 연결(모니터 창에 연주 화면이 없음)에서는 세션이 없어 안내만 보인다.
import { hitIdLabel } from '@/features/monitor/core/feed';
import type { StageHealth } from '@/features/monitor/core/health';
import type { JudgeLog, RecentRow, SessionInfo } from '@/features/monitor/core/recording/judgeLog';
import { DeltaHistogram } from '@/features/monitor/DeltaHistogram';
import { Fold } from '@/features/monitor/layout/Fold';
import { MetricRow } from '@/features/monitor/layout/MetricRow';
import { fmt, stickName, type Snap } from '@/features/monitor/monitorTypes';

const STATUS_LABEL: Record<SessionInfo['status'], string> = { running: '진행 중', paused: '일시정지', ended: '종료' };

function SessionLine({ s }: { s: SessionInfo }) {
  const end = s.status === 'ended' ? ` (${s.endReason === 'finished' ? '끝까지 침' : '중간에 나감'})` : '';
  return (
    <div className="mon-summary-line">
      <strong>{s.mode === 'RHYTHM' ? '리듬 게임' : '악보 연주'}</strong> · {s.title || s.songId} · 채보 버전{' '}
      {s.chartVersionId ?? '내장'} · 판정 창 PERFECT ±{s.windows.perfectMs} / GOOD ±{s.windows.goodMs}ms · 오디오 오프셋{' '}
      {s.audioOffsetMs}ms{s.kickOffsetMs !== s.audioOffsetMs ? ` (킥 ${s.kickOffsetMs}ms)` : ''} · 노트 {s.noteCount}개 · {STATUS_LABEL[s.status]}
      {end}
    </div>
  );
}

/** 목록 한 행의 표시 값과 강조 여부 */
function describe(r: RecentRow): { judge: string; hitPad: string; mismatch: boolean } {
  if (r.kind === 'stray') return { judge: 'stray', hitPad: r.hitPad ?? '–', mismatch: false };
  if (r.kind === 'missed') return { judge: 'MISS (무타격)', hitPad: '무타격', mismatch: false };
  return {
    judge: r.judgement ?? '–',
    hitPad: r.hitPad ?? '–',
    // 노트 pad와 타격 pad가 다르면 강조(RhythmSession은 같은 pad만 매칭하므로 정상이면 나타나지 않는다)
    mismatch: r.notePad !== null && r.hitPad !== null && r.notePad !== r.hitPad,
  };
}

export function ScoreSection({
  health,
  snap,
  judgeLog,
  onSelectTrace,
}: {
  health: StageHealth;
  snap: Snap;
  judgeLog: JudgeLog;
  /** 판정 행 클릭(hitId가 있는 행): 타격 추적으로 이동 */
  onSelectTrace?: (hitId: number) => void;
}) {
  const s = snap.judge.score;
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">⑤ 채점</h2>
      {s.session ? (
        <SessionLine s={s.session} />
      ) : (
        <p className="faint mon-empty">채점은 상단 바에서 입력 방식을 따라보기로 바꾸면 연주 창(/play·/sheet)의 결과가 채워집니다. 이 창에서 직접 곡을 연주해도 채워집니다.</p>
      )}
      <MetricRow items={health.items} />
      {s.session && (
        <div className="mon-table-wrap">
          <table className="mon-table">
            <thead>
              <tr>
                <th>노트 #</th>
                <th>노트 pad</th>
                <th>타격 pad</th>
                <th>delta(ms)</th>
                <th>판정</th>
                <th>hitId</th>
                <th>스틱·seq</th>
              </tr>
            </thead>
            <tbody>
              {s.recent.length === 0 ? (
                <tr>
                  <td colSpan={7} className="faint">
                    아직 판정이 없습니다.
                  </td>
                </tr>
              ) : (
                s.recent.slice(0, 20).map((r, i) => {
                  const d = describe(r);
                  return (
                    <tr
                      key={`${r.t}-${i}`}
                      className={onSelectTrace && r.hitId !== null ? 'clickable' : undefined}
                      onClick={onSelectTrace && r.hitId !== null ? () => onSelectTrace(r.hitId as number) : undefined}
                    >
                      <td className="num">{r.noteIndex ?? '–'}</td>
                      <td>{r.notePad ?? '–'}</td>
                      <td className={d.mismatch ? 'mon-mismatch' : undefined}>{d.hitPad}</td>
                      <td className="num">{r.deltaMs === null ? '–' : `${r.deltaMs >= 0 ? '+' : ''}${fmt(r.deltaMs)}`}</td>
                      <td className={r.kind === 'judged' ? undefined : 'faint'}>{d.judge}</td>
                      <td className="num">{r.hitId === null ? '–' : hitIdLabel(r.hitId)}</td>
                      <td className="num">{r.seq === null ? '–' : `${stickName(r.stick)} ${r.seq}`}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      <Fold id="score.hist" title="delta 히스토그램 (판정 창 띠 겹침)">
        <DeltaHistogram deltas={judgeLog.allDeltas()} windows={s.session?.windows ?? null} tick={snap.tick} />
      </Fold>
    </div>
  );
}
