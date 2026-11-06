package com.ssafy.airdrum.chart.worker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HexFormat;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;

import com.ssafy.airdrum.chart.ChartDocumentReader;
import com.ssafy.airdrum.chart.ChartVersionRepository;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.midi.DifficultyThinner;
import com.ssafy.airdrum.song.midi.DrumNote;
import com.ssafy.airdrum.song.midi.DrumPad;

/**
 * AI 채보 JSON(schemaVersion 1, NORMAL 하나)을 검증하고 HARD 원본·NORMAL·EASY 파생으로 나눈다. 음원 워커 결과 저장({@link WorkerResults})과
 * MusicXML 업로드(293번 {@code song.musicxml})가 같은 규칙을 쓰려고 {@code WorkerResults}에서 꺼냈다. 동작은 꺼내기 전과 같다.
 *
 * <p>검증 실패는 {@link WorkerError#RESULT_INVALID}다. 부르는 쪽이 자기 오류 코드로 바꾼다.
 */
@Component
public class TranscriptionCharts {
    private static final Set<String> PADS=Set.of("KICK","SNARE","HIHAT","HIHAT_PEDAL","SMALL_TOM","MID_TOM","FLOOR_TOM","CRASH","RIDE");
    private final WorkerPayload payload;
    private final ChartDocumentReader documents;

    TranscriptionCharts(WorkerPayload payload, ChartDocumentReader documents) { this.payload=payload; this.documents=documents; }

    /**
     * @param notes          HARD(원본) 노트 JSON 배열 문자열
     * @param normalNotes    NORMAL 파생 노트(원본 JSON·배열 순서 보존)
     * @param easyNotes      EASY 파생 노트
     * @param generatorVersion 입력 원문. 파생 버전은 {@link #derivedVersion(String)}
     */
    public record ChartData(String notes,String normalNotes,String easyNotes,String timing,String notationStatus,int noteCount,int normalCount,int easyCount,String generatorVersion,
            java.math.BigDecimal bpm,int offset,String timeSignature,String metrics) {}

    private static BusinessException invalid() { return new BusinessException(WorkerError.RESULT_INVALID); }
    private static void require(boolean condition) { if(!condition) throw invalid(); }

    /** 결과 봉투의 {@code result}(채보 JSON)를 검증하고 3난이도로 나눈다. {@code duration}은 곡 길이 ms(노트 timeMs 상한). */
    public ChartData parse(JsonNode n,int duration) {
        require(n.path("schemaVersion").isIntegralNumber() && n.path("schemaVersion").canConvertToInt() && n.path("schemaVersion").asInt()==1
                && n.path("generator").isString() && "ADT_MODEL".equals(n.path("generator").asString()) && n.path("generatorVersion").isString()
                && !n.path("generatorVersion").asString().isBlank() && n.path("generatorVersion").asString().length()<=50
                && n.path("metrics").isObject() && n.path("charts").isArray() && n.path("charts").size()==1);
        var c=n.path("charts").get(0);
        require(c.isObject() && c.path("difficulty").isString() && "NORMAL".equals(c.path("difficulty").asString()) && c.path("notes").isArray()
                && c.path("notes").size()<=50000 && c.path("timing").isObject()
                && c.path("notationStatus").isString() && Set.of("READY","PENDING","UNAVAILABLE").contains(c.path("notationStatus").asString()) && !c.has("sheetPages"));
        int count=c.path("notes").size();
        for(var note:c.path("notes")) {
            require(note.isObject() && note.path("timeMs").isIntegralNumber() && note.path("timeMs").canConvertToLong()
                    && note.path("timeMs").asLong()>=0 && note.path("timeMs").asLong()<=duration
                    && note.path("pad").isString() && PADS.contains(note.path("pad").asString()));
            var hihatOpen=note.get("hihatOpen");
            require(hihatOpen==null || hihatOpen.isNull() || hihatOpen.isBoolean());
            if("READY".equals(c.path("notationStatus").asString())) require(note.path("notation").isObject());
        }
        if("READY".equals(c.path("notationStatus").asString())) require(count>0
                && c.path("timing").path("ppq").isIntegralNumber() && c.path("timing").path("ppq").canConvertToInt() && c.path("timing").path("ppq").asInt()>0
                && c.path("timing").path("tempoMap").isArray() && !c.path("timing").path("tempoMap").isEmpty()
                && c.path("timing").path("timeSignatureMap").isArray() && !c.path("timing").path("timeSignatureMap").isEmpty());
        String notes=payload.write(c.path("notes")), timing=payload.write(c.path("timing")), status=c.path("notationStatus").asString();
        try { documents.detail(new Detail(notes,timing,status,count,duration)); }
        catch(RuntimeException x) { throw invalid(); }
        var t=c.path("timing");
        double bpm=t.path("bpm").doubleValue();
        require(Double.isFinite(bpm) && bpm>=0.01 && bpm<=9999.99 && t.path("offsetMs").isIntegralNumber()
                && t.path("offsetMs").canConvertToInt() && t.path("timeSignature").asString().length()<=5);
        var source=c.path("notes");
        boolean useTicks=t.path("ppq").isIntegralNumber() && t.path("ppq").canConvertToInt() && t.path("ppq").asInt()>0;
        for (var note:source) useTicks &= note.path("notation").isObject();
        int ppq=useTicks ? t.path("ppq").asInt() : 480;
        var virtualTicks=useTicks ? null : VirtualTicks.of(t,bpm,ppq);
        var drumNotes=new ArrayList<DrumNote>();
        var originals=new IdentityHashMap<DrumNote,JsonNode>();
        for (var note:source) {
            long tick=useTicks ? note.path("notation").path("tick").asLong() : virtualTicks.tick(note.path("timeMs").asLong());
            int velocity=note.path("velocityHint").isIntegralNumber() ? note.path("velocityHint").asInt() : 100;
            var drum=new DrumNote(tick,DrumPad.valueOf(note.path("pad").asString()),velocity,0);
            drumNotes.add(drum); originals.put(drum,note);
        }
        var thinned=DifficultyThinner.thin(drumNotes,ppq);
        var hard=thinned.get(DifficultyThinner.Difficulty.HARD);
        var normalKept=thinned.get(DifficultyThinner.Difficulty.NORMAL);
        var easyKept=thinned.get(DifficultyThinner.Difficulty.EASY);
        // 공통 규칙의 빈 결과 폴백이 HARD라면 병합 전 원본을 복원한다.
        var normal=normalKept==hard ? originalNotes(source) : selected(source,originals,normalKept);
        var easy=easyKept==hard ? originalNotes(source) : selected(source,originals,easyKept);
        return new ChartData(notes,payload.write(normal),payload.write(easy),timing,status,count,normal.size(),easy.size(),n.path("generatorVersion").asString(),
                java.math.BigDecimal.valueOf(bpm).setScale(2,java.math.RoundingMode.HALF_UP),
                t.path("offsetMs").asInt(),t.path("timeSignature").asString(),payload.write(n.path("metrics")));
    }
    /**
     * notation이 없는 노트의 난이도 줄이기용 틱. timing.tempoMap(빠르기가 바뀌는 곡)이 있으면 구간마다 그 bpm으로,
     * 없으면 timing.bpm 하나로 offsetMs부터 센다. tempoMap 틱은 timing.ppq 단위라 박 수로 바꾼 뒤 솎기 ppq를 곱한다.
     * 구간 시작 시각·박 수는 채보마다 한 번만 계산하고, 노트마다 이분 탐색으로 구간을 찾는다(노트 N, 구간 M에서 O(M + N log M)).
     */
    static final class VirtualTicks {
        private final double offsetMs, bpm;
        private final int ppq;
        private final double[] startMs, startBeat, rate;

        private VirtualTicks(double offsetMs,double bpm,int ppq,double[] startMs,double[] startBeat,double[] rate) {
            this.offsetMs=offsetMs; this.bpm=bpm; this.ppq=ppq; this.startMs=startMs; this.startBeat=startBeat; this.rate=rate;
        }

        static VirtualTicks of(JsonNode timing,double bpm,int ppq) {
            double offset=timing.path("offsetMs").asInt();
            var map=timing.path("tempoMap");
            int mapPpq=timing.path("ppq").isIntegralNumber() ? timing.path("ppq").asInt() : 0;
            if(!map.isArray() || map.size()<2 || mapPpq<=0) return new VirtualTicks(offset,bpm,ppq,null,null,null);
            int m=map.size();
            double[] startMs=new double[m], startBeat=new double[m], rate=new double[m];
            for(int i=0;i<m;i++) {
                startBeat[i]=map.get(i).path("tick").asLong()/(double)mapPpq;
                rate[i]=map.get(i).path("bpm").doubleValue();
                startMs[i]=i==0 ? 0 : startMs[i-1]+(startBeat[i]-startBeat[i-1])*60000.0/rate[i-1];
            }
            return new VirtualTicks(offset,bpm,ppq,startMs,startBeat,rate);
        }

        long tick(long timeMs) {
            double ms=timeMs-offsetMs;
            if(startMs==null) return Math.max(0,Math.round(ms*bpm*ppq/60000.0));
            int i=Arrays.binarySearch(startMs,ms);
            if(i<0) i=Math.max(0,-i-2);
            double beats=startBeat[i]+(ms-startMs[i])*rate[i]/60000.0;
            return Math.max(0,Math.round(beats*ppq));
        }
    }
    private static List<JsonNode> originalNotes(JsonNode source) {
        var result=new ArrayList<JsonNode>();
        for (var node:source) result.add(node);
        return result;
    }
    private static List<JsonNode> selected(JsonNode source,IdentityHashMap<DrumNote,JsonNode> originals,List<DrumNote> kept) {
        var selected=Collections.newSetFromMap(new IdentityHashMap<JsonNode,Boolean>());
        for (var note:kept) selected.add(originals.get(note));
        var result=new ArrayList<JsonNode>();
        for (var node:source) if(selected.contains(node)) result.add(node);
        return result;
    }
    /** 파생 난이도의 generator_version: 원문 + {@code +midi-rule-1.1}. 50자를 넘으면 원문 앞부분과 SHA-256 앞 12자리로 결정적으로 줄인다. */
    public static String derivedVersion(String original) {
        String suffix="+"+DifficultyThinner.RULE_VERSION;
        if(original.length()+suffix.length()<=50) return original+suffix;
        try {
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(original.getBytes(StandardCharsets.UTF_8))).substring(0,12);
            int end=50-suffix.length()-hash.length()-1;
            if (Character.isHighSurrogate(original.charAt(end-1)) && Character.isLowSurrogate(original.charAt(end))) end--;
            return original.substring(0,end)+"~"+hash+suffix;
        } catch(NoSuchAlgorithmException x) { throw new IllegalStateException(x); }
    }
    private record Detail(String notes,String timing,String notationStatus,int noteCount,int duration) implements ChartVersionRepository.Detail {
        public Long getSongId(){return 1L;} public Long getChartId(){return 1L;} public String getDifficulty(){return "NORMAL";}
        public Long getChartVersionId(){return 1L;} public int getVersion(){return 1;} public int getNoteCount(){return noteCount;}
        public String getNotationStatus(){return notationStatus;} public int getSchemaVersion(){return 1;} public String getTitle(){return "검증";}
        public String getSource(){return "AUDIO";} public String getStatus(){return "READY";} public Integer getDurationMs(){return duration;}
        public String getTiming(){return timing;} public String getSheetPages(){return null;} public String getNotes(){return notes;}
    }
}
