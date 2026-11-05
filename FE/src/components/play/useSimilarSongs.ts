// 연주 준비 패널의 "이 곡과 비슷한 곡" 줄 (설계 COACH-004-similar-songs D1~D3·D10·D11, 4-1). /play·/sheet가 같이 쓴다.
// - 준비 단계(active)에 들어오면 곡당 1회만 요청한다(키 `SIMILAR:${songId}`). 연습 단계를 바꿔도 다시 요청하지 않는다
// - 곡이 바뀌거나(songId 변경) 곡 선택으로 돌아가면(songId null) 이전 키를 clear한다
// - 카드 배지·클릭은 지금 선택된 연습 단계를 따라간다(D11). api는 모르고 store·domain만 쓴다
import { useCallback, useEffect, useRef } from 'react';
import type { Difficulty } from '@/domain/chart';
import type { RecommendCard } from '@/domain/recommendation';
import { useAuth } from '@/store/authStore';
import { entryOf, useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';

interface Options {
  /** URL의 곡. 곡 선택 단계면 null */
  songId: number | null;
  /** 연주 준비 단계인지(stage === 'ready') */
  active: boolean;
  /** 지금 선택된 연습 단계(준비 단계에서 읽은 채보의 난이도). 아직 모르면 null */
  difficulty: Difficulty | null;
  /** 같은 페이지에서 곡·채보를 바꾼다(`useChartParam().select`) */
  onSelect: (songId: number, chartId: number) => void;
}

export interface SimilarSongs {
  /** 보일 카드. 보이지 않을 때(조건 미충족·로딩·숨김)는 빈 배열 */
  cards: RecommendCard[];
  onPick: (card: RecommendCard) => void;
}

export function useSimilarSongs({ songId, active, difficulty, onSelect }: Options): SimilarSongs {
  const source = useSongs((s) => s.source);
  const selectSong = useSongs((s) => s.selectSong);
  const authed = useAuth((a) => a.status === 'authenticated');
  const enabled = source === 'api' && authed && songId !== null;
  const key = `SIMILAR:${songId}`;
  const entry = useRecommendations((r) => entryOf(r.entries, key));
  const loadSimilar = useRecommendations((r) => r.loadSimilar);
  const click = useRecommendations((r) => r.click);
  const clear = useRecommendations((r) => r.clear);
  // 요청 시점의 난이도를 쓰되 난이도 변경이 효과를 다시 돌리지 않게 ref로 읽는다
  const difficultyRef = useRef(difficulty);
  // 곡 상세 조회를 기다리는 동안 같은 카드가 두 번 눌리면 이동이 두 번 나는 것을 막는다
  const pickingRef = useRef(false);
  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  // 요청: 준비 단계에서 채보 난이도를 알게 되면 1회(중복은 store가 막는다)
  const hasDifficulty = difficulty !== null;
  useEffect(() => {
    if (!enabled || !active || !hasDifficulty || songId === null) return;
    void loadSimilar(key, { songId, difficulty: difficultyRef.current ?? undefined, size: 5 });
  }, [enabled, active, hasDifficulty, songId, key, loadSimilar]);

  // 수명: 곡이 바뀌거나 곡 선택으로 돌아가거나 페이지를 떠나면 이전 키를 버린다
  useEffect(() => {
    if (!enabled) return;
    return () => clear(key);
  }, [enabled, key, clear]);

  const requestId = entry.status === 'ready' ? entry.requestId : '';
  const visible = enabled && active && entry.status === 'ready';
  const base = visible && entry.status === 'ready' ? entry.cards : [];
  // 선택 단계를 가진 곡은 그 단계 배지로 보인다
  const cards = base.map((c) => (difficulty !== null && c.song.difficulties.includes(difficulty) ? { ...c, difficulty } : c));

  const onPick = useCallback(
    (card: RecommendCard) => {
      // 기록은 기다리지 않는다
      void click(card, requestId);
      if (difficulty === null || !card.song.difficulties.includes(difficulty)) {
        onSelect(card.song.id, card.chartId);
        return;
      }
      // 선택 단계의 채보 id는 곡 상세에서 찾고, 실패·없으면 BE가 준 채보로 간다. 조회 중에는 추가 클릭을 무시한다
      if (pickingRef.current) return;
      pickingRef.current = true;
      selectSong(card.song.id)
        .then(
          (detail) => onSelect(card.song.id, detail.charts.find((c) => c.difficulty === difficulty)?.id ?? card.chartId),
          () => onSelect(card.song.id, card.chartId),
        )
        .finally(() => {
          pickingRef.current = false;
        });
    },
    [click, requestId, difficulty, selectSong, onSelect],
  );

  return { cards, onPick };
}
