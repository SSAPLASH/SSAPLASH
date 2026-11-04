package com.ssafy.airdrum.song.midi;

import java.io.PrintStream;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 운영자가 명시한 곡만 원본을 검증한 뒤 새 합성 작업으로 등록한다. */
public final class MidiResynthesis {
    private record Source(long song,long user,UUID original,String key,int size,String sha,String timing,int duration) {}
    private final JdbcTemplate db; private final TransactionTemplate tx; private final MidiOriginalStore store;
    public MidiResynthesis(JdbcTemplate db,PlatformTransactionManager manager,MidiOriginalStore store) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(10); this.store=store;
    }
    public int run(String[] args,PrintStream output) {
        boolean apply=false; var ids=new java.util.LinkedHashSet<Long>();
        for (String arg:args) {
            if ("--apply".equals(arg)) apply=true;
            else {
                try { long id=Long.parseLong(arg); if (id<=0) throw new NumberFormatException(); ids.add(id); }
                catch (NumberFormatException e) { output.println("사용법: --resynthesize [--apply] songId [songId ...]"); return 2; }
            }
        }
        if (ids.isEmpty()) { output.println("곡 ID를 하나 이상 지정하세요."); return 2; }
        int failures=0;
        for (long song:ids) {
            try {
                var source=lookup(song);
                if (source==null) { output.println(song+" SKIPPED (대상이 아님)"); continue; }
                MidiOriginalReceipts.requireKey(source.user(),source.song(),source.original(),source.key());
                var midi=store.get(source.key(),source.size(),source.sha());
                if (!MidiAccompanimentTiming.hasMelody(midi)) { output.println(song+" SKIPPED (드럼 외 노트 없음)"); continue; }
                if (!apply) { output.println(song+" DRY_RUN (원본 확인)"); continue; }
                boolean inserted=Boolean.TRUE.equals(tx.execute(s->enqueue(source)));
                output.println(song+(inserted?" QUEUED":" SKIPPED (상태 변경 또는 진행 중)"));
            } catch (Exception e) { failures++; output.println(song+" ERROR (원본 또는 DB 확인 실패)"); }
        }
        return failures==0?0:1;
    }
    private Source lookup(long id) {
        var rows=db.query("""
                SELECT s.id,s.owner_id,o.id,o.object_key,o.size_bytes,o.sha256,v.timing::text,s.duration_ms
                FROM songs s JOIN users u ON u.id=s.owner_id
                JOIN midi_original_uploads o ON o.song_id=s.id AND o.status='ACCEPTED'
                JOIN charts c ON c.song_id=s.id AND c.difficulty='HARD'
                JOIN chart_versions v ON v.chart_id=c.id AND v.version=(SELECT max(v2.version) FROM chart_versions v2 WHERE v2.chart_id=c.id)
                WHERE s.id=? AND s.source='MIDI' AND s.deleted_at IS NULL AND u.status='ACTIVE'
                """,(r,n)->new Source(r.getLong(1),r.getLong(2),r.getObject(3,UUID.class),r.getString(4),r.getInt(5),r.getString(6),r.getString(7),r.getInt(8)),id);
        return rows.isEmpty()?null:rows.getFirst();
    }
    private boolean enqueue(Source source) {
        var users=db.queryForList("SELECT status FROM users WHERE id=? FOR SHARE",String.class,source.user());
        var songs=db.query("SELECT deleted_at FROM songs WHERE id=? AND owner_id=? FOR UPDATE",(r,n)->r.getTimestamp(1),source.song(),source.user());
        if (users.isEmpty() || !"ACTIVE".equals(users.getFirst()) || songs.isEmpty() || songs.getFirst()!=null) return false;
        var originals=db.queryForList("SELECT id FROM midi_original_uploads WHERE id=? AND song_id=? AND status='ACCEPTED' FOR UPDATE",UUID.class,source.original(),source.song());
        if (originals.isEmpty()) return false;
        return !db.queryForList("""
                INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status)
                VALUES(?,?,?,?::jsonb,?,'QUEUED') ON CONFLICT DO NOTHING RETURNING id
                """,Long.class,source.song(),source.user(),source.original(),source.timing(),source.duration()).isEmpty();
    }
}
