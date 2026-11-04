package com.ssafy.airdrum.song.midi;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import javax.sound.midi.InvalidMidiDataException;
import javax.sound.midi.MetaMessage;
import javax.sound.midi.MidiEvent;
import javax.sound.midi.MidiMessage;
import javax.sound.midi.MidiSystem;
import javax.sound.midi.Sequence;
import javax.sound.midi.ShortMessage;

/** 테스트용 표준 MIDI 파일을 바이트로 만든다. 외부 MIDI 파일을 저장소에 넣지 않기 위해서다. */
final class MidiFixtures {

	static final int DRUM = 9;

	private final int ppq;
	private boolean singleTrack;
	private final List<MidiEvent> meta = new ArrayList<>();
	private final List<MidiEvent> notes = new ArrayList<>();

	private MidiFixtures(int ppq) {
		this.ppq = ppq;
	}

	static MidiFixtures ppq(int ppq) {
		return new MidiFixtures(ppq);
	}

	/** format 0(트랙 하나)으로 쓴다. 기본은 format 1(메타 트랙 + 노트 트랙). */
	MidiFixtures format0() {
		singleTrack = true;
		return this;
	}

	MidiFixtures tempo(long tick, double bpm) {
		return tempoMicros(tick, (int) Math.round(60_000_000 / bpm));
	}

	/** 4분음표당 µs를 그대로 쓴다(24비트). */
	MidiFixtures tempoMicros(long tick, int us) {
		meta.add(new MidiEvent(meta(0x51, new byte[] { (byte) (us >> 16), (byte) (us >> 8), (byte) us }), tick));
		return this;
	}

	MidiFixtures signature(long tick, int numerator, int denominatorPower) {
		meta.add(new MidiEvent(meta(0x58, new byte[] { (byte) numerator, (byte) denominatorPower, 24, 8 }), tick));
		return this;
	}

	/** note-off는 NOTE_OFF 메시지로 쓴다. duration이 0이면 note-off를 쓰지 않는다. */
	MidiFixtures note(long tick, int channel, int pitch, int velocity, long duration) {
		notes.add(new MidiEvent(shortMessage(ShortMessage.NOTE_ON, channel, pitch, velocity), tick));
		if (duration > 0) notes.add(new MidiEvent(shortMessage(ShortMessage.NOTE_OFF, channel, pitch, 0), tick + duration));
		return this;
	}

	/** note-off를 velocity 0 NOTE_ON으로 쓴다(많은 프로그램이 쓰는 방식). */
	MidiFixtures noteWithZeroVelocityOff(long tick, int channel, int pitch, int velocity, long duration) {
		notes.add(new MidiEvent(shortMessage(ShortMessage.NOTE_ON, channel, pitch, velocity), tick));
		notes.add(new MidiEvent(shortMessage(ShortMessage.NOTE_ON, channel, pitch, 0), tick + duration));
		return this;
	}

	MidiFixtures drum(long tick, int pitch) {
		return note(tick, DRUM, pitch, 100, ppq / 4);
	}

	byte[] bytes() {
		try {
			var sequence = new Sequence(Sequence.PPQ, ppq);
			var first = sequence.createTrack();
			meta.forEach(first::add);
			var noteTrack = singleTrack ? first : sequence.createTrack();
			notes.forEach(noteTrack::add);
			var out = new ByteArrayOutputStream();
			MidiSystem.write(sequence, singleTrack ? 0 : 1, out);
			return out.toByteArray();
		} catch (InvalidMidiDataException | IOException e) {
			throw new IllegalStateException(e);
		}
	}

	private static MidiMessage meta(int type, byte[] data) {
		try {
			return new MetaMessage(type, data, data.length);
		} catch (InvalidMidiDataException e) {
			throw new IllegalStateException(e);
		}
	}

	private static MidiMessage shortMessage(int command, int channel, int data1, int data2) {
		try {
			return new ShortMessage(command, channel, data1, data2);
		} catch (InvalidMidiDataException e) {
			throw new IllegalStateException(e);
		}
	}

	/** 헤더의 format(바이트 8~9)·division(바이트 12~13)을 바꾼 복사본. */
	static byte[] withHeader(byte[] midi, int format, int division) {
		var copy = midi.clone();
		copy[8] = (byte) (format >> 8);
		copy[9] = (byte) format;
		copy[12] = (byte) (division >> 8);
		copy[13] = (byte) division;
		return copy;
	}

}
