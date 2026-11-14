package com.ssafy.airdrum.domain.play.controller.history;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import com.ssafy.airdrum.domain.play.repository.session.PlaySessionRepository;
import com.ssafy.airdrum.domain.play.service.history.PlayQueryService;
import com.ssafy.airdrum.domain.play.support.PlayFixtures;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="auth.jwt.secret=test-only-jwt-secret-0123456789ab")
@AutoConfigureMockMvc
class PlayQueryApiTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired AccessTokenService tokens;
    @Autowired JsonMapper json;
    @Autowired PlayQueryService service;
    @MockitoSpyBean PlaySessionRepository sessions;
    long user, other;
    String token, otherToken;
    final List<Long> songs = new ArrayList<>();
    @BeforeEach void setup() {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES ('기록 본인') RETURNING id",Long.class);
        SignupConsentFixtures.complete(db, user);
        other=db.queryForObject("INSERT INTO users(nickname) VALUES ('기록 타인') RETURNING id",Long.class);
        SignupConsentFixtures.complete(db, other);
        token=token(user, UserRole.USER, Instant.now()); otherToken=token(other, UserRole.USER, Instant.now());
    }
    String token(long id,UserRole role,Instant when) { return tokens.issue(new AuthUser(id,role),when).token(); }
    @AfterEach void cleanup() {
        db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)",user,other);
        for(long song:songs) {
            db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)",song);
            db.update("DELETE FROM charts WHERE song_id=?",song);
            db.update("DELETE FROM songs WHERE id=?",song);
        }
        db.update("DELETE FROM users WHERE id IN (?,?)",user,other);
    }
    long song(Long owner,String source,String title,boolean published) {
        long id=db.queryForObject("INSERT INTO songs(owner_id,title,source,license,published) VALUES(?,?,?,?,?) RETURNING id",Long.class,owner,title,source,source.equals("BUILTIN")?"test license":null,published);
        songs.add(id); return id;
    }
    long version(long song,String difficulty,int n) {
        Long chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,?) ON CONFLICT(song_id,difficulty) DO UPDATE SET song_id=EXCLUDED.song_id RETURNING id",Long.class,song,difficulty);
        return db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,?,'[{\"noteId\":\"n1\",\"timeMs\":100,\"pad\":\"SNARE\"},{\"noteId\":\"n2\",\"timeMs\":200,\"pad\":\"KICK\"}]','{}','PENDING',2,'MANUAL') RETURNING id",Long.class,chart,n);
    }
    void insert(UUID id,long owner,String mode,Long song,Long version,String end) {
        db.update("INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,score,accuracy,max_combo,judgement_context,payload_schema_version,payload_hash,started_at,ended_at) VALUES(?,?,?,?,?,'KEYBOARD',?,?,?,?::jsonb,1,?,?::timestamptz,?::timestamptz)",id,owner,song,version,mode,song==null?null:100,song==null?null:new java.math.BigDecimal("50.25"),song==null?null:1,song==null?null:"{}","a".repeat(64),end,end);
    }
    JsonNode list(String auth,String query,int status) throws Exception {
        var request=get(java.net.URI.create("/api/v1/plays"+query)); if(auth!=null) request.header("Authorization","Bearer "+auth);
        var result=mvc.perform(request).andExpect(status().is(status)).andReturn().getResponse();
        return result.getContentAsString().isEmpty()?null:json.readTree(result.getContentAsString());
    }
    @Test void emptyAuthenticationAndPageBounds() throws Exception {
        list(null,"",401); list(token(user,UserRole.USER,Instant.now().minusSeconds(86400)),"",401);
        var empty=list(token,"",200); assertThat(empty.path("items").size()).isZero();
        assertThat(empty.path("totalElements").asLong()).isZero(); assertThat(empty.path("totalPages").asInt()).isZero();
        assertThat(empty.path("size").asInt()).isEqualTo(20);
        assertThat(list(token,"?page=100000",200).path("items").size()).isZero();
        for(String query:List.of("?page=-1","?page=100001","?size=0","?size=101"))
            assertThat(list(token,query,400).path("code").asString()).isEqualTo("VALIDATION_FAILED");
        list(token,"?page=x",400);
        for(int[] bad:new int[][]{{-1,20},{100001,20},{0,0},{0,101}})
            assertThatThrownBy(()->service.list(user,bad[0],bad[1],null,null,null,null,null)).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode()).isEqualTo(CommonErrorCode.VALIDATION_FAILED));
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);
        list(token,"",401); assertThatThrownBy(()->service.list(user,0,20,null,null,null,null,null)).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode()).isEqualTo(CommonErrorCode.UNAUTHORIZED));
    }
    @Test void visibleSongsAndAllModesKeepHistoricalReferences() throws Exception {
        long own=song(user,"MIDI","내 곡",true), foreign=song(other,"MIDI","타인 비밀",true);
        long visible=song(null,"BUILTIN","공개 곡",true), hidden=song(null,"BUILTIN","비공개 비밀",false), deleted=song(user,"MIDI","삭제 비밀",true);
        long ownOld=version(own,"NORMAL",1); version(own,"NORMAL",2);
        long foreignV=version(foreign,"HARD",1), visibleV=version(visible,"EASY",1), hiddenV=version(hidden,"HARD",1), deletedV=version(deleted,"EASY",1);
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?",deleted);
        List<Long> ss=List.of(own,foreign,visible,hidden,deleted); List<Long> vs=List.of(ownOld,foreignV,visibleV,hiddenV,deletedV);
        for(int i=0;i<ss.size();i++) insert(UUID.fromString("00000000-0000-0000-0000-00000000000"+(i+1)),user,i%2==0?"RHYTHM":"SHEET",ss.get(i),vs.get(i),"2026-01-01T00:00:00Z");
        insert(UUID.fromString("00000000-0000-0000-0000-000000000006"),user,"FREE",null,null,"2026-01-01T00:00:00Z");
        insert(UUID.fromString("00000000-0000-0000-0000-000000000007"),user,"TEMPO",null,null,"2026-01-01T00:00:00Z");
        insert(UUID.randomUUID(),other,"FREE",null,null,"2026-01-02T00:00:00Z");
        var response=mvc.perform(get("/api/v1/plays?size=100").header("Authorization","Bearer "+token)).andExpect(status().isOk()).andExpect(header().string("Cache-Control",org.hamcrest.Matchers.containsString("no-store"))).andExpect(header().string("Cache-Control",org.hamcrest.Matchers.containsString("no-cache"))).andReturn().getResponse();
        var page=json.readTree(response.getContentAsString()); assertThat(page.path("totalElements").asInt()).isEqualTo(7);
        var items=page.path("items"); assertThat(items.size()).isEqualTo(7);
        assertThat(items.get(0).path("mode").asString()).isEqualTo("TEMPO");
        assertThat(items.get(1).path("mode").asString()).isEqualTo("FREE");
        for (int i=0;i<2;i++) {
            var item=items.get(i);
            for (String field:List.of("songId","songTitle","chartVersionId","chartId","difficulty","endReason","score","accuracy","maxCombo"))
                assertThat(item.path(field).isNull()).as(field).isTrue();
            assertThat(item.path("songAccessible").asBoolean()).isFalse();
            assertThat(item.path("hasReport").asBoolean()).isFalse();
        }
        for(int i=0;i<5;i++) {
            var item=items.get(6-i); boolean access=i==0 || i==2;
            assertThat(item.path("songId").asLong()).isEqualTo(ss.get(i));
            assertThat(item.path("chartVersionId").asLong()).isEqualTo(vs.get(i));
            assertThat(item.path("songAccessible").asBoolean()).isEqualTo(access);
            if(access) assertThat(item.path("songTitle").asString()).isEqualTo(i==0?"내 곡":"공개 곡"); else assertThat(item.path("songTitle").isNull()).isTrue();
            assertThat(item.path("accuracy").asDouble()).isEqualTo(50.25); assertThat(item.path("hasReport").asBoolean()).isFalse();
            assertThat(item.has("userId")).isFalse(); assertThat(item.has("hits")).isFalse();
        }
        assertThat(items.get(6).path("difficulty").asString()).isEqualTo("NORMAL");
        assertThat(items.get(6).path("chartId").asLong()).isEqualTo(db.queryForObject("SELECT chart_id FROM chart_versions WHERE id=?",Long.class,ownOld));
        var first=list(token,"?page=0&size=3",200); var second=list(token,"?page=1&size=3",200);
        assertThat(first.path("totalPages").asInt()).isEqualTo(3); assertThat(first.path("hasNext").asBoolean()).isTrue();
        assertThat(second.path("totalPages").asInt()).isEqualTo(3); assertThat(second.path("hasNext").asBoolean()).isTrue();
        List<String> ids0=new ArrayList<>(), ids1=new ArrayList<>();
        first.path("items").forEach(x->ids0.add(x.path("playId").asString()));
        second.path("items").forEach(x->ids1.add(x.path("playId").asString()));
        assertThat(ids0).containsExactly(items.get(0).path("playId").asString(),items.get(1).path("playId").asString(),items.get(2).path("playId").asString());
        assertThat(ids1).containsExactly(items.get(3).path("playId").asString(),items.get(4).path("playId").asString(),items.get(5).path("playId").asString());
        assertThat(ids0).doesNotContainAnyElementsOf(ids1);
        assertThat(list(token,"?page=3&size=3",200).path("items").size()).isZero();
        assertThat(list(otherToken,"",200).path("totalElements").asInt()).isEqualTo(1);
        db.update("UPDATE users SET role='ADMIN' WHERE id=?",other);
        assertThat(list(token(other,UserRole.ADMIN,Instant.now()),"",200).path("totalElements").asInt()).isEqualTo(1);
    }
    @Test void filtersUseVisibleTitlesInclusiveKoreanDatesAndStablePagination() throws Exception {
        long own=song(user,"MIDI","Rock 100%_!",true), hidden=song(other,"MIDI","Rock 100%_!",true);
        long v=version(own,"NORMAL",1), hv=version(hidden,"NORMAL",1);
        UUID before=UUID.fromString("00000000-0000-0000-0000-000000000001"), first=UUID.fromString("00000000-0000-0000-0000-000000000002"), second=UUID.fromString("00000000-0000-0000-0000-000000000003"), after=UUID.fromString("00000000-0000-0000-0000-000000000004");
        insert(before,user,"RHYTHM",own,v,"2025-12-31T14:59:59.999999Z");
        insert(first,user,"RHYTHM",own,v,"2025-12-31T15:00:00Z");
        insert(second,user,"RHYTHM",own,v,"2025-12-31T15:00:00Z");
        insert(after,user,"RHYTHM",own,v,"2026-01-01T15:00:00Z");
        insert(UUID.randomUUID(),user,"SHEET",hidden,hv,"2026-01-01T14:59:59.999999Z");
        insert(UUID.randomUUID(),other,"RHYTHM",own,v,"2026-01-01T00:00:00Z");
        String query="?q=rock&from=2026-01-01&to=2026-01-01&mode=RHYTHM&size=1";
        var newest=list(token,query,200);
        assertThat(newest.path("totalElements").asInt()).isEqualTo(2);
        assertThat(newest.path("totalPages").asInt()).isEqualTo(2);
        assertThat(newest.path("items").get(0).path("playId").asString()).isEqualTo(second.toString());
        assertThat(list(token,query+"&page=1",200).path("items").get(0).path("playId").asString()).isEqualTo(first.toString());
        assertThat(list(token,query+"&sort=OLDEST",200).path("items").get(0).path("playId").asString()).isEqualTo(first.toString());
        assertThat(list(token,"?q=100%25_!&from=2026-01-01&to=2026-01-01",200).path("totalElements").asInt()).isEqualTo(2);
        assertThat(list(token,"?q=100%25x",200).path("totalElements").asInt()).isZero();
        assertThat(list(token,"?q=rock&mode=SHEET",200).path("totalElements").asInt()).isZero();
        assertThat(list(token,"?mode=SHEET",200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(list(token,"?from=2026-01-01&to=2026-01-01",200).path("totalElements").asInt()).isEqualTo(3);
        assertThat(list(token,"?to=2025-12-31",200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(list(token,"?from=2026-01-02",200).path("totalElements").asInt()).isEqualTo(1);
    }
    @Test void filterInputsAreValidated() throws Exception {
        for (String query:List.of("?from=2026-02-30", "?to=2026-1-01", "?from=2026-02-01&to=2026-01-01", "?mode=BAD", "?sort=bad", "?q="+"a".repeat(101)))
            assertThat(list(token,query,400).path("code").asString()).isEqualTo("VALIDATION_FAILED");
        assertThat(list(token,"?q=%20%20",200).path("totalElements").asInt()).isZero();
    }
    @Test void uploadListReportAndNotesFlow() throws Exception {
        long song=song(user,"MIDI","업로드 곡",true), version=version(song,"NORMAL",1); UUID play=UUID.randomUUID();
        mvc.perform(post("/api/v1/plays").header("Authorization","Bearer "+token).contentType(MediaType.APPLICATION_JSON).content(PlayFixtures.scored(play,song,version))).andExpect(status().isCreated());
        var item=list(token,"",200).path("items").get(0);
        assertThat(item.path("playId").asString()).isEqualTo(play.toString()); assertThat(item.path("hasReport").asBoolean()).isTrue();
        assertThat(item.path("accuracy").asDouble()).isEqualTo(50);
        mvc.perform(get("/api/v1/plays/"+play+"/report").header("Authorization","Bearer "+token)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/plays/"+play+"/report/notes").header("Authorization","Bearer "+token)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/plays/"+play+"/report").header("Authorization","Bearer "+otherToken)).andExpect(status().isNotFound());
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?",song);
        var afterDelete=list(token,"",200).path("items").get(0);
        assertThat(afterDelete.path("hasReport").asBoolean()).isTrue();
        assertThat(afterDelete.path("songAccessible").asBoolean()).isFalse();
        assertThat(afterDelete.path("songTitle").isNull()).isTrue();
        mvc.perform(get("/api/v1/plays/"+play+"/report").header("Authorization","Bearer "+token)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/plays/"+play+"/report/notes").header("Authorization","Bearer "+token)).andExpect(status().isOk());
    }
    @Test void listQueriesCountAndPageOnceRegardlessOfPageSize() throws Exception {
        insert(UUID.randomUUID(),user,"FREE",null,null,"2026-01-01T00:00:00Z");
        list(token,"",200);
        verify(sessions,times(1)).countForUser(eq(user), any());
        verify(sessions,times(1)).pageForUser(eq(user),eq(20),eq(0L),any());
        verifyNoMoreInteractions(sessions);
        clearInvocations(sessions);
        for(int i=0;i<10;i++) insert(UUID.randomUUID(),user,"FREE",null,null,"2026-01-01T00:00:00Z");
        list(token,"",200);
        verify(sessions,times(1)).countForUser(eq(user), any());
        verify(sessions,times(1)).pageForUser(eq(user),eq(20),eq(0L),any());
        verifyNoMoreInteractions(sessions);
    }
    @Test void openApiDescribesNullableFieldsAndVisibility() throws Exception {
        var result=mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse();
        var props=json.readTree(result.getContentAsString()).path("components").path("schemas").path("PlaySummaryResponse").path("properties");
        for(String field:List.of("songId","songTitle","chartVersionId","chartId","difficulty","endReason","score","accuracy","maxCombo")) {
            assertThat(props.path(field).path("type").isArray()).as(field).isTrue();
            assertThat(props.path(field).path("type").toString()).as(field).contains("\"null\"");
            assertThat(props.path(field).path("description").asString()).as(field).isNotBlank();
        }
        assertThat(props.path("accuracy").path("minimum").asInt()).isZero();
        assertThat(props.path("accuracy").path("maximum").asInt()).isEqualTo(100);
        assertThat(props.path("songAccessible").path("description").asString()).isNotBlank();
        assertThat(props.path("hasReport").path("description").asString()).contains("AI");
    }
    UUID scored(long owner, String mode, long song, long version, Integer score, String accuracy, String reason) {
        UUID id=UUID.randomUUID();
        insert(id,owner,mode,song,version,"2026-01-01T00:00:00Z");
        db.update("UPDATE play_sessions SET score=?,accuracy=?::numeric,client_meta=CASE WHEN ?::text IS NULL THEN NULL ELSE jsonb_build_object('endReason',?::text) END WHERE id=?",score,accuracy,reason,reason,id);
        return id;
    }
    JsonNode best(String auth, String ids, int expected) throws Exception {
        var request=get("/api/v1/plays/best-records");
        if(ids!=null) request.param("songIds",ids);
        if(auth!=null) request.header("Authorization","Bearer "+auth);
        var response=mvc.perform(request).andExpect(status().is(expected)).andReturn().getResponse();
        return response.getContentAsString().isEmpty()?null:json.readTree(response.getContentAsString());
    }
    @Test void bestRecordsGroupVersionsModesVisibilityAndCompletion() throws Exception {
        long own=song(user,"MIDI","내 곡",true), visible=song(null,"BUILTIN","공개",true), foreign=song(other,"MIDI","타인",true), hidden=song(null,"BUILTIN","비공개",false), deleted=song(user,"MIDI","삭제",true), empty=song(user,"MIDI","기록 없음",true);
        long easy=version(own,"EASY",1), easyNext=version(own,"EASY",2), hard=version(own,"HARD",1);
        long pub=version(visible,"NORMAL",1), foreignV=version(foreign,"EASY",1), hiddenV=version(hidden,"EASY",1), deletedV=version(deleted,"EASY",1);
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?",deleted);
        UUID finished=scored(user,"RHYTHM",own,easy,100,"20.00","COMPLETED");
        scored(user,"RHYTHM",own,easyNext,80,"90.00","COMPLETED");
        scored(user,"SHEET",own,easy,30,"40.00","COMPLETED");
        UUID practice = scored(user,"SHEET",own,easy,200,"99.00","COMPLETED");
        db.update("UPDATE play_sessions SET judgement_context='{\"playbackRate\":0.7}'::jsonb WHERE id=?", practice);
        scored(user,"RHYTHM",own,hard,0,"0.00","COMPLETED");
        scored(user,"RHYTHM",visible,pub,null,null,"COMPLETED");
        scored(other,"RHYTHM",own,easy,9999,"99.00","COMPLETED");
        for(String reason:List.of("ABORTED","DISCONNECTED")) scored(user,"RHYTHM",own,easy,9000,"99.00",reason);
        scored(user,"RHYTHM",own,easy,9000,"99.00",null);
        scored(user,"RHYTHM",foreign,foreignV,100,"50.00","COMPLETED");
        scored(user,"RHYTHM",hidden,hiddenV,100,"50.00","COMPLETED");
        scored(user,"RHYTHM",deleted,deletedV,100,"50.00","COMPLETED");
        scored(user,"RHYTHM",own,pub,9000,"99.00","COMPLETED"); // 곡과 버전 불일치
        String ids=own+","+visible+","+foreign+","+hidden+","+deleted+","+empty+","+own;
        var items=best(token,ids,200).path("items"); assertThat(items.size()).isEqualTo(4);
        long easyChart=db.queryForObject("SELECT chart_id FROM chart_versions WHERE id=?",Long.class,easy);
        assertThat(items.get(0).path("songId").asLong()).isEqualTo(own);
        assertThat(items.get(0).path("chartId").asLong()).isEqualTo(easyChart);
        assertThat(items.get(0).path("difficulty").asString()).isEqualTo("EASY");
        assertThat(items.get(0).path("mode").asString()).isEqualTo("RHYTHM");
        assertThat(items.get(0).path("bestScore").asInt()).isEqualTo(100);
        assertThat(items.get(0).path("bestAccuracy").asDouble()).isEqualTo(90);
        assertThat(items.get(1).path("mode").asString()).isEqualTo("SHEET");
        assertThat(items.get(1).path("bestAccuracy").asDouble()).isEqualTo(40);
        assertThat(items.get(2).path("difficulty").asString()).isEqualTo("HARD");
        assertThat(items.get(2).path("bestScore").asInt()).isZero();
        assertThat(items.get(2).path("bestAccuracy").asDouble()).isZero();
        assertThat(items.get(3).path("songId").asLong()).isEqualTo(visible);
        assertThat(items.get(3).path("bestScore").isNull()).isTrue();
        assertThat(items.get(3).path("bestAccuracy").isNull()).isTrue();
        assertThat(best(otherToken,Long.toString(own),200).path("items").size()).isZero();
        assertThat(best(token,Long.toString(empty),200).path("items").size()).isZero();
        var page=list(token,"?size=100",200).path("items");
        assertThat(page.size()).isEqualTo(13);
        for (var item : page) {
            boolean isPractice = item.get("playId").asString().equals(practice.toString());
            assertThat(item.get("playbackRate").asDouble()).isEqualTo(isPractice ? 0.7 : 1);
        }
        assertThat(items.get(1).path("bestScore").asInt()).isEqualTo(30);
        var reasons=new ArrayList<String>();
        page.forEach(item->{ if(!item.path("endReason").isNull()) reasons.add(item.path("endReason").asString()); });
        assertThat(reasons).contains("COMPLETED","ABORTED","DISCONNECTED");
        assertThat(page.toString()).contains(finished.toString());
    }
    @Test void bestRecordsValidateIdsAndAuthentication() throws Exception {
        best(null,"1",401); best(token(user,UserRole.USER,Instant.now().minusSeconds(86400)),"1",401);
        for(String invalid:List.of("", "0", "-1", "1,,2", ",1", "1,", "abc", "1, 2", "9223372036854775808", String.join(",",Collections.nCopies(101,"1")))) best(token,invalid,400);
        best(token,null,400);
        assertThat(best(token,String.join(",",Collections.nCopies(100,"1")),200).path("items").size()).isZero();
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);
        best(token,"1",401);
        assertThatThrownBy(()->service.bestRecords(user,"1")).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode()).isEqualTo(CommonErrorCode.UNAUTHORIZED));
    }
    @Test void bestRecordsOpenApiAndReportPathsCoexist() throws Exception {
        var result=mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse();
        var api=json.readTree(result.getContentAsString());
        assertThat(api.path("paths").path("/api/v1/plays/best-records").path("get").isMissingNode()).isFalse();
        assertThat(api.path("paths").path("/api/v1/plays/{playId}/report").path("get").isMissingNode()).isFalse();
        assertThat(api.path("paths").path("/api/v1/plays/{playId}/report/notes").path("get").isMissingNode()).isFalse();
        var schemas=api.path("components").path("schemas");
        assertThat(schemas.path("BestRecordsResponse").path("properties").path("items").path("items").path("$ref").asString()).isEqualTo("#/components/schemas/BestRecordItem");
        assertThat(schemas.path("BestRecordItem").path("properties").path("bestAccuracy").path("description").asString()).contains("0~100");
        assertThat(schemas.path("BestRecordItem").path("properties").has("seq")).isFalse();
    }
    @Test void countAndPageShareSnapshotWhenAnotherTransactionInserts() throws Exception { snapshot(false); }
    @Test void countAndPageShareSnapshotWhenAnotherTransactionDeletes() throws Exception { snapshot(true); }
    void snapshot(boolean delete) throws Exception {
        UUID first=UUID.randomUUID(), second=UUID.randomUUID();
        insert(first,user,"FREE",null,null,"2026-01-01T00:00:00Z");
        doAnswer(inv -> {
            Object count=inv.callRealMethod();
            try(var pool=Executors.newSingleThreadExecutor()) {
                pool.submit(()->{ if(delete) db.update("DELETE FROM play_sessions WHERE id=?",first); else insert(second,user,"TEMPO",null,null,"2026-01-02T00:00:00Z"); }).get(15,TimeUnit.SECONDS);
            }
            return count;
        }).when(sessions).countForUser(eq(user), any());
        var result=service.list(user,0,20,null,null,null,null,null);
        assertThat(result.totalElements()).isEqualTo(1); assertThat(result.items()).hasSize(1);
        assertThat(result.items().get(0).playId()).isEqualTo(first);
    }
}
