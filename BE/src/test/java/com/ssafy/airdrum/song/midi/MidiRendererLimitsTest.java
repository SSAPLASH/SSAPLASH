package com.ssafy.airdrum.song.midi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class MidiRendererLimitsTest {
    @TempDir Path temp;
    private List<String> command(String... args) throws Exception {
        var result=new ArrayList<String>();
        result.add(Path.of(System.getProperty("java.home"),"bin","java").toString());
        result.add("-cp"); result.add(Path.of(MidiProcessFixture.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString());
        result.add(MidiProcessFixture.class.getName()); result.addAll(List.of(args)); return result;
    }
    @Test void outputIsBoundedButBothPipesAreDrained() throws Exception {
        try (var renderer=new MidiRenderer("","","","")) {
            String captured=renderer.run(command("spam"),temp,System.nanoTime()+TimeUnit.SECONDS.toNanos(10),()->true);
            assertThat(captured).hasSize(65536);
        }
    }
    @Test void temporaryOutputLimitStopsTheChild() throws Exception {
        try (var renderer=new MidiRenderer("","","","",100,100)) {
            assertThatThrownBy(()->renderer.run(command("large",temp.resolve("output.flac").toString()),temp,
                    System.nanoTime()+TimeUnit.SECONDS.toNanos(10),()->true)).isInstanceOf(IllegalArgumentException.class);
        }
    }
    @Test void deadlineTerminatesDescendantProcess() throws Exception {
        Path pid=temp.resolve("child.pid"); long start=System.nanoTime();
        try (var renderer=new MidiRenderer("","","","")) {
            assertThatThrownBy(()->renderer.run(command("spawn",pid.toString()),temp,
                    System.nanoTime()+TimeUnit.SECONDS.toNanos(3),()->true)).isInstanceOf(IllegalStateException.class);
        }
        assertThat(TimeUnit.NANOSECONDS.toSeconds(System.nanoTime()-start)).isLessThan(8);
        assertThat(Files.exists(pid)).isTrue();
        long child=Long.parseLong(Files.readString(pid));
        assertThat(ProcessHandle.of(child).map(ProcessHandle::isAlive).orElse(false)).isFalse();
    }
    @Test void nonzeroExitIsPermanentFailure() throws Exception {
        try (var renderer=new MidiRenderer("","","","")) {
            assertThatThrownBy(()->renderer.run(command("unsupported"),temp,
                    System.nanoTime()+TimeUnit.SECONDS.toNanos(10),()->true)).isInstanceOf(IllegalArgumentException.class);
        }
    }
}
