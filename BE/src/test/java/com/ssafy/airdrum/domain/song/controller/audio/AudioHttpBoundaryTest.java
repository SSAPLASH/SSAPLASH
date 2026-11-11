package com.ssafy.airdrum.domain.song.controller.audio;

import com.ssafy.airdrum.domain.song.storage.audio.AudioStore;
import com.ssafy.airdrum.support.SignupConsentFixtures;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "auth.jwt.secret=test-only-jwt-secret-0123456789ab")
class AudioHttpBoundaryTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @MockitoBean AudioStore store;
    @MockitoBean com.ssafy.airdrum.domain.play.storage.PlayRawStore rawStore;
    @TempDir Path dir;
    long user;
    String token;
    UUID play;

    @BeforeEach
    void setup() {
        user =
                db.queryForObject(
                        "INSERT INTO users(nickname) VALUES('http boundary') RETURNING id",
                        Long.class);
        SignupConsentFixtures.complete(db, user);
        token = AudioUploadApiTest.jwt(user);
        play = UUID.randomUUID();
        db.update(
                "INSERT INTO"
                    + " play_sessions(id,user_id,mode,input_source,payload_schema_version,payload_hash,started_at,ended_at)"
                    + " VALUES(?,?,'FREE','KEYBOARD',1,?,now(),now())",
                play,
                user,
                "0".repeat(64));
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
        db.update("DELETE FROM play_raw_uploads WHERE original_play_id=?", play);
        db.update("DELETE FROM play_sessions WHERE id=?", play);
        db.update("DELETE FROM users WHERE id=?", user);
    }

    @Test
    void realHttpPreservesBothFileLimits() throws Exception {
        Path audio = dir.resolve("audio.wav");
        wav(audio, 50L * 1024 * 1024);
        assertThat(send("/api/v1/songs/audio", audio, true)).isEqualTo(202);
        Path tooBig = dir.resolve("oversized.wav");
        wav(tooBig, 50L * 1024 * 1024 + 1);
        assertThat(send("/api/v1/songs/audio", tooBig, true)).isEqualTo(413);
        Path raw = dir.resolve("raw.gz");
        try (var f = new java.io.RandomAccessFile(raw.toFile(), "rw")) {
            f.setLength(20L * 1024 * 1024 + 1);
        }
        assertThat(send("/api/v1/plays/" + play + "/raw", raw, false)).isEqualTo(413);
    }

    @Test
    void rawRequestRequiresKnownLengthAndKnownLengthStillSucceeds() throws Exception {
        Path raw = dir.resolve("valid.gz");
        try (var out = new java.util.zip.GZIPOutputStream(Files.newOutputStream(raw))) {
            out.write(
                    ("{\"schemaVersion\":1,\"playId\":\""
                                    + play
                                    + "\",\"clockContext\":{\"sensorTickHz\":1000,\"browserClock\":\"PERFORMANCE_NOW\",\"audioClock\":\"SONG_POSITION\"},\"hits\":[]}")
                            .getBytes(StandardCharsets.UTF_8));
        }
        assertThat(send("/api/v1/plays/" + play + "/raw", raw, false)).isEqualTo(204);
        String boundary = "chunk" + UUID.randomUUID();
        byte[] bytes =
                ("--"
                                + boundary
                                + "\r\n"
                                + "Content-Disposition: form-data; name=\"file\";"
                                + " filename=\"x.gz\"\r\n"
                                + "Content-Type: application/gzip\r\n\r\n"
                                + "x\r\n"
                                + "--"
                                + boundary
                                + "--\r\n")
                        .getBytes(StandardCharsets.UTF_8);
        var body =
                HttpRequest.BodyPublishers.ofInputStream(
                        () -> new java.io.ByteArrayInputStream(bytes));
        var request =
                HttpRequest.newBuilder(
                                URI.create(
                                        "http://127.0.0.1:"
                                                + port
                                                + "/api/v1/plays/"
                                                + play
                                                + "/raw"))
                        .timeout(java.time.Duration.ofSeconds(30))
                        .header("Authorization", "Bearer " + token)
                        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                        .POST(body)
                        .build();
        var response =
                HttpClient.newBuilder()
                        .version(HttpClient.Version.HTTP_1_1)
                        .build()
                        .send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(411);
        assertThat(response.body()).contains("PLAY_RAW_LENGTH_REQUIRED");
    }

    void wav(Path path, long size) throws Exception {
        try (var f = new java.io.RandomAccessFile(path.toFile(), "rw")) {
            f.setLength(size);
            ByteBuffer b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
            b.put("RIFF".getBytes(StandardCharsets.US_ASCII))
                    .putInt((int) size - 8)
                    .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII))
                    .putInt(16)
                    .putShort((short) 1)
                    .putShort((short) 2)
                    .putInt(44100)
                    .putInt(176400)
                    .putShort((short) 4)
                    .putShort((short) 16)
                    .put("data".getBytes(StandardCharsets.US_ASCII))
                    .putInt((int) size - 44);
            f.seek(0);
            f.write(b.array());
        }
    }

    int send(String path, Path file, boolean audio) throws Exception {
        String boundary = "boundary" + UUID.randomUUID();
        String prefix =
                "--"
                        + boundary
                        + "\r\n"
                        + "Content-Disposition: form-data; name=\"file\"; filename=\"x\"\r\n"
                        + "Content-Type: application/octet-stream\r\n\r\n";
        String suffix =
                "\r\n"
                        + (audio
                                ? "--"
                                        + boundary
                                        + "\r\n"
                                        + "Content-Disposition: form-data; name=\"title\"\r\n\r\n"
                                        + "song\r\n"
                                : "")
                        + "--"
                        + boundary
                        + "--\r\n";
        var body =
                HttpRequest.BodyPublishers.concat(
                        HttpRequest.BodyPublishers.ofString(prefix),
                        HttpRequest.BodyPublishers.ofFile(file),
                        HttpRequest.BodyPublishers.ofString(suffix));
        var request =
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                        .timeout(java.time.Duration.ofSeconds(60))
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                        .POST(body)
                        .build();
        return HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .build()
                .send(request, HttpResponse.BodyHandlers.discarding())
                .statusCode();
    }
}
