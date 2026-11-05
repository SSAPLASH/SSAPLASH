package com.ssafy.airdrum.song.admin;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.chart.ChartErrorCode;
import com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy;
import com.ssafy.airdrum.chart.asset.ChartAssetStore;
import com.ssafy.airdrum.chart.withdrawal.SongAssetCleanup;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.response.PageResponse;
import com.ssafy.airdrum.play.web.PlayMultipartConfiguration.SpoolDirectory;
import com.ssafy.airdrum.song.AccompanimentStorage;
import com.ssafy.airdrum.song.CoverImage;
import com.ssafy.airdrum.song.CoverStorage;
import com.ssafy.airdrum.song.SongManagementError;
import com.ssafy.airdrum.song.SongLevelService;
import com.ssafy.airdrum.song.audio.AudioErrorCode;
import com.ssafy.airdrum.song.audio.AudioProbe;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;
import com.ssafy.airdrum.song.midi.MidiChartConverter;
import com.ssafy.airdrum.song.midi.MidiChartDocuments;
import com.ssafy.airdrum.song.midi.MidiChartRepository;
import com.ssafy.airdrum.song.admin.AdminSongRepository.ChartRow;
import com.ssafy.airdrum.song.admin.AdminSongRepository.SongRow;
import static com.ssafy.airdrum.song.admin.AdminSongResponses.*;

/**
 * 공용 곡 관리(156번 설계 4절). 채보 변환은 151번 변환기를 그대로 쓰고, 곡 행을 잠근 트랜잭션에서만 바꾼다.
 * ADMIN 회원 상태는 인증 필터가 매 요청 확인하고, 공용 곡은 소유자가 없어 회원 행을 잠그지 않는다.
 */
@Service
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class AdminSongService {

	/** 159번 음원 접수와 같은 상한. */
	static final long BACKING_LIMIT = 50L * 1024 * 1024;
	static final int BACKING_MAX_MS = 10 * 60 * 1000;

	/** PATCH가 받는 필드와 컬럼. */
	record Change(boolean titlePresent, String title, boolean artistPresent, String artist,
			boolean licensePresent, String license, Boolean published) {}

	private final AdminSongRepository songs;
	private final MidiChartConverter converter;
	private final MidiChartRepository charts;
	private final CoverStorage covers;
	private final ChartAssetKeyPolicy keys;
	private final SongAssetCleanup cleanup;
	private final CoverImage images;
	private final AccompanimentStorage backings;
	private final AudioProbe probe;
	private final ChartAssetStore assets;
	private final SpoolDirectory spool;
	private final TransactionTemplate tx;
	private final SongLevelService levels;

	AdminSongService(AdminSongRepository songs, MidiChartConverter converter, MidiChartRepository charts,
			CoverStorage covers, ChartAssetKeyPolicy keys, SongAssetCleanup cleanup, CoverImage images,
			AccompanimentStorage backings, AudioProbe probe, ChartAssetStore assets, SpoolDirectory spool,
			PlatformTransactionManager manager, SongLevelService levels) {
		this.songs = songs;
		this.levels = levels;
		this.converter = converter;
		this.charts = charts;
		this.covers = covers;
		this.keys = keys;
		this.cleanup = cleanup;
		this.images = images;
		this.backings = backings;
		this.probe = probe;
		this.assets = assets;
		this.spool = spool;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(15);
	}

	/** ADMIN 업로드 등록. {@code offsetMs}는 첫 마디 첫 박 시각(0이면 0틱이 첫 박, 262번). */
	AdminSongDetail register(String title, String artist, String license, boolean published, MultipartFile file, int offsetMs) {
		return register(title, artist, license, published, converter.convert(file, offsetMs));
	}

	/** 공용 곡 카탈로그(254번)가 저장소의 MIDI 바이트로 등록한다. 규칙은 업로드 등록과 같고, 카탈로그 offsetMs를 첫 박으로 쓴다(260번). */
	AdminSongDetail register(String title, String artist, String license, boolean published, byte[] midi, int offsetMs) {
		return register(title, artist, license, published, converter.convert(midi, offsetMs));
	}

	private AdminSongDetail register(String title, String artist, String license, boolean published, MidiChartDocuments.Song song) {
		Long id = tx.execute(s -> {
			long songId = songs.insertSong(title, artist, license, published, song);
			for (var difficulty : Difficulty.values())
				charts.insertVersion(charts.insertChart(songId, difficulty), 1, song.charts().get(difficulty));
			levels.process(songId, true);
			return songId;
		});
		return detail(id);
	}

	/** 고친 MIDI로 난이도별 새 버전을 만든다(U3). 기존 버전 행은 그대로 둔다. 빠진 난이도는 version 1로 채운다. */
	AdminSongDetail regenerate(long id, MultipartFile file) {
		tx.executeWithoutResult(s -> songs.lock(id));
		return regenerate(id, converter.convert(file));
	}

	/** 공용 곡 카탈로그(254번)가 난이도가 모자란 곡을 채울 때 쓴다. offsetMs는 카탈로그 값(260번). */
	AdminSongDetail regenerate(long id, byte[] midi, int offsetMs) {
		tx.executeWithoutResult(s -> songs.lock(id));
		return regenerate(id, converter.convert(midi, offsetMs));
	}

	private AdminSongDetail regenerate(long id, MidiChartDocuments.Song song) {
		tx.executeWithoutResult(s -> {
			songs.lock(id);
			for (var difficulty : Difficulty.values()) {
				var next = songs.nextVersion(id, difficulty);
				long chartId = next == null ? charts.insertChart(id, difficulty) : next.getKey();
				charts.insertVersion(chartId, next == null ? 1 : next.getValue(), song.charts().get(difficulty));
			}
			songs.updateTiming(id, song);
			levels.process(id, true);
		});
		return detail(id);
	}

	AdminSongDetail patch(long id, Change change) {
		tx.executeWithoutResult(s -> {
			songs.lock(id);
			if (change.titlePresent()) songs.update(id, "title", change.title());
			if (change.artistPresent()) songs.update(id, "artist", change.artist());
			if (change.licensePresent()) songs.update(id, "license", change.license());
			if (change.published() != null) songs.update(id, "published", change.published());
		});
		return detail(id);
	}

	/** 소프트 삭제. 채보 버전·플레이 기록은 남기고 반주·커버 객체만 정리 큐에 넣는다. */
	void delete(long id) {
		tx.executeWithoutResult(s -> {
			var locked = songs.lock(id);
			cleanup.registerBuiltin(id, locked.accompanimentKey(), locked.coverKey());
			songs.softDelete(id);
		});
	}

	/** 4-5절. 임시 정리 등록 → 저장 → 재잠금·연결·이전 키 정리. 스토리지 호출 중에는 트랜잭션을 열어 두지 않는다. */
	CoverResponse cover(long id, byte[] data) {
		tx.executeWithoutResult(s -> songs.lock(id));
		var image = images.decode(data);
		String key = "cover/builtin/" + id + "/" + UUID.randomUUID() + "." + image.extension();
		keys.builtinCover(id, key);
		tx.executeWithoutResult(s -> {
			songs.lock(id);
			songs.registerTemporary(key, "COVER");
		});
		covers.put(key, image.bytes(), image.contentType());
		tx.executeWithoutResult(s -> {
			var locked = songs.lock(id);
			if (!songs.temporaryAlive(key, "COVER")) throw new BusinessException(SongManagementError.COVER_UNAVAILABLE);
			songs.updateKey(id, "cover_key", key);
			if (locked.coverKey() != null) cleanup.builtinCover(id, locked.coverKey());
		});
		return new CoverResponse(covers.sign(key));
	}

	void deleteCover(long id) {
		tx.executeWithoutResult(s -> {
			var locked = songs.lock(id);
			if (locked.coverKey() == null) return;
			songs.updateKey(id, "cover_key", null);
			cleanup.builtinCover(id, locked.coverKey());
		});
	}

	/** 4-4절. 실제 바이트를 ffprobe로 검사해 WAV·MP3, 10분 이하만 받는다. 키는 매번 새로 만들어 덮어쓰지 않는다. */
	AccompanimentResponse accompaniment(long id, MultipartFile file) {
		tx.executeWithoutResult(s -> songs.lock(id));
		if (file == null || file.isEmpty()) throw new BusinessException(AdminSongError.ACCOMPANIMENT_INVALID);
		if (file.getSize() > BACKING_LIMIT) throw new BusinessException(AdminSongError.ACCOMPANIMENT_TOO_LARGE);
		Path temp = null;
		try {
			temp = Files.createTempFile(spool.path(), "backing-", ".upload");
			long size = copy(file, temp);
			var info = inspect(temp);
			String key = "accompaniment/" + id + "/" + UUID.randomUUID() + (info.mime().equals("audio/wav") ? ".wav" : ".mp3");
			keys.accompaniment(id, key);
			tx.executeWithoutResult(s -> {
				songs.lock(id);
				songs.registerTemporary(key, "ACCOMPANIMENT");
			});
			try {
				backings.put(key, temp, size, info.mime());
			} catch (RuntimeException ex) {
				throw new BusinessException(AdminSongError.ACCOMPANIMENT_UNAVAILABLE);
			}
			tx.executeWithoutResult(s -> {
				var locked = songs.lock(id);
				if (!songs.temporaryAlive(key, "ACCOMPANIMENT")) throw new BusinessException(AdminSongError.ACCOMPANIMENT_UNAVAILABLE);
				songs.updateKey(id, "accompaniment_key", key);
				if (locked.accompanimentKey() != null) cleanup.builtinAccompaniment(id, locked.accompanimentKey());
			});
			var signed = assets.sign(ChartAssetStore.Kind.ACCOMPANIMENT, key);
			return new AccompanimentResponse(signed.url(), signed.expiresAt());
		} catch (IOException ex) {
			throw new BusinessException(AdminSongError.ACCOMPANIMENT_UNAVAILABLE);
		} finally {
			if (temp != null) try {
				Files.deleteIfExists(temp);
			} catch (IOException ignored) {
			}
		}
	}

	void deleteAccompaniment(long id) {
		tx.executeWithoutResult(s -> {
			var locked = songs.lock(id);
			if (locked.accompanimentKey() == null) return;
			songs.updateKey(id, "accompaniment_key", null);
			cleanup.builtinAccompaniment(id, locked.accompanimentKey());
		});
	}

	/** 선언 크기를 믿지 않고 읽은 바이트로 상한을 다시 확인한다. */
	private static long copy(MultipartFile file, Path temp) throws IOException {
		long count = 0;
		try (var input = file.getInputStream(); var output = Files.newOutputStream(temp)) {
			byte[] buffer = new byte[65536];
			int n;
			while ((n = input.read(buffer)) != -1) {
				count += n;
				if (count > BACKING_LIMIT) throw new BusinessException(AdminSongError.ACCOMPANIMENT_TOO_LARGE);
				output.write(buffer, 0, n);
			}
		}
		if (count == 0) throw new BusinessException(AdminSongError.ACCOMPANIMENT_INVALID);
		return count;
	}

	private AudioProbe.Info inspect(Path file) {
		AudioProbe.Info info;
		try {
			info = probe.inspect(file);
		} catch (BusinessException ex) {
			if (ex.getErrorCode() == AudioErrorCode.UNSUPPORTED) throw new BusinessException(AdminSongError.ACCOMPANIMENT_UNSUPPORTED);
			throw new BusinessException(AdminSongError.ACCOMPANIMENT_UNAVAILABLE);
		}
		if ((!info.mime().equals("audio/wav") && !info.mime().equals("audio/mpeg")) || info.durationMs() > BACKING_MAX_MS)
			throw new BusinessException(AdminSongError.ACCOMPANIMENT_UNSUPPORTED);
		return info;
	}

	PageResponse<AdminSongSummary> list(Boolean published, String q, int page, int size) {
		String pattern = "%" + (q == null ? "" : q.strip()).replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
		var rows = songs.page(published, pattern, size, (long) page * size);
		long total = songs.count(published, pattern);
		var byId = charts(rows.stream().map(SongRow::id).toList());
		var items = rows.stream().map(r -> new AdminSongSummary(r.id(), r.title(), r.artist(), r.license(), r.status(), r.bpm(),
				r.timeSignature(), r.durationMs(), r.accompanimentKey() != null, r.coverKey() != null, r.published(),
				difficulties(byId.getOrDefault(r.id(), List.of())), r.createdAt(), r.updatedAt())).toList();
		return PageResponse.of(items, page, size, total);
	}

	AdminSongDetail detail(long id) {
		var r = songs.find(id).orElseThrow(() -> new BusinessException(ChartErrorCode.SONG_NOT_FOUND));
		var latest = charts(List.of(id)).getOrDefault(id, List.of());
		var summaries = latest.stream().map(c -> new AdminChartSummary(c.chartId(), c.difficulty(), c.versionId(), c.version(),
				c.noteCount(), c.notationStatus(), c.generator(), c.generatorVersion(), c.createdAt())).toList();
		return new AdminSongDetail(r.id(), r.title(), r.artist(), r.license(), r.status(), r.bpm(), r.timeSignature(),
				r.durationMs(), r.accompanimentKey() != null, r.coverKey() != null, r.published(), difficulties(latest),
				r.createdAt(), r.updatedAt(), coverUrl(id, r.coverKey()), summaries);
	}

	private String coverUrl(long id, String key) {
		if (key == null) return null;
		try {
			keys.builtinCover(id, key);
		} catch (IllegalStateException ex) {
			throw new BusinessException(SongManagementError.COVER_UNAVAILABLE);
		}
		return covers.sign(key);
	}

	private Map<Long, List<ChartRow>> charts(List<Long> ids) {
		return songs.latestCharts(ids).stream().collect(Collectors.groupingBy(ChartRow::songId));
	}

	private static List<String> difficulties(List<ChartRow> rows) {
		return rows.stream().map(ChartRow::difficulty).toList();
	}

}
