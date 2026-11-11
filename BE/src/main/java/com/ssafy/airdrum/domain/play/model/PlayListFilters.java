package com.ssafy.airdrum.domain.play.model;

import java.time.Instant;

public record PlayListFilters(String pattern, Instant from, Instant until, String mode, String sort) {}
