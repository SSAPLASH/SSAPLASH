package com.ssafy.airdrum.song.audio;

import static org.assertj.core.api.Assertions.*;

import com.ssafy.airdrum.common.error.BusinessException;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import tools.jackson.databind.json.JsonMapper;

import java.nio.file.*;

class AudioProbeTest {
    @TempDir Path dir;

    @Test
    void actualMp3AndWavAreReadRegardlessOfClientFilename() throws Exception {
        var probe =
                new AudioProbe(
                        System.getenv().getOrDefault("AUDIO_FFPROBE_PATH", "ffprobe"),
                        JsonMapper.builder().build());
        Path wav = dir.resolve("wrong.mp3");
        Files.write(wav, AudioUploadApiTest.wav());
        assertThat(probe.inspect(wav).mime()).isEqualTo("audio/wav");
        Path mp3 = dir.resolve("wrong.wav");
        try (var in = getClass().getResourceAsStream("/audio-test.mp3")) {
            Files.copy(in, mp3);
        }
        assertThat(probe.inspect(mp3).mime()).isEqualTo("audio/mpeg");
    }

    @Test
    void durationBoundaryAndNetworkPlaylistAreRejected() throws Exception {
        var probe =
                new AudioProbe(
                        System.getenv().getOrDefault("AUDIO_FFPROBE_PATH", "ffprobe"),
                        JsonMapper.builder().build());
        Path valid = dir.resolve("600.wav");
        long data = 8000L * 2 * 600;
        wav(valid, data);
        assertThat(probe.inspect(valid).durationMs()).isEqualTo(600000);
        Path tooLong = dir.resolve("over.wav");
        wav(tooLong, data + 16);
        assertThatThrownBy(() -> probe.inspect(tooLong))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AudioErrorCode.UNSUPPORTED));
        var received = new java.util.concurrent.atomic.AtomicInteger();
        var server =
                com.sun.net.httpserver.HttpServer.create(
                        new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                exchange -> {
                    received.incrementAndGet();
                    exchange.sendResponseHeaders(200, -1);
                    exchange.close();
                });
        server.start();
        try {
            Path playlist = dir.resolve("playlist.wav");
            Files.writeString(
                    playlist,
                    "#EXTM3U\nhttp://127.0.0.1:" + server.getAddress().getPort() + "/file.wav\n");
            assertThatThrownBy(() -> probe.inspect(playlist))
                    .isInstanceOfSatisfying(
                            BusinessException.class,
                            e ->
                                    assertThat(e.getErrorCode())
                                            .isEqualTo(AudioErrorCode.UNSUPPORTED));
            assertThat(received.get()).isZero();
        } finally {
            server.stop(0);
        }
    }

    private void wav(Path file, long data) throws Exception {
        try (var f = new java.io.RandomAccessFile(file.toFile(), "rw")) {
            f.setLength(data + 44);
            var b = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            b.put("RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII))
                    .putInt((int) data + 36)
                    .put("WAVEfmt ".getBytes(java.nio.charset.StandardCharsets.US_ASCII))
                    .putInt(16)
                    .putShort((short) 1)
                    .putShort((short) 1)
                    .putInt(8000)
                    .putInt(16000)
                    .putShort((short) 2)
                    .putShort((short) 16)
                    .put("data".getBytes(java.nio.charset.StandardCharsets.US_ASCII))
                    .putInt((int) data);
            f.seek(0);
            f.write(b.array());
        }
    }

    @Test
    void stuckProcessAndExcessOutputCannotHoldRequestForever() throws Exception {
        boolean windows = System.getProperty("os.name").toLowerCase().contains("win");
        var probe =
                new AudioProbe(
                        "unused",
                        JsonMapper.builder().build(),
                        args ->
                                windows
                                        ? new ProcessBuilder(
                                                        "powershell.exe",
                                                        "-NoProfile",
                                                        "-Command",
                                                        "[Console]::Out.Write('x' * 1000000);"
                                                                + " Start-Sleep -Seconds 30")
                                                .redirectErrorStream(true)
                                                .start()
                                        : new ProcessBuilder(
                                                        "sh",
                                                        "-c",
                                                        "yes x | head -c 1000000; sleep 30")
                                                .redirectErrorStream(true)
                                                .start());
        long start = System.nanoTime();
        assertThatThrownBy(() -> probe.inspect(dir.resolve("x")))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AudioErrorCode.UNAVAILABLE));
        assertThat(java.time.Duration.ofNanos(System.nanoTime() - start))
                .isLessThan(java.time.Duration.ofSeconds(15));
    }

    @Test
    void timeoutTerminatesChildProcess() throws Exception {
        boolean windows = System.getProperty("os.name").toLowerCase().contains("win");
        var children =
                new java.util.concurrent.atomic.AtomicReference<java.util.List<ProcessHandle>>();
        var probe =
                new AudioProbe(
                        "unused",
                        JsonMapper.builder().build(),
                        args -> {
                            Process process =
                                    windows
                                            ? new ProcessBuilder(
                                                            "cmd.exe",
                                                            "/c",
                                                            "ping -n 30 127.0.0.1 >nul")
                                                    .start()
                                            : new ProcessBuilder("sh", "-c", "sleep 30 & wait")
                                                    .start();
                            try {
                                Thread.sleep(500);
                            } catch (InterruptedException ex) {
                                Thread.currentThread().interrupt();
                                throw new java.io.IOException(ex);
                            }
                            children.set(process.descendants().toList());
                            return process;
                        });
        assertThatThrownBy(() -> probe.inspect(dir.resolve("x")))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AudioErrorCode.UNAVAILABLE));
        assertThat(children.get()).isNotEmpty();
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(3).toNanos();
        while (children.get().stream().anyMatch(ProcessHandle::isAlive)
                && System.nanoTime() < deadline) Thread.sleep(25);
        assertThat(children.get()).noneMatch(ProcessHandle::isAlive);
    }

    @Test
    void missingOrUnknownCodecIsRejected() {
        for (String codec :
                new String[] {"", ",\"codec_name\":null", ",\"codec_name\":\"unknown\""}) {
            String json =
                    "{\"format\":{\"format_name\":\"wav\",\"duration\":\"1\"},\"streams\":[{\"codec_type\":\"audio\""
                            + codec
                            + "}]}";
            var probe =
                    new AudioProbe(
                            "unused",
                            JsonMapper.builder().build(),
                            args -> new CompletedProcess(json));
            assertThatThrownBy(() -> probe.inspect(dir.resolve("x")))
                    .isInstanceOfSatisfying(
                            BusinessException.class,
                            e ->
                                    assertThat(e.getErrorCode())
                                            .isEqualTo(AudioErrorCode.UNSUPPORTED));
        }
    }

    static final class CompletedProcess extends Process {
        private final java.io.InputStream output;

        CompletedProcess(String value) {
            output =
                    new java.io.ByteArrayInputStream(
                            value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }

        @Override
        public java.io.OutputStream getOutputStream() {
            return java.io.OutputStream.nullOutputStream();
        }

        @Override
        public java.io.InputStream getInputStream() {
            return output;
        }

        @Override
        public java.io.InputStream getErrorStream() {
            return java.io.InputStream.nullInputStream();
        }

        @Override
        public int waitFor() {
            return 0;
        }

        @Override
        public boolean waitFor(long timeout, java.util.concurrent.TimeUnit unit) {
            return true;
        }

        @Override
        public int exitValue() {
            return 0;
        }

        @Override
        public void destroy() {}

        @Override
        public boolean isAlive() {
            return false;
        }

        @Override
        public java.util.stream.Stream<ProcessHandle> descendants() {
            return java.util.stream.Stream.empty();
        }
    }

    @Test
    void missingToolFailsSafely() {
        var p = new AudioProbe(dir.resolve("not-present").toString(), JsonMapper.builder().build());
        assertThatThrownBy(() -> p.inspect(dir.resolve("x")))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AudioErrorCode.UNAVAILABLE));
    }
}
