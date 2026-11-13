// 사이드바 토글 아이콘 마크업 검사 (D11). 회전은 CSS 클래스로만 표현되므로 클래스 유무를 본다.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarToggleIcon } from './SidebarToggleIcon'

const ARROW_PATH = 'd="m16 15-3-3 3-3"'

describe('SidebarToggleIcon', () => {
  it('svg가 하나이고 화살표 path가 있다', () => {
    const html = renderToStaticMarkup(<SidebarToggleIcon collapsed={false} />)
    expect(html.match(/<svg/g)).toHaveLength(1)
    expect(html).toContain(ARROW_PATH)
  })

  it('collapsed=true면 화살표에 collapsed 클래스가 붙는다', () => {
    const html = renderToStaticMarkup(<SidebarToggleIcon collapsed />)
    expect(html).toMatch(/class="side-toggle-arrow collapsed"[^>]*d="m16 15-3-3 3-3"/)
  })

  it('collapsed=false면 collapsed 클래스가 없다', () => {
    const html = renderToStaticMarkup(<SidebarToggleIcon collapsed={false} />)
    expect(html).toMatch(/class="side-toggle-arrow"/)
    expect(html).not.toContain('collapsed')
  })
})
