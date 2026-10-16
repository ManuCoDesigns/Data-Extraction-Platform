import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * The page as Nimble read it, laid out so it can be read: headings, nested lists, links and tables instead of one wall of
 * markdown. Embedded images and empty links are dropped, long runs of menu links fold away, and the value of the field
 * you are on (plus anything you type in Find) is marked. Raw shows the untouched text.
 */

type Block =
  | { t: 'h'; level: number; text: string; id: number }
  | { t: 'p'; text: string }
  | { t: 'li'; depth: number; text: string }
  | { t: 'table'; rows: string[][] }
  | { t: 'hr' }
  | { t: 'nav'; items: { depth: number; text: string }[] }

const LINK = /\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g

function clean(raw: string) {
  return (raw || '').replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/\[\s*!\[[^\]]*\]\([^)]*\)\s*\]\([^)]*\)/g, m => m.replace(/^\[\s*/, '').replace(/\]\([^)]*\)$/, ''))
}

const plain = (s: string) => s.replace(LINK, '$1').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
const linkOnly = (s: string) => /^\[[^\]]+\]\([^)]*\)(\s*[|·•,-]?\s*\[[^\]]+\]\([^)]*\))*$/.test(s.trim())

function parse(raw: string): Block[] {
  const lines = clean(raw).split('\n')
  const out: Block[] = []
  let para: string[] = []
  let hid = 0
  const flush = () => { if (para.length) { out.push({ t: 'p', text: para.join(' ') }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const s = line.trim()
    if (!s) { flush(); continue }
    if (/^([-*_])\1{2,}$/.test(s.replace(/\s/g, ''))) { flush(); out.push({ t: 'hr' }); continue }
    if (s.startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush()
      const row = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const rows = [row(s)]
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(row(lines[i])); i++ }
      i--
      out.push({ t: 'table', rows })
      continue
    }
    const h = s.match(/^(#{1,6})\s+(.*?)\s*#*$/)
    if (h) { flush(); out.push({ t: 'h', level: h[1].length, text: h[2], id: hid++ }); continue }
    const b = line.match(/^(\s*)((?:[*+-]\s+)+)(.*)$/) || line.match(/^(\s*)(\d+[.)]\s+)(.*)$/)
    if (b) {
      flush()
      const content = b[3].trim()
      if (!content) continue
      const markers = (b[2].match(/[*+-]/g) || []).length
      const depth = markers > 1 ? Math.min(4, markers) : Math.min(4, Math.floor(b[1].replace(/\t/g, '    ').length / 4) + 1)
      const hh = content.match(/^(#{1,6})\s+(.*?)\s*#*$/)
      if (hh) { out.push({ t: 'h', level: hh[1].length, text: hh[2], id: hid++ }); continue }
      const prev = out[out.length - 1]
      if (prev && prev.t === 'li' && prev.text === content && prev.depth === depth) continue
      out.push({ t: 'li', depth, text: content })
      continue
    }
    para.push(s)
  }
  flush()
  // runs of menu links fold into one group
  const grouped: Block[] = []
  for (let i = 0; i < out.length; i++) {
    const x = out[i]
    if (x.t === 'li' && linkOnly(x.text)) {
      let j = i
      while (j < out.length && out[j].t === 'li' && linkOnly((out[j] as any).text)) j++
      if (j - i >= 5) { grouped.push({ t: 'nav', items: out.slice(i, j).map((y: any) => ({ depth: y.depth, text: y.text })) }); i = j - 1; continue }
    }
    grouped.push(x)
  }
  return grouped
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
const normUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')

type Terms = { field: string; find: string }

function mark(str: string, t: Terms, key: string) {
  const parts: string[] = []
  if (t.field.length >= 3) parts.push(`(${esc(t.field)})`)
  if (t.find.length >= 2) parts.push(`(${esc(t.find)})`)
  if (!parts.length || !str) return [<span key={key}>{str}</span>]
  const rx = new RegExp(parts.join('|'), 'ig')
  const nodes: any[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  const hasField = t.field.length >= 3
  while ((m = rx.exec(str))) {
    if (m[0] === '') { rx.lastIndex++; continue }
    if (m.index > last) nodes.push(<span key={`${key}-${k++}`}>{str.slice(last, m.index)}</span>)
    const isField = hasField && m[1] !== undefined
    nodes.push(<mark key={`${key}-${k++}`} data-hit={isField ? 'field' : 'find'} className="rounded px-0.5" style={isField ? { background: '#fbbf24', color: '#1c1917' } : { background: '#7dd3fc', color: '#0c4a6e' }}>{m[0]}</mark>)
    last = m.index + m[0].length
  }
  if (last < str.length) nodes.push(<span key={`${key}-${k++}`}>{str.slice(last)}</span>)
  return nodes
}

function inline(text: string, t: Terms, key: string) {
  const out: any[] = []
  const rx = /\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*|`([^`]+)`|!\[([^\]]*)\]\([^)]*\)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = rx.exec(text))) {
    if (m.index > last) out.push(...mark(text.slice(last, m.index), t, `${key}-t${k++}`))
    if (m[2] !== undefined) {
      const label = plain(m[1]) || normUrl(m[2]).replace(/^[^/]+/, '') || m[2]
      const exact = t.field.length >= 3 && normUrl(m[2]) === normUrl(t.field)
      const internal = m[2].startsWith('#')
      out.push(
        <a key={`${key}-a${k++}`} href={internal ? undefined : m[2]} target="_blank" rel="noreferrer noopener" title={m[2]} data-hit={exact ? 'field' : undefined}
          className="underline decoration-dotted underline-offset-2 text-indigo-600 hover:text-indigo-800 break-words" style={exact ? { background: '#fbbf24', color: '#1c1917', borderRadius: 4, padding: '0 2px' } : undefined}>
          {mark(label, t, `${key}-l${k}`)}
        </a>,
      )
    } else if (m[3] !== undefined) {
      out.push(<strong key={`${key}-b${k++}`} className="font-semibold text-gray-900">{mark(m[3], t, `${key}-s${k}`)}</strong>)
    } else if (m[4] !== undefined) {
      out.push(<code key={`${key}-c${k++}`} className="px-1 rounded bg-gray-100 text-[12px]">{m[4]}</code>)
    } else if (m[5]) {
      out.push(<span key={`${key}-i${k++}`} className="text-gray-400 italic text-[12px]">[image: {m[5]}]</span>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(...mark(text.slice(last), t, `${key}-t${k++}`))
  return out
}

const hits = (text: string, t: Terms) => {
  const p = plain(text).toLowerCase()
  const exact = t.field.length >= 3 && Array.from(text.matchAll(LINK)).some(x => normUrl(x[2]) === normUrl(t.field))
  return exact || (t.field.length >= 3 && p.includes(t.field.toLowerCase())) || (t.find.length >= 2 && p.includes(t.find.toLowerCase()))
}

export function PageReader({ text, needle, field }: { text: string; needle: unknown; field?: string }) {
  const [view, setViewRaw] = useState<'read' | 'raw'>(() => { try { return localStorage.getItem('dx.pageView') === 'raw' ? 'raw' : 'read' } catch { return 'read' } })
  const setView = (v: 'read' | 'raw') => { setViewRaw(v); try { localStorage.setItem('dx.pageView', v) } catch { /* ignore */ } }
  const [find, setFind] = useState('')
  const [cur, setCur] = useState(0)
  const [count, setCount] = useState(0)
  const box = useRef<HTMLDivElement | null>(null)
  const fieldTerm = typeof needle === 'string' ? needle.trim() : typeof needle === 'number' ? String(needle) : ''
  const terms: Terms = { field: fieldTerm, find: find.trim() }
  const blocks = useMemo(() => parse(text), [text])
  const heads = useMemo(() => blocks.filter(b => b.t === 'h') as Extract<Block, { t: 'h' }>[], [blocks])
  const words = useMemo(() => plain(clean(text)).split(' ').filter(Boolean).length, [text])
  const rawText = useMemo(() => (text || '').replace(/data:[^)\s]{40,}/g, 'data:…'), [text])

  // count and number the marks, then bring the right one into view
  useEffect(() => {
    const els = Array.from(box.current?.querySelectorAll('[data-hit]') || []) as HTMLElement[]
    setCount(els.length)
    els.forEach(e => { e.style.outline = '' })
    if (!els.length) return
    const i = Math.min(cur, els.length - 1)
    els[i].style.outline = '2px solid #6366f1'
    els[i].scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [cur, fieldTerm, find, text, view, count])
  useEffect(() => { setCur(0) }, [fieldTerm, find, text, view])
  const step = (d: number) => setCur(c => (count ? (c + d + count) % count : 0))
  const jump = (id: string) => { const el = box.current?.querySelector(`[data-hid="${id}"]`) as HTMLElement | null; el?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 mb-2 bg-white border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <div role="tablist" aria-label="How to show the page" className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          {(['read', 'raw'] as const).map(v => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`px-2.5 py-1.5 ${view === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{v === 'read' ? 'Reading view' : 'Raw text'}</button>)}
        </div>
        <input value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) } }} placeholder="Find in page" aria-label="Find in page"
          className="flex-1 min-w-[120px] text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white text-gray-800" />
        <span className="text-xs text-gray-500 tabular-nums" aria-live="polite">{count ? `${Math.min(cur, count - 1) + 1} of ${count}` : (find || fieldTerm.length >= 3) ? 'No match' : ''}</span>
        <button type="button" onClick={() => step(-1)} disabled={!count} aria-label="Previous match" className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-40">‹</button>
        <button type="button" onClick={() => step(1)} disabled={!count} aria-label="Next match" className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-40">›</button>
        {view === 'read' && heads.length > 1 && (
          <select aria-label="Jump to a section" value="" onChange={e => e.target.value && jump(e.target.value)} className="text-xs rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-gray-700 max-w-[10rem]">
            <option value="">Jump to…</option>
            {heads.slice(0, 80).map(h => <option key={h.id} value={h.id}>{'· '.repeat(Math.max(0, h.level - 1))}{plain(h.text).slice(0, 48)}</option>)}
          </select>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">{words.toLocaleString()} words{field ? <> · marking <b>{field}</b></> : ''}</span>
      </div>
      <div ref={box}>
        {view === 'raw' ? (
          <pre className="m-0 text-[12.5px] leading-6 text-gray-800 whitespace-pre-wrap break-words font-mono">{mark(rawText, terms, 'raw')}</pre>
        ) : (
          <article className="text-sm leading-6 text-gray-800 space-y-2 max-w-[75ch]">
            {blocks.map((b, i) => {
              if (b.t === 'h') {
                const size = b.level <= 1 ? 'text-lg' : b.level === 2 ? 'text-base' : 'text-sm'
                return <h3 key={i} data-hid={b.id} className={`m-0 mt-4 font-bold text-gray-900 ${size} scroll-mt-16`}>{inline(b.text, terms, `h${i}`)}</h3>
              }
              if (b.t === 'p') return <p key={i} className="m-0">{inline(b.text, terms, `p${i}`)}</p>
              if (b.t === 'hr') return <hr key={i} className="border-gray-100 my-3" />
              if (b.t === 'li') return <div key={i} className="flex gap-2" style={{ paddingLeft: (b.depth - 1) * 16 }}><span className="text-gray-400 select-none" aria-hidden>{b.depth > 1 ? '–' : '•'}</span><span className="min-w-0 break-words">{inline(b.text, terms, `l${i}`)}</span></div>
              if (b.t === 'table') return (
                <div key={i} className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="text-xs w-full border-collapse"><tbody>
                    {b.rows.map((r, ri) => <tr key={ri} className={ri === 0 ? 'bg-gray-50 font-semibold' : 'border-t border-gray-100'}>{r.map((c, ci) => <td key={ci} className="px-2 py-1.5 align-top">{inline(c, terms, `t${i}-${ri}-${ci}`)}</td>)}</tr>)}
                  </tbody></table>
                </div>
              )
              const open = b.items.some(x => hits(x.text, terms))
              return (
                <details key={`${i}-${open}`} open={open} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-gray-600">Menu and navigation links ({b.items.length})</summary>
                  <div className="mt-2 space-y-1">
                    {b.items.map((x, k) => <div key={k} className="flex gap-2 text-[13px]" style={{ paddingLeft: 0 }}><span className="text-gray-400 select-none" aria-hidden>–</span><span className="min-w-0 break-words">{inline(x.text, terms, `n${i}-${k}`)}</span></div>)}
                  </div>
                </details>
              )
            })}
            {blocks.length === 0 && <p className="m-0 text-gray-500">The page had no readable text.</p>}
          </article>
        )}
      </div>
    </div>
  )
}
