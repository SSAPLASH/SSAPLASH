package com.ssafy.airdrum.domain.song.model.midi;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import javax.sound.midi.MetaMessage;
import javax.sound.midi.MidiEvent;
import javax.sound.midi.MidiMessage;
import javax.sound.midi.MidiSystem;
import javax.sound.midi.Sequence;
import javax.sound.midi.ShortMessage;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Timing;

/** 채보의 BPM 맵을 0.1ms 간격의 고정 템포 MIDI에 적용한다. 원본은 변경하지 않는다. */
public final class MidiAccompanimentTiming {
    private static final int OUTPUT_PPQ = 10_000;
    private MidiAccompanimentTiming() {}

    private record Event(long tick, int track, int order, MidiMessage message) {}

    public static boolean hasMelody(byte[] bytes) throws Exception {
        var sequence = MidiSystem.getSequence(new ByteArrayInputStream(bytes));
        for (var track : sequence.getTracks()) for (int i = 0; i < track.size(); i++) {
            var message = track.get(i).getMessage();
            if (message instanceof ShortMessage m && m.getChannel() != 9
                    && m.getCommand() == ShortMessage.NOTE_ON && m.getData2() > 0) return true;
        }
        return false;
    }

    public static byte[] retime(byte[] bytes, Timing timing) throws Exception {
        Sequence source;
        try { source = MidiSystem.getSequence(new ByteArrayInputStream(bytes)); }
        catch (java.io.IOException | javax.sound.midi.InvalidMidiDataException e) {
            throw new IllegalArgumentException("저장된 MIDI 원본을 읽을 수 없습니다.",e);
        }
        if (source.getDivisionType() != Sequence.PPQ || timing.ppq() == null || timing.ppq() != source.getResolution()
                || timing.offsetMs() != 0 || timing.tempoMap() == null || timing.tempoMap().isEmpty())
            throw new IllegalArgumentException("MIDI 시간 기준이 올바르지 않습니다.");
        var events = new ArrayList<Event>();
        var tracks = source.getTracks();
        for (int t = 0; t < tracks.length; t++) for (int i = 0; i < tracks[t].size(); i++) {
            var event = tracks[t].get(i);
            var message = event.getMessage();
            if (message instanceof ShortMessage m && m.getStatus() < 0xf0 && m.getChannel() == 9) continue;
            if (message instanceof MetaMessage m && (m.getType() == 0x51 || m.getType() == 0x2f)) continue;
            events.add(new Event(event.getTick(), t, i, message));
        }
        var end = new MetaMessage();
        end.setMessage(0x2f, new byte[0], 0);
        events.add(new Event(source.getTickLength(), Integer.MAX_VALUE, Integer.MAX_VALUE, end));
        events.sort(Comparator.comparingLong(Event::tick).thenComparingInt(Event::track).thenComparingInt(Event::order));
        var output = new Sequence(Sequence.PPQ, OUTPUT_PPQ);
        var track = output.createTrack();
        var fixedTempo = new MetaMessage();
        fixedTempo.setMessage(0x51, new byte[] { 0x0f, 0x42, 0x40 }, 3);
        track.add(new MidiEvent(fixedTempo, 0));
        var tempos = timing.tempoMap();
        int current = 0;
        double atTempoMs = 0;
        for (var event : events) {
            while (current + 1 < tempos.size() && tempos.get(current + 1).tick() <= event.tick()) {
                var previous = tempos.get(current);
                long nextTick = tempos.get(current + 1).tick();
                atTempoMs += (nextTick - previous.tick()) * 60000.0 / timing.ppq() / previous.bpm();
                current++;
            }
            var active = tempos.get(current);
            double ms = atTempoMs + (event.tick() - active.tick()) * 60000.0 / timing.ppq() / active.bpm();
            if (!Double.isFinite(ms) || ms < 0 || ms > 1_800_000.1)
                throw new IllegalArgumentException("MIDI 이벤트 시각이 범위를 벗어났습니다.");
            track.add(new MidiEvent(event.message(), Math.round(ms * 10)));
        }
        var result = new ByteArrayOutputStream();
        if (MidiSystem.write(output, 0, result) <= 0) throw new IllegalStateException("MIDI 생성 실패");
        return result.toByteArray();
    }
}
