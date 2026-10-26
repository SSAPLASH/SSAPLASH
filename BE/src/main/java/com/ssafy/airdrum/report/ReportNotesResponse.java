package com.ssafy.airdrum.report;

import java.util.List;

public record ReportNotesResponse(List<Item> items, Integer nextAfterSeq) {
    public ReportNotesResponse { items = List.copyOf(items); }
    public record Item(int seq, String matchedNoteId, double tMs, String pad, String judgement,
            Double deltaMs, Integer velocity) {}
}
