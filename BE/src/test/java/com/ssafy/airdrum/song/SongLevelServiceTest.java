package com.ssafy.airdrum.song;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.chart.ChartResponses.Note;
import static org.assertj.core.api.Assertions.*;
import static com.ssafy.airdrum.song.SongLevelService.Level.*;

class SongLevelServiceTest {
    private List<Note> evenly(int count, int duration) {
        var notes = new ArrayList<Note>();
        for (int i=0;i<count;i++) notes.add(new Note("n"+i, (double)i*duration/count, "SNARE", null, null));
        return notes;
    }
    private List<Note> simultaneous(int count) {
        var notes = new ArrayList<Note>();
        for (int i=0;i<count;i++) notes.add(new Note("n"+i, 0, "SNARE", null, null));
        return notes;
    }
    @Test void averageAndPeakBoundariesAreInclusive() {
        assertThat(SongLevelService.calculate(evenly(49,10000),10000)).isEqualTo(BEGINNER);
        assertThat(SongLevelService.calculate(evenly(50,10000),10000)).isEqualTo(INTERMEDIATE);
        assertThat(SongLevelService.calculate(evenly(69,10000),10000)).isEqualTo(INTERMEDIATE);
        assertThat(SongLevelService.calculate(evenly(70,10000),10000)).isEqualTo(ADVANCED);
        assertThat(SongLevelService.calculate(simultaneous(11),100000)).isEqualTo(BEGINNER);
        assertThat(SongLevelService.calculate(simultaneous(12),100000)).isEqualTo(INTERMEDIATE);
        assertThat(SongLevelService.calculate(simultaneous(15),100000)).isEqualTo(INTERMEDIATE);
        assertThat(SongLevelService.calculate(simultaneous(16),100000)).isEqualTo(ADVANCED);
    }
    @Test void windowsExcludeExactTwoSecondsAndRejectInvalidInput() {
        var notes = new ArrayList<>(simultaneous(11));
        notes.add(new Note("end",2000,"KICK",null,null));
        assertThat(SongLevelService.calculate(notes,100000)).isEqualTo(BEGINNER);
        notes.set(11,new Note("end",1999,"KICK",null,null));
        assertThat(SongLevelService.calculate(notes,100000)).isEqualTo(INTERMEDIATE);
        assertThatThrownBy(() -> SongLevelService.calculate(List.of(),1)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SongLevelService.calculate(simultaneous(1),0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SongLevelService.calculate(List.of(new Note("n",2001,"KICK",null,null)),2000)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SongLevelService.calculate(List.of(new Note("a",2,"KICK",null,null),new Note("b",1,"KICK",null,null)),2000)).isInstanceOf(IllegalArgumentException.class);
    }
}
