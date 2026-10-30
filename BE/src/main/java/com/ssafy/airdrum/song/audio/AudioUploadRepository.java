package com.ssafy.airdrum.song.audio;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

@Repository
public class AudioUploadRepository {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final UserRepository users;

    public AudioUploadRepository(
            JdbcTemplate db, PlatformTransactionManager manager, UserRepository users) {
        this.db = db;
        this.tx = new TransactionTemplate(manager);
        this.tx.setTimeout(15);
        this.users = users;
    }

    public record Response(long jobId, long songId, String status) {}

    public record Receipt(UUID id, String key) {}

    public record Outcome(Response response, AudioErrorCode error) {}

    public record Begin(Receipt receipt, Outcome outcome) {}

    public record Metadata(String mime, long size, String sha, int durationMs) {}

    private void lock(long user) {
        db.execute("SET LOCAL lock_timeout='3s'");
        db.execute("SET LOCAL statement_timeout='10s'");
        var u = users.findByIdForShare(user);
        if (u.isEmpty() || u.get().getStatus() != UserStatus.ACTIVE)
            throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        db.queryForObject("SELECT pg_advisory_xact_lock(?)", Object.class, user);
    }

    private Outcome prior(long user, UUID key, String hash) {
        var rows =
                db.query(
                        "SELECT j.id,j.song_id,j.status,j.request_hash,s.deleted_at IS NOT NULL"
                            + " FROM chart_jobs j JOIN songs s ON s.id=j.song_id WHERE j.user_id=?"
                            + " AND j.idempotency_key=?",
                        (r, n) ->
                                new Object[] {
                                    r.getLong(1),
                                    r.getLong(2),
                                    r.getString(3),
                                    r.getString(4),
                                    r.getBoolean(5)
                                },
                        user,
                        key.toString());
        if (rows.isEmpty()) return null;
        var a = rows.getFirst();
        if ((boolean) a[4]) return new Outcome(null, AudioErrorCode.NOT_FOUND);
        if (!hash.equals(a[3])) return new Outcome(null, AudioErrorCode.CONFLICT);
        return new Outcome(new Response((long) a[0], (long) a[1], (String) a[2]), null);
    }

    private boolean active(long user) {
        return Boolean.TRUE.equals(
                db.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM chart_jobs WHERE user_id=? AND status IN"
                            + " ('QUEUED','SEPARATING','TRANSCRIBING'))",
                        Boolean.class,
                        user));
    }

    public Outcome preflight(long user, UUID key, String hash) {
        return tx.execute(
                s -> {
                    lock(user);
                    var old = prior(user, key, hash);
                    if (old != null) return old;
                    if (active(user)) return new Outcome(null, AudioErrorCode.BUSY);
                    return null;
                });
    }

    public Begin begin(long user, UUID key, String hash, Metadata m) {
        return tx.execute(
                s -> {
                    lock(user);
                    var old = prior(user, key, hash);
                    if (old != null) return new Begin(null, old);
                    if (active(user))
                        return new Begin(null, new Outcome(null, AudioErrorCode.BUSY));
                    var id = UUID.randomUUID();
                    String object = "source-audio/" + id;
                    db.update(
                            "INSERT INTO"
                                + " audio_uploads(id,user_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at)"
                                + " VALUES(?,?,?,?,?,?,?,'UPLOADING',now()+interval '5 minutes')",
                            id,
                            user,
                            object,
                            m.mime(),
                            m.size(),
                            m.sha(),
                            m.durationMs());
                    return new Begin(new Receipt(id, object), null);
                });
    }

    public Outcome accept(long user, UUID key, String hash, String title, String artist, UUID id) {
        return tx.execute(
                s -> {
                    lock(user);
                    var row =
                            db
                                    .query(
                                            "SELECT object_key,status,expires_at<=now(),duration_ms"
                                                + " FROM audio_uploads WHERE id=? AND user_id=? FOR"
                                                + " UPDATE",
                                            (r, n) ->
                                                    new Object[] {
                                                        r.getString(1),
                                                        r.getString(2),
                                                        r.getBoolean(3),
                                                        r.getInt(4)
                                                    },
                                            id,
                                            user)
                                    .stream()
                                    .findFirst()
                                    .orElse(null);
                    if (row == null) return new Outcome(null, AudioErrorCode.UNAVAILABLE);
                    var old = prior(user, key, hash);
                    if (old != null) {
                        retire(id, (String) row[0]);
                        return old;
                    }
                    if (active(user)) {
                        retire(id, (String) row[0]);
                        return new Outcome(null, AudioErrorCode.BUSY);
                    }
                    if (!row[1].equals("UPLOADING") || (boolean) row[2]) {
                        retire(id, (String) row[0]);
                        return new Outcome(null, AudioErrorCode.UNAVAILABLE);
                    }
                    Long song =
                            db.queryForObject(
                                    "INSERT INTO"
                                        + " songs(owner_id,title,artist,source,status,duration_ms)"
                                        + " VALUES(?,?,?,'AUDIO','PROCESSING',?) RETURNING id",
                                    Long.class,
                                    user,
                                    title,
                                    artist,
                                    row[3]);
                    Long job =
                            db.queryForObject(
                                    "INSERT INTO"
                                        + " chart_jobs(song_id,user_id,status,source_key,idempotency_key,request_hash)"
                                        + " VALUES(?,?,'QUEUED',?,?,?) RETURNING id",
                                    Long.class,
                                    song,
                                    user,
                                    row[0],
                                    key.toString(),
                                    hash);
                    db.update(
                            "UPDATE audio_uploads SET"
                                + " job_id=?,status='ACCEPTED',updated_at=clock_timestamp() WHERE"
                                + " id=?",
                            job,
                            id);
                    return new Outcome(new Response(job, song, "QUEUED"), null);
                });
    }

    public Response accepted(UUID id) {
        return db
                .query(
                        "SELECT j.id,j.song_id,j.status FROM audio_uploads a JOIN chart_jobs j ON"
                            + " j.id=a.job_id JOIN songs s ON s.id=j.song_id WHERE a.id=? AND"
                            + " a.status='ACCEPTED' AND s.deleted_at IS NULL",
                        (r, n) -> new Response(r.getLong(1), r.getLong(2), r.getString(3)),
                        id)
                .stream()
                .findFirst()
                .orElse(null);
    }

    public void settle(UUID id) {
        tx.executeWithoutResult(
                s -> {
                    var a =
                            db
                                    .query(
                                            "SELECT object_key,status FROM audio_uploads WHERE id=?"
                                                + " FOR UPDATE",
                                            (r, n) -> new String[] {r.getString(1), r.getString(2)},
                                            id)
                                    .stream()
                                    .findFirst()
                                    .orElse(null);
                    if (a != null && !a[1].equals("ACCEPTED")) retire(id, a[0]);
                });
    }

    public void recover() {
        var ids =
                db.queryForList(
                        "SELECT id FROM audio_uploads WHERE status='UPLOADING' AND"
                            + " expires_at<=now() ORDER BY expires_at,id LIMIT 100",
                        UUID.class);
        for (var id : ids)
            tx.executeWithoutResult(
                    s -> {
                        var a =
                                db
                                        .query(
                                                "SELECT object_key,status,expires_at<=now() FROM"
                                                    + " audio_uploads WHERE id=? FOR UPDATE",
                                                (r, n) ->
                                                        new Object[] {
                                                            r.getString(1),
                                                            r.getString(2),
                                                            r.getBoolean(3)
                                                        },
                                                id)
                                        .stream()
                                        .findFirst()
                                        .orElse(null);
                        if (a != null && a[1].equals("UPLOADING") && (boolean) a[2])
                            retire(id, (String) a[0]);
                    });
    }

    private void retire(UUID id, String object) {
        if (Boolean.TRUE.equals(
                db.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM audio_uploads WHERE id=? AND"
                            + " status='ACCEPTED')",
                        Boolean.class,
                        id))) return;
        db.update(
                "UPDATE audio_uploads SET"
                    + " status='RETIRED',job_id=NULL,retired_at=coalesce(retired_at,clock_timestamp()),updated_at=clock_timestamp()"
                    + " WHERE id=? AND status<>'ACCEPTED'",
                id);
        db.update(
                "INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES(?,'SOURCE') ON"
                    + " CONFLICT(object_key) DO UPDATE SET"
                    + " status='PENDING',deleted_at=NULL,next_attempt_at=clock_timestamp(),updated_at=GREATEST(clock_timestamp(),file_cleanup_tasks.updated_at+interval"
                    + " '1 microsecond') WHERE file_cleanup_tasks.file_role='SOURCE'",
                object);
    }
}
