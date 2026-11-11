import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "./Input";
import { Segmented } from "./Segmented";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it('role="switch"·aria-checked·aria-label', () => {
    const on = renderToStaticMarkup(
      <Toggle checked label="메트로놈" onChange={() => {}} />,
    );
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('aria-label="메트로놈"');
    expect(on).toMatch(/class="[^"]*\bon\b/);
    const off = renderToStaticMarkup(
      <Toggle checked={false} label="a" onChange={() => {}} />,
    );
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toMatch(/\bon\b/);
  });

  it("disabled", () => {
    expect(
      renderToStaticMarkup(
        <Toggle checked label="a" disabled onChange={() => {}} />,
      ),
    ).toContain('disabled=""');
  });
});

describe("Segmented", () => {
  const options = [
    { value: "a", label: "가" },
    { value: "b", label: "나" },
    { value: "c", label: "다" },
  ];

  it("radiogroup이고 선택 항목만 aria-checked·tabindex 0", () => {
    const html = renderToStaticMarkup(
      <Segmented
        options={options}
        value="b"
        onChange={() => {}}
        label="보기"
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="보기"');
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toContain('aria-checked="false"');
    expect(buttons[0]).toContain('tabindex="-1"');
    expect(buttons[1]).toContain('aria-checked="true"');
    expect(buttons[1]).toContain('tabindex="0"');
    expect(buttons[1]).toContain("ui-seg-item selected");
    expect(buttons[2]).toContain('tabindex="-1"');
    expect(buttons.every((b) => b.includes('role="radio"'))).toBe(true);
  });
});

describe("Slider", () => {
  it("range 속성과 채움 비율·valueText", () => {
    const html = renderToStaticMarkup(
      <Slider
        label="음량"
        value={25}
        min={0}
        max={100}
        step={5}
        onChange={() => {}}
        valueText="25%"
        id="vol"
      />,
    );
    expect(html).toContain('type="range"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="100"');
    expect(html).toContain('step="5"');
    expect(html).toContain('value="25"');
    expect(html).toContain("--ui-slider-fill:25%");
    expect(html).toContain('for="vol"');
    expect(html).toContain('id="vol"');
    expect(html).toContain('<span class="ui-slider-value">25%</span>');
  });

  it("세로 배치: 라벨 → 값 → 입력 순서", () => {
    const html = renderToStaticMarkup(
      <Slider
        label="음량"
        value={25}
        min={0}
        max={100}
        onChange={() => {}}
        valueText="25%"
        id="vol"
      />,
    );
    const label = html.indexOf("ui-slider-label");
    const value = html.indexOf("ui-slider-value");
    const input = html.indexOf("<input");
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(value);
    expect(value).toBeLessThan(input);
  });

  it("leading·trailing이 없으면 트랙 묶음 없이 입력이 바로 들어간다(마크업 불변)", () => {
    const html = renderToStaticMarkup(
      <Slider label="음량" value={25} min={0} max={100} onChange={() => {}} valueText="25%" id="vol" />,
    );
    expect(html).not.toContain("ui-slider-track-row");
    expect(html).toMatch(/<\/span><input /);
  });

  it("leading·trailing을 주면 입력 앞뒤에 놓인 한 줄 묶음으로 감싼다", () => {
    const html = renderToStaticMarkup(
      <Slider
        label="음량"
        value={25}
        min={0}
        max={100}
        onChange={() => {}}
        valueText="25%"
        id="vol"
        leading={<i data-k="l" />}
        trailing={<i data-k="t" />}
      />,
    );
    const row = html.indexOf("ui-slider-track-row");
    const l = html.indexOf('data-k="l"');
    const input = html.indexOf("<input");
    const t = html.indexOf('data-k="t"');
    expect(row).toBeGreaterThan(html.indexOf("ui-slider-value"));
    expect(row).toBeLessThan(l);
    expect(l).toBeLessThan(input);
    expect(input).toBeLessThan(t);
    expect(html).toContain('for="vol"');
  });

  it("leading만 줘도 묶음이 생긴다", () => {
    const html = renderToStaticMarkup(
      <Slider label="a" value={1} min={0} max={2} onChange={() => {}} leading={<i data-k="l" />} />,
    );
    expect(html).toContain("ui-slider-track-row");
  });

  it("valueText가 없으면 값 표시가 없고, max<=min이면 채움 0%", () => {
    const html = renderToStaticMarkup(
      <Slider label="a" value={3} min={3} max={3} onChange={() => {}} />,
    );
    expect(html).not.toContain("ui-slider-value");
    expect(html).toContain("--ui-slider-fill:0%");
  });
});

describe("Input", () => {
  it("label이 input id와 연결된다", () => {
    const html = renderToStaticMarkup(<Input label="이름" id="nm" />);
    expect(html).toContain('for="nm"');
    expect(html).toContain('id="nm"');
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("자동 id로도 label과 input이 짝을 이룬다", () => {
    const html = renderToStaticMarkup(<Input label="이름" />);
    const forId = /for="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toContain(`id="${forId}"`);
  });

  it("error면 aria-invalid·오류 문구, 도움말도 함께 보이고 둘 다 describedby로 건다", () => {
    const html = renderToStaticMarkup(
      <Input label="이름" id="nm" help="도움" error="필수입니다" />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="nm-help nm-error"');
    expect(html).toContain('id="nm-error"');
    expect(html).toContain("필수입니다");
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      '<span id="nm-help" class="ui-input-help">도움</span>',
    );
    expect(html).toMatch(/class="[^"]*\berror\b/);
  });

  it("help만 있으면 도움말 id를 describedby로 건다", () => {
    const html = renderToStaticMarkup(
      <Input label="이름" id="nm" help="도움" />,
    );
    expect(html).toContain('aria-describedby="nm-help"');
    expect(html).toContain(
      '<span id="nm-help" class="ui-input-help">도움</span>',
    );
  });

  it("호출부 aria-describedby를 뒤에 합친다", () => {
    const html = renderToStaticMarkup(
      <Input label="이름" id="nm" help="도움" aria-describedby="ext" />,
    );
    expect(html).toContain('aria-describedby="nm-help ext"');
  });

  it("counter 텍스트", () => {
    const html = renderToStaticMarkup(
      <Input label="이름" counter={{ value: 3, max: 20 }} />,
    );
    expect(html).toContain('<span class="ui-input-counter">3/20</span>');
  });

  it("compact면 라벨을 시각 숨김 클래스로 남기고 foot·오류 줄을 그리지 않는다", () => {
    const html = renderToStaticMarkup(
      <Input label="제목 검색" id="q" compact help="도움" error="오류" counter={{ value: 1, max: 5 }} />,
    );
    expect(html).toMatch(/class="ui-input compact/);
    expect(html).toContain('class="ui-input-label ui-input-label-hidden" for="q"');
    expect(html).not.toContain("ui-input-foot");
    expect(html).not.toContain("ui-input-error");
    expect(html).not.toContain("aria-describedby");
  });

  it("compact가 아니면 라벨 숨김 클래스와 compact 클래스가 없다", () => {
    const html = renderToStaticMarkup(<Input label="이름" id="nm" />);
    expect(html).not.toContain("compact");
    expect(html).not.toContain("ui-input-label-hidden");
    expect(html).toContain("ui-input-foot");
  });

  it("trailing이 없으면(undefined) 기존 마크업 그대로: 감싸는 칸·has-trailing 없음", () => {
    const html = renderToStaticMarkup(<Input label="이름" id="nm" />);
    expect(html).not.toContain("ui-input-control");
    expect(html).not.toContain("has-trailing");
    expect(html).not.toContain("ui-input-trailing");
  });

  it("trailing이 있으면 입력칸 안 오른쪽 슬롯에 그린다", () => {
    const html = renderToStaticMarkup(
      <Input label="검색" id="q" compact trailing={<button type="button">x</button>} />,
    );
    expect(html).toContain("has-trailing");
    expect(html).toContain('class="ui-input-control"><input');
    expect(html).toContain('<span class="ui-input-trailing"><button type="button">x</button></span></div>');
  });

  it("trailing이 null이면 슬롯 요소 없이 자리만 둔다(input이 다시 만들어지지 않는다)", () => {
    const html = renderToStaticMarkup(<Input label="검색" id="q" compact trailing={null} />);
    expect(html).toContain("has-trailing");
    expect(html).toContain("ui-input-control");
    expect(html).not.toContain("ui-input-trailing");
  });
});
