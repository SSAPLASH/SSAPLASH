// Figma Controls / TableHeader 134:2686 + Navigation / HistoryRow 220:3964 — 연주 기록 표. 열: 날짜 · 모드 · 곡 · 정확도 / 점수 · 결과 보기.
// 삭제된 곡 행(song=deleted)은 제목을 --text-3로 흐리게 하고 「삭제된 곡」 칩을 붙인다. 결과 보기는 그대로 열린다.
import { Link } from 'react-router-dom';
import { DeletedSongChip } from '@/components/song/DeletedSongChip';
import { formatPlayDate, playModeName } from '@/domain/playLogView';
import type { PlayLog } from '@/engine/playLog';
import '@/components/ui/table.css';
import './history.css';

export interface HistoryTableProps {
  logs: PlayLog[];
  /** 삭제(404)로 확인된 BE 곡 id */
  deletedIds: ReadonlySet<number>;
}

/** 「96.8% / 92,400」 — 악보 모드(점수 없음)는 점수 자리에 「—」 */
function resultText(l: PlayLog): string {
  const acc = `${(l.summary.accuracy * 100).toFixed(1)}%`;
  const score = l.mode === 'SHEET' ? '—' : l.summary.score.toLocaleString('ko-KR');
  return `${acc} / ${score}`;
}

export function HistoryTable({ logs, deletedIds }: HistoryTableProps) {
  return (
    <div className="history-table-wrap">
      <table className="ui-table history-table" aria-label="연주 기록">
        <colgroup>
          <col className="history-col-date" />
          <col className="history-col-mode" />
          <col className="history-col-song" />
          <col className="history-col-result" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col">모드</th>
            <th scope="col">곡</th>
            <th scope="col">정확도 / 점수</th>
            <th scope="col">
              <span className="history-visually-hidden">결과 보기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => {
            const deleted = l.songNumericId != null && deletedIds.has(l.songNumericId);
            return (
              <tr key={l.playId}>
                <td>{formatPlayDate(l.startedAt)}</td>
                <td className="history-mode">{playModeName(l.mode)}</td>
                <td>
                  <div className="history-song">
                    <span className={deleted ? 'history-song-title deleted' : 'history-song-title'}>{l.title}</span>
                    {deleted ? <DeletedSongChip /> : null}
                  </div>
                </td>
                <td className="history-result">{resultText(l)}</td>
                <td>
                  <Link to={`/result/${l.playId}`} className="history-link">
                    결과 보기
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
