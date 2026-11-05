import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

describe("Button", () => {
  it('기본은 type="button"·primary·md', () => {
    const html = renderToStaticMarkup(<Button>확인</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain("ui-btn-primary");
    expect(html).toContain("ui-btn-md");
    expect(html).toContain("확인");
  });

  it("variant·size·fullWidth 클래스", () => {
    const html = renderToStaticMarkup(
      <Button variant="secondary" size="sm" fullWidth>
        x
      </Button>,
    );
    expect(html).toContain("ui-btn-secondary");
    expect(html).toContain("ui-btn-sm");
    expect(html).toContain("ui-btn-full");
  });

  it("type을 넘기면 submit", () => {
    expect(renderToStaticMarkup(<Button type="submit">x</Button>)).toContain(
      'type="submit"',
    );
  });

  it("disabled", () => {
    expect(renderToStaticMarkup(<Button disabled>x</Button>)).toContain(
      'disabled=""',
    );
  });

  it("leadingIcon은 aria-hidden 래퍼 안에 글자보다 앞서 나온다", () => {
    const html = renderToStaticMarkup(
      <Button leadingIcon={<i>I</i>}>글자</Button>,
    );
    expect(html).toContain(
      '<span class="ui-btn-icon" aria-hidden="true"><i>I</i></span>',
    );
    expect(html.indexOf("ui-btn-icon")).toBeLessThan(html.indexOf("글자"));
  });

  it("leadingIcon이 없으면 아이콘 래퍼가 없다", () => {
    expect(renderToStaticMarkup(<Button>x</Button>)).not.toContain(
      "ui-btn-icon",
    );
  });
});

describe("IconButton", () => {
  it("label이 aria-label·title이 된다", () => {
    const html = renderToStaticMarkup(<IconButton label="닫기">x</IconButton>);
    expect(html).toContain('aria-label="닫기"');
    expect(html).toContain('title="닫기"');
    expect(html).toContain('type="button"');
    expect(html).toContain("ui-icon-btn-md");
  });

  it("active·size 클래스", () => {
    const on = renderToStaticMarkup(
      <IconButton label="a" active size="sm">
        x
      </IconButton>,
    );
    expect(on).toContain("ui-icon-btn-sm");
    expect(on).toMatch(/class="[^"]*\bactive\b/);
    const off = renderToStaticMarkup(<IconButton label="a">x</IconButton>);
    expect(off).not.toMatch(/\bactive\b/);
  });

  it("size 기본값은 md, sm은 별도 클래스(원형 투명 스타일은 CSS)", () => {
    const md = renderToStaticMarkup(<IconButton label="a">x</IconButton>);
    expect(md).toContain("ui-icon-btn ui-icon-btn-md");
    expect(md).not.toContain("ui-icon-btn-sm");
    const sm = renderToStaticMarkup(
      <IconButton label="a" size="sm">
        x
      </IconButton>,
    );
    expect(sm).toContain("ui-icon-btn ui-icon-btn-sm");
    expect(sm).not.toContain("ui-icon-btn-md");
  });
});
