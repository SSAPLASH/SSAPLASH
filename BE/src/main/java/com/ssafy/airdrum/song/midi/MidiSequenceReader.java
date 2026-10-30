package com.ssafy.airdrum.song.midi;

import java.io.ByteArrayInputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import javax.sound.midi.MetaMessage;
import javax.sound.midi.MidiSystem;
import javax.sound.midi.Sequence;
import javax.sound.midi.ShortMessage;

import org.springframework.stereotype.Component;

import com.ssafy.airdrum.common.error.BusinessException;

/**
 * 표준 MIDI 파일(format 0·1, PPQ)에서 드럼 채널(10) 노트와 템포·박자표를 꺼낸다(설계 2절).
 * 소리 장치는 쓰지 않고 JDK {@code javax.sound.midi}로 파일만 읽는다. 패드 해석은 하지 않는다.
 */
@Component
class MidiSequenceReader {

	/** GM 규격의 타악기 채널 10(0부터 세면 9). */
	static final int DRUM_CHANNEL = 9;
	private static final int TEMPO = 0x51;
	private static final int TIME_SIGNATURE = 0x58;

	record Tempo(long tick, int microsPerQuarter) {}
	record Signature(long tick, int numerator, int denominator) {}
	/** durationTicks는 note-off까지의 tick. note-off가 없으면 0. */
	record DrumEvent(long tick, int pitch, int velocity, long durationTicks) {}
	/** tempos·signatures가 비어 있으면 파일에 없다는 뜻이다(기본값은 문서 생성 단계가 채운다). */
	record DrumSequence(int ppq, List<Tempo> tempos, List<Signature> signatures, List<DrumEvent> events, long lengthTicks) {}

	DrumSequence read(byte[] bytes) {
		checkHeader(bytes);
		Sequence sequence;
		try {
			sequence = MidiSystem.getSequence(new ByteArrayInputStream(bytes));
		} catch (Exception e) {
			throw unsupported("MIDI 파일이 아니거나 손상되었습니다.");
		}
		if (sequence.getDivisionType() != Sequence.PPQ || sequence.getResolution() <= 0)
			throw unsupported("SMPTE 시간 단위 MIDI는 지원하지 않습니다.");

		var tempos = new TreeMap<Long, Integer>();
		var signatures = new TreeMap<Long, Signature>();
		var events = new ArrayList<DrumEvent>();
		for (var track : sequence.getTracks()) {
			// 같은 피치의 note-on은 먼저 열린 것부터 닫는다.
			Map<Integer, ArrayDeque<Integer>> open = new HashMap<>();
			var trackEvents = new ArrayList<long[]>();
			for (int i = 0; i < track.size(); i++) {
				var event = track.get(i);
				long tick = event.getTick();
				if (event.getMessage() instanceof MetaMessage meta) {
					if (meta.getType() == TEMPO) tempos.put(tick, tempo(meta.getData()));
					else if (meta.getType() == TIME_SIGNATURE) signatures.put(tick, signature(tick, meta.getData()));
				} else if (event.getMessage() instanceof ShortMessage msg && msg.getChannel() == DRUM_CHANNEL) {
					int pitch = msg.getData1(), velocity = msg.getData2();
					if (msg.getCommand() == ShortMessage.NOTE_ON && velocity > 0) {
						trackEvents.add(new long[] { tick, pitch, velocity, 0 });
						open.computeIfAbsent(pitch, p -> new ArrayDeque<>()).add(trackEvents.size() - 1);
					} else if (msg.getCommand() == ShortMessage.NOTE_OFF || msg.getCommand() == ShortMessage.NOTE_ON) {
						var queue = open.get(pitch);
						if (queue != null && !queue.isEmpty()) {
							long[] note = trackEvents.get(queue.poll());
							note[3] = tick - note[0];
						}
					}
				}
			}
			for (long[] n : trackEvents) events.add(new DrumEvent(n[0], (int) n[1], (int) n[2], n[3]));
		}
		events.sort(Comparator.comparingLong(DrumEvent::tick).thenComparingInt(DrumEvent::pitch));
		return new DrumSequence(sequence.getResolution(),
				tempos.entrySet().stream().map(e -> new Tempo(e.getKey(), e.getValue())).toList(),
				List.copyOf(signatures.values()), List.copyOf(events), sequence.getTickLength());
	}

	/** format·시간 단위는 JDK 리더에 맡기지 않고 헤더에서 직접 확인한다. */
	private static void checkHeader(byte[] bytes) {
		if (bytes.length < 14 || bytes[0] != 'M' || bytes[1] != 'T' || bytes[2] != 'h' || bytes[3] != 'd')
			throw unsupported("MIDI 파일이 아니거나 손상되었습니다.");
		int format = ((bytes[8] & 0xFF) << 8) | (bytes[9] & 0xFF);
		if (format > 1) throw unsupported("format 0·1 MIDI만 지원합니다.");
		if ((bytes[12] & 0x80) != 0) throw unsupported("SMPTE 시간 단위 MIDI는 지원하지 않습니다.");
	}

	/** 4분음표당 µs. BPM 1~999 밖이면 거절한다(설계 4-2절). */
	private static int tempo(byte[] data) {
		if (data.length != 3) throw unsupported("템포 정보가 올바르지 않습니다.");
		int us = ((data[0] & 0xFF) << 16) | ((data[1] & 0xFF) << 8) | (data[2] & 0xFF);
		if (us <= 0) throw unsupported("템포는 1~999 BPM이어야 합니다.");
		double bpm = 60_000_000.0 / us;
		if (bpm < 1 || bpm > 999) throw unsupported("템포는 1~999 BPM이어야 합니다.");
		return us;
	}

	/** 분모는 2의 거듭제곱 지수로 저장돼 있다. 저장 컬럼 time_signature가 5자라 그보다 긴 표기는 거절한다. */
	private static Signature signature(long tick, byte[] data) {
		if (data.length < 2) throw unsupported("지원하지 않는 박자표입니다.");
		int numerator = data[0] & 0xFF, power = data[1] & 0xFF;
		if (numerator < 1 || power > 6) throw unsupported("지원하지 않는 박자표입니다.");
		int denominator = 1 << power;
		if ((numerator + "/" + denominator).length() > 5) throw unsupported("지원하지 않는 박자표입니다.");
		return new Signature(tick, numerator, denominator);
	}

	private static BusinessException unsupported(String detail) {
		return new BusinessException(MidiErrorCode.UNSUPPORTED, detail);
	}

}
