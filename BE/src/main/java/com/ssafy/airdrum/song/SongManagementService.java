package com.ssafy.airdrum.song;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.chart.ChartErrorCode;
import com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy;
import com.ssafy.airdrum.chart.withdrawal.SongAssetCleanup;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.sheet.SheetSongLink;

@Service
public class SongManagementService {
    private final JdbcTemplate db; private final TransactionTemplate tx;
    private final SongAssetCleanup assets; private final CoverStorage storage; private final ChartAssetKeyPolicy keys;
    private final SheetSongLink sheets;
    public SongManagementService(JdbcTemplate db,PlatformTransactionManager manager,SongAssetCleanup assets,CoverStorage storage,ChartAssetKeyPolicy keys,SheetSongLink sheets) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(15); this.assets=assets; this.storage=storage; this.keys=keys; this.sheets=sheets;
    }
    record Song(String status,String accompaniment,String cover) {}
    private Song lock(long user,long id,boolean busy) {
        var users=db.queryForList("SELECT status FROM users WHERE id=? FOR SHARE",String.class,user);
        if(users.isEmpty() || !"ACTIVE".equals(users.getFirst())) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        var rows=db.query("SELECT owner_id,source,status,deleted_at,accompaniment_key,cover_key FROM songs WHERE id=? FOR UPDATE",(r,n)->new Object[]{r.getObject(1,Long.class),r.getString(2),r.getString(3),r.getTimestamp(4),r.getString(5),r.getString(6)},id);
        if(rows.isEmpty() || rows.getFirst()[3]!=null) throw new BusinessException(ChartErrorCode.SONG_NOT_FOUND);
        var row=rows.getFirst();
        if(row[0]==null || !row[0].equals(user) || "BUILTIN".equals(row[1])) throw new BusinessException(SongManagementError.SONG_FORBIDDEN);
        if(busy && "PROCESSING".equals(row[2])) throw new BusinessException(SongManagementError.SONG_BUSY);
        return new Song((String)row[2],(String)row[4],(String)row[5]);
    }
    public void patch(long user,long id,boolean titlePresent,String title,boolean artistPresent,String artist) {
        tx.executeWithoutResult(x->{ lock(user,id,true);
            if(titlePresent && artistPresent) db.update("UPDATE songs SET title=?,artist=?,updated_at=clock_timestamp() WHERE id=?",title,artist,id);
            else if(titlePresent) db.update("UPDATE songs SET title=?,updated_at=clock_timestamp() WHERE id=?",title,id);
            else db.update("UPDATE songs SET artist=?,updated_at=clock_timestamp() WHERE id=?",artist,id);
        });
    }
    public void requireWritable(long user,long id) { tx.executeWithoutResult(x->lock(user,id,false)); }
    public String upload(long user,long id,CoverImage.Image image) {
        String key="cover/"+user+"/"+id+"/"+UUID.randomUUID()+"."+image.extension();
        keys.cover(user,id,key);
        tx.executeWithoutResult(x->{ lock(user,id,false); db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,next_attempt_at) VALUES(?,'COVER',?,clock_timestamp()+interval '5 minutes')",key,user); });
        storage.put(key,image.bytes(),image.contentType());
        String url=storage.sign(key);
        tx.executeWithoutResult(x->{
            var row=lock(user,id,false);
            var allowed=db.queryForList("SELECT id FROM file_cleanup_tasks WHERE object_key=? AND file_role='COVER' AND status='PENDING' AND next_attempt_at>clock_timestamp() FOR UPDATE",Long.class,key);
            if(allowed.isEmpty()) throw new BusinessException(SongManagementError.COVER_UNAVAILABLE);
            db.update("UPDATE songs SET cover_key=?,updated_at=clock_timestamp() WHERE id=?",key,id);
            if(row.cover()!=null) assets.cover(user,id,row.cover());
        });
        return url;
    }
    public void deleteCover(long user,long id) {
        tx.executeWithoutResult(x->{ var row=lock(user,id,false); if(row.cover()!=null) {
            db.update("UPDATE songs SET cover_key=NULL,updated_at=clock_timestamp() WHERE id=?",id); assets.cover(user,id,row.cover());
        }});
    }
    /** 248: 연결된 내 악보도 같은 트랜잭션에서 소프트 삭제하고 페이지 파일을 정리 대상으로 등록한다. */
    public void deleteSong(long user,long id) {
        tx.executeWithoutResult(x->{ var row=lock(user,id,true); assets.registerAll(user,id,row.accompaniment(),row.cover());
            sheets.deleteLinked(user,id);
            db.update("UPDATE songs SET deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=?",id);
        });
    }
}
