import { useMemo } from 'react'

/** The batch on exactly one A4 page: header, donut, table, four facts, and what is blocked. Everything comes from the report data. */
export const A4 = { w: 794, h: 1120 }
const BLUES = ['#93bbfb', '#4a8df0', '#1d4ed8', '#173a9c', '#0f2a73']
const GREYS = ['#d9dee7', '#c8ced9', '#b4bcc9', '#a3acba', '#929cab']
const BLOCK = [
  { bg: '#fdf0e6', fg: '#c2410c' }, { bg: '#f1ebfb', fg: '#6d28d9' }, { bg: '#fce8f1', fg: '#be185d' },
]

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const P = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  const L = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = P(r1, a0), [x1, y1] = P(r1, a1), [x2, y2] = P(r0, a1), [x3, y3] = P(r0, a0)
  return `M${x0} ${y0} A${r1} ${r1} 0 ${L} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${L} 0 ${x3} ${y3} Z`
}
function ring(cx: number, cy: number, r0: number, r1: number, parts: { n: number; fill: string; label?: string; dark?: boolean }[]) {
  const total = parts.reduce((s, p) => s + p.n, 0)
  if (!total) return null
  let a = -Math.PI / 2
  return parts.filter(p => p.n > 0).map((p, i) => {
    const span = (2 * Math.PI * p.n) / total
    const d = p.n === total ? `${arc(cx, cy, r0, r1, a, a + Math.PI)} ${arc(cx, cy, r0, r1, a + Math.PI, a + 2 * Math.PI - 0.0001)}` : arc(cx, cy, r0, r1, a, a + span - 0.012)
    const mid = a + span / 2; a += span
    const rm = (r0 + r1) / 2
    return (
      <g key={i}>
        <path d={d} fill={p.fill} />
        {p.label && span > 0.22 && <text x={cx + rm * Math.cos(mid)} y={cy + rm * Math.sin(mid) + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill={p.dark ? '#fff' : '#1f2937'}>{p.label}</text>}
      </g>
    )
  })
}

const Check = ({ c = '#fff' }: { c?: string }) => <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#fff" /><path d="M7 12.5l3.2 3.2L17 9" stroke="#1d6ff0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>

export function OnePager({ d }: { d: any }) {
  const date = new Date(d.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const T = d.totals
  const base = d.label.replace(/\s*\(.*\)/, '')

  // types: top 4 and the rest together
  const rows = useMemo(() => {
    const t = [...d.by_type].sort((a: any, b: any) => b.total - a.total)
    const top = t.slice(0, 4)
    const rest = t.slice(4)
    if (rest.length) top.push({ type: 'Other', total: rest.reduce((s: number, x: any) => s + x.total, 0), delivered: rest.reduce((s: number, x: any) => s + x.delivered, 0) })
    return top
  }, [d])
  const open = T.sources - T.delivered
  const outer = [
    ...rows.map((r: any, i: number) => ({ n: r.delivered, fill: BLUES[i % 5], label: String(r.delivered), dark: i > 0 })),
    ...rows.map((r: any, i: number) => ({ n: r.total - r.delivered, fill: GREYS[i % 5], label: String(r.total - r.delivered) })),
  ]
  const inner = [{ n: T.delivered, fill: '#1473f0' }, { n: open, fill: '#d6dbe4' }]

  // up to three blocked cards: the rest merge into one
  const groups: any[] = (() => {
    const g = d.blocked
    if (g.length <= 3) return g
    const rest = g.slice(2)
    return [...g.slice(0, 2), { kind: 'other', title: 'Other issues', need: 'A decision on each item', items: rest.flatMap((x: any) => x.items.map((i: any) => ({ ...i, detail: i.detail || x.title }))) }]
  })()
  const MAXL = 7

  return (
    <div id="onepager" style={{ width: A4.w, height: A4.h, background: '#fff', color: '#0f172a', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#1473f0', color: '#fff', padding: '30px 40px 0', height: 672, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={{ background: '#fff', color: '#1f2937', borderRadius: 14, padding: '10px 20px', fontWeight: 800, fontSize: 21 }}>Careerflow.ai</span>
          <span style={{ fontSize: 13, opacity: .92, paddingTop: 6, textAlign: 'right' }}>{d.projects[0] || 'Data extraction'} status update, {date}</span>
        </div>
        <h1 style={{ margin: '22px 0 4px', fontSize: 46, lineHeight: 1.05, fontWeight: 800, letterSpacing: -1, color: '#fff' }}>{base} deliveries</h1>
        <p style={{ margin: 0, fontSize: 18 }}><b>{T.delivered}</b> of <b>{T.sources}</b> sources delivered so far, <b>{T.percent}%</b> of the batch.</p>

        <div style={{ marginTop: 20, background: '#fff', color: '#0f172a', borderRadius: 22, height: 318, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 22, boxShadow: '0 8px 24px rgba(0,0,0,.14)' }}>
          <svg width="280" height="280" viewBox="0 0 290 290" style={{ flex: 'none' }}>
            {ring(145, 145, 98, 140, outer)}
            {ring(145, 145, 56, 90, inner)}
            <text x="145" y="143" textAnchor="middle" fontSize="38" fontWeight="800" fill="#1473f0">{T.percent}%</text>
            <text x="145" y="164" textAnchor="middle" fontSize="13" fill="#6b7280">delivered</text>
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Delivered vs still open, by type</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ color: '#475569', fontSize: 12, textAlign: 'left' }}>
                <th style={{ fontWeight: 600, padding: '0 0 4px' }}></th><th style={{ fontWeight: 600, paddingRight: 10, whiteSpace: 'nowrap' }}><span style={dot('#1473f0')} />Delivered</th><th style={{ fontWeight: 600, paddingRight: 10, whiteSpace: 'nowrap' }}><span style={dot('#cbd2dc')} />Still open</th><th style={{ fontWeight: 600 }}>Done</th></tr></thead>
              <tbody>
                {[...rows, { type: 'All sources', total: T.sources, delivered: T.delivered, all: true }].map((r: any, i: number) => {
                  const pc = r.total ? Math.round((100 * r.delivered) / r.total) : 0
                  const ci = r.all ? -1 : i % 5
                  return (
                    <tr key={r.type} style={{ borderTop: '1px solid #eef1f5', fontWeight: r.all ? 800 : 600 }}>
                      <td style={{ padding: '7px 6px 7px 0', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.type}</td>
                      <td style={{ color: '#1473f0', fontSize: 17, fontWeight: 800 }}><span style={dot(r.all ? '#1473f0' : BLUES[ci])} />{r.delivered}</td>
                      <td style={{ color: '#6b7280', fontSize: 17, fontWeight: 800 }}><span style={dot(r.all ? '#d6dbe4' : GREYS[ci])} />{r.total - r.delivered}</td>
                      <td style={{ whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: 56, height: 7, borderRadius: 4, background: '#e5e7eb', verticalAlign: 'middle', marginRight: 6 }}><span style={{ display: 'block', width: `${pc}%`, height: 7, borderRadius: 4, background: '#1473f0' }} /></span>{pc}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p style={{ margin: '12px 0 0', fontSize: 11.5, color: '#4b5563', lineHeight: 1.45 }}>Inner ring: delivered vs still open. Outer ring: the split by type, darker blue is delivered. {open ? `The ${open} still open are our top priority.` : 'Every source in this batch is delivered.'}</p>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {d.cards.map((c: any, i: number) => (
            <div key={i} style={{ background: 'rgba(255,255,255,.13)', border: '1px solid rgba(255,255,255,.3)', borderRadius: 16, padding: '14px 14px', height: 124, boxSizing: 'border-box', display: 'flex', gap: 9, overflow: 'hidden' }}>
              <span style={{ flex: 'none' }}><Check /></span>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>{c.title}</div><div style={{ fontSize: 11.5, opacity: .93, marginTop: 4, lineHeight: 1.4 }}>{c.text}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, padding: '24px 40px 0', minHeight: 0, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -.6 }}>What's blocked<span style={{ color: '#1473f0', fontSize: 22, verticalAlign: 'top' }}>*</span></div>
        {groups.length === 0 ? (
          <div style={{ marginTop: 12, background: '#ecfdf3', borderRadius: 16, padding: '22px 24px', color: '#166534' }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Nothing is blocked</div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>Every source in this batch can move forward as written. Nothing is waiting on the client.</div>
          </div>
        ) : (
          <>
            <p style={{ margin: '3px 0 10px', fontSize: 13, color: '#4b5563' }}>{T.blocked} {T.blocked === 1 ? 'source can\'t' : 'sources can\'t'} move as things stand. We flag them early so they don't hold up the rest, and each group needs a decision from you.</p>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${groups.length}, 1fr)`, gap: 12 }}>
              {groups.map((g: any, i: number) => {
                const st = BLOCK[i % 3]
                return (
                  <div key={g.title} style={{ background: st.bg, borderRadius: 16, padding: '14px 16px', boxSizing: 'border-box', height: 252, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 40, lineHeight: .95, fontWeight: 800, color: st.fg }}>{g.items.length}</span>
                      <div style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.2 }}>{g.title}</div><div style={{ fontSize: 11, marginTop: 3, lineHeight: 1.35 }}><b style={{ color: st.fg }}>Need from you:</b> <span style={{ color: '#4b5563' }}>{g.need}</span></div></div>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(0,0,0,.08)', marginTop: 9, paddingTop: 7 }}>
                      {g.items.slice(0, MAXL).map((it: any, j: number) => (
                        <div key={j} style={{ fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b style={{ color: st.fg }}>{it.item_no ? `#${it.item_no}` : '•'}</b> {it.name}{it.detail ? <span style={{ color: '#6b7280' }}> {it.detail}</span> : null}</div>
                      ))}
                      {g.items.length > MAXL && <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>and {g.items.length - MAXL} more</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
        <p style={{ margin: '10px 0 0', fontSize: 11.5, color: '#6b7280' }}><span style={{ color: '#1473f0', fontWeight: 800 }}>*</span> This list updates as the batch moves. Built from live platform data.</p>
      </div>
    </div>
  )
}

function dot(c: string): React.CSSProperties {
  return { display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: c, marginRight: 6, verticalAlign: 'middle' }
}
