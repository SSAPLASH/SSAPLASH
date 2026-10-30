package com.ssafy.airdrum.chart.withdrawal;

import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy;

/** 곡을 잠근 트랜잭션에서 자산 정리 작업을 등록한다. */
@Component
public class SongAssetCleanup {
    private final JdbcTemplate db;
    private final ChartAssetKeyPolicy keys;
    public SongAssetCleanup(JdbcTemplate db,ChartAssetKeyPolicy keys) { this.db=db; this.keys=keys; }
    public void registerAll(long user,long song,String accompaniment,String cover) {
        if(accompaniment!=null) register(user,song,null,accompaniment);
        if(cover!=null) cover(user,song,cover);
        db.query("SELECT v.id,p->>'imageKey' FROM chart_versions v JOIN charts c ON c.id=v.chart_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.sheet_pages,'[]'::jsonb)) p WHERE c.song_id=?", r -> { register(user,song,r.getLong(1),r.getString(2)); },song);
    }
    public void cover(long user,long song,String key) {
        try { keys.cover(user,song,key); }
        catch(IllegalStateException ex) { LoggerFactory.getLogger(getClass()).warn("커버 자산 귀속 오류 userId={} songId={}",user,song); return; }
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'COVER',?) ON CONFLICT(object_key) DO UPDATE SET next_attempt_at=least(file_cleanup_tasks.next_attempt_at,clock_timestamp())",key,user);
    }
    /** 공용 곡(156번). 소유자가 없어 user_id는 NULL이다. */
    public void registerBuiltin(long song,String accompaniment,String cover) {
        if(accompaniment!=null) builtinAccompaniment(song,accompaniment);
        if(cover!=null) builtinCover(song,cover);
    }
    public void builtinCover(long song,String key) {
        try { keys.builtinCover(song,key); }
        catch(IllegalStateException ex) { LoggerFactory.getLogger(getClass()).warn("공용 곡 커버 귀속 오류 songId={}",song); return; }
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES(?,'COVER') ON CONFLICT(object_key) DO UPDATE SET next_attempt_at=least(file_cleanup_tasks.next_attempt_at,clock_timestamp())",key);
    }
    public void builtinAccompaniment(long song,String key) {
        try { keys.accompaniment(song,key); }
        catch(IllegalStateException ex) { LoggerFactory.getLogger(getClass()).warn("공용 곡 반주 귀속 오류 songId={}",song); return; }
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES(?,'ACCOMPANIMENT') ON CONFLICT(object_key) DO UPDATE SET next_attempt_at=least(file_cleanup_tasks.next_attempt_at,clock_timestamp())",key);
    }
    private void register(long user,long song,Long version,String key) {
        try { if(version==null) keys.accompaniment(song,key); else keys.sheet(version,key); }
        catch(IllegalStateException ex) { LoggerFactory.getLogger(getClass()).warn("곡 자산 귀속 오류 userId={} songId={} versionId={}",user,song,version); return; }
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,?,?) ON CONFLICT(object_key) DO NOTHING",key,version==null ? "ACCOMPANIMENT" : "SHEET_PAGE",user);
    }
}
