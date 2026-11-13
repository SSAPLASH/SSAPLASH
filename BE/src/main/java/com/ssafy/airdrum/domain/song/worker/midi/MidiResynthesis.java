package com.ssafy.airdrum.domain.song.worker.midi;

import java.io.PrintStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;

/** 운영자가 명시한 곡만 원본을 검증한 뒤 새 합성 작업으로 등록한다. */
public final class MidiResynthesis {
    private final MidiResynthesisSupport support;
    public MidiResynthesis(JdbcTemplate db,PlatformTransactionManager manager,MidiOriginalStore store) {
        support=new MidiResynthesisSupport(db,manager,store);
    }
    public int run(String[] args,PrintStream output) {
        boolean apply=false; var ids=new java.util.LinkedHashSet<Long>();
        for (String arg:args) {
            if ("--apply".equals(arg)) apply=true;
            else {
                try { long id=Long.parseLong(arg); if (id<=0) throw new NumberFormatException(); ids.add(id); }
                catch (NumberFormatException e) { output.println("사용법: --resynthesize [--apply] songId [songId ...]"); return 2; }
            }
        }
        if (ids.isEmpty()) { output.println("곡 ID를 하나 이상 지정하세요."); return 2; }
        int failures=0;
        for (long song:ids) {
            try {
                var source=support.lookup(song);
                if (source==null) { output.println(song+" SKIPPED (대상이 아님)"); continue; }
                if (!support.hasMelody(source)) { output.println(song+" SKIPPED (드럼 외 노트 없음)"); continue; }
                if (!apply) { output.println(song+" DRY_RUN (원본 확인)"); continue; }
                boolean inserted=support.enqueue(source,false);
                output.println(song+(inserted?" QUEUED":" SKIPPED (상태 변경 또는 진행 중)"));
            } catch (Exception e) { failures++; output.println(song+" ERROR (원본 또는 DB 확인 실패)"); }
        }
        return failures==0?0:1;
    }
}
