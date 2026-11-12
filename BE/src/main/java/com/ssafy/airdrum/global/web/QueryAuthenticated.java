package com.ssafy.airdrum.global.web;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** 조회 컨트롤러에서 인증을 매개변수 바인딩보다 먼저 수행한다. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface QueryAuthenticated {
	String USER_ID = "com.ssafy.airdrum.chart.query.userId";
}
