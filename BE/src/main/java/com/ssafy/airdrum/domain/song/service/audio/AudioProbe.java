package com.ssafy.airdrum.domain.song.service.audio;

import com.ssafy.airdrum.domain.song.exception.AudioErrorCode;
import com.ssafy.airdrum.global.media.AudioDuration;
import com.ssafy.airdrum.global.error.BusinessException;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.*;

@Component
public class AudioProbe {
    @FunctionalInterface
    interface Launcher {
        Process start(java.util.List<String> args) throws java.io.IOException;
    }

    private final String executable;
    private final JsonMapper json;
    private final Launcher launcher;
    private final Duration timeout;

    @org.springframework.beans.factory.annotation.Autowired
    public AudioProbe(@Value("${audio.ffprobe-path:ffprobe}") String executable, JsonMapper json) {
        this(executable, json, args -> new ProcessBuilder(args).redirectErrorStream(true).start());
    }

    AudioProbe(String executable, JsonMapper json, Launcher launcher) {
        this(executable, json, launcher, Duration.ofSeconds(10));
    }

    AudioProbe(String executable, JsonMapper json, Launcher launcher, Duration timeout) {
        this.executable = executable;
        this.json = json;
        this.launcher = launcher;
        this.timeout = timeout;
    }

    public record Info(String mime, int durationMs) {}

    public Info inspect(Path file) {
        Process process;
        try {
            process =
                    launcher.start(
                            java.util.List.of(
                                    executable,
                                    "-v",
                                    "error",
                                    "-protocol_whitelist",
                                    "file",
                                    "-format_whitelist",
                                    "mp3,wav,mov,ogg",
                                    "-show_entries",
                                    "format=format_name,duration:stream=codec_type,codec_name:stream_disposition=attached_pic",
                                    "-of",
                                    "json",
                                    file.toAbsolutePath().toString()));
        } catch (java.io.IOException e) {
            throw new BusinessException(AudioErrorCode.UNAVAILABLE);
        }
        var output = new FutureTask<byte[]>(() -> readBounded(process.getInputStream()));
        Thread.ofVirtual().start(output);
        try {
            if (!process.waitFor(timeout.toNanos(), TimeUnit.NANOSECONDS)) {
                throw new BusinessException(AudioErrorCode.UNAVAILABLE);
            }
            byte[] bytes = output.get(2, TimeUnit.SECONDS);
            if (process.exitValue() != 0) throw new BusinessException(AudioErrorCode.UNSUPPORTED);
            var root = json.readTree(bytes);
            var format = root.path("format");
            String name = format.path("format_name").asText();
            String mime =
                    switch (name) {
                        case "mp3" -> "audio/mpeg";
                        case "wav" -> "audio/wav";
                        case "mov,mp4,m4a,3gp,3g2,mj2" -> "audio/mp4";
                        case "ogg" -> "audio/ogg";
                        default -> throw new BusinessException(AudioErrorCode.UNSUPPORTED);
                    };
            boolean audio = false;
            boolean newFormat = mime.equals("audio/mp4") || mime.equals("audio/ogg");
            for (var stream : root.path("streams")) {
                var codec = stream.path("codec_name");
                String type = stream.path("codec_type").asText();
                if ("audio".equals(type)
                        && codec.isTextual()
                        && !codec.asText().isBlank()
                        && !"unknown".equalsIgnoreCase(codec.asText())) {
                    if (newFormat && !(mime.equals("audio/mp4")
                            ? java.util.Set.of("aac", "alac").contains(codec.asText())
                            : "opus".equals(codec.asText()))) {
                        throw new BusinessException(AudioErrorCode.UNSUPPORTED);
                    }
                    audio = true;
                } else if (newFormat && !("video".equals(type)
                        && stream.path("disposition").path("attached_pic").asInt() == 1)) {
                    throw new BusinessException(AudioErrorCode.UNSUPPORTED);
                }
            }
            if (!audio) throw new BusinessException(AudioErrorCode.UNSUPPORTED);
            try {
                return new Info(mime, AudioDuration.milliseconds(format.path("duration").asText()));
            } catch (IllegalArgumentException | ArithmeticException e) {
                throw new BusinessException(AudioErrorCode.UNSUPPORTED);
            }
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new BusinessException(AudioErrorCode.UNAVAILABLE);
        } finally {
            process.descendants().forEach(child -> child.destroyForcibly());
            if (process.isAlive()) process.destroyForcibly();
            output.cancel(true);
            // 스트림 읽기가 OS에서 막힌 경우에도 요청 스레드는 대기하지 않는다.
            Thread.ofVirtual()
                    .start(
                            () -> {
                                try {
                                    process.getInputStream().close();
                                } catch (java.io.IOException ignored) {
                                }
                                try {
                                    process.getOutputStream().close();
                                } catch (java.io.IOException ignored) {
                                }
                                try {
                                    process.getErrorStream().close();
                                } catch (java.io.IOException ignored) {
                                }
                            });
        }
    }

    private byte[] readBounded(InputStream input) throws Exception {
        var out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = input.read(buf)) != -1) {
            if (out.size() + n > 65536) throw new IllegalStateException("probe output too large");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }
}
