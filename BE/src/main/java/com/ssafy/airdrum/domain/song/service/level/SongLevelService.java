package com.ssafy.airdrum.domain.song.service.level;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import com.ssafy.airdrum.domain.song.entity.Song;
import com.ssafy.airdrum.domain.chart.model.ChartDocumentReader;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Note;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.chart.event.SongChartsChanged;

/** songs 행 잠금을 공유하는 트랜잭션에서 최신 입력의 난이도를 저장한다. */
@Service
public class SongLevelService {
    public static final String RULE = "song-level-1";
    private static final Logger log = LoggerFactory.getLogger(SongLevelService.class);
    private final JdbcTemplate db;
    private final ChartDocumentReader reader;
    private ApplicationEventPublisher events;
    public SongLevelService(JdbcTemplate db, ChartDocumentReader reader) { this.db = db; this.reader = reader; }
    /** 스프링이 주입한다. 직접 만드는 도구·테스트에서는 없고, 그러면 채보 특징 신호만 건너뛴다. */
    @Autowired(required = false)
    void events(ApplicationEventPublisher events) { this.events = events; }

    public enum Level { BEGINNER, INTERMEDIATE, ADVANCED }
    public record Result(String reason, Level level, Long versionId, Integer durationMs, boolean legacyEligible, boolean legacyUsed) {}
    private record Song(Integer duration, boolean legacy, String currentLevel, Long currentVersion, String currentRule, Integer currentDuration) {}
    private record Version(long id, int schema, int count, String notes) {}

    public static Level calculate(List<Note> notes, int duration) {
        if (duration <= 0 || notes.isEmpty()) throw new IllegalArgumentException("유효한 곡 길이와 노트가 필요합니다.");
        int left = 0, max = 0;
        double prev = -1;
        for (int right = 0; right < notes.size(); right++) {
            double time = notes.get(right).timeMs();
            if (!Double.isFinite(time) || time < prev || time < 0 || time > duration)
                throw new IllegalArgumentException("노트 시간이 곡 범위를 벗어납니다.");
            prev = time;
            while (time - notes.get(left).timeMs() >= 2000) left++;
            max = Math.max(max, right - left + 1);
        }
        double average = notes.size() * 1000.0 / duration;
        if (average >= 7 || max >= 16) return Level.ADVANCED;
        if (average >= 5 || max >= 12) return Level.INTERMEDIATE;
        return Level.BEGINNER;
    }

    /** apply는 기존 트랜잭션 안에서 호출하며 dry-run은 쓰기·잠금이 없다. */
    public Result process(long id, boolean apply) {
        if (apply && !org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("난이도 저장에는 트랜잭션이 필요합니다.");
        var rows = db.query("SELECT duration_ms,level_legacy_fallback,song_level,level_chart_version_id,level_rule_version,level_duration_ms FROM songs WHERE id=? AND deleted_at IS NULL" + (apply ? " FOR UPDATE" : ""),
                (r,n) -> new Song(r.getObject(1,Integer.class),r.getBoolean(2),r.getString(3),r.getObject(4,Long.class),r.getString(5),r.getObject(6,Integer.class)), id);
        if (rows.isEmpty()) return new Result("SKIPPED",null,null,null,false,false);
        Song song = rows.getFirst();
        var hard = db.queryForObject("SELECT EXISTS(SELECT 1 FROM charts WHERE song_id=? AND difficulty='HARD')",Boolean.class,id);
        boolean fallback = song.legacy() && !Boolean.TRUE.equals(hard);
        String difficulty = Boolean.TRUE.equals(hard) ? "HARD" : fallback ? db.query("SELECT difficulty FROM charts WHERE song_id=? ORDER BY CASE difficulty WHEN 'NORMAL' THEN 0 ELSE 1 END LIMIT 1",(r,n)->r.getString(1),id).stream().findFirst().orElse(null) : null;
        var versions = difficulty == null ? List.<Version>of() : db.query("SELECT v.id,v.schema_version,v.note_count,CAST(v.notes AS text) FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND c.difficulty=? ORDER BY v.version DESC LIMIT 1",(r,n)->new Version(r.getLong(1),r.getInt(2),r.getInt(3),r.getString(4)),id,difficulty);
        Level level = null; Version version = versions.isEmpty() ? null : versions.getFirst();
        String reason = version == null ? "NO_CHART" : "INVALID";
        if (version != null && song.duration() != null && song.duration() > 0) {
            try {
                ChartDocumentReader.requireSchema(version.schema());
                level = calculate(reader.notes(version.notes(),version.count()),song.duration());
                reason = "CALCULATED";
            } catch (IllegalStateException | IllegalArgumentException | BusinessException ex) {
                log.warn("곡 난이도 산정 입력 오류 songId={}", id);
            }
        }
        if (apply) {
            Long versionId = level == null ? null : version.id();
            Integer duration = level == null ? null : song.duration();
            String rule = level == null ? null : RULE;
            String levelValue = level == null ? null : level.name();
            if (java.util.Objects.equals(levelValue,song.currentLevel()) && java.util.Objects.equals(versionId,song.currentVersion())
                    && java.util.Objects.equals(rule,song.currentRule()) && java.util.Objects.equals(duration,song.currentDuration())
                    && (!Boolean.TRUE.equals(hard) || !song.legacy())) reason = level == null ? reason : "UNCHANGED";
            else db.update("UPDATE songs SET song_level=?,level_chart_version_id=?,level_rule_version=?,level_duration_ms=?,level_legacy_fallback=? WHERE id=?",levelValue,versionId,rule,duration,fallback,id);
            if (events != null && level != null) events.publishEvent(new SongChartsChanged(id));
        }
        return new Result(reason,level,level == null ? null : version.id(),level == null ? null : song.duration(),song.legacy(),fallback && level != null);
    }
}
