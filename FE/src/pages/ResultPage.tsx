// 연주 결과 (리듬 게임 설계 4-2 · 악보 연주 설계 D11 · Figma 결과 112:1194). localStorage 플레이 로그를 읽어 보여준다.
// 요약 카드 → [서버 분석 진입] → 판정 분포·타이밍 분포 → (악보 모드) 피드백 카드·약점 마디 미니 악보 → 패드별 표 → 버튼 행.
// 악보 연주(mode SHEET)는 점수·콤보 대신 정확도 중심이라 요약 카드에 점수 블록이 없다.
// 곡이 삭제됐으면(곡 상세 404, CHART-001 U7) 결과는 그대로 보이고 「삭제된 곡」 칩과 함께 [다시 하기]·Enter만 숨긴다.
import { setupTagsOf } from '@/coach/live';
import { SetupHintCard } from '@/components/result/SetupHintCard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReportEntry } from '@/components/ReportEntry';
import { resumePlaySync, startPlaySync, usePlaySync, usePrefetchedReport } from '@/app/playSync';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/keyTarget';
import { pickPathOf, retryPathOf } from '@/domain/playRetry';
import { SONGS_SOURCE } from '@/store/songStore';
import { isServerPlayId } from '@/domain/playUpload';
import { SheetSnippet } from '@/components/SheetSnippet';
import { formatDuration } from '@/components/formatTime';
import { FeedbackCard } from '@/components/result/FeedbackCard';
import { JudgeBars } from '@/components/result/JudgeBars';
import { PadSummaryTable } from '@/components/result/PadSummaryTable';
import { ResultSummaryCard } from '@/components/result/ResultSummaryCard';
import { TimingHistogram } from '@/components/result/TimingHistogram';
import '@/components/result/result.css';
import { useShell } from '@/components/shell/useShell';
import { DeletedSongChip } from '@/components/song/DeletedSongChip';
import { useDeletedSongIds } from '@/components/song/useDeletedSongIds';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { buttonClassName } from '@/components/ui/buttonStyle';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatPlayDate } from '@/domain/playLogView';
import { timingHistogram } from '@/domain/timingHistogram';
import { buildFeedback, chartFromLog, summarizeByPad, summarizeOpenHihat } from '@/domain/feedback';
import { isUploadTarget } from '@/domain/report';
import { getPlayLog, type PlayLog } from '@/engine/playLog';

/** 모드별 선택 화면 경로 */
const pickPath = (l: PlayLog): string => pickPathOf(l.mode);

/** 요약 카드 메타의 모드 표기 */
const MODE_LABEL: Record<string, string> = { RHYTHM: '게임 모드', SHEET: '악보 모드' };

export function ResultPage() {
  useShell({ title: '결과' });
  const { playId } = useParams();
  const navigate = useNavigate();
  const log = useMemo(() => (playId ? getPlayLog(playId) : null), [playId]);

  // 서버 업로드 상태(설계 COACH-002 4-1). 진입 시 한 번 끊긴 업로드·재시도 가능한 실패를 다시 보낸다 —
  // 연주 직후라면 이미 진행 중이라 무시된다
  const legacy = !playId || !isServerPlayId(playId);
  const liveUpload = usePlaySync((s) => (playId ? s.states[playId] : undefined));
  const uploadState = liveUpload ?? log?.upload;
  // 업로드 대상이면 분석은 서버(AI) 하나로 일원화해 로컬 카드를 숨긴다(COACH-003 D3). 프리패치된 리포트만 구독하고 재조회하지 않는다
  const uploadTarget = isUploadTarget(legacy, uploadState);
  const prefetchedReport = usePrefetchedReport(log?.playId);
  useEffect(() => {
    if (playId && !legacy) resumePlaySync(playId);
  }, [playId, legacy]);

  // 악보 연주 피드백. 로그에 bpm·박자가 있으면 마디 규칙까지, 이전 로그(필드 없음)는 마디 규칙을 건너뛴다
  const isSheet = log?.mode === 'SHEET';
  // 로컬 피드백 카드·미니 악보·패드 요약 표를 보일지. 업로드 대상이면 만들지 않는다
  const showLocalFeedback = isSheet && !uploadTarget;
  const feedback = useMemo(() => (log && showLocalFeedback ? buildFeedback(log, log.bpm ? { bpm: log.bpm, beatsPerBar: log.beatsPerBar, offsetMs: log.offsetMs } : undefined) : []), [log, showLocalFeedback]);
  // 패드별 표는 통계라 모든 모드에서 보인다(업로드 대상이어도)
  const summary = useMemo(() => (log ? summarizeByPad(log) : []), [log]);
  const openHihat = useMemo(() => (log ? summarizeOpenHihat(log) : null), [log]);
  // 약점 마디 미니 악보. 이전 로그(bpm 없음)는 채보를 못 만들어 스니펫·카드 클릭이 없다
  const snippetChart = useMemo(() => (log && showLocalFeedback ? chartFromLog(log) : null), [log, showLocalFeedback]);
  const noteStates = useMemo(() => (log ? log.notes.map((n) => n.judgement) : []), [log]);
  // 카드를 누르기 전에는 bars가 있는 첫 카드. 로그가 바뀌면(다른 결과) 선택을 버린다
  const [picked, setPicked] = useState<{ playId: string; bars: [number, number] } | null>(null);
  const focusBars: [number, number] | null =
    picked && picked.playId === log?.playId ? picked.bars : (feedback.find((f) => f.bars)?.bars ?? null);
  const snippetRef = useRef<HTMLDivElement>(null);
  const focus = (bars: [number, number]) => {
    if (log) setPicked({ playId: log.playId, bars });
    snippetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  // 이 기록의 BE 곡이 아직 있는지(U7). 확인 전·확인 실패는 지금처럼 다시 하기를 둔다
  const deletedIds = useDeletedSongIds(log ? [log] : []);
  const songDeleted = log?.songNumericId != null && deletedIds.has(log.songNumericId);

  const retry = () => {
    if (log && !songDeleted) navigate(retryPathOf(log, { songsSource: SONGS_SOURCE }));
  };

  // Enter = 다시 하기(지운 곡이면 하지 않는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' || !log || songDeleted) return;
      // D1: 링크·버튼·입력 칸이 소유한 Enter는 가로채지 않는다
      if (e.isComposing || e.defaultPrevented || isKeyOwnedByTarget(e.target as KeyTarget, e.code)) return;
      e.preventDefault();
      navigate(retryPathOf(log, { songsSource: SONGS_SOURCE }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, navigate, songDeleted]);

  if (!log) {
    return (
      <main className="main">
        <EmptyState
          title="결과를 찾을 수 없어요"
          description="이 브라우저에 저장된 최근 20건에 없는 기록이에요."
          action={
            <Link to="/history" className={buttonClassName({ variant: 'primary', size: 'md' })}>
              연주 기록 보기
            </Link>
          }
        />
      </main>
    );
  }

  const h = timingHistogram(log);
  const s = log.summary;
  const metaParts = [
    log.bpm ? `BPM ${Math.round(log.bpm)}` : null,
    log.durationMs > 0 ? formatDuration(log.durationMs) : null,
    MODE_LABEL[log.mode] ?? log.mode,
    formatPlayDate(log.startedAt),
  ].filter((x): x is string => x !== null);
  const timingDetail = `빠름 평균 ${h.early === null ? '–' : `${h.early.toFixed(0)}ms`} · 늦음 평균 ${h.late === null ? '–' : `+${h.late.toFixed(0)}ms`} · 판정 폭 ±${log.timing.perfectMs}/±${log.timing.goodMs}ms`;

  return (
    <main className="main">
      <div className="result-page">
        <ResultSummaryCard
          title={log.title}
          meta={metaParts.join(' · ')}
          titleBadge={songDeleted ? <DeletedSongChip /> : undefined}
          scoreText={isSheet ? undefined : `${s.score.toLocaleString('ko-KR')} / ${s.maxCombo}`}
          accuracyText={`${(s.accuracy * 100).toFixed(1)}%`}
        />

        <ReportEntry
          playId={log.playId}
          legacy={legacy}
          state={uploadState}
          report={prefetchedReport}
          onRetry={() => void startPlaySync(log.playId)}
        />

        <div className="result-cols">
          <JudgeBars counts={s.counts} strayHits={s.strayHits} />
          <TimingHistogram
            counts={h.counts}
            perfectIdx={h.perfectIdx}
            goodMs={log.timing.goodMs}
            meanDeltaMs={h.meanDeltaMs}
            detail={timingDetail}
          />
        </div>

        {showLocalFeedback && feedback.length > 0 && (
          <section className="result-fb-section" aria-label="간단 피드백">
            <div className="result-fb-list">
              {feedback.map((it) => (
                <FeedbackCard
                  key={it.id}
                  item={it}
                  active={!!it.bars && !!focusBars && it.bars[0] === focusBars[0] && it.bars[1] === focusBars[1]}
                  onFocusBars={snippetChart ? focus : undefined}
                />
              ))}
            </div>
            {snippetChart && focusBars && (
              <div ref={snippetRef}>
                <Card title={focusBars[0] === focusBars[1] ? `약점 ${focusBars[0] + 1}마디` : `약점 마디 ${focusBars[0] + 1}~${focusBars[1] + 1}`}>
                  <SheetSnippet chart={snippetChart} noteStates={noteStates} bars={focusBars} />
                  <p className="result-caption">카드를 누르면 구간이 바뀝니다</p>
                </Card>
              </div>
            )}
          </section>
        )}

        {summary.length > 0 && <PadSummaryTable summary={summary} openHihat={openHihat} />}
        {openHihat && !summary.some((row) => row.pad === 'HIHAT') && <p className="result-caption" aria-label={openHihat.label}>{openHihat.text}</p>}

        <SetupHintCard tags={setupTagsOf(log.liveCoachEvents)} returnTo={`/result/${log.playId}`} />

        <div className="result-actions">
          {!songDeleted && (
            <Button variant="primary" size="md" onClick={retry} aria-keyshortcuts="Enter">
              다시 하기
            </Button>
          )}
          <Link to={pickPath(log)} className={buttonClassName({ variant: 'secondary', size: 'md' })}>
            다른 곡
          </Link>
          <Link to="/free" className={buttonClassName({ variant: 'secondary', size: 'md' })}>
            자유 연습
          </Link>
        </div>
      </div>
    </main>
  );
}
