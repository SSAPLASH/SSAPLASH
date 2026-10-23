package com.ssafy.airdrum.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.hibernate.resource.jdbc.spi.StatementInspector;

/**
 * Hibernate가 실행하는 SQL을 모아 두는 테스트 도구. 잠금 절(FOR SHARE 등)처럼 결과로는 보이지 않는 것을 확인할 때 쓴다.
 * {@code spring.jpa.properties.hibernate.session_factory.statement_inspector}에 이 클래스 이름을 준다.
 */
public class SqlCapture implements StatementInspector {

	private static final List<String> STATEMENTS = new CopyOnWriteArrayList<>();

	@Override
	public String inspect(String sql) {
		STATEMENTS.add(sql);
		return sql;
	}

	public static void clear() {
		STATEMENTS.clear();
	}

	public static List<String> statements() {
		return List.copyOf(STATEMENTS);
	}

}
