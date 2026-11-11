package com.ssafy.airdrum.domain.sheet.event;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.ssafy.airdrum.domain.user.event.UserWithdrawnEvent;

import static org.assertj.core.api.Assertions.assertThat;

/** 155번 설계 4절: 탈퇴가 커밋되면 그 회원의 모든 악보 파일을 정리 큐에 바로 등록한다. 다른 회원 것은 건드리지 않는다. */
// 기본 컨텍스트는 마이그레이션 테스트가 풀 연결의 search_path를 바꿔 둘 수 있어, 정리 큐 테스트와 같은 격리 컨텍스트를 쓴다.
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory", "chart.worker.cleanup-interval-ms=86400000"})
class SheetWithdrawalTest {

	@Autowired JdbcTemplate db;
	@Autowired ApplicationEventPublisher events;
	@Autowired PlatformTransactionManager manager;
	long user, other;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('악보 탈퇴 회원') RETURNING id", Long.class);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES('악보 다른 회원') RETURNING id", Long.class);
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM file_cleanup_tasks WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM sheet_music WHERE owner_id IN (?,?)", user, other);
		db.update("DELETE FROM users WHERE id IN (?,?)", user, other);
	}

	@Test
	void 탈퇴하면_모든_악보_페이지를_정리_큐에_등록한다() {
		String a = page(user, "IMAGE", 1).getFirst(), pdf = page(user, "PDF", 1).getFirst(), keep = page(other, "IMAGE", 1).getFirst();
		List<String> two = page(user, "IMAGE", 2);
		String deleted = page(user, "IMAGE", 1).getFirst();
		db.update("UPDATE sheet_music SET deleted_at=now() WHERE id=(SELECT sheet_id FROM sheet_music_pages WHERE object_key=?)", deleted);
		db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,next_attempt_at) VALUES(?,'SHEET_MUSIC',?,now()+interval '1 day')", a, user);

		new TransactionTemplate(manager).executeWithoutResult(s -> events.publishEvent(new UserWithdrawnEvent(user)));

		assertThat(db.queryForList("SELECT object_key FROM file_cleanup_tasks WHERE user_id=? AND file_role='SHEET_MUSIC' AND next_attempt_at<=clock_timestamp()", String.class, user))
				.containsExactlyInAnyOrder(a, two.get(0), two.get(1), pdf, deleted);
		assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=?", Integer.class, keep)).isZero();
	}

	private List<String> page(long owner, String kind, int pages) {
		long sheet = db.queryForObject("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes) VALUES(?,'악보','UPLOADED',?,?,10) RETURNING id", Long.class, owner, kind, pages);
		var keys = new ArrayList<String>();
		for (int i = 1; i <= pages; i++) {
			String key = "sheet-music/" + owner + "/" + sheet + "/" + UUID.randomUUID() + (kind.equals("PDF") ? ".pdf" : ".png");
			db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes) VALUES(?,?,?,?,5)", sheet, i, key, kind.equals("PDF") ? "application/pdf" : "image/png");
			keys.add(key);
		}
		return keys;
	}
}
