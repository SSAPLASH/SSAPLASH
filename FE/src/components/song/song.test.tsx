import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevelBadge } from "./LevelBadge";
import { SongCover } from "./SongCover";
import { SongMeta } from "@/features/play/components/picker/SongMeta";
import { RecommendRow } from "@/features/result/components/RecommendRow";
import { cardOf, type RecommendationItem } from "@/domain/song/recommendation";

describe("LevelBadge", () => {
  it.each([
    ["EASY", "EASY", "song-level-easy"],
    ["NORMAL", "NORM", "song-level-normal"],
    ["HARD", "HARD", "song-level-hard"],
  ] as const)("%s → %s·%s", (level, label, cls) => {
    const html = renderToStaticMarkup(<LevelBadge level={level} />);
    expect(html).toContain(`>${label}<`);
    expect(html).toContain(cls);
    expect(html).toMatch(/^<span/);
  });

  it("onClick이 있으면 버튼이고 선택되지 않으면 흐리다", () => {
    const off = renderToStaticMarkup(
      <LevelBadge level="EASY" onClick={() => {}} />,
    );
    expect(off).toMatch(/^<button/);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain("song-level-dim");
    const on = renderToStaticMarkup(
      <LevelBadge level="EASY" selected onClick={() => {}} />,
    );
    expect(on).toContain('aria-pressed="true"');
    expect(on).not.toContain("song-level-dim");
  });

  it("기본 크기는 md라 song-level-sm이 없고, size=sm이면 붙는다", () => {
    expect(renderToStaticMarkup(<LevelBadge level="NORMAL" />)).not.toContain("song-level-sm");
    const sm = renderToStaticMarkup(<LevelBadge level="NORMAL" size="sm" />);
    expect(sm).toContain("song-level song-level-normal song-level-sm");
    expect(sm).toContain(">NORM<");
  });
});

describe("SongMeta", () => {
  it('아티스트·BPM·길이를 " · "로 잇는다', () => {
    const html = renderToStaticMarkup(
      <SongMeta artist="밴드" bpm={120} durationSec={185} />,
    );
    expect(html).toContain("밴드 · BPM 120 · 3:05");
    expect(html).toContain('class="song-meta"');
  });

  it("없는 값은 건너뛴다", () => {
    expect(renderToStaticMarkup(<SongMeta bpm={90} />)).toContain(">BPM 90<");
    expect(
      renderToStaticMarkup(<SongMeta artist="a" durationSec={60} />),
    ).toContain(">a · 1:00<");
  });

  it("BPM은 반올림한다", () => {
    expect(renderToStaticMarkup(<SongMeta bpm={120.6} />)).toContain("BPM 121");
  });

  it("모두 없으면 빈 출력", () => {
    expect(renderToStaticMarkup(<SongMeta />)).toBe("");
  });

  it("className을 합친다", () => {
    expect(
      renderToStaticMarkup(<SongMeta bpm={100} className="extra" />),
    ).toContain('class="song-meta extra"');
  });
});

describe("SongCover", () => {
  it("커버가 없으면 기본 커버: 원반·홈 3개·라벨·구멍", () => {
    const html = renderToStaticMarkup(<SongCover coverUrl={null} />);
    expect(html).toContain("song-cover default");
    expect(html).toContain("song-cover-disc");
    expect(html.match(/song-cover-groove /g)?.length).toBe(3);
    expect(html).toContain("song-cover-label");
    expect(html).toContain("song-cover-hole");
    expect(html).not.toContain("<img");
  });

  it("올린 커버는 이미지, 기본 커버 요소 없음", () => {
    const html = renderToStaticMarkup(<SongCover coverUrl="https://x/c.jpg" />);
    expect(html).toContain('src="https://x/c.jpg"');
    expect(html).not.toContain("song-cover-disc");
  });
});

describe("RecommendRow", () => {
  const item = (id: number, code: string, text = "BE 문구"): RecommendationItem => ({
    song: {
      id, title: `곡${id}`, artist: `가수${id}`, source: "BUILTIN", status: "READY", bpm: 100, timeSignature: "4/4", durationMs: null,
      hasAccompaniment: false, accompanimentStatus: "NONE", songLevel: null, difficulties: [], createdAt: "", coverUrl: null, sheetId: null,
    },
    chartId: id * 10, difficulty: "HARD", reasons: [{ code, text }, { code: "RETRY", text: "둘째" }],
  });

  it("카드 수·제목·아티스트·배지·첫 이유 문구를 그린다", () => {
    const html = renderToStaticMarkup(<RecommendRow items={[cardOf(item(1, "STARTER")), cardOf(item(2, "NEW_CODE", "BE 문구"))]} onPick={() => {}} />);
    expect(html).toContain('aria-label="추천곡"');
    expect(html.match(/<button type="button" class="song-reco-card"/g)?.length).toBe(2);
    expect(html).toContain(">곡1<");
    expect(html).toContain(">가수2<");
    expect(html).toContain("song-level-hard song-level-sm");
    expect(html).toContain("처음 시작하기 좋은 쉬운 곡이에요");
    expect(html).toContain(">BE 문구<");
    expect(html).not.toContain("둘째");
  });

  it("caption을 제목·aria-label로 쓰고, line이 비면 문구 줄을 그리지 않는다", () => {
    const card = { ...cardOf(item(1, "STARTER")), line: "" };
    const html = renderToStaticMarkup(<RecommendRow items={[card]} onPick={() => {}} caption="AI 추천 연습곡" />);
    expect(html).toContain('aria-label="AI 추천 연습곡"');
    expect(html).toContain(">AI 추천 연습곡<");
    expect(html).not.toContain("song-reco-reason");
  });

  it("빈 목록이면 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<RecommendRow items={[]} onPick={() => {}} />)).toBe("");
  });
});
