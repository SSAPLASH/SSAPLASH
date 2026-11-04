package com.ssafy.airdrum.song.midi;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.SongQueryService;
import com.ssafy.airdrum.song.SongLevelService;
import com.ssafy.airdrum.song.SongResponses.SongDetail;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;

/**
 * MIDI 업로드 → 채보 3난이도 저장(설계 4-1절). 요청 안에서 변환하고 곡·채보를 한 트랜잭션으로 넣는다.
 * 원본 파일은 보관하지 않는다(설계 U5).
 */
@Service
class MidiUploadService {

	private static final int TEXT_LIMIT = 100;

	private final MidiChartConverter converter;
	private final MidiChartRepository repository;
	private final SongQueryService songs;
	private final SongLevelService levels;
	private final TransactionTemplate tx;

	MidiUploadService(MidiChartConverter converter, MidiChartRepository repository, SongQueryService songs, SongLevelService levels,
			PlatformTransactionManager manager) {
		this.converter = converter;
		this.repository = repository;
		this.songs = songs;
		this.levels = levels;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(15);
	}

	SongDetail upload(long userId, String title, String artist, MultipartFile file) {
		String cleanTitle = text(title);
		String cleanArtist = text(artist);
		if (cleanTitle == null || (artist != null && !artist.isBlank() && cleanArtist == null) || file == null)
			throw new BusinessException(MidiErrorCode.INVALID);
		var song = converter.convert(file);

		Long songId = tx.execute(s -> {
			repository.requireActive(userId);
			long id = repository.insertSong(userId, cleanTitle, cleanArtist, song);
			for (var difficulty : Difficulty.values())
				repository.insertVersion(repository.insertChart(id, difficulty), 1, song.charts().get(difficulty));
			levels.process(id, true);
			return id;
		});
		return songs.detail(userId, songId);
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
