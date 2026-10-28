package com.ssafy.airdrum.song.midi;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.DrumEvent;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.Signature;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.Tempo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 표준 MIDI → 드럼 이벤트·템포·박자표 추출(설계 2절 MidiSequenceReader, 4-2절). */
class MidiSequenceReaderTest {

	final MidiSequenceReader reader = new MidiSequenceReader();

	@Test
	void format1에서_채널10_노트와_템포_박자표를_읽는다() {
		var bytes = MidiFixtures.ppq(480)
				.tempo(0, 100).signature(0, 3, 2)
				.note(0, 9, 36, 110, 120)
				.note(480, 9, 38, 90, 240)
				.note(480, 0, 60, 80, 480) // 피아노 채널은 무시
				.bytes();

		var seq = reader.read(bytes);

		assertThat(seq.ppq()).isEqualTo(480);
		assertThat(seq.tempos()).containsExactly(new Tempo(0, 600_000));
		assertThat(seq.signatures()).containsExactly(new Signature(0, 3, 4));
		assertThat(seq.events()).containsExactly(new DrumEvent(0, 36, 110, 120), new DrumEvent(480, 38, 90, 240));
		assertThat(seq.lengthTicks()).isGreaterThanOrEqualTo(960);
	}

	@Test
	void format0도_읽는다() {
		var seq = reader.read(MidiFixtures.ppq(96).format0().tempo(0, 120).drum(0, 42).drum(48, 42).bytes());

		assertThat(seq.events()).extracting(DrumEvent::tick).containsExactly(0L, 48L);
	}

	@Test
	void velocity_0_NOTE_ON을_note_off로_본다() {
		var seq = reader.read(MidiFixtures.ppq(480).noteWithZeroVelocityOff(0, 9, 38, 100, 60).bytes());

		assertThat(seq.events()).containsExactly(new DrumEvent(0, 38, 100, 60));
	}

	@Test
	void note_off가_없으면_길이는_0이다() {
		var seq = reader.read(MidiFixtures.ppq(480).note(0, 9, 49, 100, 0).bytes());

		assertThat(seq.events()).containsExactly(new DrumEvent(0, 49, 100, 0));
	}

	@Test
	void 템포_박자표_변경을_tick_순서로_모두_읽는다() {
		var seq = reader.read(MidiFixtures.ppq(480)
				.tempo(0, 120).tempo(1920, 90).signature(0, 4, 2).signature(1920, 6, 3)
				.drum(0, 36).bytes());

		assertThat(seq.tempos()).containsExactly(new Tempo(0, 500_000), new Tempo(1920, 666_667));
		assertThat(seq.signatures()).containsExactly(new Signature(0, 4, 4), new Signature(1920, 6, 8));
	}

	@Test
	void 템포_박자표가_없으면_비어_있다() {
		var seq = reader.read(MidiFixtures.ppq(480).drum(0, 36).bytes());

		assertThat(seq.tempos()).isEmpty();
		assertThat(seq.signatures()).isEmpty();
	}

	@Test
	void 같은_tick의_템포는_마지막_값을_쓴다() {
		var seq = reader.read(MidiFixtures.ppq(480).tempo(0, 120).tempo(0, 140).drum(0, 36).bytes());

		assertThat(seq.tempos()).containsExactly(new Tempo(0, 428_571));
	}

	@Test
	void 이벤트는_tick_그다음_피치_순서다() {
		var seq = reader.read(MidiFixtures.ppq(480).drum(480, 42).drum(0, 42).drum(0, 36).bytes());

		assertThat(seq.events()).extracting(DrumEvent::tick, DrumEvent::pitch)
				.containsExactly(org.assertj.core.groups.Tuple.tuple(0L, 36), org.assertj.core.groups.Tuple.tuple(0L, 42),
						org.assertj.core.groups.Tuple.tuple(480L, 42));
	}

	@Test
	void MIDI가_아니면_422() {
		assertUnsupported("hello world, not a midi file".getBytes(StandardCharsets.UTF_8));
		assertUnsupported(new byte[] { 'M', 'T', 'h', 'd' });
	}

	@Test
	void 손상된_MIDI는_422() {
		var bytes = MidiFixtures.ppq(480).drum(0, 36).bytes();
		var truncated = java.util.Arrays.copyOf(bytes, 20);
		assertUnsupported(truncated);
	}

	@Test
	void format2는_422() {
		var bytes = MidiFixtures.ppq(480).drum(0, 36).bytes();
		assertUnsupported(MidiFixtures.withHeader(bytes, 2, 480));
	}

	@Test
	void SMPTE_분해능은_422() {
		var bytes = MidiFixtures.ppq(480).format0().drum(0, 36).bytes();
		assertUnsupported(MidiFixtures.withHeader(bytes, 0, 0xE728)); // -25fps, 40 ticks/frame
	}

	@Test
	void 템포가_1_999_BPM_밖이면_422() {
		assertUnsupported(MidiFixtures.ppq(480).tempo(0, 1000).drum(0, 36).bytes());
		assertUnsupported(MidiFixtures.ppq(480).tempoMicros(0, 0).drum(0, 36).bytes());
	}

	@Test
	void 박자표_문자열이_5자를_넘거나_분모가_64를_넘으면_422() {
		assertUnsupported(MidiFixtures.ppq(480).signature(0, 100, 4).drum(0, 36).bytes()); // 100/16
		assertUnsupported(MidiFixtures.ppq(480).signature(0, 4, 7).drum(0, 36).bytes()); // 4/128
		assertUnsupported(MidiFixtures.ppq(480).signature(0, 0, 2).drum(0, 36).bytes()); // 0/4
	}

	private void assertUnsupported(byte[] bytes) {
		assertThatThrownBy(() -> reader.read(bytes))
				.isInstanceOfSatisfying(BusinessException.class,
						e -> assertThat(e.getErrorCode()).isEqualTo(MidiErrorCode.UNSUPPORTED));
	}

}
