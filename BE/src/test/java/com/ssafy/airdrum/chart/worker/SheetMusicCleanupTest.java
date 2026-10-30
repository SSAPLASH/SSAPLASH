package com.ssafy.airdrum.chart.worker;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 155번 설계 4절: 정리 큐는 살아 있는 내 악보 파일을 지우지 않고, 악보 삭제·탈퇴 뒤에는 악보 버킷에서 지운다. */
@SpringBootTest(properties={"auth.jwt.secret=test-only-jwt-secret-0123456789ab","auth.refresh-token.store=memory","chart.worker.cleanup-interval-ms=86400000"})
class SheetMusicCleanupTest {
    @Autowired JdbcTemplate db; @Autowired WorkerCleanup cleanup;
    @MockitoBean S3WorkerStore store;
    long user,sheet; String key;
    @BeforeEach void setup() {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('sheet cleanup') RETURNING id",Long.class);
        sheet=db.queryForObject("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes) VALUES(?,'정리 악보','UPLOADED','IMAGE',1,10) RETURNING id",Long.class,user);
        key="sheet-music/"+user+"/"+sheet+"/"+UUID.randomUUID()+".png";
        db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes) VALUES(?,1,?,'image/png',10)",sheet,key);
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'SHEET_MUSIC',?)",key,user);
        when(store.exists(any(),anyString())).thenReturn(true);
    }
    @AfterEach void clean() { db.update("DELETE FROM file_cleanup_tasks WHERE user_id=?",user); db.update("DELETE FROM sheet_music WHERE owner_id=?",user); db.update("DELETE FROM users WHERE id=?",user); }

    @Test void livePageIsProtectedUntilSheetDeleted() {
        cleanup.runOnce();
        verify(store,never()).delete(any(),eq(key));
        db.update("UPDATE sheet_music SET deleted_at=now() WHERE id=?",sheet);
        cleanup.runOnce();
        verify(store).delete(WorkerStore.Bucket.SHEET,key);
    }

    @Test void withdrawnOwnersPagesAreDeleted() {
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);
        cleanup.runOnce();
        verify(store).delete(WorkerStore.Bucket.SHEET,key);
    }

    @Test void unlinkedUploadIsDeleted() {
        String orphan="sheet-music/"+user+"/"+sheet+"/"+UUID.randomUUID()+".png";
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'SHEET_MUSIC',?)",orphan,user);
        cleanup.runOnce();
        verify(store).delete(WorkerStore.Bucket.SHEET,orphan);
        verify(store,never()).delete(any(),eq(key));
    }
}
