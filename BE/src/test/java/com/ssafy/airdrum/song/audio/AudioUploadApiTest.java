package com.ssafy.airdrum.song.audio;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@SpringBootTest(properties = "auth.jwt.secret=test-only-jwt-secret-0123456789ab")
@AutoConfigureMockMvc
class AudioUploadApiTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired SourceCleanupWorker cleanup;
    @MockitoBean AudioStore store;
    @MockitoSpyBean AudioProbe probe;
    long user;
    String token;
    Set<String> objects;

    @BeforeEach
    void setup() {
        user =
                db.queryForObject(
                        "INSERT INTO users(nickname) VALUES('audio test') RETURNING id",
                        Long.class);
        token = jwt(user);
        objects = ConcurrentHashMap.newKeySet();
        doAnswer(
                        i -> {
                            objects.add(i.getArgument(0));
                            return null;
                        })
                .when(store)
                .put(anyString(), any(), anyLong(), anyString());
        when(store.exists(anyString())).thenAnswer(i -> objects.contains(i.getArgument(0)));
        doAnswer(
                        i -> {
                            objects.remove(i.getArgument(0));
                            return null;
                        })
                .when(store)
                .delete(anyString());
    }

    @AfterEach
    void clean() {
        db.update(
                "DELETE FROM file_cleanup_tasks WHERE object_key IN (SELECT object_key FROM"
                        + " audio_uploads WHERE user_id=?)",
                user);
        db.update("DELETE FROM audio_uploads WHERE user_id=?", user);
        db.update("DELETE FROM chart_jobs WHERE user_id=?", user);
        db.update("DELETE FROM songs WHERE owner_id=?", user);
        db.update("DELETE FROM users WHERE id=?", user);
    }

    @Test
    void acceptedReplayConflictActiveAndDeleted() throws Exception {
        var key = UUID.randomUUID().toString();
        var bytes = wav();
        request(key, "song", bytes)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("QUEUED"));
        request(key, "song", bytes).andExpect(status().isAccepted());
        request(key, "other", bytes).andExpect(status().isConflict());
        request(UUID.randomUUID().toString(), "song", bytes)
                .andExpect(status().isTooManyRequests());
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM chart_jobs WHERE user_id=?",
                                Integer.class,
                                user))
                .isEqualTo(1);
        assertThat(
                        db.queryForObject(
                                "SELECT content_type FROM audio_uploads WHERE user_id=?",
                                String.class,
                                user))
                .isEqualTo("audio/wav");
        db.update("UPDATE chart_jobs SET status='FAILED',finished_at=now() WHERE user_id=?", user);
        request(key, "song", bytes)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("FAILED"));
        db.update("UPDATE songs SET deleted_at=now() WHERE owner_id=?", user);
        request(key, "song", bytes).andExpect(status().isNotFound());
    }

    @Test
    void replayAndConflictsDoNotDependOnProbeAvailability() throws Exception {
        var key = UUID.randomUUID().toString();
        var bytes = wav();
        request(key, "song", bytes).andExpect(status().isAccepted());
        doThrow(new com.ssafy.airdrum.common.error.BusinessException(AudioErrorCode.UNAVAILABLE))
                .when(probe)
                .inspect(any());
        request(key, "song", bytes).andExpect(status().isAccepted());
        request(key, "other", bytes).andExpect(status().isConflict());
        request(UUID.randomUUID().toString(), "song", bytes)
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void sameKeyConcurrentRequestsCommitOneJob() throws Exception {
        var gate = new java.util.concurrent.CountDownLatch(1);
        var key = UUID.randomUUID().toString();
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var tasks = new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
            for (int i = 0; i < 2; i++)
                tasks.add(
                        pool.submit(
                                () -> {
                                    gate.await();
                                    return request(key, "song", wav())
                                            .andReturn()
                                            .getResponse()
                                            .getStatus();
                                }));
            gate.countDown();
            for (var task : tasks)
                assertThat(task.get(20, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(202);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM chart_jobs WHERE user_id=?",
                                Integer.class,
                                user))
                .isEqualTo(1);
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM audio_uploads WHERE user_id=? AND"
                                        + " status='ACCEPTED'",
                                Integer.class,
                                user))
                .isEqualTo(1);
    }

    @Test
    void storageFailureRetiresAndRecoversLatePut() throws Exception {
        doAnswer(
                        i -> {
                            objects.add(i.getArgument(0));
                            throw new RuntimeException();
                        })
                .when(store)
                .put(anyString(), any(), anyLong(), anyString());
        request(UUID.randomUUID().toString(), "song", wav())
                .andExpect(status().isServiceUnavailable());
        assertThat(
                        db.queryForObject(
                                "SELECT status FROM audio_uploads WHERE user_id=?",
                                String.class,
                                user))
                .isEqualTo("RETIRED");
        cleanup.runOnce();
        assertThat(objects).isEmpty();
        String key =
                db.queryForObject(
                        "SELECT object_key FROM audio_uploads WHERE user_id=?", String.class, user);
        objects.add(key);
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=now() WHERE object_key=?", key);
        cleanup.runOnce();
        assertThat(objects).isEmpty();
    }

    @Test
    void withdrawalDuringPutRetiresObjectWithoutCreatingJob() throws Exception {
        var entered = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        doAnswer(
                        call -> {
                            objects.add(call.getArgument(0));
                            entered.countDown();
                            if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS))
                                throw new IllegalStateException();
                            return null;
                        })
                .when(store)
                .put(anyString(), any(), anyLong(), anyString());
        try (var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var future =
                    pool.submit(
                            () ->
                                    request(UUID.randomUUID().toString(), "song", wav())
                                            .andReturn()
                                            .getResponse()
                                            .getStatus());
            try {
                assertThat(entered.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                db.update(
                        "UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?", user);
            } finally {
                release.countDown();
            }
            assertThat(future.get(15, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(401);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM chart_jobs WHERE user_id=?",
                                Integer.class,
                                user))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT status FROM audio_uploads WHERE user_id=?",
                                String.class,
                                user))
                .isEqualTo("RETIRED");
        cleanup.runOnce();
        assertThat(objects).isEmpty();
    }

    @Test
    void failedJobInsertRollsBackSongAndRetiresUploadedObject() throws Exception {
        String name = "audio_test_fail_" + user;
        db.execute(
                "CREATE FUNCTION "
                        + name
                        + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = "
                        + user
                        + " THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$");
        db.execute(
                "CREATE TRIGGER "
                        + name
                        + " BEFORE INSERT ON chart_jobs FOR EACH ROW EXECUTE FUNCTION "
                        + name
                        + "()");
        try {
            request(UUID.randomUUID().toString(), "song", wav())
                    .andExpect(status().isServiceUnavailable());
        } finally {
            db.execute("DROP TRIGGER " + name + " ON chart_jobs");
            db.execute("DROP FUNCTION " + name + "()");
        }
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM songs WHERE owner_id=?", Integer.class, user))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM chart_jobs WHERE user_id=?",
                                Integer.class,
                                user))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT status FROM audio_uploads WHERE user_id=?",
                                String.class,
                                user))
                .isEqualTo("RETIRED");
        cleanup.runOnce();
        assertThat(objects).isEmpty();
    }

    @Test
    void expiredReceiptIsRecoveredAndAcceptedObjectIsNeverClaimed() throws Exception {
        var id = UUID.randomUUID();
        String expired = "source-audio/" + id;
        db.update(
                "INSERT INTO"
                    + " audio_uploads(id,user_id,object_key,content_type,size_bytes,sha256,duration_ms,status,created_at,expires_at)"
                    + " VALUES(?,?,?,'audio/wav',1,?,1,'UPLOADING',now()-interval '10"
                    + " minutes',now()-interval '1 minute')",
                id,
                user,
                expired,
                "0".repeat(64));
        objects.add(expired);
        request(UUID.randomUUID().toString(), "song", wav()).andExpect(status().isAccepted());
        String accepted =
                db.queryForObject(
                        "SELECT object_key FROM audio_uploads WHERE user_id=? AND"
                            + " status='ACCEPTED'",
                        String.class,
                        user);
        db.update(
                "INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES(?,'SOURCE')",
                accepted);
        cleanup.runOnce();
        assertThat(objects).containsExactly(accepted);
        assertThat(
                        db.queryForObject(
                                "SELECT status FROM audio_uploads WHERE id=?", String.class, id))
                .isEqualTo("RETIRED");
    }

    @Test
    void differentKeysRacingToAcceptCreateOnlyOneJob() throws Exception {
        var entered = new java.util.concurrent.CountDownLatch(2);
        var release = new java.util.concurrent.CountDownLatch(1);
        doAnswer(
                        call -> {
                            objects.add(call.getArgument(0));
                            entered.countDown();
                            if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS))
                                throw new IllegalStateException();
                            return null;
                        })
                .when(store)
                .put(anyString(), any(), anyLong(), anyString());
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var one =
                    pool.submit(
                            () ->
                                    request(UUID.randomUUID().toString(), "song", wav())
                                            .andReturn()
                                            .getResponse()
                                            .getStatus());
            var two =
                    pool.submit(
                            () ->
                                    request(UUID.randomUUID().toString(), "song", wav())
                                            .andReturn()
                                            .getResponse()
                                            .getStatus());
            try {
                assertThat(entered.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            } finally {
                release.countDown();
            }
            assertThat(
                            java.util.List.of(
                                    one.get(15, java.util.concurrent.TimeUnit.SECONDS),
                                    two.get(15, java.util.concurrent.TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(202, 429);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM chart_jobs WHERE user_id=?",
                                Integer.class,
                                user))
                .isEqualTo(1);
        assertThat(
                        db.queryForObject(
                                "SELECT count(*) FROM audio_uploads WHERE user_id=? AND"
                                    + " status='RETIRED'",
                                Integer.class,
                                user))
                .isEqualTo(1);
        cleanup.runOnce();
        assertThat(objects).hasSize(1);
    }

    @Test
    void rejectsSpoofAndBadKey() throws Exception {
        request(UUID.randomUUID().toString(), "song", new byte[] {1, 2, 3})
                .andExpect(status().isUnprocessableEntity());
        request("bad", "song", wav()).andExpect(status().isBadRequest());
    }

    private org.springframework.test.web.servlet.ResultActions request(
            String key, String title, byte[] bytes) throws Exception {
        return mvc.perform(
                multipart("/api/v1/songs/audio")
                        .file(new MockMultipartFile("file", "fake.mp3", "audio/mpeg", bytes))
                        .param("title", title)
                        .header("Idempotency-Key", key)
                        .header("Authorization", "Bearer " + token));
    }

    static byte[] wav() {
        int n = 16000;
        ByteBuffer b = ByteBuffer.allocate(44 + n).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII))
                .putInt(36 + n)
                .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII))
                .putInt(16)
                .putShort((short) 1)
                .putShort((short) 1)
                .putInt(8000)
                .putInt(16000)
                .putShort((short) 2)
                .putShort((short) 16)
                .put("data".getBytes(StandardCharsets.US_ASCII))
                .putInt(n);
        return b.array();
    }

    static String jwt(long id) {
        try {
            var enc = java.util.Base64.getUrlEncoder().withoutPadding();
            String h =
                    enc.encodeToString(
                            "{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
            String c =
                    enc.encodeToString(
                            ("{\"iss\":\"airdrum-api\",\"sub\":\""
                                            + id
                                            + "\",\"iat\":"
                                            + Instant.now().getEpochSecond()
                                            + ",\"exp\":"
                                            + Instant.now().plusSeconds(1800).getEpochSecond()
                                            + "}")
                                    .getBytes(StandardCharsets.UTF_8));
            var mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(
                    new javax.crypto.spec.SecretKeySpec(
                            "test-only-jwt-secret-0123456789ab".getBytes(StandardCharsets.UTF_8),
                            "HmacSHA256"));
            return h
                    + "."
                    + c
                    + "."
                    + enc.encodeToString(
                            mac.doFinal((h + "." + c).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
