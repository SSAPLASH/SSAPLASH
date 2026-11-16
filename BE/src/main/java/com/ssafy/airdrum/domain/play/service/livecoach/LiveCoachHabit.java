package com.ssafy.airdrum.domain.play.service.livecoach;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * 연주 중 LLM 코칭에 붙이는 사용자 습관 요약(설계 COACH-001 습관 개인화 3.1).
 * 최근 분석된 플레이의 약점(reports.weak_segments)에서 여러 판에 반복된 약점을 최대 2개 고른다.
 * 결과에는 pattern·패드·손·자주/가끔만 담고 숫자 비율·날짜·곡·playId는 넣지 않는다.
 * 이번 구간과 맞대는 일은 워커(AI live_narrative.habit_match)가 한다.
 */
@Component
public class LiveCoachHabit {
    /** 최근 분석된 플레이를 이만큼 본다. */
    static final int RECENT_PLAYS = 10;
    /** 분석된 플레이가 이보다 적으면 습관을 만들지 않는다. */
    static final int MIN_PLAYS = 3;
    /** 이 판 수 이상에서 나와야 습관이다. */
    static final int MIN_COUNT = 3;
    /** 본 플레이 중 이 비율 이상에서 나와야 습관이다. */
    static final double MIN_SHARE = 0.4;
    /** 이 비율 이상이면 OFTEN, 아니면 SOMETIMES. */
    static final double OFTEN_SHARE = 0.6;
    static final int MAX_ITEMS = 2;

    private static final Set<String> PAD_PATTERNS = Set.of("PAD_LATE", "PAD_EARLY", "MISS_CLUSTER");
    private static final Set<String> PLAIN_PATTERNS = Set.of(
        "TIMING_LATE", "TIMING_EARLY", "UNSTEADY", "TRANSITION_LATE", "TRANSITION_MISS");
    private static final Pattern PAD_NAME = Pattern.compile("[A-Z_]{1,20}");

    private final JdbcTemplate db;
    private final JsonMapper json;

    LiveCoachHabit(JdbcTemplate db, JsonMapper json) {
        this.db = db;
        this.json = json;
    }

    /** 반복된 약점 하나. pad는 패드 약점만, hand는 약한 손만 값이 있다. */
    record Key(String pattern, String pad, String hand) {}

    /** 그 사용자의 습관 요약. 없으면 빈 값. 분석이 끝나지 않았거나 실패한 리포트(weak_segments null)는 건너뛴다. */
    public Optional<ObjectNode> forUser(long userId) {
        List<String> plays = db.queryForList("""
            SELECT CAST(r.weak_segments AS text) FROM play_sessions p JOIN reports r ON r.play_session_id = p.id
            WHERE p.user_id = ? AND p.mode IN ('RHYTHM', 'SHEET') AND r.weak_segments IS NOT NULL
            ORDER BY p.ended_at DESC, p.id LIMIT ?
            """, String.class, userId, RECENT_PLAYS);
        return summarize(plays);
    }

    /** 플레이마다의 weak_segments(JSON 배열 문자열)로 습관 요약을 만든다. 읽을 수 없는 행은 약점 없는 판으로 센다. */
    Optional<ObjectNode> summarize(List<String> plays) {
        if (plays.size() < MIN_PLAYS) return Optional.empty();
        Map<Key, Integer> count = new HashMap<>();
        Map<Key, Double> severity = new HashMap<>();
        for (String raw : plays) {
            Map<Key, Double> once = new HashMap<>();
            for (JsonNode segment : array(raw)) {
                double s = severityOf(segment);
                for (Key key : keysOf(segment)) once.merge(key, s, Math::max);
            }
            once.forEach((key, s) -> {
                count.merge(key, 1, Integer::sum);
                severity.merge(key, s, Double::sum);
            });
        }
        int n = plays.size();
        List<Key> picked = count.entrySet().stream()
            .filter(e -> e.getValue() >= MIN_COUNT && e.getValue() >= MIN_SHARE * n)
            .map(Map.Entry::getKey)
            .sorted(Comparator.<Key>comparingInt(count::get).reversed()
                .thenComparing(Comparator.<Key>comparingDouble(k -> severity.get(k) / count.get(k)).reversed())
                .thenComparing(Key::pattern)
                .thenComparing(k -> k.pad() == null ? "" : k.pad())
                .thenComparing(k -> k.hand() == null ? "" : k.hand()))
            .limit(MAX_ITEMS)
            .toList();
        if (picked.isEmpty()) return Optional.empty();
        ObjectNode out = json.createObjectNode();
        out.put("plays", n);
        var items = out.putArray("items");
        for (Key key : picked) {
            ObjectNode item = items.addObject();
            item.put("pattern", key.pattern());
            if (key.pad() != null) item.put("pad", key.pad());
            if (key.hand() != null) item.put("hand", key.hand());
            item.put("share", count.get(key) >= OFTEN_SHARE * n ? "OFTEN" : "SOMETIMES");
        }
        return Optional.of(out);
    }

    private List<JsonNode> array(String raw) {
        List<JsonNode> out = new ArrayList<>();
        if (raw == null) return out;
        try {
            JsonNode node = json.readTree(raw);
            if (node != null && node.isArray()) node.forEach(out::add);
        } catch (RuntimeException ignored) {
            // 읽을 수 없는 행은 약점이 없는 판으로 센다
        }
        return out;
    }

    private static double severityOf(JsonNode segment) {
        JsonNode s = segment.path("metrics").path("severity");
        return s.isNumber() ? Math.max(0, Math.min(1, s.doubleValue())) : 0.5;
    }

    /** 약점 하나를 키로. 패드 약점은 패드마다, 전환은 패드 순서가 방향인지 확인되지 않아 pattern만 쓴다(추천 설계 U6). */
    private static Set<Key> keysOf(JsonNode segment) {
        String pattern = segment.path("pattern").asString("");
        Set<Key> keys = new LinkedHashSet<>();
        if (PLAIN_PATTERNS.contains(pattern)) {
            keys.add(new Key(pattern, null, null));
        } else if (PAD_PATTERNS.contains(pattern)) {
            for (JsonNode pad : segment.path("pads")) {
                String name = pad.asString("");
                if (name.equals("HI_TOM")) name = "SMALL_TOM"; // 옛 이름
                if (PAD_NAME.matcher(name).matches()) keys.add(new Key(pattern, name, null));
            }
        } else if (pattern.equals("HAND_WEAK")) {
            JsonNode stick = segment.path("metrics").path("weakStickId");
            // 스틱 0은 왼손, 1은 오른손(공통 명세서 9장). 손을 모르면 쓰지 않는다
            if (stick.isNumber() && stick.intValue() == 0) keys.add(new Key(pattern, null, "LEFT"));
            if (stick.isNumber() && stick.intValue() == 1) keys.add(new Key(pattern, null, "RIGHT"));
        }
        return keys;
    }
}
