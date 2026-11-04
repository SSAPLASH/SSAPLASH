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
    void acceptsRealMpeg4AudioAndOggOpusButRejectsOtherContainersAndVideo() throws Exception {
        var probe = new AudioProbe(System.getenv().getOrDefault("AUDIO_FFPROBE_PATH", "ffprobe"), JsonMapper.builder().build());
        // fixture는 FFmpeg 8.1의 sine(440Hz, 1초)·color 소스로 직접 생성한 합성 음원이다.
        for (var entry : java.util.Map.of("sample-aac.m4a", "audio/mp4", "sample-alac.m4a", "audio/mp4",
                "sample-cover.m4a", "audio/mp4", "sample-opus.opus", "audio/ogg").entrySet()) {
            Path file = fixture(entry.getKey(), "misleading.wav");
            assertThat(probe.inspect(file).mime()).as(entry.getKey()).isEqualTo(entry.getValue());
        }
        for (String name : java.util.List.of("sample-vorbis.ogg", "sample-webm.webm", "sample-video.mp4", "sample-video-only.mp4")) {
            Path file = fixture(name, "misleading.m4a");
            assertThatThrownBy(() -> probe.inspect(file)).as(name)
                    .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(AudioErrorCode.UNSUPPORTED));
        }
    }

    private Path fixture(String resource, String filename) throws Exception {
        Path file = dir.resolve(filename);
        try (var in = getClass().getResourceAsStream("/audio-formats/" + resource)) {
            Files.copy(java.util.Objects.requireNonNull(in), file, StandardCopyOption.REPLACE_EXISTING);
        }
        return file;
    }

    @Test
    void readsExactDecimalMillisecondsFromReal48KhzInputs() throws Exception {
        var probe = new AudioProbe(System.getenv().getOrDefault("AUDIO_FFPROBE_PATH", "ffprobe"), JsonMapper.builder().build());
        Path wav = dir.resolve("4.001.wav");
        wav(wav, 48000L * 4 * 4 + 48L * 4, 48000, 2);
        assertThat(probe.inspect(wav).durationMs()).isEqualTo(4001);
        Path mp3 = dir.resolve("4.001.mp3");
        try (var in = getClass().getResourceAsStream("/worker/duration-4001ms-48khz.mp3")) { Files.copy(in, mp3); }
        // MP3 gapless 메타 해석은 ffprobe 버전에 따라 다르므로 실행 중인 도구의
        // format.duration을 독립적으로 읽어 십진수 올림한 값과 비교한다.
        var executable=System.getenv().getOrDefault("AUDIO_FFPROBE_PATH", "ffprobe");
        var process=new ProcessBuilder(executable, "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", mp3.toString()).redirectErrorStream(true).start();
        boolean finished=process.waitFor(10, java.util.concurrent.TimeUnit.SECONDS);
        if (!finished) process.destroyForcibly();
        assertThat(finished).isTrue();
        assertThat(process.exitValue()).isZero();
        String seconds=new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).trim();
        int expected=new java.math.BigDecimal(seconds).movePointRight(3).setScale(0, java.math.RoundingMode.CEILING).intValueExact();
        assertThat(expected).isBetween(1,600000);
        assertThat(probe.inspect(mp3).durationMs()).isEqualTo(expected);
    }

    @Test
    void rejectsInvalidProbeDurationAsUnsupported() {
        for (String value : new String[] {"NaN", "Infinity", "-Infinity", "0", "-1", "600.000001", "N/A"}) {
            String output = "{\"format\":{\"format_name\":\"wav\",\"duration\":\"" + value
                    + "\"},\"streams\":[{\"codec_type\":\"audio\",\"codec_name\":\"pcm_s16le\"}]}";
            var probe = new AudioProbe("unused", JsonMapper.builder().build(), args -> new CompletedProcess(output));
            assertThatThrownBy(() -> probe.inspect(dir.resolve("x")))
                    .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(AudioErrorCode.UNSUPPORTED));
        }
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

    private void wav(Path file, long data) throws Exception { wav(file, data, 8000, 1); }

    private void wav(Path file, long data, int rate, int channels) throws Exception {
        try (var f = new java.io.RandomAccessFile(file.toFile(), "rw")) {
            f.setLength(data + 44);
            var b = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            b.put("RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII))
                    .putInt((int) data + 36)
                    .put("WAVEfmt ".getBytes(java.nio.charset.StandardCharsets.US_ASCII))
                    .putInt(16)
                    .putShort((short) 1)
                    .putShort((short) channels)
                    .putInt(rate)
                    .putInt(rate * channels * 2)
                    .putShort((short) (channels * 2))
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
