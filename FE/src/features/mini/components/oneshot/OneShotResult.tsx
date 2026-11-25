// 「정적 뒤 한 방」 결과 본문. 「정답 자리와 내 타격」 그림 판 + 「곡별 기록」 판.
import type { ShotOutcome } from '@/features/mini/domain/oneShotRound';
import { ShotChart } from './ShotChart';
import './oneshot.css';

interface Props {
  outcome: ShotOutcome;
  /** 곡별 기록 줄. `text`가 null이면 기록 없음 */
  rows: readonly { id: string; name: string; when: string; text: string | null }[];
}

export function OneShotResult({ outcome, rows }: Props) {
  return (
    <>
      <section className="mini-chart-panel" aria-labelledby="mini-oneshot-chart-title">
        <h3 id="mini-oneshot-chart-title" className="mini-chart-title">
          정답 자리와 내 타격
        </h3>
        <ShotChart outcome={outcome} />
      </section>
      <section className="mini-chart-panel" aria-labelledby="mini-oneshot-records-title">
        <h3 id="mini-oneshot-records-title" className="mini-chart-title">
          곡별 기록
        </h3>
        <ul className="mini-oneshot-records">
          {rows.map((row) => (
            <li key={row.id} className="mini-oneshot-record" data-testid={`mini-oneshot-row-${row.id}`}>
              <div className="mini-oneshot-record-left">
                <span className="mini-oneshot-record-name">{row.name}</span>
                {row.text !== null && row.when !== '' ? (
                  <span className="mini-oneshot-record-when">{row.when}</span>
                ) : null}
              </div>
              <span className={`mini-oneshot-record-value${row.text === null ? ' is-empty' : ''}`}>
                {row.text ?? '기록 없음'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
