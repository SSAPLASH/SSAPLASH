package com.ssafy.airdrum.song;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.chart.ChartDocumentReader;
import tools.jackson.databind.json.JsonMapper;

/** 일회용 도구. 환경변수 DB_URL, DB_USERNAME, DB_PASSWORD로 연결한다. */
public final class SongLevelBackfill {
    private SongLevelBackfill() {}
    public static void main(String[] args) {
        boolean apply = false;
        for (String arg : args) {
            if ("--apply".equals(arg) && !apply) apply = true;
            else throw new IllegalArgumentException("허용된 인자는 --apply 하나입니다.");
        }
        String url = required("DB_URL"), username = required("DB_USERNAME"), password = required("DB_PASSWORD");
        var source = new DriverManagerDataSource(url, username, password);
        var db = new JdbcTemplate(source);
        var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        var service = new SongLevelService(db, new ChartDocumentReader(JsonMapper.builder().build()));
        long upper = db.queryForObject("SELECT coalesce(max(id),0) FROM songs WHERE deleted_at IS NULL",Long.class);
        var result = run(db,tx,service,apply,0,upper,100);
        System.out.println("mode=" + (apply ? "apply" : "dry-run") + " upperId=" + upper + " counts=" + result.counts()
                + " legacyEligible=" + result.legacyEligible() + " legacyUsed=" + result.legacyUsed() + " errors=" + result.errors());
        if (result.errors() > 0) System.exit(1);
    }
    public record Summary(Map<String,Integer> counts, int errors, int legacyEligible, int legacyUsed) {}
    public static Summary run(JdbcTemplate db, TransactionTemplate tx, SongLevelService service, boolean apply,
            long cursor, long upper, int batchSize) {
        if (batchSize <= 0) throw new IllegalArgumentException("배치 크기는 양수여야 합니다.");
        int failures = 0, legacyEligible = 0, legacyUsed = 0;
        Map<String,Integer> counts = new LinkedHashMap<>();
        while (cursor < upper) {
            var ids = db.queryForList("SELECT id FROM songs WHERE id>? AND id<=? AND deleted_at IS NULL ORDER BY id LIMIT ?",Long.class,cursor,upper,batchSize);
            if (ids.isEmpty()) break;
            for (long id : ids) {
                cursor = id;
                try {
                    SongLevelService.Result result = apply ? tx.execute(status -> service.process(id,true)) : service.process(id,false);
                    counts.merge(result.reason(),1,Integer::sum);
                    if (result.legacyEligible()) legacyEligible++;
                    if (result.legacyUsed()) legacyUsed++;
                    if ("INVALID".equals(result.reason()) || "NO_CHART".equals(result.reason()))
                        System.out.println("songId=" + id + " reason=" + result.reason());
                } catch (RuntimeException ex) {
                    failures++;
                    System.err.println("songId=" + id + " reason=ERROR");
                }
            }
        }
        return new Summary(Map.copyOf(counts),failures,legacyEligible,legacyUsed);
    }
    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " 설정이 필요합니다.");
        return value;
    }
}
