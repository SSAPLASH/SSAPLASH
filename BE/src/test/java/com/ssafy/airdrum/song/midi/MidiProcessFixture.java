package com.ssafy.airdrum.song.midi;

import java.nio.file.Files;
import java.nio.file.Path;

/** 프로세스 제한 테스트 전용. 운영 JAR에는 포함되지 않는다. */
public class MidiProcessFixture {
    public static void main(String[] args) throws Exception {
        switch (args[0]) {
            case "spam" -> { byte[] bytes=new byte[1024]; java.util.Arrays.fill(bytes,(byte)'x');
                for (int i=0;i<1024;i++) { System.out.write(bytes); System.err.write(bytes); } }
            case "large" -> { Files.write(Path.of(args[1]),new byte[101]); Thread.sleep(60_000); }
            case "spawn" -> {
                String java=Path.of(System.getProperty("java.home"),"bin","java").toString();
                String classes=Path.of(MidiProcessFixture.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
                Process child=new ProcessBuilder(java,"-cp",classes,MidiProcessFixture.class.getName(),"sleep").start();
                Files.writeString(Path.of(args[1]),Long.toString(child.pid())); Thread.sleep(60_000);
            }
            case "sleep" -> Thread.sleep(60_000);
            default -> throw new IllegalArgumentException();
        }
    }
}
