package com.ssafy.airdrum.domain.chart.tool;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** 기본 8비트용 90 BPM·8마디 반주를 외부 샘플 없이 PCM WAV로 만든다. */
public final class PracticeBackingWav {
	public static final int SAMPLE_RATE = 44_100;
	public static final int CHANNELS = 2;
	public static final int BEATS_PER_BAR = 4;
	public static final int BAR_COUNT = 8;
	public static final int BPM = 90;
	public static final int FRAME_COUNT = SAMPLE_RATE * 60 * BEATS_PER_BAR * BAR_COUNT / BPM;

	private static final double[] CHORD_ROOTS_HZ = {130.81, 98.0, 110.0, 87.31};
	private static final double[] CHORD_INTERVALS = {1.0, 1.25, 1.5};
	private static final double RAMP_FRAMES = SAMPLE_RATE * 0.02;

	private PracticeBackingWav() {}

	public static byte[] create() {
		int beatFrames = SAMPLE_RATE * 60 / BPM;
		int barFrames = beatFrames * BEATS_PER_BAR;
		List<Voice> voices = voices(beatFrames, barFrames);
		int dataBytes = FRAME_COUNT * CHANNELS * Short.BYTES;
		ByteArrayOutputStream output = new ByteArrayOutputStream(44 + dataBytes);
		writeHeader(output, dataBytes);
		for (int frame = 0; frame < FRAME_COUNT; frame++) {
			double mixed = 0;
			for (Voice voice : voices) mixed += voice.sample(frame);
			short sample = (short) Math.round(Math.max(-1.0, Math.min(1.0, mixed)) * Short.MAX_VALUE);
			writeShort(output, sample);
			writeShort(output, sample);
		}
		return output.toByteArray();
	}

	private static List<Voice> voices(int beatFrames, int barFrames) {
		var result = new ArrayList<Voice>(BAR_COUNT * CHORD_INTERVALS.length + BAR_COUNT * BEATS_PER_BAR);
		for (int bar = 0; bar < BAR_COUNT; bar++) {
			int barStart = bar * barFrames;
			double root = CHORD_ROOTS_HZ[bar % CHORD_ROOTS_HZ.length];
			int chordEnd = Math.min(FRAME_COUNT, barStart + barFrames);
			double chordEnvelopeEnd = Math.min(FRAME_COUNT, barStart + barFrames * 0.92);
			for (double interval : CHORD_INTERVALS) {
				result.add(new Voice(barStart, chordEnd, chordEnvelopeEnd, root * interval * 2,
						Waveform.TRIANGLE, 0.45, 0.12));
			}
			for (int beat = 0; beat < BEATS_PER_BAR; beat++) {
				int beatStart = barStart + beat * beatFrames;
				int sourceEnd = Math.min(FRAME_COUNT, beatStart + (int) (beatFrames * 0.82));
				double envelopeEnd = Math.min(FRAME_COUNT, beatStart + beatFrames * 0.78);
				double peak = beat == 0 ? 0.7 : 0.46;
				result.add(new Voice(beatStart, sourceEnd, envelopeEnd, root / 2, Waveform.SINE, peak, 1.0));
			}
		}
		return List.copyOf(result);
	}

	private static void writeHeader(ByteArrayOutputStream output, int dataBytes) {
		output.writeBytes("RIFF".getBytes(StandardCharsets.US_ASCII));
		writeInt(output, 36 + dataBytes);
		output.writeBytes("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
		writeInt(output, 16);
		writeShort(output, (short) 1);
		writeShort(output, (short) CHANNELS);
		writeInt(output, SAMPLE_RATE);
		writeInt(output, SAMPLE_RATE * CHANNELS * Short.BYTES);
		writeShort(output, (short) (CHANNELS * Short.BYTES));
		writeShort(output, (short) (Short.SIZE));
		output.writeBytes("data".getBytes(StandardCharsets.US_ASCII));
		writeInt(output, dataBytes);
	}

	private static void writeShort(ByteArrayOutputStream output, short value) {
		output.write(value & 0xff);
		output.write((value >>> 8) & 0xff);
	}

	private static void writeInt(ByteArrayOutputStream output, int value) {
		output.write(value & 0xff);
		output.write((value >>> 8) & 0xff);
		output.write((value >>> 16) & 0xff);
		output.write((value >>> 24) & 0xff);
	}

	private enum Waveform { SINE, TRIANGLE }

	private record Voice(int startFrame, int stopFrame, double envelopeEnd, double frequencyHz,
			Waveform waveform, double peak, double gain) {
		double sample(int frame) {
			if (frame < startFrame || frame >= stopFrame) return 0;
			double elapsedFrames = frame - startFrame;
			double phase = 2.0 * StrictMath.PI * frequencyHz * elapsedFrames / SAMPLE_RATE;
			double oscillator = waveform == Waveform.SINE
					? StrictMath.sin(phase)
					: (2.0 / StrictMath.PI) * StrictMath.asin(StrictMath.sin(phase));
			return oscillator * envelope(elapsedFrames, envelopeEnd - startFrame, peak) * gain;
		}
	}

	private static double envelope(double elapsedFrames, double endFrame, double peak) {
		if (elapsedFrames <= RAMP_FRAMES) {
			return 0.0001 * StrictMath.exp(StrictMath.log(peak / 0.0001) * elapsedFrames / RAMP_FRAMES);
		}
		if (endFrame <= RAMP_FRAMES) return 0.0001;
		return peak * StrictMath.exp(StrictMath.log(0.0001 / peak) *
				(elapsedFrames - RAMP_FRAMES) / (endFrame - RAMP_FRAMES));
	}
}
