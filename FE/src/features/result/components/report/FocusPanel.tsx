// 선택 구간 확대 (설계 COACH-002 리포트 화면 개편 2·4장). 큰 제목·근거 한 줄·AI 문구, 패드 줄 위의 노트 표시, 노트 넘겨 보기, 재생 조작.
// 페이지가 선택(Focus)마다 key를 바꿔 다시 만든다 — 고른 노트는 선택이 바뀌면 처음으로 돌아가고 재생은 멈춘다.
// 화면 이동의 목적지(id="rp-focus")는 다시 만들어지지 않는 바깥 틀에 페이지가 둔다.
// 재생기는 페이지가 useSegmentPlayer로 만들어 내려준다. AI 문구(description·detail·tip)는 고치지 않고 그대로 보인다.
// 타이밍이 어긋난 노트는 빠름 ◀ · 늦음 ▶로 나눠 그리고 센다(설계 COACH-002-report-timing-direction D3·D4).
import { useEffect, useState } from 'react';
import type { UseSegmentPlayer } from './useSegmentPlayer';
import { ALL_PADS, PAD_META } from '@/domain/kit/pads';
import { levelBadge, segmentLevel, type ReportNote } from '@/domain/play/report';
import {
  clockHundredth,
  clockRange,
  clockTenth,
  deltaText,
  focusBasis,
  focusHeadline,
  noteVerdict,
  notesInRange,
  VERDICT_LABEL,
  verdictCounts,
  type Focus,
  type NoteVerdict,
} from '@/features/result/domain/reportView';
import { planSegment } from '@/features/result/domain/segmentPlayback';
import './report.css';

interface Props {
  focus: Focus;
  /** 전체 노트(시간순). null이면 불러오는 중이거나 실패 */
  notes: ReportNote[] | null;
  /** 노트 조회가 실패했다(notes는 null). 불러오는 중 문구 대신 실패 안내를 보인다 */
  notesFailed?: boolean;
  player: UseSegmentPlayer;
  accompanimentUrl: string | null;
}

const MARK_CLASS: Record<NoteVerdict, string> = { PERFECT: 'perfect', EARLY: 'early', LATE: 'late', MISS: 'miss' };

/** 고른 노트 한 줄의 판정 글자. 빠름·늦음은 오차 글자(「39ms 빠름」)가 방향을 말하므로 이름을 따로 쓰지 않는다(D6) */
function readoutVerdict(n: ReportNote): string {
  const verdict = noteVerdict(n);
  return (verdict === 'EARLY' || verdict === 'LATE') && deltaText(n.deltaMs) !== '' ? '' : VERDICT_LABEL[verdict];
}

export function FocusPanel({ focus, notes, notesFailed = false, player, accompanimentUrl }: Props) {
  const [selected, setSelected] = useState(0);
  const { stop } = player;
  // 선택이 바뀌어 이 패널이 사라지면 재생을 멈춘다
  useEffect(() => () => stop(), [stop]);

  const [line1, line2] = focusHeadline(focus);
  const basis = focusBasis(focus, notes);
  const seg = focus.segment;
  const badge = seg ? levelBadge(segmentLevel(seg)) : null;
  const inWindow = notes ? notesInRange(notes, focus.fromMs, focus.toMs) : [];
  const pads = ALL_PADS.filter((p) => inWindow.some((n) => n.pad === p));
  const span = Math.max(1, focus.toMs - focus.fromMs);
  const index = Math.min(selected, Math.max(0, inWindow.length - 1));
  const current = inWindow[index];
  const counts = verdictCounts(inWindow);
  // 시간축 눈금: 1초마다(창이 길면 8칸으로)
  const tickCount = Math.min(8, Math.max(1, Math.ceil(span / 1000)));
  const playing = player.playingKey === focus.key;

  return (
    <section className="rp-focus" aria-labelledby="rp-focus-title">
      <div className="rp-lead">
        <h2 id="rp-focus-title" aria-live="polite">
          {line1}
          <br />
          {line2}
        </h2>
        {basis !== '' && (
          <p className="rp-basis">
            {focus.kind === 'transition' && '전환 분석 집계 · '}
            <strong>{basis}</strong>
          </p>
        )}
        {seg && (
          <div className="rp-ai">
            <p className="rp-ai-desc">
              {seg.description}
              {badge && <span className={`weak-badge tone-${badge.tone}`}>{badge.text}</span>}
            </p>
            {seg.detail && <p className="rp-ai-detail">{seg.detail}</p>}
            {seg.tip && (
              <p className="rp-ai-tip">
                <span className="rp-ai-tip-label">연습 방법</span>
                {seg.tip}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="rp-detail">
        {focus.kind !== 'cluster' && (
          <>
            <div className="rp-detail-header">
              <h3>
                {focus.kind === 'transition' ? '구간 예시' : '확대 구간'} {clockRange(focus.fromMs, focus.toMs)}
              </h3>
              {notes && <span className="rp-small">{inWindow.length}개 노트</span>}
            </div>
            {notes && inWindow.length > 0 && (
              <p className="rp-detail-summary">
                구간 내 판정: {VERDICT_LABEL.PERFECT} {counts.PERFECT} · {VERDICT_LABEL.EARLY} {counts.EARLY} · {VERDICT_LABEL.LATE} {counts.LATE} · {VERDICT_LABEL.MISS}{' '}
                {counts.MISS}
              </p>
            )}
          </>
        )}

        {notes === null && <p className="rp-small">{notesFailed ? '노트를 불러오지 못해 이 구간을 그릴 수 없어요.' : '노트를 불러오는 중…'}</p>}
        {notes !== null && inWindow.length === 0 && <p className="rp-small">이 구간에는 노트가 없습니다.</p>}

        {inWindow.length > 0 && (
          <>
            <div className="rp-lanes">
              {pads.map((pad) => (
                <div key={pad} className="rp-lane">
                  <span className={`rp-lane-name${focus.relatedPads.includes(pad) ? ' related' : ''}`}>{PAD_META[pad].label}</span>
                  <div className="rp-plot">
                    {inWindow.map((n, i) =>
                      n.pad !== pad ? null : (
                        <button
                          key={n.seq}
                          type="button"
                          tabIndex={-1}
                          className={`rp-mark ${MARK_CLASS[noteVerdict(n)]}${i === index ? ' current' : ''}`}
                          style={{ left: `${(100 * (n.timeMs - focus.fromMs)) / span}%` }}
                          aria-label={`${clockHundredth(n.timeMs)} ${PAD_META[pad].label} ${VERDICT_LABEL[noteVerdict(n)]}`}
                          onClick={() => setSelected(i)}
                        />
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="rp-detail-axis" aria-hidden="true">
              {Array.from({ length: tickCount + 1 }, (_, i) => (
                <span key={i} style={{ left: `${(100 * i) / tickCount}%` }}>
                  {clockTenth(focus.fromMs + (span * i) / tickCount)}
                </span>
              ))}
            </div>
            <div className="rp-note-controls">
              <button type="button" className="rp-step" disabled={index === 0} onClick={() => setSelected(index - 1)}>
                이전 노트
              </button>
              <button type="button" className="rp-step" disabled={index >= inWindow.length - 1} onClick={() => setSelected(index + 1)}>
                다음 노트
              </button>
              <span className="rp-note-number">
                {index + 1} / {inWindow.length}
              </span>
              {current && (
                <span className="rp-note-readout">
                  {[clockHundredth(current.timeMs), PAD_META[current.pad].label, readoutVerdict(current), deltaText(current.deltaMs)]
                    .filter((t) => t !== '')
                    .join(' · ')}
                </span>
              )}
            </div>
            <p className="rp-note-key">
              {VERDICT_LABEL.PERFECT} ● · {VERDICT_LABEL.EARLY} ◀ · {VERDICT_LABEL.LATE} ▶ · {VERDICT_LABEL.MISS} ×
            </p>
          </>
        )}
      </div>

      <div className="rp-player">
        <button
          type="button"
          className="rp-control"
          disabled={notes === null || inWindow.length === 0}
          aria-pressed={playing}
          onClick={() => {
            if (playing) player.stop();
            else if (notes) player.play(focus.key, planSegment(notes, focus.fromMs, focus.toMs, player.rate), accompanimentUrl);
          }}
        >
          {playing ? '정지' : '정답 듣기'}
        </button>
        <button type="button" className="rp-control" aria-pressed={player.rate === 1} onClick={() => player.rate !== 1 && player.toggleRate()}>
          1배
        </button>
        <button type="button" className="rp-control" aria-pressed={player.rate === 0.75} onClick={() => player.rate !== 0.75 && player.toggleRate()}>
          0.75배
        </button>
        <button type="button" className="rp-control" aria-pressed={player.loop} onClick={player.toggleLoop}>
          반복
        </button>
      </div>
      <p className="rp-player-note">FE 드럼 소리로 재연한 정답 연주예요</p>
    </section>
  );
}
