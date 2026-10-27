package com.ssafy.airdrum.song.audio;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.web.PlayMultipartConfiguration.SpoolDirectory;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;

@Service
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class AudioUploadService {
    private static final long LIMIT = 50L * 1024 * 1024;
    private final AudioProbe probe;
    private final AudioStore store;
    private final AudioUploadRepository db;
    private final SpoolDirectory spool;

    public AudioUploadService(
            AudioProbe probe, AudioStore store, AudioUploadRepository db, SpoolDirectory spool) {
        this.probe = probe;
        this.store = store;
        this.db = db;
        this.spool = spool;
    }

    public AudioUploadRepository.Response upload(
            long user, String keyText, String title, String artist, MultipartFile file) {
        UUID key;
        try {
            key = UUID.fromString(keyText);
            if (!key.toString().equals(keyText)) throw new IllegalArgumentException();
        } catch (Exception e) {
            throw new BusinessException(AudioErrorCode.INVALID);
        }
        title = title == null ? null : title.strip();
        artist = artist == null ? null : artist.strip();
        if (artist != null && artist.isEmpty()) artist = null;
        if (title == null
                || title.isEmpty()
                || title.length() > 100
                || (artist != null && artist.length() > 100)
                || file == null
                || title.indexOf(0) >= 0
                || (artist != null && artist.indexOf(0) >= 0))
            throw new BusinessException(AudioErrorCode.INVALID);
        if (file.isEmpty()) throw new BusinessException(AudioErrorCode.UNSUPPORTED);
        if (file.getSize() > LIMIT) throw new BusinessException(AudioErrorCode.TOO_LARGE);
        Path temp = null;
        try {
            temp = Files.createTempFile(spool.path(), "audio-", ".upload");
            var digest = MessageDigest.getInstance("SHA-256");
            long count = 0;
            try (var input = file.getInputStream();
                    var output = Files.newOutputStream(temp)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = input.read(buf)) != -1) {
                    count += n;
                    if (count > LIMIT) throw new BusinessException(AudioErrorCode.TOO_LARGE);
                    digest.update(buf, 0, n);
                    output.write(buf, 0, n);
                }
            }
            if (count == 0) throw new BusinessException(AudioErrorCode.INVALID);
            String sha = HexFormat.of().formatHex(digest.digest());
            var requestHash = hash(sha, title, artist);
            var existing = db.preflight(user, key, requestHash);
            if (existing != null) return result(existing);
            var info = probe.inspect(temp);
            var meta =
                    new AudioUploadRepository.Metadata(info.mime(), count, sha, info.durationMs());
            var begin = db.begin(user, key, requestHash, meta);
            if (begin.outcome() != null) return result(begin.outcome());
            var receipt = begin.receipt();
            try {
                store.checkAvailable();
                store.put(receipt.key(), temp, count, info.mime());
                return result(db.accept(user, key, requestHash, title, artist, receipt.id()));
            } catch (RuntimeException e) {
                try {
                    var accepted = db.accepted(receipt.id());
                    if (accepted != null) return accepted;
                    db.settle(receipt.id());
                } catch (RuntimeException ignored) {
                    throw new BusinessException(AudioErrorCode.UNAVAILABLE);
                }
                throw e;
            }
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(AudioErrorCode.UNAVAILABLE);
        } finally {
            if (temp != null)
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException ignored) {
                }
        }
    }

    private static String hash(String sha, String title, String artist) throws Exception {
        var d = MessageDigest.getInstance("SHA-256");
        for (String s : new String[] {sha, title, artist}) {
            if (s == null) {
                d.update((byte) 0);
                continue;
            }
            byte[] b = s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            d.update((byte) 1);
            d.update(java.nio.ByteBuffer.allocate(4).putInt(b.length).array());
            d.update(b);
        }
        return HexFormat.of().formatHex(d.digest());
    }

    private static AudioUploadRepository.Response result(AudioUploadRepository.Outcome out) {
        if (out.error() != null) throw new BusinessException(out.error());
        return out.response();
    }
}
