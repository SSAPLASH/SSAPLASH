package com.ssafy.airdrum.song.midi;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.SongQueryService;
import com.ssafy.airdrum.song.SongResponses.SongDetail;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;

/**
 * MIDI 업로드 → 채보 3난이도 저장(설계 4-1절). 요청 안에서 변환하고 곡·채보를 한 트랜잭션으로 넣는다.
 * 원본 파일은 보관하지 않는다(설계 U5).
 */
@Service
class MidiUploadService {

	private static final Logger log = LoggerFactory.getLogger(MidiUploadService.class);
	static final int LIMIT = 1024 * 1024;
	static final int MAX_NOTES = 50_000;
	private static final int TEXT_LIMIT = 100;

	private final MidiSequenceReader reader;
	private final MidiChartDocuments documents;
	private final MidiChartRepository repository;
	private final SongQueryService songs;
	private final TransactionTemplate tx;

	MidiUploadService(MidiSequenceReader reader, MidiChartDocuments documents, MidiChartRepository repository,
			SongQueryService songs, PlatformTransactionManager manager) {
		this.reader = reader;
		this.documents = documents;
		this.repository = repository;
		this.songs = songs;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(15);
	}

	SongDetail upload(long userId, String title, String artist, MultipartFile file) {
		String cleanTitle = text(title);
		String cleanArtist = text(artist);
		if (cleanTitle == null || (artist != null && !artist.isBlank() && cleanArtist == null) || file == null)
			throw new BusinessException(MidiErrorCode.INVALID);
		byte[] bytes = read(file);

		var sequence = reader.read(bytes);
		var notes = GmDrumMapping.notes(sequence.events());
		if (notes.isEmpty()) throw new BusinessException(MidiErrorCode.NO_DRUM_NOTES, "드럼 채널(10)에 변환할 드럼 노트가 없습니다.");
		if (notes.size() > MAX_NOTES) throw new BusinessException(MidiErrorCode.UNSUPPORTED, "드럼 노트는 50,000개 이하여야 합니다.");
		if (log.isDebugEnabled()) log.debug("MIDI 드럼 노트 {}개 중 패드에 없는 {}개 제외", sequence.events().size(),
				sequence.events().size() - notes.size());
		var song = documents.build(sequence, DifficultyThinner.thin(notes, sequence.ppq()));

		Long songId = tx.execute(s -> {
			repository.requireActive(userId);
			long id = repository.insertSong(userId, cleanTitle, cleanArtist, song);
			for (var difficulty : Difficulty.values())
				repository.insertVersion(repository.insertChart(id, difficulty), song.charts().get(difficulty));
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

	/** 선언 크기를 믿지 않고 상한 + 1바이트까지만 읽는다. */
	private static byte[] read(MultipartFile file) {
		if (file.getSize() > LIMIT) throw new BusinessException(MidiErrorCode.TOO_LARGE);
		byte[] bytes;
		try (var in = file.getInputStream()) {
			bytes = in.readNBytes(LIMIT + 1);
		} catch (IOException e) {
			throw new BusinessException(MidiErrorCode.INVALID);
		}
		if (bytes.length > LIMIT) throw new BusinessException(MidiErrorCode.TOO_LARGE);
		if (bytes.length == 0) throw new BusinessException(MidiErrorCode.INVALID);
		return bytes;
	}

}
