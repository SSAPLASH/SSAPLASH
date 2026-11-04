package com.ssafy.airdrum.song.midi;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.common.error.BusinessException;

/**
 * 업로드 파일 → 채보 3난이도 문서. 개인 MIDI 업로드(151번)와 공용 곡 관리(156번)가 같은 규칙을 쓰도록 변환만 맡는다.
 * DB 저장은 하지 않는다.
 */
@Component
public class MidiChartConverter {

	private static final Logger log = LoggerFactory.getLogger(MidiChartConverter.class);
	static final int LIMIT = 1024 * 1024;
	static final int MAX_NOTES = 50_000;

	private final MidiSequenceReader reader;
	private final MidiChartDocuments documents;

	MidiChartConverter(MidiSequenceReader reader, MidiChartDocuments documents) {
		this.reader = reader;
		this.documents = documents;
	}

	public MidiChartDocuments.Song convert(MultipartFile file) {
		if (file == null) throw new BusinessException(MidiErrorCode.INVALID);
		return convert(read(file));
	}

	/** 이미 읽은 MIDI 바이트를 변환한다. 공용 곡 카탈로그 등록(254번)이 저장소 리소스로 부른다. 크기 규칙은 업로드와 같다. */
	public MidiChartDocuments.Song convert(byte[] bytes) {
		if (bytes == null || bytes.length == 0) throw new BusinessException(MidiErrorCode.INVALID);
		if (bytes.length > LIMIT) throw new BusinessException(MidiErrorCode.TOO_LARGE);
		var sequence = reader.read(bytes);
		var notes = GmDrumMapping.notes(sequence.events());
		if (notes.isEmpty()) throw new BusinessException(MidiErrorCode.NO_DRUM_NOTES, "드럼 채널(10)에 변환할 드럼 노트가 없습니다.");
		if (notes.size() > MAX_NOTES) throw new BusinessException(MidiErrorCode.UNSUPPORTED, "드럼 노트는 50,000개 이하여야 합니다.");
		if (log.isDebugEnabled()) log.debug("MIDI 드럼 노트 {}개 중 패드에 없는 {}개 제외", sequence.events().size(),
				sequence.events().size() - notes.size());
		return documents.build(sequence, DifficultyThinner.thin(notes, sequence.ppq()));
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
