// 다음 박 배지 훅 (설계 5-1). KitGuideView가 하던 "패드마다 다음에 칠 박 라벨" 계산을 DrumKit badges(PadBadge: now·next·later·격자 밖 점) 형식으로 내놓는다.
// 노트 판정 상태는 RhythmSession.notes를 매 프레임 직접 읽고, 표시가 바뀔 때만 React 상태를 갱신한다.
import { useEffect, useMemo, useState } from 'react';
import type { RhythmSession } from '@/engine/RhythmSession';
import { nextBeatBadges, padCues, type NextBeatBadges } from '@/features/play/domain/padCue';
import { buildSheet, gridTimeAt } from '@/domain/song/sheet';

const EMPTY: NextBeatBadges = { badges: {}, nowPads: [] };

export interface UseNextBeatLabelsArgs {
  session: RhythmSession | null | undefined;
  /** 매 프레임 호출된다. null이면 0 기준 정지(시작 확인 창) */
  getSongTime: () => number | null;
  /** 설정 sheetPadCount. false면 빈 배지 */
  enabled: boolean;
}

/** DrumKit의 badges·highlight에 그대로 넘긴다. nowPads는 "지금" 칠 패드 전부(동시타 포함) */
export function useNextBeatLabels({ session, getSongTime, enabled }: UseNextBeatLabelsArgs): NextBeatBadges {
  const sheet = useMemo(
    () => (session ? buildSheet(session.chart, session.chart.beatsPerBar * 4) : null),
    [session],
  );
  const [result, setResult] = useState<NextBeatBadges>(EMPTY);

  useEffect(() => {
    if (!enabled || !session || !sheet) {
      return;
    }
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      const t = getSongTime() ?? 0;
      // 마디는 격자 시각으로, "지금"은 원본 timeMs와 곡 시각으로 비교한다(원점과 무관)
      const bar = Math.floor(Math.max(gridTimeAt(session.chart, t), 0) / sheet.barMs);
      const next = nextBeatBadges(padCues(sheet, bar, session.notes), t);
      const key = `${next.highlight ?? ''}|${next.nowPads.join(',')}|${Object.entries(next.badges)
        .map(([p, b]) => `${p}:${b?.text}:${b?.level}:${b?.offGrid ? 1 : 0}`)
        .join(',')}`;
      if (key !== lastKey) {
        lastKey = key;
        setResult(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, session, sheet, getSongTime]);

  return enabled ? result : EMPTY;
}
