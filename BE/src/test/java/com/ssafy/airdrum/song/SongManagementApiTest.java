package com.ssafy.airdrum.song;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"auth.jwt.secret=test-only-jwt-secret-0123456789ab","auth.refresh-token.store=memory"})
class SongManagementApiTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db; @Autowired AccessTokenService tokens; @Autowired JsonMapper json;
    @Autowired com.ssafy.airdrum.withdrawal.WithdrawalService withdrawal;
    @MockitoBean CoverStorage storage;
    // 내장 서버의 HTTP/1.1 본문 검증에서 JDK 클라이언트의 h2c 업그레이드를 제외한다.
    final HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
    long owner,other,song,builtin; String token,otherToken;
    @BeforeEach void setup() {
        owner=db.queryForObject("INSERT INTO users(nickname) VALUES('cover owner') RETURNING id",Long.class);
        SignupConsentFixtures.complete(db, owner);
        other=db.queryForObject("INSERT INTO users(nickname) VALUES('cover other') RETURNING id",Long.class);
        SignupConsentFixtures.complete(db, other);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,artist,source,status) VALUES(?,'original','artist','MIDI','READY') RETURNING id",Long.class,owner);
        builtin=db.queryForObject("INSERT INTO songs(title,source,status,license) VALUES('builtin','BUILTIN','READY','test') RETURNING id",Long.class);
        token=tokens.issue(new AuthUser(owner,UserRole.USER),Instant.now()).token(); otherToken=tokens.issue(new AuthUser(other,UserRole.USER),Instant.now()).token();
        when(storage.sign(anyString())).thenAnswer(i->"https://example.test/signed/"+i.getArgument(0));
    }
    @AfterEach void cleanup() {
        try {
            db.update("DELETE FROM file_cleanup_tasks WHERE user_id IN (?,?)",owner,other);
            db.update("DELETE FROM sheet_music WHERE owner_id IN (?,?)",owner,other);
            db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)",song);
            db.update("DELETE FROM charts WHERE song_id=?",song);
            db.update("DELETE FROM songs WHERE id IN (?,?)",song,builtin);
            db.update("DELETE FROM users WHERE id IN (?,?)",owner,other);
        } finally { client.shutdownNow(); }
    }
    HttpResponse<String> call(String method,String path,String tok,String contentType,HttpRequest.BodyPublisher body) throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(java.time.Duration.ofSeconds(20)).method(method,body);
        if(tok!=null) b.header("Authorization","Bearer "+tok); if(contentType!=null) b.header("Content-Type",contentType);
        return client.send(b.build(),HttpResponse.BodyHandlers.ofString());
    }
    String path() { return "/api/v1/songs/"+song; }
    HttpResponse<String> patch(String value,String tok) throws Exception { return call("PATCH",path(),tok,"application/json",HttpRequest.BodyPublishers.ofString(value)); }
    byte[] img(String format) throws Exception { var out=new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(4,4,BufferedImage.TYPE_INT_RGB),format,out); return out.toByteArray(); }
    byte[] multipart(byte[] data,String name,String filename,boolean extra) throws Exception {
        var out=new ByteArrayOutputStream(); out.write(("--test-boundary\r\nContent-Disposition: form-data; name=\""+name+"\"; filename=\""+filename+"\"\r\nContent-Type: text/plain\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        out.write(data); out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
        if(extra) out.write("--test-boundary\r\nContent-Disposition: form-data; name=\"extra\"\r\n\r\nx\r\n".getBytes(StandardCharsets.US_ASCII));
        out.write("--test-boundary--\r\n".getBytes(StandardCharsets.US_ASCII)); return out.toByteArray();
    }
    HttpResponse<String> upload(byte[] bytes,String name,boolean chunked,boolean extra) throws Exception {
        byte[] multipart=multipart(bytes,name,"disguised.txt",extra);
        var body=chunked ? HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(multipart)) : HttpRequest.BodyPublishers.ofByteArray(multipart);
        return call("PUT",path()+"/cover",token,"multipart/form-data; boundary=test-boundary",body);
    }
    /** 248: 곡을 지우면 연결된 악보도 같은 트랜잭션에서 소프트 삭제되고 페이지 파일이 바로 정리 대상이 된다. 곡 없는 악보는 그대로다. */
    @Test void deletingSongSoftDeletesLinkedSheetAndQueuesItsPages() throws Exception {
        long linked=db.queryForObject("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes,song_id) VALUES(?,'곡 악보','UPLOADED','IMAGE',1,10,?) RETURNING id",Long.class,owner,song);
        String key="sheet-music/"+owner+"/"+linked+"/page1.png";
        db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes,width,height) VALUES(?,1,?,'image/png',10,4,4)",linked,key);
        long loose=db.queryForObject("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes) VALUES(?,'곡 없는 악보','UPLOADED','IMAGE',1,10) RETURNING id",Long.class,owner);
        db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes,width,height) VALUES(?,1,?,'image/png',10,4,4)",loose,"sheet-music/"+owner+"/"+loose+"/page1.png");
        var detail=call("GET",path(),token,null,HttpRequest.BodyPublishers.noBody());
        assertThat(detail.statusCode()).isEqualTo(200);
        assertThat(json.readTree(detail.body()).path("sheetId").asLong()).isEqualTo(linked);

        assertThat(call("DELETE",path(),token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(204);

        assertThat(db.queryForObject("SELECT deleted_at IS NOT NULL FROM sheet_music WHERE id=?",Boolean.class,linked)).isTrue();
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=? AND file_role='SHEET_MUSIC' AND user_id=? AND next_attempt_at<=clock_timestamp()",Integer.class,key,owner)).isEqualTo(1);
        assertThat(call("GET","/api/v1/sheets/"+linked,token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(404);
        // 곡 없는 악보는 그대로다(상세 GET은 악보 저장소 서명이 필요해 이 테스트에서는 DB로 확인한다)
        assertThat(db.queryForObject("SELECT deleted_at IS NULL FROM sheet_music WHERE id=?",Boolean.class,loose)).isTrue();
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key LIKE ? AND file_role='SHEET_MUSIC'",Integer.class,"sheet-music/"+owner+"/"+loose+"/%")).isZero();
    }
    @Test void patchValidationOwnershipAndBusy() throws Exception {
        assertThat(patch("{\"title\":\"  changed  \"}",token).statusCode()).isEqualTo(200);
        assertThat(db.queryForObject("SELECT title FROM songs WHERE id=?",String.class,song)).isEqualTo("changed");
        assertThat(patch("{\"artist\":\"  \"}",token).statusCode()).isEqualTo(200);
        assertThat(db.queryForObject("SELECT artist FROM songs WHERE id=?",String.class,song)).isNull();
        for(String bad:java.util.List.of("{}","null","{\"title\":null}","{\"title\":\" \"}","{\"bad\":1}","{\"title\":\"a\\u0000b\"}","{\"title\":\"a\",\"title\":\"b\"}","{\"title\":\"a\"} {}")) {
            var r=patch(bad,token); assertThat(r.statusCode()).isEqualTo(400); assertThat(json.readTree(r.body()).path("code").asString()).isEqualTo("SONG_INVALID");
        }
        assertThat(patch("{\"title\":\"x\"}",otherToken).statusCode()).isEqualTo(403);
        assertThat(call("PUT",path()+"/cover",otherToken,"multipart/form-data; boundary=test-boundary",HttpRequest.BodyPublishers.ofByteArray(multipart(img("png"),"file","x",false))).statusCode()).isEqualTo(403);
        assertThat(call("DELETE",path()+"/cover",otherToken,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(403);
        assertThat(patch("{\"title\":\"x\"}",null).statusCode()).isEqualTo(401);
        assertThat(call("PATCH","/api/v1/songs/"+builtin,token,"application/json",HttpRequest.BodyPublishers.ofString("{\"title\":\"x\"}")).statusCode()).isEqualTo(403);
        db.update("UPDATE songs SET status='FAILED' WHERE id=?",song);
        assertThat(patch("{\"title\":\"failed renamed\"}",token).statusCode()).isEqualTo(200);
        db.update("UPDATE songs SET status='PROCESSING' WHERE id=?",song);
        assertThat(patch("{\"title\":\"x\"}",token).statusCode()).isEqualTo(409);
        assertThat(call("DELETE",path(),token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(409);
        assertThat(call("DELETE",path()+"/cover",token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(204);
        assertThat(upload(img("png"),"file",false,false).statusCode()).isEqualTo(200);
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?",song);
        assertThat(patch("{\"title\":\"x\"}",token).statusCode()).isEqualTo(404);
    }
    @Test void contentDetectionAndLimitsWithRealHttp() throws Exception {
        byte[] png=img("png"),jpg=img("jpeg"),gif=img("gif");
        byte[] webp=Base64.getDecoder().decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
        assertThat(upload(png,"file",true,false).statusCode()).isEqualTo(200);
        assertThat(upload(jpg,"file",false,false).statusCode()).isEqualTo(200);
        assertThat(upload(webp,"file",false,false).statusCode()).isEqualTo(200);
        assertThat(upload(gif,"file",false,false).statusCode()).isEqualTo(415);
        assertThat(upload(java.util.Arrays.copyOf(png,png.length-8),"file",false,false).statusCode()).isEqualTo(400);
        byte[] huge=png.clone(); java.nio.ByteBuffer.wrap(huge,16,4).putInt(4097);
        var crc=new java.util.zip.CRC32(); crc.update(huge,12,17); java.nio.ByteBuffer.wrap(huge,29,4).putInt((int)crc.getValue());
        assertThat(upload(huge,"file",false,false).statusCode()).isEqualTo(400);
        assertThat(upload(java.util.Arrays.copyOf(jpg,jpg.length-8),"file",false,false).statusCode()).isEqualTo(400);
        assertThat(upload("<html>".getBytes(StandardCharsets.UTF_8),"file",false,false).statusCode()).isEqualTo(400);
        assertThat(upload(png,"wrong",false,false).statusCode()).isEqualTo(400);
        assertThat(upload(png,"file",false,true).statusCode()).isEqualTo(400);
        assertThat(upload(new byte[2*1024*1024],"file",true,false).statusCode()).isEqualTo(400);
        assertThat(upload(new byte[2*1024*1024+1],"file",true,false).statusCode()).isEqualTo(413);
        String digits=Long.toString(song); String encoded="%"+Integer.toHexString(digits.charAt(0))+digits.substring(1);
        byte[] oversized=multipart(new byte[2*1024*1024+1],"file","x",false);
        var encodedResponse=call("PUT","/api/v1/songs/"+encoded+"/cover",token,"multipart/form-data; boundary=test-boundary",HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(oversized)));
        assertThat(encodedResponse.statusCode()).isEqualTo(413);
        var invalidId=call("PUT","/api/v1/songs/abc/cover",token,"multipart/form-data; boundary=test-boundary",HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(oversized)));
        assertThat(invalidId.statusCode()).isEqualTo(400);
        byte[] one=multipart(png,"file","x",false);
        String prefix=new String(one,StandardCharsets.ISO_8859_1).replace("--test-boundary--\r\n", "");
        byte[] duplicate=(prefix+new String(one,StandardCharsets.ISO_8859_1)).getBytes(StandardCharsets.ISO_8859_1);
        assertThat(call("PUT",path()+"/cover",token,"multipart/form-data; boundary=test-boundary",HttpRequest.BodyPublishers.ofByteArray(duplicate)).statusCode()).isEqualTo(400);
    }
    @Test void coverVisibilityDeleteAndReferencesRemain() throws Exception {
        var initial=call("GET",path(),token,null,HttpRequest.BodyPublishers.noBody());
        assertThat(json.readTree(initial.body()).path("coverUrl").isNull()).isTrue();
        var upload=upload(img("png"),"file",false,false); assertThat(upload.statusCode()).isEqualTo(200);
        String key=db.queryForObject("SELECT cover_key FROM songs WHERE id=?",String.class,song);
        assertThat(key).startsWith("cover/"+owner+"/"+song+"/");
        var detail=json.readTree(call("GET",path(),token,null,HttpRequest.BodyPublishers.noBody()).body());
        assertThat(detail.path("coverUrl").asString()).startsWith("https://example.test/");
        assertThat(call("GET",path(),otherToken,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(404);
        var list=json.readTree(call("GET","/api/v1/songs?source=MINE",token,null,HttpRequest.BodyPublishers.noBody()).body());
        assertThat(list.path("items").get(0).path("coverUrl").asString()).isNotEmpty();
        assertThat(call("DELETE",path()+"/cover",token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(204);
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=? AND file_role='COVER'",Integer.class,key)).isEqualTo(1);
        assertThat(call("DELETE",path()+"/cover",token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(204);
        long chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'HARD') RETURNING id",Long.class,song);
        db.update("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,'[]'::jsonb,'{}'::jsonb,'UNAVAILABLE',0,'MIDI_RULE')",chart);
        assertThat(call("DELETE",path(),token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(204);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_versions WHERE chart_id=?",Integer.class,chart)).isEqualTo(1);
        assertThat(call("GET",path(),token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(404);
    }
    @Test void uploadRacingDeletionLeavesNoPointerAndKeepsOrphan() throws Exception {
        var entered=new java.util.concurrent.CountDownLatch(1); var release=new java.util.concurrent.CountDownLatch(1);
        doAnswer(i->{ entered.countDown(); if(!release.await(10,java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException(); return null; }).when(storage).put(anyString(),any(),anyString());
        try(var pool=java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var uploading=pool.submit(()->upload(img("png"),"file",false,false));
            assertThat(entered.await(10,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            assertThat(call("DELETE",path(),token,null,HttpRequest.BodyPublishers.noBody()).statusCode()).isEqualTo(204);
            release.countDown(); assertThat(uploading.get(10,java.util.concurrent.TimeUnit.SECONDS).statusCode()).isEqualTo(404);
        } finally { release.countDown(); }
        assertThat(db.queryForObject("SELECT cover_key FROM songs WHERE id=?",String.class,song)).isNull();
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND file_role='COVER'",Integer.class,owner)).isEqualTo(1);
    }
    @Test void uploadRacingWithdrawalCannotPublishCover() throws Exception {
        var entered=new java.util.concurrent.CountDownLatch(1); var release=new java.util.concurrent.CountDownLatch(1);
        doAnswer(i->{ entered.countDown(); if(!release.await(10,java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException(); return null; }).when(storage).put(anyString(),any(),anyString());
        try(var pool=java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var uploading=pool.submit(()->upload(img("png"),"file",false,false));
            assertThat(entered.await(10,java.util.concurrent.TimeUnit.SECONDS)).isTrue(); withdrawal.withdraw(owner);
            release.countDown(); assertThat(uploading.get(10,java.util.concurrent.TimeUnit.SECONDS).statusCode()).isEqualTo(401);
        } finally { release.countDown(); }
        assertThat(db.queryForObject("SELECT cover_key FROM songs WHERE id=?",String.class,song)).isNull();
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND file_role='COVER'",Integer.class,owner)).isEqualTo(1);
    }
    @Test void databaseFailureAfterPutPreservesOrphanTask() throws Exception {
        db.execute("CREATE FUNCTION cover_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.cover_key IS NOT NULL THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$");
        db.execute("CREATE TRIGGER cover_test_fail BEFORE UPDATE ON songs FOR EACH ROW EXECUTE FUNCTION cover_test_fail()");
        try {
            assertThat(upload(img("png"),"file",false,false).statusCode()).isEqualTo(500);
            assertThat(db.queryForObject("SELECT cover_key FROM songs WHERE id=?",String.class,song)).isNull();
            assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND file_role='COVER'",Integer.class,owner)).isEqualTo(1);
        } finally { db.execute("DROP TRIGGER IF EXISTS cover_test_fail ON songs"); db.execute("DROP FUNCTION IF EXISTS cover_test_fail()"); }
    }
    @Test void concurrentReplacementsRegisterDisplacedKey() throws Exception {
        var entered=new java.util.concurrent.CountDownLatch(2); var release=new java.util.concurrent.CountDownLatch(1);
        doAnswer(i->{ entered.countDown(); if(!release.await(10,java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException(); return null; }).when(storage).put(anyString(),any(),anyString());
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var first=pool.submit(()->upload(img("png"),"file",false,false)); var second=pool.submit(()->upload(img("png"),"file",false,false));
            assertThat(entered.await(10,java.util.concurrent.TimeUnit.SECONDS)).isTrue(); release.countDown();
            assertThat(first.get(10,java.util.concurrent.TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertThat(second.get(10,java.util.concurrent.TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        } finally { release.countDown(); }
        var keys=db.queryForList("SELECT object_key FROM file_cleanup_tasks WHERE user_id=? AND file_role='COVER'",String.class,owner);
        assertThat(keys).hasSize(2);
        String current=db.queryForObject("SELECT cover_key FROM songs WHERE id=?",String.class,song);
        assertThat(keys).contains(current);
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND file_role='COVER' AND object_key<>? AND next_attempt_at<=now()",Integer.class,owner,current)).isEqualTo(1);
    }
    @Test void failedPutLeavesDurableOrphan() throws Exception {
        doThrow(new com.ssafy.airdrum.common.error.BusinessException(SongManagementError.COVER_UNAVAILABLE)).when(storage).put(anyString(),any(),anyString());
        assertThat(upload(img("png"),"file",false,false).statusCode()).isEqualTo(503);
        assertThat(db.queryForObject("SELECT cover_key FROM songs WHERE id=?",String.class,song)).isNull();
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND file_role='COVER'",Integer.class,owner)).isEqualTo(1);
    }
}
