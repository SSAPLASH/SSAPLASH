// 연주 결과 (리듬 게임 설계 4-2 · 악보 연주 설계 D11 · Figma 결과 112:1194). localStorage 플레이 로그를 읽어 보여준다.
// 요약 카드 → [서버 분석 진입] → 판정 분포·타이밍 분포 → (악보 모드) 피드백 카드·약점 마디 미니 악보 → 패드별 표 → 버튼 행.
// 악보 연주(mode SHEET)는 점수·콤보 대신 정확도 중심이라 요약 카드에 점수 블록이 없다.
// 곡이 삭제됐으면(곡 상세 404, CHART-001 U7) 결과는 그대로 보이고 「삭제된 곡」 칩과 함께 [다시 하기]·Enter만 숨긴다.
import { setupTagsOf } from '@/coach/live';
import { SetupHintCard } from '@/features/result/components/SetupHintCard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ReportEntry } from '@/features/result/components/ReportEntry';
import { LessonResultBand } from '@/features/result/components/LessonResultBand';
import { lessonOfChart, lessonPath } from '@/domain/play/lesson';
import { useLessons } from '@/store/lessonStore';
import { TimingCalDialog } from '@/components/calibration/TimingCalDialog';
import { DEFAULT_TIMING } from '@/domain/play/judgement';
import { isSensorSource } from '@/domain/events';
import { shouldRemindTimingCal } from '@/domain/kit/calibration/timingCalPrompt';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { clockSkewText } from '@/domain/kit/device/arrivalSkew';
import { resumePlaySync, startPlaySync, usePlaySync, usePrefetchedReport } from '@/runtime/playSync';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/kit/keyTarget';
import { pickPathOf, RETRY_AUTOSTART_STATE, retryPathOf } from '@/domain/play/playRetry';
import { unlockAudio } from '@/runtime/audioUnlock';
import { SONGS_SOURCE } from '@/store/songStore';
import { isServerPlayId } from '@/domain/play/playUpload';
import { SheetSnippet } from '@/features/result/components/SheetSnippet';
import { formatDuration } from '@/domain/time/formatTime';
import { FeedbackCard } from '@/features/result/components/FeedbackCard';
import { JudgeBars } from '@/features/result/components/JudgeBars';
import { PadSummaryTable } from '@/features/result/components/PadSummaryTable';
import { ResultSummaryCard } from '@/features/result/components/ResultSummaryCard';
import { RecordCelebration } from '@/features/result/components/RecordCelebration';
import { useReducedMotion } from 'motion/react';
import { bestRecordDelta, isSlowedLog, localPrevBest, recordBadgeOf, type PrevBest } from '@/domain/play/bestRecord';
import { rateLabel } from '@/domain/song/practiceRate';
import { TimingHistogram } from '@/features/result/components/TimingHistogram';
import '@/features/result/components/result.css';
import { useShell } from '@/components/shell/nav/useShell';
import { DeletedSongChip } from '@/components/song/DeletedSongChip';
import { useDeletedSongIds } from '@/components/song/useDeletedSongIds';
import { Button } from '@/components/ui/action/Button';
import { Card } from '@/components/ui/layout/Card';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { formatPlayDate } from '@/domain/play/playLogView';
import { timingHistogram } from '@/features/result/domain/timingHistogram';
import { buildFeedback, chartFromLog, summarizeByPad, summarizeOpenHihat } from '@/features/result/domain/feedback';
import { isUploadTarget } from '@/domain/play/report';
import { getPlayLog, loadPlayLogs } from '@/engine/playLog';
import type { PlayLog } from '@/domain/play/playLog';

/** 모드별 선택 화면 경로 */
const pickPath = (l: PlayLog): string => pickPathOf(l.mode);

/** 요약 카드 메타의 모드 표기 */
const MODE_LABEL: Record<string, string> = { RHYTHM: '게임 모드', SHEET: '악보 모드' };

export function ResultPage() {
  useShell({ title: '결과' });
  const { playId } = useParams();
  const navigate = useNavigate();
  const log = useMemo(() => (playId ? getPlayLog(playId) : null), [playId]);
  const location = useLocation();
  const reducedMotion = useReducedMotion();

  // 최고 기록 비교(설계 MODE-001-score-combo-fx D4). 연주 직후 도착이면 치기 전 최고값(prevBest)이 navigate state로 온다.
  // 도착 때 한 번만 정해 두고(state를 곧 비우므로) 그 뒤 로컬 로그가 바뀌어도 칩이 흔들리지 않게 한다
  const stateBest = (location.state as { prevBest?: PrevBest } | null)?.prevBest ?? null;
  // 연주를 막 끝내고 온 화면만 state에 prevBest 키가 있다(값은 첫 연주면 null). 이것도 도착 때 한 번 정해 둔다 —
  // 아래에서 state를 비워도 학습 코스 띠의 자동 넘김이 꺼지지 않게(설계 SETUP-학습-코스-자동-넘김 U4)
  const stateFresh = location.state !== null && typeof location.state === 'object' && 'prevBest' in location.state;
  const [arrival, setArrival] = useState<{ playId: string | undefined; prev: PrevBest | null; fresh: boolean } | null>(null);
  if (arrival === null || arrival.playId !== playId) setArrival({ playId, prev: stateBest, fresh: stateFresh });
  const arrived = arrival !== null && arrival.playId === playId ? arrival.prev : stateBest;
  const fresh = arrival !== null && arrival.playId === playId ? arrival.fresh : stateFresh;
  // 새로고침해도 축하가 다시 나오지 않도록 도착 state를 비운다(칩은 로컬 로그로 다시 계산)
  useEffect(() => {
    if (stateBest) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // 도착 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const delta = useMemo(() => {
    // 연습 속도로 친 판은 최고 기록과 비교하지 않는다(설계 MODE-003-practice-speed D9)
    if (!log || log.mode === 'FREE' || isSlowedLog(log)) return null;
    // state가 없으면(새로고침·기록 화면에서 연 결과) 이 판보다 먼저 친 로컬 로그만으로 비교한다
    const prev =
      arrived ??
      localPrevBest(
        loadPlayLogs(),
        { mode: log.mode, songNumericId: log.songNumericId, chartId: log.chartId, songId: log.songId, difficulty: log.difficulty, goodMs: log.timing.goodMs },
        (l) => l.playId === log.playId || !(l.startedAt < log.startedAt),
      );
    return bestRecordDelta(log, prev);
  }, [log, arrived]);
  // 박자 맞추기 권유 띠(PLAY-004 4-3): 첫 권유를 건너뛴 센서 사용자에게, 연주를 마치고 도착한 결과 화면에서 한 번만 보인다
  // (연주 기록에서 옛 결과를 열 때는 보이지 않는다). 처음 판단 결과를 붙잡아 두어 아래에서 설정을 done으로 바꿔도
  // 이 화면에 머무는 동안 띠가 남는다
  const [remind] = useState(() => {
    const st = useSettings.getState();
    return stateBest !== null && log !== null && shouldRemindTimingCal({ sensor: isSensorSource(log.inputSource), timingCal: st.timingCal, prompt: st.timingCalPrompt });
  });
  // 기기 사이 시각 차이 경고 띠(PLAY-006): 연주를 마치고 도착한 시점에 경고 중이었으면 한 줄만 보인다(버튼 없음).
  // 도착 시점 값을 붙잡아 이 화면에 머무는 동안 흔들리지 않게 하고, 연주 기록에서 연 옛 결과에는 보이지 않는다
  const [skewText] = useState(() => {
    const skew = useLive.getState().clockSkew;
    return stateBest !== null && skew !== null ? clockSkewText(skew) : null;
  });
  const [calOpen, setCalOpen] = useState(false);
  useEffect(() => {
    if (remind) useSettings.getState().setTimingCalPrompt('done');
  }, [remind]);
  const celebrating = arrived !== null && delta?.kind === 'new' && !reducedMotion;

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

  // 리듬 게임은 곡 선택을 거치지 않고 같은 곡·단계의 카운트다운으로 바로 간다(state.autoStart). 악보 연습은 주소의 start=1이 시작 확인 창을 연다
  // 레슨 기록이면 그 코스를 유지한 학습 코스 주소로 다시 한다(시작 확인 창을 닫으면 코스 화면이 남게). 띠에는 다시 하기를 두지 않는다
  const lessonItems = useLessons((l) => l.list)?.items;
  const retryLesson = log?.mode === 'SHEET' && lessonItems ? lessonOfChart(lessonItems, log.chartId) : undefined;
  const retry = () => {
    if (!log || songDeleted) return;
    if (retryLesson) {
      navigate(lessonPath(retryLesson));
      return;
    }
    if (log.mode !== 'SHEET') void unlockAudio(); // 사용자 동작 안에서 오디오 잠금을 풀어 둔다(시작은 화면이 바뀐 뒤 자동으로 일어난다)
    navigate(retryPathOf(log, { songsSource: SONGS_SOURCE }), log.mode === 'SHEET' ? undefined : { state: RETRY_AUTOSTART_STATE });
  };

  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });
  // Enter = 다시 하기(지운 곡이면 하지 않는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' || !log || songDeleted) return;
      // D1: 링크·버튼·입력 칸이 소유한 Enter는 가로채지 않는다
      if (e.isComposing || e.defaultPrevented || isKeyOwnedByTarget(e.target as KeyTarget, e.code)) return;
      e.preventDefault();
      retryRef.current();
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

  const badge = delta ? recordBadgeOf(log, delta) : null;
  return (
    <main className="main">
      <div className="result-page">
        <ResultSummaryCard
          title={log.title}
          meta={metaParts.join(' · ')}
          titleBadge={
            songDeleted || isSlowedLog(log) ? (
              <>
                {songDeleted && <DeletedSongChip />}
                {isSlowedLog(log) && <span className="result-rate-chip">{rateLabel(log.playbackRate ?? 1)} 속도로 연습</span>}
              </>
            ) : undefined
          }
          scoreText={isSheet ? undefined : `${s.score.toLocaleString('ko-KR')} / ${s.maxCombo}`}
          accuracyText={`${(s.accuracy * 100).toFixed(1)}%`}
          recordBadge={badge}
          countUp={
            celebrating
              ? {
                  score: isSheet ? undefined : (p) => `${Math.round(s.score * p).toLocaleString('ko-KR')} / ${Math.round(s.maxCombo * p)}`,
                  accuracy: (p) => `${(s.accuracy * 100 * p).toFixed(1)}%`,
                }
              : undefined
          }
        />
        {/* 최고 기록 갱신: 화면 전체 색종이 + 가운데 네온 글자(요약 카드 안 작은 폭발 대신) */}
        {celebrating && <RecordCelebration detail={badge?.text.split(' · ')[1]} />}
        {/* 연주 기록·리포트에서 다시 연 결과는 자동으로 넘기지 않는다 */}
        <LessonResultBand log={log} fresh={fresh} />
        {remind && (
          <div className="lesson-band" role="status">
            <div className="lesson-band-text">
              <b>박자 맞추기를 하면 판정이 더 정확해져요.</b>
            </div>
            <div className="lesson-band-actions">
              <Button variant="secondary" onClick={() => setCalOpen(true)}>
                박자 맞추기
              </Button>
            </div>
          </div>
        )}
        {skewText !== null && (
          <div className="lesson-band" role="status">
            <div className="lesson-band-text">
              <b>{skewText}</b>
            </div>
          </div>
        )}
        {calOpen && <TimingCalDialog onClose={() => setCalOpen(false)} />}
        {log.timing.goodMs > DEFAULT_TIMING.goodMs && (
          <p className="result-caption">판정 여유 ±{log.timing.goodMs}ms로 연주한 기록이에요</p>
        )}

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
