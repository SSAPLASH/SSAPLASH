// 제어 섹션: 데이터가 아니라 도구(파라미터 표·명령 바). 기존 파라미터·명령 탭을 그대로 옮겼다.
import { useRef, useState } from 'react';
import type { CalibrationProfile } from '@/domain/calibration';
import type { ParamStore } from '@/monitor/params';
import { parseJsonl } from '@/monitor/recorder';
import { summarizeRecording, summaryToMarkdown, type RecordingSummary } from '@/monitor/recordingSummary';
import { CommandBar } from '../CommandBar';
import type { SendFn } from '../monitorTypes';
import { ParamPanel } from '../ParamPanel';

export function ControlSection({
  store,
  send,
  profile,
  canSend,
  summary,
  onSummary,
}: {
  store: ParamStore;
  send: SendFn;
  profile: CalibrationProfile;
  canSend: boolean;
  summary: RecordingSummary | null;
  onSummary: (s: RecordingSummary | null) => void;
}) {
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">제어</h2>
      <div className="mon-param-grid">
        <ParamPanel store={store} canSend={canSend} />
        <CommandBar send={send} store={store} profile={profile} canSend={canSend} />
      </div>
      <SummaryPanel summary={summary} onSummary={onSummary} />
    </div>
  );
}

const fmt1 = (v: number | null | undefined): string => (v === null || v === undefined ? '–' : v.toFixed(1));

/** 녹화 요약 패널: 방금 녹화 또는 연 녹화 파일의 구간 지연·rtt·delta 표. 표 복사는 Wiki 붙여넣기용 Markdown */
function SummaryPanel({ summary, onSummary }: { summary: RecordingSummary | null; onSummary: (s: RecordingSummary | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const openFile = async (file: File) => {
    try {
      onSummary(summarizeRecording(parseJsonl(await file.text())));
      setError(null);
    } catch (e) {
      setError(`녹화 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summaryToMarkdown(summary));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('클립보드에 복사하지 못했습니다(권한·보안 컨텍스트 확인).');
    }
  };

  const rows: Array<[string, RecordingSummary['rtt']]> = summary
    ? [
        ['SYNC rtt', summary.rtt],
        ['센서→수신', summary.latency.recv],
        ['수신→판정', summary.latency.resolve],
        ['판정→오디오', summary.latency.audio],
        ['센서→오디오', summary.latency.total],
        ['채점 delta', summary.delta],
      ]
    : [];

  return (
    <section className="mon-panel">
      <h4 className="mon-h">녹화 요약</h4>
      <div className="mon-summary-actions">
        <button className="btn-ghost small" onClick={() => fileRef.current?.click()}>
          녹화 파일 열기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".jsonl"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = '';
          }}
        />
        <button className="btn-ghost small" onClick={() => void copy()} disabled={!summary}>
          {copied ? '복사됨' : '표 복사'}
        </button>
      </div>
      {error && <div className="mon-empty">{error}</div>}
      {!summary ? (
        <div className="mon-empty">녹화를 정지하거나 녹화 파일을 열면 요약이 보입니다.</div>
      ) : (
        <>
          <div className="mon-summary-line">
            {summary.meta.startedAt} · {summary.meta.source.label} · 수신 {summary.packets.inTotal}건(HIT {summary.packets.hits}) · 진단 {summary.diagCount}건
          </div>
          <div className="mon-table-wrap">
            <table className="mon-table">
              <thead>
                <tr>
                  <th>지표 (ms)</th>
                  <th>n</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>max</th>
                  <th>기준</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([name, m]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="num">{m.n}</td>
                    <td className="num">{fmt1(m.p50)}</td>
                    <td className="num">{fmt1(m.p95)}</td>
                    <td className="num">{fmt1(m.max)}</td>
                    <td>{m.threshold ? `${m.threshold.stat === 'absMean' ? '|평균|' : m.threshold.stat} ≤ ${m.threshold.warn}` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mon-summary-line">
            delta 평균 {fmt1(summary.delta.mean)}ms · PERFECT {summary.judgements.PERFECT} · GOOD {summary.judgements.GOOD} · MISS{' '}
            {summary.judgements.MISS} · stray {summary.stray} · 무타격 {summary.missed}
          </div>
        </>
      )}
    </section>
  );
}
