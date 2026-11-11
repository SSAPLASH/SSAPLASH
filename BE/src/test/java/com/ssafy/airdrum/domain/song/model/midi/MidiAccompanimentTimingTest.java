package com.ssafy.airdrum.domain.song.model.midi;

import static org.assertj.core.api.Assertions.assertThat;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import javax.sound.midi.MetaMessage;
import javax.sound.midi.MidiEvent;
import javax.sound.midi.MidiSystem;
import javax.sound.midi.Sequence;
import javax.sound.midi.ShortMessage;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Tempo;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Timing;
import com.ssafy.airdrum.domain.chart.model.ChartDocumentReader;
import tools.jackson.databind.json.JsonMapper;

class MidiAccompanimentTimingTest {
    @Test void keepsMelodyOnMixedTrackAndUsesRoundedChartTempoAcrossChanges() throws Exception {
        var source = new Sequence(Sequence.PPQ, 480);
        var first = source.createTrack();
        add(first, ShortMessage.NOTE_ON, 9, 36, 100, 0);
        add(first, ShortMessage.PROGRAM_CHANGE, 0, 3, 0, 0);
        add(first, ShortMessage.NOTE_ON, 0, 60, 100, 480);
        add(first, ShortMessage.NOTE_OFF, 0, 60, 0, 960);
        var second = source.createTrack();
        add(second, ShortMessage.NOTE_ON, 1, 64, 100, 960);
        var output = new ByteArrayOutputStream();
        MidiSystem.write(source, 1, output);
        byte[] bytes = output.toByteArray();
        var timing = new Timing(123.45, 0, "4/4", 480,
                List.of(new Tempo(0, 123.45), new Tempo(480, 99.99)), null);
        assertThat(MidiAccompanimentTiming.hasMelody(bytes)).isTrue();
        var result = MidiSystem.getSequence(new ByteArrayInputStream(MidiAccompanimentTiming.retime(bytes, timing)));
        assertThat(result.getResolution()).isEqualTo(10_000);
        var messages = new ArrayList<MidiEvent>();
        for (int i = 0; i < result.getTracks()[0].size(); i++) {
            var e = result.getTracks()[0].get(i);
            if (e.getMessage() instanceof ShortMessage) messages.add(e);
        }
        assertThat(messages).hasSize(4);
        assertThat(messages).allSatisfy(e -> assertThat(((ShortMessage)e.getMessage()).getChannel()).isNotEqualTo(9));
        assertThat(messages.get(1).getTick() / 10.0).isCloseTo(60000.0 / 123.45, org.assertj.core.data.Offset.offset(0.051));
        assertThat(messages.get(2).getTick() / 10.0).isCloseTo(60000.0 / 123.45 + 60000.0 / 99.99, org.assertj.core.data.Offset.offset(0.051));
        assertThat(((ShortMessage)messages.get(2).getMessage()).getCommand()).isEqualTo(ShortMessage.NOTE_OFF);
        assertThat(((ShortMessage)messages.get(3).getMessage()).getChannel()).isEqualTo(1);
        long tempos = java.util.stream.IntStream.range(0, result.getTracks()[0].size())
                .mapToObj(result.getTracks()[0]::get).map(MidiEvent::getMessage)
                .filter(m -> m instanceof MetaMessage meta && meta.getType() == 0x51).count();
        assertThat(tempos).isEqualTo(1);
    }

    @Test void velocityZeroOutsideDrumsDoesNotRequestSynthesis() throws Exception {
        var source = new Sequence(Sequence.PPQ, 480);
        var track = source.createTrack();
        add(track, ShortMessage.NOTE_ON, 9, 36, 100, 0);
        add(track, ShortMessage.NOTE_ON, 0, 60, 0, 0);
        var out = new ByteArrayOutputStream();
        MidiSystem.write(source, 0, out);
        assertThat(MidiAccompanimentTiming.hasMelody(out.toByteArray())).isFalse();
    }
    @Test void everyEventStaysWithinPointZeroFiveOneMsAtTempoBoundsAndThirtyMinutes() throws Exception {
        var reader=new ChartDocumentReader(new JsonMapper());
        for (double bpm:new double[]{3.58,120.0,999.0}) {
            int ppq=480; long end=(long)Math.floor(1_799_000.0*bpm*ppq/60000);
            var source=new Sequence(Sequence.PPQ,ppq); var track=source.createTrack();
            long[] ticks={0,1,end/4,end/2,3*end/4,end};
            for (int i=0;i<ticks.length;i++) add(track,ShortMessage.NOTE_ON,0,50+i,100,ticks[i]);
            var out=new ByteArrayOutputStream(); MidiSystem.write(source,0,out);
            var timing=new Timing(bpm,0,"4/4",ppq,List.of(new Tempo(0,bpm)),null);
            var result=MidiSystem.getSequence(new ByteArrayInputStream(MidiAccompanimentTiming.retime(out.toByteArray(),timing)));
            var actual=new ArrayList<MidiEvent>();
            for (int i=0;i<result.getTracks()[0].size();i++) {
                var event=result.getTracks()[0].get(i); if (event.getMessage() instanceof ShortMessage) actual.add(event);
            }
            assertThat(actual).hasSize(ticks.length);
            for (int i=0;i<ticks.length;i++)
                assertThat(Math.abs(actual.get(i).getTick()/10.0-reader.milliseconds(timing,ticks[i]))).isLessThanOrEqualTo(0.051);
        }
    }
    @Test void roundingCollisionsPreserveSourceTickAndTrackOrder() throws Exception {
        var source=new Sequence(Sequence.PPQ,32767); var first=source.createTrack(); var second=source.createTrack();
        add(first,ShortMessage.NOTE_ON,0,60,100,1);
        add(second,ShortMessage.NOTE_ON,1,61,100,1);
        add(first,ShortMessage.NOTE_ON,0,62,100,2);
        var out=new ByteArrayOutputStream(); MidiSystem.write(source,1,out);
        var timing=new Timing(999,0,"4/4",32767,List.of(new Tempo(0,999)),null);
        var result=MidiSystem.getSequence(new ByteArrayInputStream(MidiAccompanimentTiming.retime(out.toByteArray(),timing)));
        var pitches=new ArrayList<Integer>();
        for (int i=0;i<result.getTracks()[0].size();i++) {
            var event=result.getTracks()[0].get(i);
            if (event.getMessage() instanceof ShortMessage message) { assertThat(event.getTick()).isZero(); pitches.add(message.getData1()); }
        }
        assertThat(pitches).containsExactly(60,61,62);
    }
    @Test void trailingEndOfTrackAndSysexRemainOnOriginalTimeAxis() throws Exception {
        var source=new Sequence(Sequence.PPQ,480); var track=source.createTrack();
        add(track,ShortMessage.NOTE_ON,0,60,100,0);
        var sysex=new javax.sound.midi.SysexMessage();
        byte[] data={(byte)0xf0,0x7e,0x7f,0x09,0x01,(byte)0xf7}; sysex.setMessage(data,data.length);
        track.add(new MidiEvent(sysex,480));
        var end=new MetaMessage(); end.setMessage(0x2f,new byte[0],0);
        track.add(new MidiEvent(end,3840));
        var bytes=new ByteArrayOutputStream(); MidiSystem.write(source,0,bytes);
        var timing=new Timing(120,0,"4/4",480,List.of(new Tempo(0,120)),null);
        var result=MidiSystem.getSequence(new ByteArrayInputStream(MidiAccompanimentTiming.retime(bytes.toByteArray(),timing)));
        assertThat(result.getTickLength()).isEqualTo(40_000);
        boolean sysexFound=false;
        for (int i=0;i<result.getTracks()[0].size();i++) {
            var event=result.getTracks()[0].get(i);
            if (event.getMessage() instanceof javax.sound.midi.SysexMessage) {
                sysexFound=true; assertThat(event.getTick()).isEqualTo(5_000);
            }
        }
        assertThat(sysexFound).isTrue();
    }
    private static void add(javax.sound.midi.Track track, int command, int channel, int d1, int d2, long tick) throws Exception {
        var message = new ShortMessage(); message.setMessage(command, channel, d1, d2);
        track.add(new MidiEvent(message,tick));
    }
}
