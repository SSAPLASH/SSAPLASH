package com.ssafy.airdrum.chart.worker;

import static org.assertj.core.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory",
    "chart.worker.recovery-interval-ms=86400000"})
class JobProgressWebSocketTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired AccessTokenService tokens;
    @Autowired JsonMapper json;
    @Autowired WorkerQueue queue;
    @Autowired WorkerResults results;
    @Autowired WorkerPayload payload;
    @Autowired PlatformTransactionManager manager;
    final HttpClient client=HttpClient.newHttpClient();
    long user,other,song,job;
    String ownerToken,otherToken;
    static final String HASH="a".repeat(64);
    @BeforeEach void setup() {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('ws owner') RETURNING id",Long.class);
        SignupConsentFixtures.complete(db, user);
        other=db.queryForObject("INSERT INTO users(nickname) VALUES('ws other') RETURNING id",Long.class);
        SignupConsentFixtures.complete(db, other);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'ws song','AUDIO','PROCESSING',60000) RETURNING id",Long.class,user);
        String key="source-audio/"+UUID.randomUUID();
        job=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,source_key,idempotency_key,request_hash) VALUES(?,?,?,?,?) RETURNING id",Long.class,song,user,key,UUID.randomUUID().toString(),HASH);
        db.update("INSERT INTO audio_uploads(id,user_id,job_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at) VALUES(?,?,?,?,'audio/wav',100,?,60000,'ACCEPTED',now()+interval '1 hour')",UUID.randomUUID(),user,job,key,HASH);
        ownerToken=tokens.issue(new AuthUser(user,UserRole.USER),Instant.now()).token();
        otherToken=tokens.issue(new AuthUser(other,UserRole.USER),Instant.now()).token();
    }
    @AfterEach void cleanup() {
        db.update("DELETE FROM file_cleanup_tasks WHERE job_id=?",job);
        db.update("DELETE FROM chart_job_results WHERE job_id=?",job);
        db.update("DELETE FROM chart_worker_files WHERE job_id=?",job);
        db.update("DELETE FROM audio_uploads WHERE user_id=?",user);
        db.update("UPDATE chart_jobs SET status='FAILED',finished_at=coalesce(finished_at,now()),current_attempt_id=NULL WHERE id=?",job);
        db.update("DELETE FROM chart_job_attempts WHERE job_id=?",job);
        db.update("DELETE FROM chart_jobs WHERE id=?",job);
        db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)",song);
        db.update("DELETE FROM charts WHERE song_id=?",song);
        db.update("DELETE FROM songs WHERE id=?",song);
        db.update("DELETE FROM users WHERE id IN (?,?)",user,other);
    }
    class Listener implements WebSocket.Listener {
        final BlockingQueue<String> messages=new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed=new CompletableFuture<>();
        final StringBuilder text=new StringBuilder();
        @Override public void onOpen(WebSocket ws) { ws.request(1); }
        @Override public java.util.concurrent.CompletionStage<?> onText(WebSocket ws,CharSequence data,boolean last) { text.append(data); if(last) { messages.add(text.toString()); text.setLength(0); } ws.request(1); return null; }
        @Override public java.util.concurrent.CompletionStage<?> onPing(WebSocket ws,java.nio.ByteBuffer data) { ws.request(1); return WebSocket.Listener.super.onPing(ws,data); }
        @Override public java.util.concurrent.CompletionStage<?> onClose(WebSocket ws,int code,String reason) { closed.complete(code); return null; }
        @Override public void onError(WebSocket ws,Throwable error) { closed.completeExceptionally(error); }
        JsonNode next() throws Exception { String message=messages.poll(8,TimeUnit.SECONDS); assertThat(message).isNotNull(); return json.readTree(message); }
    }
    WebSocket connect(String suffix,String origin,Listener listener) {
        return client.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5)).header("Origin",origin)
                .buildAsync(URI.create("ws://127.0.0.1:"+port+"/ws/jobs/"+job+suffix),listener).join();
    }
    void auth(WebSocket ws,String token) { ws.sendText(json.writeValueAsString(java.util.Map.of("type","AUTH","accessToken",token)),true).join(); }
    HttpResponse<String> get(String path,String token) throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(8)).GET();
        if(token!=null) b.header("Authorization","Bearer "+token);
        return client.send(b.build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void noDataBeforeAuthAndHandshakeRejectsQueryAndOrigin() throws Exception {
        var listener=new Listener(); connect("","http://localhost:5173",listener);
        assertThat(listener.messages.poll(1,TimeUnit.SECONDS)).isNull();
        assertThat(listener.closed.get(7,TimeUnit.SECONDS)).isEqualTo(1008);
        assertThat(listener.messages).isEmpty();
        assertThatThrownBy(()->connect("?accessToken=x","http://localhost:5173",new Listener())).hasCauseInstanceOf(java.net.http.WebSocketHandshakeException.class);
        assertThatThrownBy(()->connect("","https://evil.example",new Listener())).hasCauseInstanceOf(java.net.http.WebSocketHandshakeException.class);
    }
    @Test void malformedAuthFramesAreRejectedWithoutData() throws Exception {
        for(String text:java.util.List.of("{", "{\"type\":\"AUTH\",\"accessToken\":\"x\"} {}",
                "{\"type\":\"AUTH\",\"type\":\"AUTH\",\"accessToken\":\"x\"}",
                "{\"type\":\"AUTH\",\"accessToken\":3}", "x".repeat(5000))) {
            var listener=new Listener(); var ws=connect("","http://localhost:5173",listener);
            ws.sendText(text,true).handle((ok,error)->null).join();
            assertThat(listener.closed.get(8,TimeUnit.SECONDS)).isIn(1008,1009);
            assertThat(listener.messages).isEmpty();
        }
    }
    @Test void authorizationAndRecoveryHideOtherDeletedOrInactiveJobs() throws Exception {
        assertThat(get("/api/v1/jobs/"+job,null).statusCode()).isEqualTo(401);
        assertThat(get("/api/v1/jobs/"+job,otherToken).statusCode()).isEqualTo(404);
        var listing=json.readTree(get("/api/v1/jobs?status=QUEUED&page=0&size=10",ownerToken).body());
        assertThat(listing.path("totalElements").asLong()).isEqualTo(1);
        assertThat(get("/api/v1/jobs?status=NOPE",ownerToken).statusCode()).isEqualTo(400);
        assertThat(get("/api/v1/jobs?size=101",ownerToken).statusCode()).isEqualTo(400);
        var otherListener=new Listener(); var otherWs=connect("","http://localhost:5173",otherListener); auth(otherWs,otherToken);
        assertThat(otherListener.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1008); assertThat(otherListener.messages).isEmpty();
        var bad=new Listener(); var badWs=connect("","http://localhost:5173",bad); auth(badWs,"invalid");
        assertThat(bad.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1008); assertThat(bad.messages).isEmpty();
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?",song);
        assertThat(get("/api/v1/jobs/"+job,ownerToken).statusCode()).isEqualTo(404);
        var deleted=new Listener(); var deletedWs=connect("","http://localhost:5173",deleted); auth(deletedWs,ownerToken);
        assertThat(deleted.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1008); assertThat(deleted.messages).isEmpty();
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);
        assertThat(get("/api/v1/jobs/"+job,ownerToken).statusCode()).isEqualTo(401);
    }
    @Test void committedProgressRetryAndFailureAreOrderedAndRollbackInvisible() throws Exception {
        var listener=new Listener(); var ws=connect("","http://localhost:5173",listener); auth(ws,ownerToken);
        JsonNode initial=listener.next(); assertThat(initial).isEqualTo(json.readTree(get("/api/v1/jobs/"+job,ownerToken).body()));
        var assignment=queue.claim("worker1",UUID.randomUUID()); assertThat(assignment.jobId()).isEqualTo(job);
        JsonNode claimed=listener.next(); assertThat(claimed.path("status").asString()).isEqualTo("SEPARATING");
        queue.heartbeat(job,"worker1",assignment.attemptId(),1,35);
        JsonNode progress=listener.next(); assertThat(progress.path("progress").asInt()).isEqualTo(35);
        queue.heartbeat(job,"worker1",assignment.attemptId(),1,30);
        assertThat(listener.messages.poll(1500,TimeUnit.MILLISECONDS)).isNull();
        new TransactionTemplate(manager).executeWithoutResult(tx->{ db.update("UPDATE chart_jobs SET progress=40,revision=revision+1 WHERE id=?",job); tx.setRollbackOnly(); });
        assertThat(listener.messages.poll(1500,TimeUnit.MILLISECONDS)).isNull();
        queue.failure(job,"worker1",assignment.attemptId(),2,"SEPARATING","MODEL_FAILED",true,"secret value");
        JsonNode retried=listener.next(); assertThat(retried.path("status").asString()).isEqualTo("QUEUED");
        assertThat(retried.path("progress").asInt()).isZero(); assertThat(retried.path("revision").asLong()).isGreaterThan(progress.path("revision").asLong());
        db.update("UPDATE chart_jobs SET status='FAILED',finished_at=now(),error_code='OUTPUT_INVALID',error_message='secret path',revision=revision+1 WHERE id=?",job);
        JsonNode failed=listener.next(); assertThat(failed.path("status").asString()).isEqualTo("FAILED");
        assertThat(failed.toString()).doesNotContain("secret"); assertThat(listener.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1000);
        var again=new Listener(); var newWs=connect("","http://localhost:5173",again); auth(newWs,ownerToken);
        assertThat(again.next()).isEqualTo(failed); assertThat(again.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1000);
    }
    @Test void transcriptionResultProducesThreeVersionsAndTerminalSnapshot() throws Exception {
        var listener=new Listener(); var ws=connect("","http://localhost:5173",listener); auth(ws,ownerToken); listener.next();
        var assignment=queue.claim("worker1",UUID.randomUUID());
        assertThat(listener.next().path("status").asString()).isEqualTo("SEPARATING");
        db.update("UPDATE chart_jobs SET status='TRANSCRIBING',progress=50,revision=revision+1 WHERE id=?",job);
        assertThat(listener.next().path("status").asString()).isEqualTo("TRANSCRIBING");
        var body=java.util.Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","fixture","metrics",java.util.Map.of(),
                "charts",java.util.List.of(java.util.Map.of("difficulty","NORMAL","notationStatus","UNAVAILABLE",
                        "notes",java.util.List.of(java.util.Map.of("noteId","n1","timeMs",0,"pad","SNARE")),
                        "timing",java.util.Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4"))));
        var result=json.valueToTree(body);
        var envelope=json.valueToTree(java.util.Map.of("contractVersion",1,"jobId",job,"attemptId",assignment.attemptId(),
                "resultId",UUID.randomUUID(),"payloadHash",payload.hash(result),"result",body));
        var receipt=results.transcription(job,"worker1",envelope);
        assertThat(receipt.chartVersionIds()).hasSize(3);
        var done=listener.next(); assertThat(done.path("status").asString()).isEqualTo("DONE"); assertThat(done.path("progress").asInt()).isEqualTo(100);
        assertThat(listener.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1000);
        assertThat(json.readTree(get("/api/v1/jobs/"+job,ownerToken).body())).isEqualTo(done);
        var again=new Listener(); var reconnect=connect("","http://localhost:5173",again); auth(reconnect,ownerToken);
        assertThat(again.next()).isEqualTo(done); assertThat(again.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1000);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?",Integer.class,song)).isEqualTo(3);
    }
    @Test void idleAuthenticatedConnectionClosesWhenTokenExpires() throws Exception {
        String shortToken=tokens.issue(new AuthUser(user,UserRole.USER),Instant.now().minus(Duration.ofMinutes(30)).plusSeconds(6)).token();
        var listener=new Listener(); var ws=connect("","http://localhost:5173",listener); auth(ws,shortToken);
        assertThat(listener.next().path("status").asString()).isEqualTo("QUEUED");
        assertThat(listener.closed.get(12,TimeUnit.SECONDS)).isEqualTo(1008); assertThat(listener.messages).isEmpty();
    }
    @Test void userConnectionLimitIsReleasedWhenSocketCloses() throws Exception {
        var listeners=new java.util.ArrayList<Listener>(); var sockets=new java.util.ArrayList<WebSocket>();
        for(int i=0;i<4;i++) { var l=new Listener(); var ws=connect("","http://localhost:5173",l); auth(ws,ownerToken); l.next(); listeners.add(l); sockets.add(ws); }
        var fifth=new Listener(); var fifthWs=connect("","http://localhost:5173",fifth); auth(fifthWs,ownerToken);
        assertThat(fifth.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1013); assertThat(fifth.messages).isEmpty();
        sockets.getFirst().sendClose(1000,"done").join(); assertThat(listeners.getFirst().closed.get(8,TimeUnit.SECONDS)).isEqualTo(1000);
        var replacement=new Listener(); var newSocket=connect("","http://localhost:5173",replacement); auth(newSocket,ownerToken); replacement.next();
        newSocket.sendClose(1000,"done").join();
        for(int i=1;i<sockets.size();i++) sockets.get(i).sendClose(1000,"done").join();
    }
    @Test void revokeDeletionAndExpiredTokenStopFurtherData() throws Exception {
        var listener=new Listener(); var ws=connect("","http://localhost:5173",listener); auth(ws,ownerToken); listener.next();
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?",song);
        assertThat(listener.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1008); assertThat(listener.messages).isEmpty();
        db.update("UPDATE songs SET deleted_at=NULL WHERE id=?",song);
        var second=new Listener(); var ws2=connect("","http://localhost:5173",second); auth(ws2,ownerToken); second.next();
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);
        assertThat(second.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1008); assertThat(second.messages).isEmpty();
        db.update("UPDATE users SET status='ACTIVE',withdrawn_at=NULL WHERE id=?",user);
        String expired=tokens.issue(new AuthUser(user,UserRole.USER),Instant.now().minus(Duration.ofMinutes(31))).token();
        var third=new Listener(); var ws3=connect("","http://localhost:5173",third); auth(ws3,expired);
        assertThat(third.closed.get(8,TimeUnit.SECONDS)).isEqualTo(1008); assertThat(third.messages).isEmpty();
    }
}
