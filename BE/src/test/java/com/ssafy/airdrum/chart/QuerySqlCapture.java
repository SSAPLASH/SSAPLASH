package com.ssafy.airdrum.chart;

import java.util.ArrayList;
import java.util.List;
import org.hibernate.resource.jdbc.spi.StatementInspector;

public class QuerySqlCapture implements StatementInspector {
	private static final ThreadLocal<List<String>> SQL = ThreadLocal.withInitial(ArrayList::new);
	@Override public String inspect(String sql) { SQL.get().add(sql); return sql; }
	static void clear() { SQL.get().clear(); }
	static List<String> statements() { return List.copyOf(SQL.get()); }
}
