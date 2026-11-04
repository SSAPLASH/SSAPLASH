import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevelBadge } from "./LevelBadge";
import { SongCover } from "./SongCover";
import { SongMeta } from "./SongMeta";

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
    expect(html).toContain("밴드 · 120 BPM · 3:05");
    expect(html).toContain('class="song-meta"');
  });

  it("없는 값은 건너뛴다", () => {
    expect(renderToStaticMarkup(<SongMeta bpm={90} />)).toContain(">90 BPM<");
    expect(
      renderToStaticMarkup(<SongMeta artist="a" durationSec={60} />),
    ).toContain(">a · 1:00<");
  });

  it("BPM은 반올림한다", () => {
    expect(renderToStaticMarkup(<SongMeta bpm={120.6} />)).toContain("121 BPM");
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
