package com.ssafy.airdrum.domain.song.service.midi;

import com.ssafy.airdrum.domain.song.exception.MidiErrorCode;
import com.ssafy.airdrum.domain.song.model.midi.MidiAccompanimentTiming;
import com.ssafy.airdrum.domain.song.repository.midi.MidiChartRepository;
import com.ssafy.airdrum.domain.song.repository.midi.MidiOriginalReceipts;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStorageConfiguration;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;
import com.ssafy.airdrum.domain.chart.model.DifficultyThinner;

import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.song.service.catalog.SongQueryService;
import com.ssafy.airdrum.domain.song.service.level.SongLevelService;
import com.ssafy.airdrum.domain.song.dto.SongResponses.SongDetail;
import com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Difficulty;

/**
 * MIDI 업로드 → 채보 3난이도 저장(설계 4-1절). 요청 안에서 변환하고 곡·채보를 한 트랜잭션으로 넣는다.
 * 원본은 별도 비공개 저장소에 보관하고 반주는 전용 큐에서 생성한다.
 */
@Service
public class MidiUploadService {

	private static final int TEXT_LIMIT = 100;

	private final MidiChartConverter converter;
	private final MidiChartRepository repository;
	private final SongQueryService songs;
	private final SongLevelService levels;
	private final TransactionTemplate tx;
	private final MidiOriginalStore store;
	private final MidiOriginalReceipts receipts;
	private final JdbcTemplate db;

	MidiUploadService(MidiChartConverter converter, MidiChartRepository repository, SongQueryService songs, SongLevelService levels,
			PlatformTransactionManager manager, MidiOriginalStore store, MidiOriginalReceipts receipts, JdbcTemplate db) {
		this.converter = converter;
		this.repository = repository;
		this.songs = songs;
		this.levels = levels;
		this.store = store;
		this.receipts = receipts;
		this.db = db;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(15);
	}

	public SongDetail upload(long userId, String title, String artist, MultipartFile file) {
		String cleanTitle = text(title);
		String cleanArtist = text(artist);
		if (cleanTitle == null || (artist != null && !artist.isBlank() && cleanArtist == null) || file == null)
			throw new BusinessException(MidiErrorCode.INVALID);
		byte[] bytes = MidiChartConverter.read(file);
		var song = converter.convert(bytes);
		boolean melody;
		try { melody = MidiAccompanimentTiming.hasMelody(bytes); }
		catch (Exception e) { throw new BusinessException(MidiErrorCode.UNSUPPORTED); }
		String sha = MidiOriginalStorageConfiguration.MidiS3Store.hash(bytes);
		var receipt = receipts.begin(userId, bytes, sha);
		try {
			store.putAndVerify(receipt.key(), bytes, sha);

			Long songId = tx.execute(s -> {
			repository.requireActive(userId);
			long id = repository.insertReservedSong(receipt.songId(), userId, cleanTitle, cleanArtist, song);
			for (var difficulty : Difficulty.values())
				repository.insertVersion(repository.insertChart(id, difficulty), 1, song.charts().get(difficulty));
			levels.process(id, true);
			receipts.accept(receipt, userId);
			if (melody) db.update("""
					INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status)
					VALUES (?,?,?,?::jsonb,?,'QUEUED')
					""", id,userId,receipt.id(),song.charts().get(Difficulty.HARD).timing(),song.durationMs());
			return id;
			});
			return songs.detail(userId, songId);
		} catch (RuntimeException e) {
			try { receipts.retire(receipt); } catch (RuntimeException ignored) { /* 만료 복구가 접수를 회수한다. */ }
			throw e;
		}
	}

	/** 앞뒤 공백을 지운 1~100자. 비었으면 null, 길거나 NUL이 있으면 거절한다. */
	private static String text(String value) {
		if (value == null) return null;
		var stripped = value.strip();
		if (stripped.isEmpty()) return null;
		if (stripped.length() > TEXT_LIMIT || stripped.indexOf(0) >= 0) throw new BusinessException(MidiErrorCode.INVALID);
		return stripped;
	}

}
