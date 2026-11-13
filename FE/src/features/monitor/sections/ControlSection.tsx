// 제어 섹션: 데이터가 아니라 도구(파라미터 표·명령 바). 기존 파라미터·명령 탭을 그대로 옮겼다.
import { Fragment, useRef, useState, useSyncExternalStore } from 'react';
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import type { ParamStore } from '@/features/monitor/core/params';
import { telemetryStore } from '@/telemetry/enable';
import { parseJsonl } from '@/features/monitor/core/recording/recorder';
import { summarizeRecording, summaryToMarkdown, type RecordingSummary } from '@/features/monitor/core/recording/recordingSummary';
import { CommandBar } from '@/features/monitor/CommandBar';
import type { SendFn } from '@/features/monitor/monitorTypes';
import { ParamPanel } from '@/features/monitor/ParamPanel';

export function ControlSection({
  store,
  send,
  profile,
  canSend,
  follow,
  summary,
  onSummary,
  canReplay,
  onReplay,
}: {
  store: ParamStore;
  send: SendFn;
  profile: CalibrationProfile;
  canSend: boolean;
  /** 따라보기 모드(이 창은 이벤트를 만들지 않는다) */
  follow: boolean;
  summary: RecordingSummary | null;
  onSummary: (s: RecordingSummary | null) => void;
  /** 녹화 파일을 열었을 때 재생해도 되는지(녹화 중에는 요약만) */
  canReplay: boolean;
  onReplay: (parsed: ParsedRecording, name: string) => void;
}) {
  return (
    <div className="mon-section">
      <h2 className="mon-section-title">제어</h2>
      <div className="mon-param-grid">
        <ParamPanel store={store} canSend={canSend} />
        <CommandBar send={send} store={store} profile={profile} canSend={canSend} />
      </div>
      <TelemetryPanel follow={follow} />
      <SummaryPanel summary={summary} onSummary={onSummary} canReplay={canReplay} onReplay={onReplay} />
    </div>
  );
}

/** 텔레메트리 패널: 켜기 토글과 전송 카운터(설계 MONITOR-001). 전송 코드는 모니터 빌드에만 있다 */
function TelemetryPanel({ follow }: { follow: boolean }) {
  const st = useSyncExternalStore(telemetryStore.subscribe, telemetryStore.getSnapshot);
  const s = st.sender;
  const err = s.lastError;
  const reason = !st.enabled ? '꺼져 있음' : !st.roleOk ? 'ADMIN 계정으로 로그인해야 전송합니다' : null;
  return (
    <section className="mon-panel">
      <div className="mon-panel-head">
        <h4 className="mon-h">텔레메트리</h4>
        <button
          className="btn-ghost small"
          aria-pressed={st.enabled}
          onClick={() => telemetryStore.setEnabled(!st.enabled)}
        >
          {st.enabled ? '끄기' : '켜기'}
        </button>
        <span>{st.active ? (s.inflight ? '전송 중' : '전송 켜짐') : '전송 안 함'}</span>
      </div>
      {st.forbidden && <div className="mon-empty">서버가 403으로 거절해 자동으로 껐습니다. 계정 권한을 확인한 뒤 다시 켜세요.</div>}
      {!st.forbidden && reason && <div className="mon-empty">{reason}</div>}
      {follow && (
        <div className="mon-empty">
          전송은 연주 창(이벤트가 생기는 창)에서 합니다. 따라보기 창은 이벤트를 만들지 않으므로 아래 카운터(이 창 기준)는 0으로 보입니다.
        </div>
      )}
      <div className="mon-summary-line">
        보낸 {s.sent} · 결과 불명 {s.unknown} · 거절 {s.rejected} · 401 폐기 {s.unauthorized} · 큐 {s.queueSize}
      </div>
      <div className="mon-summary-line">
        폐기: 큐 초과 {s.drops.overflow} · 만료(10초) {s.drops.ttl} · 크기 초과 {s.drops.oversize}
      </div>
      {err && (
        <div className="mon-summary-line">
          마지막 오류: {err.status === 0 ? err.code : `${err.status} ${err.code}`} — {err.message}
        </div>
      )}
    </section>
  );
}

const fmt1 = (v: number | null | undefined): string => (v === null || v === undefined ? '–' : v.toFixed(1));

/** 녹화 요약 패널: 방금 녹화 또는 연 녹화 파일의 구간 지연·rtt·delta 표. 표 복사는 Wiki 붙여넣기용 Markdown */
type ParsedRecording = ReturnType<typeof parseJsonl>;

function SummaryPanel({
  summary,
  onSummary,
  canReplay,
  onReplay,
}: {
  summary: RecordingSummary | null;
  onSummary: (s: RecordingSummary | null) => void;
  canReplay: boolean;
  onReplay: (parsed: ParsedRecording, name: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const openFile = async (file: File) => {
    try {
      const parsed = parseJsonl(await file.text());
      onSummary(summarizeRecording(parsed));
      // 요약과 함께 재생 모드로 연다. 녹화 중에는 이 창의 녹화에 재생 패킷이 섞이므로 요약만 보인다
      if (canReplay) {
        onReplay(parsed, file.name);
        setError(null);
      } else {
        setError('녹화 중에는 재생하지 않고 요약만 보입니다. 녹화를 정지한 뒤 다시 여세요.');
      }
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
          녹화 파일 열기·재생
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
          {summary.timing.length > 0 && (
            <div className="mon-table-wrap">
              <table className="mon-table">
                <thead>
                  <tr>
                    <th>곡 (채보 버전)</th>
                    <th>시작(s)</th>
                    <th>판정</th>
                    <th>MISS</th>
                    <th>평균</th>
                    <th>기울기(ms/분)</th>
                    <th>앞·중·뒤</th>
                    <th>accDrift(ms/분)</th>
                    <th>힌트</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.timing.map((x, i) => (
                    <Fragment key={i}>
                      <tr>
                        <td>
                          {x.title} ({x.chartVersionId ?? '–'})
                        </td>
                        <td className="num">{(x.startedAt / 1000).toFixed(0)}</td>
                        <td className="num">{x.judged}</td>
                        <td className="num">{x.miss}</td>
                        <td className="num">{fmt1(x.meanMs)}</td>
                        <td className="num">{fmt1(x.slopeMsPerMin)}</td>
                        <td className="num">{x.thirds.map((v) => fmt1(v)).join(' / ')}</td>
                        <td className="num">{x.accDrift ? fmt1(x.accDrift.slopeMsPerMin) : '–'}</td>
                        <td>{x.verdictHint}</td>
                      </tr>
                      {x.byInput.map((b) => (
                        <tr key={b.input}>
                          <td colSpan={2}>└ {b.input}</td>
                          <td className="num">{b.n}</td>
                          <td />
                          <td className="num">{fmt1(b.meanMs)}</td>
                          <td className="num">{fmt1(b.slopeMsPerMin)}</td>
                          <td colSpan={3} />
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
