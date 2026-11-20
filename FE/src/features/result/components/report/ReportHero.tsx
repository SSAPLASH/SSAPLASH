// 리포트 머리 (설계 COACH-002-report-apple-redesign ①②). 왼쪽은 코치 총평 — 첫 문장이 화면 제목, 나머지는 그 아래.
// 총평이 없으면(분석 전·옛 기록) 곡 이름이 제목이다. 오른쪽은 점수와 노트 판정 한 줄 막대(정확·빠름늦음·놓침).
// 판정 개수는 서버 counts 그대로이고, 빠름·늦음 나누기는 노트를 받은 뒤에만 보인다. 계산은 reportView가 한다.
import { summaryBadge, type CoachSummary } from '@/domain/play/report';
import { splitSummary, VERDICT_LABEL, OFF_BEAT_LABEL, type JudgementSplit } from '@/features/result/domain/reportView';
import './report.css';

interface Props {
  summary: CoachSummary | null;
  /** 총평이 없을 때 제목 자리에 둘 글자(곡 이름) */
  fallbackTitle: string;
  score: number;
  /** 0~1 */
  accuracy: number;
  split: JudgementSplit;
}

/** 91.2% · 100% (소수 한 자리, 끝의 .0은 뺀다) */
const pctText = (rate: number) => `${Number((rate * 100).toFixed(1))}%`;

export function ReportHero({ summary, fallbackTitle, score, accuracy, split }: Props) {
  const { headline, rest } = splitSummary(summary?.text ?? '');
  const badge = summary ? summaryBadge(summary.level) : null;
  const parts = [
    { key: 'p', label: VERDICT_LABEL.PERFECT, n: split.perfect },
    { key: 'g', label: OFF_BEAT_LABEL, n: split.good },
    { key: 'm', label: VERDICT_LABEL.MISS, n: split.miss },
  ];
  const total = Math.max(1, split.total);

  return (
    <section className="rp-hero" aria-label="연주 요약">
      <div className="rp-hero-say">
        {summary && headline !== '' ? (
          <>
            <div className="rp-hero-by">
              {badge && <span className={`rp-level tone-${badge.tone}`}>{badge.text}</span>}
              <span>코치의 한마디</span>
              <span className="rp-hero-ai">AI가 작성했어요</span>
            </div>
            {/* 나머지 문장이 있으면 첫 문장은 도입 줄로 낮추고 본문을 크게 둔다 */}
            <h1 className={rest ? 'rp-hero-title is-lead' : 'rp-hero-title'}>{headline}</h1>
            {rest && <p className="rp-hero-rest">{rest}</p>}
          </>
        ) : (
          <h1 className="rp-hero-title">{fallbackTitle}</h1>
        )}
      </div>

      <div className="rp-score">
        <span className="rp-score-label">점수</span>
        <strong className="rp-score-value">{score.toLocaleString('ko-KR')}</strong>
        <div className="rp-split-cap">
          <span>노트 {split.total}개 판정</span>
          <span>정확도 {pctText(accuracy)}</span>
        </div>
        <div
          className="rp-split"
          role="img"
          aria-label={`노트 ${split.total}개 중 ${parts.map((p) => `${p.label} ${p.n}개`).join(', ')}`}
        >
          {parts.map((p) =>
            p.n > 0 ? <i key={p.key} className={p.key} style={{ width: `${(100 * p.n) / total}%` }} /> : null,
          )}
        </div>
        <ul className="rp-split-keys">
          {parts.map((p) => (
            <li key={p.key} className={p.key}>
              <span className="rp-split-name">{p.label}</span>
              <strong>
                {p.n}
                <span>개</span>
              </strong>
              {p.key === 'g' && split.early !== null && split.late !== null && (
                <span className="rp-split-sub">
                  {VERDICT_LABEL.EARLY} {split.early} · {VERDICT_LABEL.LATE} {split.late}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
