package com.ssafy.airdrum.domain.song.service.midi;

import com.ssafy.airdrum.domain.song.exception.MidiErrorCode;
import com.ssafy.airdrum.domain.chart.model.DifficultyThinner;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.global.error.BusinessException;

/**
 * 업로드 파일 → 채보 3난이도 문서. 개인 MIDI 업로드(151번)와 공용 곡 관리(156번)가 같은 규칙을 쓰도록 변환만 맡는다.
 * DB 저장은 하지 않는다.
 */
@Component
public class MidiChartConverter {

	private static final Logger log = LoggerFactory.getLogger(MidiChartConverter.class);
	public static final int LIMIT = 1024 * 1024;
	static final int MAX_NOTES = 50_000;

	private final MidiSequenceReader reader;
	private final MidiChartDocuments documents;

	MidiChartConverter(MidiSequenceReader reader, MidiChartDocuments documents) {
		this.reader = reader;
		this.documents = documents;
	}

	public MidiChartDocuments.Song convert(MultipartFile file) {
		return convert(file, 0);
	}

	/** 업로드 파일을 첫 박 {@code offsetMs} 기준으로 변환한다. 공용 곡 ADMIN 등록(262번)이 쓴다. */
	public MidiChartDocuments.Song convert(MultipartFile file, int offsetMs) {
		if (file == null) throw new BusinessException(MidiErrorCode.INVALID);
		return convert(read(file), offsetMs);
	}

	/** 이미 읽은 MIDI 바이트를 변환한다. 첫 박은 0틱(사용자 MIDI 업로드). 크기 규칙은 업로드와 같다. */
	public MidiChartDocuments.Song convert(byte[] bytes) {
		return convert(bytes, 0);
	}

	/**
	 * 0틱 = 원본 음원 0초인 MIDI를 첫 박 {@code offsetMs} 기준으로 변환한다. 공용 곡 카탈로그 등록(254·260번)이 저장소 리소스로 부른다.
	 * 첫 박보다 앞선 노트가 있으면 {@link MidiErrorCode#UNSUPPORTED}다.
	 */
	public MidiChartDocuments.Song convert(byte[] bytes, int offsetMs) {
		if (bytes == null || bytes.length == 0) throw new BusinessException(MidiErrorCode.INVALID);
		if (bytes.length > LIMIT) throw new BusinessException(MidiErrorCode.TOO_LARGE);
		var sequence = reader.read(bytes);
		var notes = GmDrumMapping.notes(sequence.events());
		if (notes.isEmpty()) throw new BusinessException(MidiErrorCode.NO_DRUM_NOTES, "드럼 채널(10)에 변환할 드럼 노트가 없습니다.");
		if (notes.size() > MAX_NOTES) throw new BusinessException(MidiErrorCode.UNSUPPORTED, "드럼 노트는 50,000개 이하여야 합니다.");
		if (log.isDebugEnabled()) log.debug("MIDI 드럼 노트 {}개 중 패드에 없는 {}개 제외", sequence.events().size(),
				sequence.events().size() - notes.size());
		var rebased = documents.rebase(sequence, notes, offsetMs);
		var tempos = tempos(rebased.sequence());
		return documents.build(rebased.sequence(), offsetMs, DifficultyThinner.thin(rebased.notes(), sequence.ppq(), tempos));
	}

	/** 솎기용 템포. 첫 템포 이벤트 전은 MIDI 기본 120 BPM이다(채보 timeMs 계산과 같다). */
	static java.util.List<DifficultyThinner.Tempo> tempos(MidiSequenceReader.DrumSequence sequence) {
		var tempos = new java.util.ArrayList<DifficultyThinner.Tempo>();
		if (sequence.tempos().isEmpty() || sequence.tempos().getFirst().tick() != 0)
			tempos.add(new DifficultyThinner.Tempo(0, MidiChartDocuments.DEFAULT_TEMPO_US));
		for (var t : sequence.tempos()) tempos.add(new DifficultyThinner.Tempo(t.tick(), t.microsPerQuarter()));
		return tempos;
	}

	/** 선언 크기를 믿지 않고 상한 + 1바이트까지만 읽는다. */
	static byte[] read(MultipartFile file) {
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
