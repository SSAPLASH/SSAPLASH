package com.ssafy.airdrum.domain.song.worker.midi;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.ssafy.airdrum.domain.song.service.midi.MidiFixtures;
import com.ssafy.airdrum.domain.song.storage.midi.MidiBackingStore;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;
import com.ssafy.airdrum.domain.chart.model.ChartDocumentReader;
import tools.jackson.databind.json.JsonMapper;

class MidiWorkerFailureTest {
    @TempDir Path temp;
    @Test void malformedMidiIsPermanentFailure() throws Exception {
        run(new byte[]{1,2,3},"{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\",\"ppq\":480,\"tempoMap\":[{\"tick\":0,\"bpm\":120}]}");
    }
    @Test void malformedStoredTimingIsPermanentFailure() throws Exception {
        run(MidiFixtures.ppq(480).drum(0,36).note(480,0,60,100,120).bytes(),"{}");
    }
    private void run(byte[] midi,String timing) throws Exception {
        var queue=mock(MidiSynthesisQueue.class); var source=mock(MidiOriginalStore.class); var backing=mock(MidiBackingStore.class);
        when(source.get(anyString(),anyInt(),anyString(),anyLong())).thenReturn(midi);
        var claim=new MidiSynthesisQueue.Claim(1,2,3,UUID.randomUUID(),"key",midi.length,"hash",timing,1000,1,
                System.nanoTime()+TimeUnit.SECONDS.toNanos(30));
        try (var renderer=new MidiRenderer("","","","")) {
            MidiWorkerMain.execute(claim,queue,source,backing,renderer,new ChartDocumentReader(new JsonMapper()),temp);
        }
        verify(queue).fail(claim,false,"SYNTHESIS_INVALID");
        verify(queue,never()).reserveOutput(any());
    }
}
