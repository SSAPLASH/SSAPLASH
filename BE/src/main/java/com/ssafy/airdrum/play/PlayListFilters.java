package com.ssafy.airdrum.play;

import java.time.Instant;

record PlayListFilters(String pattern, Instant from, Instant until, String mode, String sort) {}
