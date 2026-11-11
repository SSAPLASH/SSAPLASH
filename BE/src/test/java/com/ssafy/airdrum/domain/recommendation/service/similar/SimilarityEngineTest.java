package com.ssafy.airdrum.domain.recommendation.service.similar;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.domain.recommendation.model.ChartVector;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Note;
import com.ssafy.airdrum.domain.chart.model.ChartFeatures;
import static org.assertj.core.api.Assertions.*;

/** R2 유사도 계산. 실제 특징 계산(ChartFeatures)을 거친 입력으로 확인해 두 계산이 맞물리는지도 본다. */
class SimilarityEngineTest {
	private static int counter;
	private static Note note(double t, String pad) { return new Note("n" + counter++, t, pad, null, null); }

	/** 4/4 한 마디 4박을 {@code bars}번 반복한 패턴. */
	static List<Note> pattern(String kind, int bars, double bpm) {
		double beat = 60000 / bpm;
		var notes = new ArrayList<Note>();
		for (int bar = 0; bar < bars; bar++) for (int b = 0; b < 4; b++) {
			double t = (bar * 4 + b) * beat;
			boolean backbeat = b == 1 || b == 3;
			switch (kind) {
				case "ROCK" -> {
					if (!backbeat) notes.add(note(t, "KICK")); else notes.add(note(t, "SNARE"));
					notes.add(note(t, "HIHAT")); notes.add(note(t + beat / 2, "HIHAT"));
				}
				case "FOUR" -> {
					notes.add(note(t, "KICK")); notes.add(note(t + beat / 2, "HIHAT"));
					if (backbeat) notes.add(note(t, "SNARE"));
				}
				case "SHUFFLE" -> {
					notes.add(note(t, "RIDE")); notes.add(note(t + beat * 2 / 3, "RIDE"));
					if (backbeat) notes.add(note(t, "SNARE")); if (b == 0) notes.add(note(t, "KICK"));
				}
				default -> throw new IllegalArgumentException(kind);
			}
		}
		notes.sort(Comparator.comparingDouble(Note::timeMs));
		return notes;
	}

	static ChartVector vec(long song, long chart, String difficulty, List<Note> notes, double bpm, String signature) {
		int duration = (int) Math.ceil(notes.getLast().timeMs()) + 500;
		var features = ChartFeatures.compute(notes, duration);
		return new ChartVector(song, chart, difficulty, notes.size(), features.avgNotesPerSec(), bpm, signature,
				features.padRatio(), features.transitionRatio(), null);
	}
	static ChartVector vec(long song, String kind, double bpm) { return vec(song, song * 10, "NORMAL", pattern(kind, 8, bpm), bpm, "4/4"); }

	/** 같은 특징에서 밀도·노트 수만 바꾼 채보. */
	static ChartVector withDensity(ChartVector base, long song, long chart, String difficulty, int noteCount, double density) {
		return new ChartVector(song, chart, difficulty, noteCount, density, base.bpm(), base.timeSignature(), base.padRatio(), base.transitionRatio(), base.meta());
	}

	@Test void 같은_채보끼리는_1이고_순서를_바꿔도_같다() {
		var a = vec(1, "ROCK", 120);
		var b = vec(2, "FOUR", 120);
		assertThat(SimilarityEngine.similarity(a, a)).isCloseTo(1.0, within(1e-9));
		assertThat(SimilarityEngine.similarity(a, b)).isCloseTo(SimilarityEngine.similarity(b, a), within(1e-12)); // 합산 순서에 따른 부동소수 오차만 허용
	}

	@Test void 같은_종류의_패턴은_다른_종류보다_가깝다() {
		var rock = vec(1, "ROCK", 120);
		double sameKind = SimilarityEngine.similarity(rock, vec(2, "ROCK", 125));
		assertThat(sameKind).isGreaterThan(0.9);
		assertThat(sameKind).isGreaterThan(SimilarityEngine.similarity(rock, vec(3, "FOUR", 120)));
		assertThat(sameKind).isGreaterThan(SimilarityEngine.similarity(rock, vec(4, "SHUFFLE", 120)));
	}

	@Test void 노트를_10퍼센트_빼거나_시각을_흔든_사본은_후보_중_1위다() {
		var original = pattern("ROCK", 8, 120);
		var dropped = new ArrayList<Note>();
		for (int i = 0; i < original.size(); i++) if (i % 10 != 9) dropped.add(original.get(i));
		var jittered = new ArrayList<Note>();
		for (int i = 0; i < original.size(); i++) jittered.add(note(original.get(i).timeMs() + (i % 2 == 0 ? 8 : -8), original.get(i).pad())); // 격자 허용(약 10ms) 안
		jittered.sort(Comparator.comparingDouble(Note::timeMs));
		var candidates = List.of(vec(10, "ROCK", 120), vec(11, "FOUR", 120), vec(12, "SHUFFLE", 120), vec(13, "ROCK", 90), vec(14, "FOUR", 140));
		for (var copy : List.of(dropped, jittered)) {
			var source = vec(99, 990, "NORMAL", copy, 120, "4/4");
			var ranked = SimilarityEngine.rank(source, candidates, null, 5);
			assertThat(ranked.getFirst().chart().songId()).isEqualTo(10L);
			assertThat(ranked.getFirst().similarity()).isGreaterThan(0.9);
		}
	}

	@Test void 박자표_분자가_다르면_절반이_된다() {
		var four = vec(1, 10, "NORMAL", pattern("ROCK", 8, 120), 120, "4/4");
		var three = vec(2, 20, "NORMAL", pattern("ROCK", 8, 120), 120, "3/4");
		assertThat(SimilarityEngine.similarity(four, three)).isCloseTo(0.5, within(1e-9));
		assertThat(SimilarityEngine.similarity(four, vec(3, 30, "NORMAL", pattern("ROCK", 8, 120), 120, "4/4"))).isCloseTo(1.0, within(1e-9));
	}

	@Test void 최소_유사도_미만은_결과에_없다() {
		var source = vec(1, "ROCK", 120);
		var alien = new ChartVector(2, 20, "NORMAL", 100, 8.0, 60, "4/4", Map.of("TOM", 1.0), Map.of(), null);
		assertThat(SimilarityEngine.similarity(source, alien)).isLessThan(SimilarityEngine.MIN_SIMILARITY);
		assertThat(SimilarityEngine.rank(source, List.of(alien), null, 5)).isEmpty();
	}

	@Test void 박자표나_템포를_모르는_곡도_비교한다() {
		var known = vec(1, 10, "NORMAL", pattern("ROCK", 8, 120), 120, "4/4");
		var unknown = new ChartVector(2, 20, "NORMAL", known.noteCount(), known.density(), 0, null, known.padRatio(), known.transitionRatio(), null);
		// 템포 점수만 0이고 박자표 감점은 없다
		assertThat(SimilarityEngine.similarity(known, unknown)).isCloseTo(1 - SimilarityEngine.W_TEMPO, within(1e-9));
	}

	@Test void 기준_곡_자신은_빠지고_곡당_하나만_나온다() {
		var source = vec(1, "ROCK", 120);
		var sameSongOtherDifficulty = withDensity(vec(1, "ROCK", 120), 1, 11, "HARD", 400, 6.0);
		var other = List.of(vec(2, "ROCK", 121), withDensity(vec(2, "ROCK", 121), 2, 21, "HARD", 400, 6.0), sameSongOtherDifficulty);
		var ranked = SimilarityEngine.rank(source, other, null, 10);
		assertThat(ranked).extracting(m -> m.chart().songId()).containsExactly(2L);
	}

	@Test void 같은_난이도를_우선하고_없으면_밀도가_가까운_채보를_고른다() {
		var source = vec(1, 10, "NORMAL", pattern("ROCK", 8, 120), 120, "4/4"); // 밀도 약 3
		var base = vec(2, "ROCK", 120);
		var easy = withDensity(base, 2, 21, "EASY", 100, 1.0);
		var normal = withDensity(base, 2, 22, "NORMAL", 200, 3.0);
		var hard = withDensity(base, 2, 23, "HARD", 300, 6.0);
		assertThat(SimilarityEngine.rank(source, List.of(easy, normal, hard), null, 5).getFirst().chart().difficulty()).isEqualTo("NORMAL");
		// NORMAL이 없으면 기준 밀도(3.x)와 가까운 쪽: HARD(6.0)는 로그 거리 약 1, EASY(1.0)는 약 1.6
		assertThat(SimilarityEngine.rank(source, List.of(easy, hard), null, 5).getFirst().chart().difficulty()).isEqualTo("HARD");
	}

	@Test void 기준_곡에서_고르는_채보는_요청_난이도_없으면_난이도_순서로_가장_가까운_것() {
		var base = vec(1, "ROCK", 120);
		var easy = withDensity(base, 1, 11, "EASY", 100, 1.0);
		var hard = withDensity(base, 1, 13, "HARD", 300, 6.0);
		var normal = withDensity(base, 1, 12, "NORMAL", 200, 3.0);
		assertThat(SimilarityEngine.chooseSource(List.of(easy, normal, hard), "HARD")).isSameAs(hard);
		assertThat(SimilarityEngine.chooseSource(List.of(easy, hard), "NORMAL")).isSameAs(easy); // 같은 거리면 쉬운 쪽
		assertThat(SimilarityEngine.chooseSource(List.of(normal), "HARD")).isSameAs(normal);
	}

	@Test void NORMAL과_노트_수가_같은_EASY는_같은_채보로_보고_뺀다() {
		var source = vec(1, "ROCK", 120);
		var base = vec(2, "ROCK", 120);
		var normal = withDensity(base, 2, 22, "NORMAL", 200, 3.0);
		var easyDuplicate = withDensity(base, 2, 21, "EASY", 200, 3.0);
		var ranked = SimilarityEngine.rank(vec(1, 10, "EASY", pattern("ROCK", 8, 120), 120, "4/4"), List.of(easyDuplicate, normal), null, 5);
		assertThat(ranked).extracting(m -> m.chart().chartId()).containsExactly(22L);
		assertThat(source).isNotNull();
	}

	@Test void 본인_기준_밀도의_1점5배를_넘는_채보는_거르되_점수는_그대로다() {
		var source = vec(1, "ROCK", 120);
		var base = vec(2, "ROCK", 120);
		var near = withDensity(base, 2, 21, "NORMAL", 200, 4.5);
		var far = withDensity(base, 3, 31, "NORMAL", 200, 4.6);
		var withoutFilter = SimilarityEngine.rank(source, List.of(near, far), null, 5);
		var withFilter = SimilarityEngine.rank(source, List.of(near, far), 3.0, 5);
		assertThat(withoutFilter).extracting(m -> m.chart().songId()).contains(2L, 3L);
		assertThat(withFilter).extracting(m -> m.chart().songId()).containsExactly(2L);
		assertThat(withFilter.getFirst().similarity()).isEqualTo(withoutFilter.stream().filter(m -> m.chart().songId() == 2L).findFirst().get().similarity());
	}

	@Test void 같은_점수면_곡_id_순이고_후보_순서와_무관하게_같은_결과다() {
		var source = vec(1, "ROCK", 120);
		var list = new ArrayList<ChartVector>();
		for (long song = 9; song >= 2; song--) list.add(vec(song, "ROCK", 120)); // 같은 채보를 곡 id만 달리
		var first = SimilarityEngine.rank(source, list, null, 5);
		assertThat(first).extracting(m -> m.chart().songId()).containsExactly(2L, 3L, 4L, 5L, 6L);
		var reversed = new ArrayList<>(list);
		Collections.reverse(reversed);
		assertThat(SimilarityEngine.rank(source, reversed, null, 5)).isEqualTo(first);
	}

	@Test void 메타데이터가_없거나_한쪽만_없으면_채보_유사도만_쓴다() {
		var a = vec(1, "ROCK", 120);
		var b = vec(2, "ROCK", 130);
		double chartOnly = SimilarityEngine.similarity(a, b);
		var rock = new ChartVector.SongMeta(Set.of("ROCK"), Set.of("ENERGETIC"), Set.of("EIGHT_BEAT"), 4);
		assertThat(SimilarityEngine.similarity(a.withMeta(ChartVector.SongMeta.NONE), b.withMeta(ChartVector.SongMeta.NONE))).isEqualTo(chartOnly);
		assertThat(SimilarityEngine.similarity(a.withMeta(rock), b)).isEqualTo(chartOnly);
		assertThat(SimilarityEngine.similarity(a.withMeta(rock), b.withMeta(ChartVector.SongMeta.NONE))).isEqualTo(chartOnly);
	}

	@Test void 메타데이터가_양쪽에_있으면_15퍼센트만_섞이고_같은_장르가_더_가깝다() {
		var a = vec(1, "ROCK", 120);
		var b = vec(2, "ROCK", 130);
		double chartOnly = SimilarityEngine.similarity(a, b);
		var rock = new ChartVector.SongMeta(Set.of("ROCK"), Set.of("ENERGETIC"), Set.of("EIGHT_BEAT"), 4);
		var jazz = new ChartVector.SongMeta(Set.of("JAZZ"), Set.of("CALM"), Set.of("SHUFFLE"), 1);
		double sameMeta = SimilarityEngine.similarity(a.withMeta(rock), b.withMeta(rock));
		double otherMeta = SimilarityEngine.similarity(a.withMeta(rock), b.withMeta(jazz));
		assertThat(sameMeta).isCloseTo(0.85 * chartOnly + 0.15 * 1.0, within(1e-9));
		// 장르·분위기·드럼 스타일은 0점이고 에너지(4와 1)만 1 - 3/4 = 0.25점 → 메타 점수는 네 항목 평균 0.0625
		assertThat(otherMeta).isCloseTo(0.85 * chartOnly + 0.15 * 0.0625, within(1e-9));
		assertThat(sameMeta).isGreaterThan(otherMeta);
		var ranked = SimilarityEngine.rank(a.withMeta(rock), List.of(b.withMeta(rock)), null, 5);
		assertThat(ranked.getFirst().matchedOn()).hasSizeLessThanOrEqualTo(2);
	}

	@Test void 비슷한_이유는_기여가_큰_요소_최대_2개이고_점수가_낮은_요소는_빠진다() {
		var a = vec(1, "ROCK", 120);
		var tempoOff = vec(2, "ROCK", 180); // 패드는 같고 템포는 1.41배를 넘어 0점
		var ranked = SimilarityEngine.rank(a, List.of(tempoOff), null, 5);
		assertThat(ranked).hasSize(1);
		assertThat(ranked.getFirst().matchedOn()).hasSizeLessThanOrEqualTo(2).doesNotContain(SimilarityEngine.TEMPO).contains(SimilarityEngine.PADS);
	}

	@Test void 후보가_없으면_빈_목록() {
		assertThat(SimilarityEngine.rank(vec(1, "ROCK", 120), List.of(), null, 5)).isEmpty();
	}

	@Test void 크기_제한을_지킨다() {
		var list = new ArrayList<ChartVector>();
		for (long song = 2; song <= 8; song++) list.add(vec(song, "ROCK", 120));
		assertThat(SimilarityEngine.rank(vec(1, "ROCK", 120), list, null, 3)).hasSize(3);
	}
}
