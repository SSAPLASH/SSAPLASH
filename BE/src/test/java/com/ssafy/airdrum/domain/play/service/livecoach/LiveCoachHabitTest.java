package com.ssafy.airdrum.domain.play.service.livecoach;

import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

/** 습관 요약 계산(설계 COACH-001 습관 개인화 3.1): 표본 수·판 수 기준·한 판 한 번·키·순서·숨기는 값. */
class LiveCoachHabitTest {
    private final LiveCoachHabit habit = new LiveCoachHabit(null, JsonMapper.builder().build());

    private static String late(double severity) {
        return "{\"pattern\":\"TIMING_LATE\",\"pads\":[],\"metrics\":{\"severity\":" + severity + "}}";
    }

    private static String padMiss(String pad) {
        return "{\"pattern\":\"MISS_CLUSTER\",\"pads\":[\"" + pad + "\"],\"metrics\":{\"severity\":0.6,\"missCount\":4}}";
    }

    private static String play(String... segments) {
        return "[" + String.join(",", segments) + "]";
    }

    @Test void fewerThanThreeAnalyzedPlaysGivesNothing() {
        assertThat(habit.summarize(List.of(play(late(0.5)), play(late(0.5))))).isEmpty();
        assertThat(habit.summarize(List.of())).isEmpty();
    }

    @Test void repeatedWeaknessBecomesHabitWithShare() {
        // 5판 중 3판(60%)에서 늦음 → OFTEN, 스몰탐 놓침은 2판이라 습관이 아니다
        var out = habit.summarize(List.of(
            play(late(0.5), padMiss("SMALL_TOM")), play(late(0.4)), play(late(0.7), padMiss("SMALL_TOM")),
            play(), play())).orElseThrow();
        assertThat(out.path("plays").asInt()).isEqualTo(5);
        assertThat(out.path("items")).hasSize(1);
        assertThat(out.path("items").get(0).path("pattern").asString()).isEqualTo("TIMING_LATE");
        assertThat(out.path("items").get(0).path("share").asString()).isEqualTo("OFTEN");
        assertThat(out.path("items").get(0).has("pad")).isFalse();
    }

    @Test void needsFortyPercentOfPlays() {
        // 10판 중 3판(30%)은 판 수는 넘어도 비율이 모자란다
        var plays = new java.util.ArrayList<String>(Collections.nCopies(7, play()));
        plays.addAll(Collections.nCopies(3, play(late(0.9))));
        assertThat(habit.summarize(plays)).isEmpty();
        // 4판(40%)이면 SOMETIMES
        plays.set(0, play(late(0.9)));
        var out = habit.summarize(plays).orElseThrow();
        assertThat(out.path("items").get(0).path("share").asString()).isEqualTo("SOMETIMES");
    }

    @Test void countsOncePerPlayAndMapsOldPadName() {
        // 한 판에 같은 약점이 여러 번이어도 한 번. 옛 이름 HI_TOM은 SMALL_TOM으로 합친다
        var out = habit.summarize(List.of(
            play(padMiss("HI_TOM"), padMiss("SMALL_TOM"), padMiss("SMALL_TOM")),
            play(padMiss("SMALL_TOM")), play(padMiss("HI_TOM")))).orElseThrow();
        var item = out.path("items").get(0);
        assertThat(item.path("pattern").asString()).isEqualTo("MISS_CLUSTER");
        assertThat(item.path("pad").asString()).isEqualTo("SMALL_TOM");
        assertThat(out.path("items")).hasSize(1);
    }

    @Test void weakHandUsesStickAndTransitionDropsPads() {
        String left = "{\"pattern\":\"HAND_WEAK\",\"pads\":[],\"metrics\":{\"weakStickId\":0,\"severity\":0.5}}";
        String unknownHand = "{\"pattern\":\"HAND_WEAK\",\"pads\":[],\"metrics\":{\"severity\":0.9}}";
        String move = "{\"pattern\":\"TRANSITION_MISS\",\"pads\":[\"SNARE\",\"FLOOR_TOM\"],\"metrics\":{\"severity\":0.4}}";
        var out = habit.summarize(List.of(play(left, move, unknownHand), play(left, move), play(left, move))).orElseThrow();
        assertThat(out.path("items")).hasSize(2);
        var hand = out.path("items").get(0).path("pattern").asString().equals("HAND_WEAK") ? out.path("items").get(0) : out.path("items").get(1);
        var transition = hand == out.path("items").get(0) ? out.path("items").get(1) : out.path("items").get(0);
        assertThat(hand.path("hand").asString()).isEqualTo("LEFT");
        assertThat(transition.path("pattern").asString()).isEqualTo("TRANSITION_MISS");
        assertThat(transition.has("pad")).isFalse();
    }

    @Test void picksTwoByPlaysThenSeverity() {
        String early = "{\"pattern\":\"TIMING_EARLY\",\"pads\":[],\"metrics\":{\"severity\":0.9}}";
        String unsteady = "{\"pattern\":\"UNSTEADY\",\"pads\":[],\"metrics\":{\"severity\":0.2}}";
        // 늦음 4판, 빠름·들쭉날쭉 3판씩 → 늦음, 그다음 심각도가 큰 빠름
        var out = habit.summarize(List.of(
            play(late(0.3), early, unsteady), play(late(0.3), early, unsteady), play(late(0.3), early, unsteady),
            play(late(0.3)))).orElseThrow();
        assertThat(out.path("items")).hasSize(2);
        assertThat(out.path("items").get(0).path("pattern").asString()).isEqualTo("TIMING_LATE");
        assertThat(out.path("items").get(1).path("pattern").asString()).isEqualTo("TIMING_EARLY");
    }

    @Test void outputHasNoRatiosDatesOrIdsAndSkipsBadRows() {
        var out = habit.summarize(List.of(play(late(0.5)), "not json", play(late(0.5)), play(late(0.5)))).orElseThrow();
        // 읽을 수 없는 행도 본 판으로 센다(4판 중 3판)
        assertThat(out.path("plays").asInt()).isEqualTo(4);
        String text = out.toString();
        assertThat(text).doesNotContain("severity", "missCount", "playId", "song", "0.5", "fromMs");
        assertThat(out.propertyNames()).containsExactlyInAnyOrder("plays", "items");
    }
}
