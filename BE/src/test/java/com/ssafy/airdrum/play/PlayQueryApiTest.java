package com.ssafy.airdrum.play;

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
import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;
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
        var request=get("/api/v1/plays"+query); if(auth!=null) request.header("Authorization","Bearer "+auth);
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
            assertThatThrownBy(()->service.list(user,bad[0],bad[1])).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode()).isEqualTo(CommonErrorCode.VALIDATION_FAILED));
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);
        list(token,"",401); assertThatThrownBy(()->service.list(user,0,20)).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode()).isEqualTo(CommonErrorCode.UNAUTHORIZED));
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
            for (String field:List.of("songId","songTitle","chartVersionId","difficulty","score","accuracy","maxCombo"))
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
        verify(sessions,times(1)).countForUser(user);
        verify(sessions,times(1)).pageForUser(user,20,0L);
        verifyNoMoreInteractions(sessions);
        clearInvocations(sessions);
        for(int i=0;i<10;i++) insert(UUID.randomUUID(),user,"FREE",null,null,"2026-01-01T00:00:00Z");
        list(token,"",200);
        verify(sessions,times(1)).countForUser(user);
        verify(sessions,times(1)).pageForUser(user,20,0L);
        verifyNoMoreInteractions(sessions);
    }
    @Test void openApiDescribesNullableFieldsAndVisibility() throws Exception {
        var result=mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse();
        var props=json.readTree(result.getContentAsString()).path("components").path("schemas").path("PlaySummaryResponse").path("properties");
        for(String field:List.of("songId","songTitle","chartVersionId","difficulty","score","accuracy","maxCombo")) {
            assertThat(props.path(field).path("type").isArray()).as(field).isTrue();
            assertThat(props.path(field).path("type").toString()).as(field).contains("\"null\"");
            assertThat(props.path(field).path("description").asString()).as(field).isNotBlank();
        }
        assertThat(props.path("accuracy").path("minimum").asInt()).isZero();
        assertThat(props.path("accuracy").path("maximum").asInt()).isEqualTo(100);
        assertThat(props.path("songAccessible").path("description").asString()).isNotBlank();
        assertThat(props.path("hasReport").path("description").asString()).contains("AI");
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
        }).when(sessions).countForUser(user);
        var result=service.list(user,0,20);
        assertThat(result.totalElements()).isEqualTo(1); assertThat(result.items()).hasSize(1);
        assertThat(result.items().get(0).playId()).isEqualTo(first);
    }
}
