import { describe, expect, test } from 'bun:test'
import { renderSponsorLink } from './tipLink.js'

// OSC 8 control bytes, built without literal control chars in source.
const ESC = String.fromCharCode(27)
const OSC = `${ESC}]`
const BEL = String.fromCharCode(7)

const URL = 'https://api.trygravity.ai/track/click?p=loooong'

describe('renderSponsorLink', () => {
  test('hyperlinks supported: name is an OSC 8 link, no trailing raw url', () => {
    const r = renderSponsorLink('Vultr', URL, true)
    expect(r.display).toBe(`${OSC}8;;${URL}${BEL}Vultr ↗${OSC}8;;${BEL}`)
    expect(r.trailing).toBe('')
  })

  test('hyperlinks NOT supported: plain name + dimmed url trailing', () => {
    const r = renderSponsorLink('Vultr', URL, false)
    expect(r.display).toBe('Vultr')
    expect(r.display).not.toContain(OSC)
    expect(r.trailing).toContain(URL)
  })

  test('no url → plain name, nothing trailing (either branch)', () => {
    expect(renderSponsorLink('Vultr', undefined, true)).toEqual({ display: 'Vultr', trailing: '' })
    expect(renderSponsorLink('Vultr', '   ', false)).toEqual({ display: 'Vultr', trailing: '' })
  })

  // ── Security: name/url are advertiser-controlled, hence untrusted ──────────
  test('strips control chars from the advertiser name (no escape injection)', () => {
    const r = renderSponsorLink(`Vul${ESC}[31mtr`, undefined, true)
    expect(r.display).toBe('Vul[31mtr') // ESC removed; remaining text is inert
    expect(r.display).not.toContain(ESC)
  })

  test('rejects non-http(s) URLs (javascript:/file:) → no link', () => {
    expect(renderSponsorLink('Vultr', 'javascript:alert(1)', true)).toEqual({
      display: 'Vultr',
      trailing: '',
    })
    expect(renderSponsorLink('Vultr', 'file:///etc/passwd', false)).toEqual({
      display: 'Vultr',
      trailing: '',
    })
  })

  test('strips control chars from the url before validating it', () => {
    const r = renderSponsorLink('Vultr', `https://e${BEL}vil.test`, false)
    expect(r.trailing).toContain('https://evil.test')
    expect(r.trailing).not.toContain(BEL)
  })

  test('a malicious url cannot inject extra escape sequences into the output', () => {
    const r = renderSponsorLink('Vultr', `https://ok.test${BEL}${ESC}]0;pwned`, true)
    // Control chars are stripped before the url is framed, so the url segment
    // carries no stray OSC introducer.
    expect((r.display.split('https://')[1] ?? '')).not.toContain(`${ESC}]0;`)
  })
})
