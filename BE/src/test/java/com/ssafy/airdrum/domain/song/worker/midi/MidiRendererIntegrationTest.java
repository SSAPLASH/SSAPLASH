package com.ssafy.airdrum.domain.song.worker.midi;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import com.ssafy.airdrum.domain.song.service.midi.MidiFixtures;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Tempo;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Timing;

/** 실제 합성기와 인코더가 지정된 환경에서만 실행한다. */
@EnabledIfEnvironmentVariable(named="MIDI_TEST_FLUIDSYNTH",matches=".+")
class MidiRendererIntegrationTest {
    @TempDir Path temp;
    @Test void actualFlacPreservesLeadingSilenceSamplesAndRelativeOnsets() throws Exception {
        String fluid=System.getenv("MIDI_TEST_FLUIDSYNTH"), font=System.getenv("MIDI_TEST_SOUNDFONT");
        String ffmpeg=System.getenv("MIDI_TEST_FFMPEG"), ffprobe=System.getenv("MIDI_TEST_FFPROBE");
        var midi=MidiFixtures.ppq(480).format0().tempo(0,120).tempo(960,60)
                .note(480,0,60,100,80).note(1200,0,60,100,80).drum(480,36).bytes();
        var timing=new Timing(120,0,"4/4",480,List.of(new Tempo(0,120),new Tempo(960,60)),null);
        try (var renderer=new MidiRenderer(fluid,font,ffmpeg,ffprobe)) {
            var result=renderer.render(midi,timing,3000,temp,System.nanoTime()+TimeUnit.SECONDS.toNanos(60),()->true);
            assertThat(result.size()).isPositive();
            Path raw=temp.resolve("decoded.raw");
            var process=new ProcessBuilder(ffmpeg,"-v","error","-y","-i",result.path().toString(),
                    "-f","s16le","-acodec","pcm_s16le",raw.toString()).redirectErrorStream(true).start();
            assertThat(process.waitFor(30,TimeUnit.SECONDS)).isTrue();
            assertThat(process.exitValue()).isZero();
            byte[] pcm=Files.readAllBytes(raw);
            assertThat(pcm.length).isEqualTo(3000L*44100/1000*4);
            for (int i=0;i<44100/4*4;i++) assertThat(pcm[i]).isZero();
            int a=onset(pcm,0.3,0.7),b=onset(pcm,1.3,1.7);
            assertThat(a).isGreaterThanOrEqualTo(0); assertThat(b).isGreaterThan(a);
            assertThat(Math.abs((b-a)*1000.0/44100-1000)).isLessThanOrEqualTo(5.0);
        }
    }
    private static int onset(byte[] pcm,double from,double to) {
        for (int i=(int)(from*44100);i<(int)(to*44100);i++) {
            int left=(short)((pcm[i*4]&255)|(pcm[i*4+1]<<8));
            int right=(short)((pcm[i*4+2]&255)|(pcm[i*4+3]<<8));
            if (Math.max(Math.abs(left),Math.abs(right))>=16) return i;
        }
        return -1;
    }
    @Test void actualThirtyMinuteFileDecodesToExactSampleCount() throws Exception {
        String fluid=System.getenv("MIDI_TEST_FLUIDSYNTH"), font=System.getenv("MIDI_TEST_SOUNDFONT");
        String ffmpeg=System.getenv("MIDI_TEST_FFMPEG"), ffprobe=System.getenv("MIDI_TEST_FFPROBE");
        var midi=MidiFixtures.ppq(480).format0().tempo(0,120).drum(0,36)
                .note(960,0,60,100,60).note(1_726_080,0,60,100,60).bytes();
        var timing=new Timing(120,0,"4/4",480,List.of(new Tempo(0,120)),null);
        try (var renderer=new MidiRenderer(fluid,font,ffmpeg,ffprobe)) {
            var result=renderer.render(midi,timing,1_800_000,temp,System.nanoTime()+TimeUnit.SECONDS.toNanos(300),()->true);
            var decoder=new ProcessBuilder(ffmpeg,"-v","error","-i",result.path().toString(),"-f","s16le","-acodec","pcm_s16le","-")
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            long bytes=0; byte[] buffer=new byte[65536]; int count;
            try (var input=decoder.getInputStream()) { while ((count=input.read(buffer))!=-1) bytes+=count; }
            assertThat(decoder.waitFor(60,TimeUnit.SECONDS)).isTrue();
            assertThat(decoder.exitValue()).isZero();
            assertThat(bytes).isEqualTo(1_800_000L*44100/1000*4);
        }
    }
}
