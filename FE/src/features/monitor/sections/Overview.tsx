// 개요: ①~⑥ 단계 상자를 가로로 늘어놓고 상태 색·대표 숫자·이유를 한눈에 보인다. 상자를 누르면 해당 섹션으로 간다.
import type { StageHealth } from '@/features/monitor/core/health';
import { LEVEL_LABEL, type Section, type StageHealthMap } from '@/features/monitor/layout/sections';

interface Box {
  key: Section;
  label: string;
  stage: StageHealth;
}

/** 경과 ms → "N초 전". 없으면 대시 */
const ago = (now: number, t: number | null): string => (t === null ? '–' : `${Math.max(0, Math.floor((now - t) / 1000))}초 전`);

export function Overview({
  health,
  now,
  sourceLabel,
  mockOn,
  onSelect,
  onGoTrend,
}: {
  health: StageHealthMap;
  now: number;
  sourceLabel: string;
  mockOn: boolean;
  onSelect: (s: Section) => void;
  /** ③ 상자: 시계 섹션으로 가서 추이 패널까지 연다 */
  onGoTrend: () => void;
}) {
  const boxes: Box[] = [
    { key: 'transport', label: '① 전송', stage: health.transport },
    { key: 'sensor', label: '② 센서', stage: health.sensor },
    { key: 'clock', label: '③ 시계', stage: health.clock },
    { key: 'resolve', label: '④ 판정', stage: health.resolve },
    { key: 'score', label: '⑤ 채점', stage: health.score },
    { key: 'output', label: '⑥ 출력', stage: health.output },
  ];

  return (
    <div className="mon-section">
      <h2 className="mon-section-title">개요</h2>
      <div className="mon-flow">
        {boxes.map((b) => {
          const level = b.stage.level;
          const reason = b.stage.reason;
          return (
            <button
              key={b.key}
              className={`mon-flow-box ${level}`}
              onClick={() => (b.key === 'clock' ? onGoTrend() : onSelect(b.key))}
              title={b.key === 'clock' ? '클릭하면 시계 섹션의 동기화 추이를 엽니다' : undefined}
            >
              <div className="mon-flow-head">
                <span className={`mon-dot ${level}`} aria-hidden="true" />
                {b.label}
                <span className="mon-flow-level">{LEVEL_LABEL[level]}</span>
              </div>
              <div className="mon-flow-value">
                {b.stage.headline ? b.stage.headline.value : '–'}
                {b.stage.headline && <span className="mon-metric-unit"> {b.stage.headline.unit}</span>}
              </div>
              <div className="mon-flow-reason">{reason}</div>
            </button>
          );
        })}
      </div>
      <div className="mon-summary-line">
        입력: <strong>{sourceLabel}</strong>
        {mockOn && ' · 모의 스틱'}
        <span className="faint">
          {' '}
          · 마지막 갱신 전송 {ago(now, health.transport.lastUpdate)} · 센서 {ago(now, health.sensor.lastUpdate)} · 시계{' '}
          {ago(now, health.clock.lastUpdate)} · 판정 {ago(now, health.resolve.lastUpdate)} · 채점{' '}
          {ago(now, health.score.lastUpdate)} · 출력 {ago(now, health.output.lastUpdate)}
        </span>
      </div>
    </div>
  );
}
