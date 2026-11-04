import { Fragment, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/** The engagement report, as 16:9 slides: a short overview of the whole period, then each batch on its own pages, then an appendix.
 *  Every number is read from the platform when the report opens. Names appear only on the extractor slide, and only when `names` is on. */
export const SLIDE = { w: 1280, h: 720 }
const INK = '#0b2447', BLUE = '#1473f0', DEEP = '#0d3b8f', PALE = '#eef4ff', LINE = '#dbe5f5', MUTE = '#5a6b86', AMBER = '#e39b0b', GREEN = '#12a06b', RED = '#d6453d', SOFT = '#8593ab'
const SERIF = "Georgia, Cambria, 'Times New Roman', serif"
const SANS = "'Inter','Segoe UI',system-ui,sans-serif"
const nf = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toLocaleString())
const r1 = (n: number) => Math.round(n * 10) / 10
const p1 = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${r1(n)}%`)
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const dshort = (s: string | number) => { const d = new Date(s); return isNaN(+d) ? String(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const DAY = 86400000

function Ring({ pct, size = 120, stroke = 14, color = BLUE, track = LINE, label, sub, textColor = INK }: { pct: number; size?: number; stroke?: number; color?: string; track?: string; label?: string; sub?: string; textColor?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y={sub ? '48%' : '54%'} textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize={size * 0.24} fill={textColor}>{label ?? `${r1(v)}%`}</text>
      {sub && <text x="50%" y="66%" textAnchor="middle" fontSize={size * (size > 300 ? 0.055 : 0.11)} fill={textColor} opacity=".8">{sub}</text>}
    </svg>
  )
}

/** A slide: title and one-line lede flow above the content, so they can never overlap it. */
function Frame({ n, title, lede, children, project }: { n: number; title: string; lede?: string; children: ReactNode; project: string }) {
  return (
    <div className="deck-slide" style={{ width: SLIDE.w, height: SLIDE.h, position: 'relative', overflow: 'hidden', background: '#fff', color: INK, fontFamily: SANS, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', padding: '40px 64px 54px 64px' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 10, background: `linear-gradient(${BLUE}, ${DEEP})` }} />
      <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 36, lineHeight: 1.14, fontWeight: 700, letterSpacing: -.5, color: INK, maxWidth: 1060 }}>{title}</h2>
      {lede && <p style={{ margin: '10px 0 0', fontSize: 18, color: MUTE, maxWidth: 1020, lineHeight: 1.45 }}>{lede}</p>}
      <div style={{ flex: 1, minHeight: 0, marginTop: 22, position: 'relative' }}>{children}</div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 20, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: SOFT }}><span>Careerflow.ai · {project}</span><span>{n}</span></div>
    </div>
  )
}

const Panel = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <div style={{ background: PALE, borderRadius: 16, padding: 24, ...style }}>{children}</div>
const Big = ({ v, l, c = BLUE, size = 56 }: { v: string; l: string; c?: string; size?: number }) => <div><div style={{ fontFamily: SERIF, fontSize: size, fontWeight: 700, color: c, lineHeight: 1, letterSpacing: -1 }}>{v}</div><div style={{ fontSize: 16, color: MUTE, marginTop: 7, lineHeight: 1.35 }}>{l}</div></div>
const H3 = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12, color: INK }}>{children}</div>

/** One horizontal bar per row: label, bar filled to value/of, and a figure on the right. */
function Bars({ rows, labelW = 190, color = BLUE, h = 20, gap = 16 }: { rows: { label: string; v: number; of?: number; right?: string; color?: string; note?: string }[]; labelW?: number; color?: string; h?: number; gap?: number }) {
  const mx = Math.max(1, ...rows.map(r => r.of ?? r.v))
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: `${labelW}px 1fr 84px`, alignItems: 'center', gap: 14, marginBottom: gap }}>
          <div style={{ fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.label}>{r.label}{r.note && <span style={{ color: AMBER, fontSize: 12, fontWeight: 700 }}> {r.note}</span>}</div>
          <div style={{ height: h, background: LINE, borderRadius: h / 2, overflow: 'hidden' }}><div style={{ width: `${(100 * r.v) / (r.of ?? mx)}%`, height: h, background: r.color ?? color, borderRadius: h / 2 }} /></div>
          <div style={{ fontSize: 16, color: MUTE, textAlign: 'right' }}>{r.right ?? r.v}</div>
        </div>
      ))}
    </div>
  )
}

/** Before-and-after accuracy for each batch on a labelled scale: the gap is what review added. */
function Dumbbell({ rows, w = 520 }: { rows: { label: string; a: number; b: number }[]; w?: number }) {
  const lo = Math.max(0, Math.floor((Math.min(...rows.map(r => r.a), ...rows.map(r => r.b)) - 4) / 5) * 5), hi = 100
  const X = (v: number) => 150 + ((v - lo) / (hi - lo)) * (w - 190), rowH = 104, H = rows.length * rowH + 46
  const ticks: number[] = []
  for (let v = lo; v <= hi; v += (hi - lo) > 20 ? 10 : 5) ticks.push(v)
  return (
    <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} fontFamily={SANS}>
      {ticks.map(v => <g key={v}><line x1={X(v)} x2={X(v)} y1={4} y2={rows.length * rowH + 4} stroke={LINE} /><text x={X(v)} y={rows.length * rowH + 26} textAnchor="middle" fontSize="13" fill={MUTE}>{v}%</text></g>)}
      {rows.map((r, i) => {
        const y = i * rowH + 56
        return (
          <g key={i}>
            <text x={0} y={y + 5} fontSize="18" fontWeight="700" fill={INK}>{r.label}</text>
            <line x1={X(r.a)} x2={X(r.b)} y1={y} y2={y} stroke={GREEN} strokeWidth="6" strokeLinecap="round" opacity=".35" />
            <circle cx={X(r.a)} cy={y} r="12" fill={AMBER} /><circle cx={X(r.b)} cy={y} r="12" fill={GREEN} />
            <text x={X(r.a)} y={y - 22} textAnchor="middle" fontSize="15" fontWeight="700" fill={AMBER}>{p1(r.a)}</text>
            <text x={X(r.b)} y={y - 22} textAnchor="middle" fontSize="15" fontWeight="700" fill={GREEN}>{p1(r.b)}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Cumulative sources pulled and sent back, as steps over time. The gap between the lines is work in hand. */
function Steps({ pulled, sent, lo, hi, w = 1150, h = 250 }: { pulled: number[]; sent: number[]; lo: number; hi: number; w?: number; h?: number }) {
  const L = 44, R = 70, T = 14, B = 34
  const total = Math.max(1, pulled.length)
  const X = (t: number) => L + ((t - lo) / Math.max(1, hi - lo)) * (w - L - R), Y = (n: number) => T + (1 - n / total) * (h - T - B)
  const path = (ts: number[]) => {
    const s = [...ts].sort((a, b) => a - b); let d = `M${X(lo)},${Y(0)}`, n = 0
    s.forEach(t => { d += ` L${X(t)},${Y(n)} L${X(t)},${Y(++n)}` })
    return d + ` L${X(hi)},${Y(n)}`
  }
  const days = Math.max(1, Math.round((hi - lo) / DAY)), stepD = days > 24 ? 7 : days > 12 ? 3 : 1
  const xt: number[] = []
  for (let d = 0; d <= days; d += stepD) xt.push(lo + d * DAY)
  const yt = [0, Math.round(total / 2), total]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fontFamily={SANS}>
      {yt.map(v => <g key={v}><line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} stroke={LINE} /><text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill={MUTE}>{v}</text></g>)}
      {xt.map(t => <text key={t} x={X(t)} y={h - 10} textAnchor="middle" fontSize="12" fill={MUTE}>{dshort(t)}</text>)}
      <path d={path(pulled)} fill="none" stroke={BLUE} strokeWidth="3.5" strokeLinejoin="round" />
      <path d={path(sent)} fill="none" stroke={GREEN} strokeWidth="3.5" strokeLinejoin="round" />
      <text x={w - R + 8} y={Y(pulled.length) + 4} fontSize="13" fontWeight="700" fill={BLUE}>pulled {pulled.length}</text>
      <text x={w - R + 8} y={Y(sent.length) + 18} fontSize="13" fontWeight="700" fill={GREEN}>sent back {sent.length}</text>
    </svg>
  )
}

const niceReason = (t: string) => (/^other \(explain/i.test(t) ? 'Escalated: nothing found to extract' : t)

export function EngagementDeck({ e, names = false }: { e: any; names?: boolean }) {
  const T = e.totals, batches: any[] = (e.batches ?? []).filter((b: any) => b.key !== 'other' || b.totals.sources > 0)
  const real = batches.filter((b: any) => b.key !== 'other')
  const scopeLabel = e.scope && e.scope.kind !== 'all' ? String(e.scope.label).replace(/\s*\(.*\)/, '') : ''
  const project = scopeLabel || (e.projects[0] || 'Data extraction')
  const projLine = e.projects.length > 1 ? plural(e.projects.length, 'project', 'projects') : (e.projects[0] || 'Data extraction')
  const month = e.scope && e.scope.kind === 'month' ? String(e.scope.label).split(' ')[0] : ''
  const bname = (b: any) => (b.ordinal ? (month ? `${month} batch ${b.ordinal}` : String(b.label).replace(/\s*\(.*\)/, '')) : 'Other sources')
  const rangeA = e.period_from ? dt(e.period_from) : '', rangeB = dt(e.generated_at)
  const pct = T.sources ? Math.round((100 * T.delivered) / T.sources) : 0
  const stageColor: Record<string, string> = { delivered: DEEP, signoff: BLUE, peer_review: '#6ea8fb', needs_fixes: AMBER, extracting: '#b9cdf3', not_started: '#d4dbe8', blocked: RED, ready_to_send: '#4f86e8' }
  let n = 0
  const next = () => ++n
  const hasQuality = T.final_accuracy != null && T.first_pass_accuracy != null
  const allSources: any[] = batches.flatMap((b: any) => b.sources)
  const reviewed = allSources.filter(s => s.peers_done > 0).length
  const tmAll = e.timing && !e.timing.empty ? e.timing : null
  const who = (i: number, name?: string | null) => (names && name ? name : `Extractor ${i + 1}`)
  const hrs = (h: number | null | undefined) => (h == null ? '–' : h < 48 ? `${h} h` : `${r1(h / 24)} days`)
  const people = (tmAll?.people ?? []).filter((x: any) => x.sources > 0).slice(0, 8)
  const slowest = Math.max(1, ...people.map((x: any) => x.extraction?.max ?? 0))
  const answered = (e.qa?.items ?? []).filter((x: any) => x.status === 'answered').map((x: any) => ({ ...x, answer: String(x.answer ?? '').replace(/^FROM CLIENT:\s*/i, '') })).sort((a: any, b: any) => (a.answer.length > 300 ? 1 : 0) - (b.answer.length > 300 ? 1 : 0))
  const CH: Record<string, string> = { link: 'Pages we could not reach', nodata: 'Sources with nothing to extract', question: 'Points only the client could settle' }
  const chCount = (k: string) => e.challenges.find((x: any) => x.kind === k)?.count ?? 0
  const fieldTot: Record<string, number> = {}
  batches.forEach((b: any) => (b.times?.corrections?.top_fields ?? []).forEach((f: any) => { fieldTot[f.field] = (fieldTot[f.field] ?? 0) + f.count }))
  const topFields = Object.entries(fieldTot).sort((a, b) => b[1] - a[1]).slice(0, 7)
  const returned = batches.reduce((s: number, b: any) => s + (b.times?.corrections?.records_returned ?? 0), 0)
  const recsAll = batches.reduce((s: number, b: any) => s + (b.totals.records ?? 0), 0)
  const stages: any[] = e.stages.filter((s: any) => s.count > 0)
  const blockedItems: any[] = e.blocked.flatMap((g: any) => g.items.map((i: any) => ({ ...i, why: niceReason(g.title), need: g.need })))

  // the delivery curve
  const pullT: number[] = []
  real.forEach((b: any) => { const d = b.times?.dates?.pulled; if (d) for (let i = 0; i < b.totals.sources; i++) pullT.push(+new Date(d[0])) })
  const sentT: number[] = (e.delivered_rows ?? []).map((r: any) => +new Date(r.submitted_at || r.approved_at)).filter((x: number) => !isNaN(x))
  const lo = pullT.length ? Math.min(...pullT) : 0, hi = Math.max(lo + DAY, ...sentT, ...pullT)
  const spanDays = pullT.length && sentT.length ? r1((Math.max(...sentT) - lo) / DAY) : null
  const dlv = real.map((b: any) => b.times?.dates?.deliver_days).filter((x: any) => x != null)
  const ends = (b: any) => +new Date(b.times.dates.xtrium?.[1] ?? b.times.dates.approved?.[1] ?? b.times.dates.submitted?.[1] ?? b.times.dates.pulled[1])

  const batchSlides = (b: any) => {
    const tt = b.times && !b.times.empty ? b.times : null
    const qq = b.quality, nm = bname(b), dts = tt?.dates || {}
    const sts = b.stages.filter((s: any) => s.count > 0)
    const together = tt?.approved_together ?? 0
    const cov = b.sources.filter((s: any) => s.peers_done > 0).length
    const out: ReactNode[] = []
    out.push(
      <Frame key={`${b.key}-a`} n={next()} project={project} title={`${nm}: ${b.totals.delivered} of ${b.totals.sources} delivered`} lede={b.key === 'other' ? undefined : `Pulled from Xtrium on ${dt(b.date)}${b.totals.blocked ? `, and ${plural(b.totals.blocked, 'source needs', 'sources need')} a decision` : ''}.`}>
        <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: 44, alignItems: 'center', height: '100%' }}>
          <Panel style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Ring pct={b.totals.percent} size={290} stroke={30} label={`${b.totals.percent}%`} /></Panel>
          <div>
            <div style={{ display: 'flex', gap: 5, height: 52, borderRadius: 10, overflow: 'hidden' }}>
              {sts.map((s: any) => <div key={s.key} title={`${s.label}: ${s.count}`} style={{ flex: s.count, background: stageColor[s.key], color: ['extracting', 'not_started', 'peer_review'].includes(s.key) ? INK : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>{s.count}</div>)}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', fontSize: 14, color: MUTE }}>{sts.map((s: any) => <span key={s.key}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: stageColor[s.key], marginRight: 6 }} />{s.label}</span>)}</div>
            <div style={{ marginTop: 22 }}><Bars labelW={190} gap={18} rows={b.by_type.slice(0, 4).map((x: any) => ({ label: x.type, v: x.delivered, of: x.total, right: `${x.delivered} of ${x.total}`, color: x.delivered === x.total ? GREEN : BLUE }))} /></div>
            <div style={{ display: 'flex', gap: 36, marginTop: 14 }}>
              <Big size={52} v={nf(b.totals.records_approved)} l="records approved" />
              <Big size={52} v={nf(b.totals.submitted_to_xtrium)} l={b.totals.resubmitted ? `sent to Xtrium, ${b.totals.resubmitted} twice` : 'sent to Xtrium'} c={GREEN} />
              <Big size={52} v={`${cov} of ${b.totals.sources}`} l="sources with a peer review" c={DEEP} />
            </div>
          </div>
        </div>
      </Frame>
    )
    if (tt && tt.milestones.length > 1) {
      const dr = (x?: string[] | null) => (!x ? '' : dshort(x[0]) === dshort(x[1]) ? dshort(x[0]) : `${dshort(x[0])} to ${dshort(x[1])}`)
      const dl = dts.deliver_days ?? tt.span_days
      const story = [dts.pulled && `Pulled ${dr(dts.pulled)}`, dts.started && `extraction ${dr(dts.started)}`, dts.submitted && `submitted for review ${dr(dts.submitted)}`, dts.xtrium && `sent to Xtrium ${dr(dts.xtrium)}`].filter(Boolean).join(', then ')
      type St = { v: string; l: string; c: string }
      const stat = (v: any, l: string, c = BLUE): St | null => (v == null ? null : { v: String(v), l, c })
      const same = dts.work_days != null && dts.work_days === dl
      const stats = [
        same ? stat(dl, 'days from pull to the last source sent back', BLUE) : stat(dts.work_days, 'days from pull to the last source sent for review', BLUE),
        same ? null : stat(dl, dts.xtrium ? 'days from pull to the last source sent to Xtrium' : 'days from pull to the last approval', DEEP),
        stat(tt.extraction?.avg, 'days of extraction per source, on average', DEEP),
        stat(qq && qq.first_pass_accuracy != null ? r1(100 - qq.first_pass_accuracy) : null, 'errors per 100 fields before review', AMBER),
        stat(qq?.first_pass_accuracy != null ? p1(qq.first_pass_accuracy) : null, 'right the first time', AMBER),
        stat(qq?.final_accuracy != null ? p1(qq.final_accuracy) : null, 'accurate when delivered', GREEN),
        stat(tt.corrections.records_returned, `${tt.corrections.records_returned === 1 ? 'record' : 'records'} returned for correction`, tt.corrections.records_returned ? AMBER : GREEN),
        stat(tt.validation.peer.submitted, 'peer reviews submitted', DEEP),
      ].filter(Boolean) as St[]
      out.push(
        <Frame key={`${b.key}-b`} n={next()} project={project} title={`${nm}: ${dl != null ? `${dl} days from pull to delivery` : 'how the work moved'}`} lede={`${story}.${together ? ` ${plural(together, 'source was', 'sources were')} approved together in one sitting, so review times are left out.` : ''}`}>
          <div style={{ position: 'relative', paddingTop: 6 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 17, height: 4, background: LINE, borderRadius: 2 }} />
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tt.milestones.length},1fr)`, gap: 12 }}>
              {tt.milestones.map((m: any, i: number) => (
                <div key={m.key}>
                  <div style={{ width: 24, height: 24, borderRadius: 12, boxSizing: 'border-box', background: i === tt.milestones.length - 1 ? GREEN : BLUE, border: '4px solid #fff', boxShadow: `0 0 0 2px ${LINE}`, marginBottom: 12, position: 'relative', top: 0 }} />
                  <div style={{ fontFamily: SERIF, fontSize: 23, fontWeight: 700, lineHeight: 1.2 }}>{dshort(m.at)}{m.at_end ? ` to ${dshort(m.at_end)}` : ''}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: BLUE, margin: '4px 0' }}>{m.label}</div>
                  <div style={{ fontSize: 15, color: MUTE, lineHeight: 1.4 }}>{m.detail}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {stats.slice(0, 8).map((s, i) => <Panel key={i} style={{ padding: '20px 22px' }}><div style={{ fontFamily: SERIF, fontSize: 46, fontWeight: 700, color: s.c, lineHeight: 1 }}>{s.v}</div><div style={{ fontSize: 15.5, color: MUTE, marginTop: 8, lineHeight: 1.3 }}>{s.l}</div></Panel>)}
          </div>
        </Frame>
      )
    }
    if (tt) {
      const v = tt.validation, c = tt.corrections
      const bl = b.blocked.flatMap((g: any) => g.items.map((i: any) => ({ ...i, why: niceReason(g.title), need: g.need })))
      out.push(
        <Frame key={`${b.key}-d`} n={next()} project={project} title={`${nm}: how review went`} lede={`${c.records_returned ? `${plural(c.records_returned, 'record', 'records')} came back for correction and were fixed before delivery.` : 'No records had to be sent back.'} Sending work back is the review doing its job.`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 34 }}>
            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              <Panel style={{ padding: '24px 28px' }}><Big size={52} v={String(v.peer.submitted)} l={`peer reviews submitted${v.peer.turnaround_days ? `, ${v.peer.turnaround_days.avg} days on average after submission` : ''}`} c={DEEP} /></Panel>
              {v.admin.hours && v.admin.hours.n >= 3 && <Panel style={{ padding: '24px 28px' }}><Big size={52} v={hrs(v.admin.hours.avg)} l={`average from sending to an admin decision, over ${v.admin.hours.n} decisions`} c={GREEN} /></Panel>}
              <Panel style={{ padding: '24px 28px' }}><Big size={52} v={String(c.records_returned)} l={`${c.records_returned === 1 ? 'record' : 'records'} returned across ${plural(c.sources_returned, 'source', 'sources')}, with ${c.notes} reviewer notes${c.resets ? `, ${c.resets} reset to start again` : ''}`} c={c.records_returned ? AMBER : GREEN} /></Panel>
            </div>
            <div>
              <H3>Fields reviewers commented on most</H3>
              {c.top_fields.length ? <Bars labelW={210} color={AMBER} gap={22} rows={c.top_fields.slice(0, 6).map((f: any) => ({ label: f.field.replace(/_/g, ' '), v: f.count }))} /> : <p style={{ color: MUTE, fontSize: 16 }}>Reviewers returned work without field-level notes.</p>}
            </div>
          </div>
          {bl.length > 0 && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff6e0', border: '1px solid #f3d99a', borderRadius: 14, padding: '14px 22px', fontSize: 16, lineHeight: 1.5 }}>
            <b style={{ color: AMBER }}>Needs a decision.</b> {bl.slice(0, 2).map((i: any) => `${i.item_no ? `#${i.item_no} ` : ''}${i.name}`).join('; ')}: {bl[0].why}. <b>We need:</b> {bl[0].need}.
          </div>}
        </Frame>
      )
    }
    return out
  }

  const appendix = (b: any) => {
    const per: Record<string, any> = Object.fromEntries((b.times?.per_source ?? []).map((x: any) => [x.source_id, x]))
    const rows = b.sources.slice(0, 10)
    return (
      <Frame key={`${b.key}-t`} n={next()} project={project} title={`Appendix: ${bname(b)}, every source`} lede={b.sources.length > 10 ? `Showing 10 of ${b.sources.length} sources.` : undefined}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
          <thead><tr style={{ textAlign: 'left', color: MUTE, fontSize: 13 }}>{['Source', 'Category', 'Stage', 'Extraction', 'Records', 'Peer reviews', 'Accuracy'].map(h => <th key={h} style={{ padding: '0 8px 9px', fontWeight: 600, borderBottom: `2px solid ${INK}` }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((s: any, i: number) => (
            <tr key={s.source_id} style={{ background: i % 2 ? '#f8faff' : '#fff' }}>
              <td style={{ padding: '11px 8px', fontWeight: 600, maxWidth: 290, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</td>
              <td style={{ padding: '11px 8px' }}>{s.category}</td>
              <td style={{ padding: '11px 8px', whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: stageColor[s.stage], marginRight: 7 }} />{b.stages.find((x: any) => x.key === s.stage)?.label}{s.submissions > 1 ? ` (sent ${s.submissions}×)` : ''}</td>
              <td style={{ padding: '11px 8px' }}>{per[s.source_id]?.extraction_days != null ? `${per[s.source_id].extraction_days} d` : '–'}</td>
              <td style={{ padding: '11px 8px' }}>{s.approved} of {s.records}</td>
              <td style={{ padding: '11px 8px' }}>{s.peers_done} of {s.peers_total}{s.peers_flagged > 0 && s.peers_done < s.peers_total ? `, ${s.peers_flagged} raised findings` : ''}</td>
              <td style={{ padding: '11px 8px' }}>{p1(s.final_accuracy)}</td>
            </tr>))}</tbody>
        </table>
      </Frame>
    )
  }

  return (
    <div className="deck-wrap">
      {/* cover */}
      <div className="deck-slide" style={{ width: SLIDE.w, height: SLIDE.h, position: 'relative', overflow: 'hidden', background: `linear-gradient(135deg, ${BLUE} 0%, ${DEEP} 100%)`, color: '#fff', fontFamily: SANS }}>
        <div style={{ position: 'absolute', right: 90, top: 110 }}><Ring pct={pct} size={430} stroke={34} color="#fff" track="rgba(255,255,255,.2)" label={`${pct}%`} sub="of sources delivered" textColor="#fff" /></div>
        <div style={{ position: 'absolute', left: 80, top: 64 }}><span style={{ background: '#fff', color: '#1f2937', borderRadius: 12, padding: '9px 20px', fontWeight: 800, fontSize: 20 }}>Careerflow.ai</span></div>
        <div style={{ position: 'absolute', left: 80, top: 230, width: 640 }}>
          <div style={{ fontSize: 20, opacity: .85, marginBottom: 14 }}>Data extraction report</div>
          <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 66, lineHeight: 1.04, fontWeight: 700, letterSpacing: -1.5, color: '#fff' }}>{scopeLabel || 'Engagement report'}</h1>
          <p style={{ margin: '22px 0 0', fontSize: 23, lineHeight: 1.5, opacity: .93 }}>{nf(T.sources)} sources in {plural(T.batches, 'batch', 'batches')}, extracted, peer-reviewed and approved on one auditable platform.</p>
        </div>
        <div style={{ position: 'absolute', left: 80, bottom: 70, fontSize: 16, lineHeight: 1.7, opacity: .92 }}>{projLine}<br />{rangeA} to {rangeB}</div>
      </div>

      {/* 1. the picture in one page */}
      <Frame n={next()} project={project} title={`${T.delivered} of ${T.sources} sources delivered, ${hasQuality ? `${p1(T.final_accuracy)} accurate` : `${nf(T.records_approved)} records approved`}`} lede={`${plural(T.batches, 'batch', 'batches')} pulled from Xtrium${spanDays != null ? `, ${spanDays} days from the first pull to the last source sent back` : ''}. Each batch is reported on its own after this overview.`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 40, height: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: '1fr', gap: 18 }}>
            <Panel style={{ display: 'flex', alignItems: 'center' }}><Big size={58} v={nf(T.sources)} l="sources pulled from Xtrium" /></Panel>
            <Panel style={{ display: 'flex', alignItems: 'center' }}><Big size={58} v={nf(T.records_approved)} l="records approved" c={DEEP} /></Panel>
            <Panel style={{ display: 'flex', alignItems: 'center' }}><Big size={58} v={hasQuality ? p1(T.final_accuracy) : '–'} l={`accurate when delivered, across ${nf(T.fields)} fields`} c={GREEN} /></Panel>
            <Panel style={{ display: 'flex', alignItems: 'center' }}><Big size={58} v={hasQuality ? p1(T.first_pass_accuracy) : '–'} l="right the first time, before review" c={AMBER} /></Panel>
          </div>
          <div>
            <H3>How the work moved</H3>
            <Bars labelW={220} h={28} gap={24} rows={[
              { label: 'Pulled from Xtrium', v: T.sources, of: T.sources, right: String(T.sources), color: '#b9cdf3' },
              { label: 'Peer-reviewed sources', v: reviewed, of: T.sources, right: String(reviewed), color: '#6ea8fb' },
              { label: 'Approved by an admin', v: T.approved ?? T.delivered, of: T.sources, right: String(T.approved ?? T.delivered), color: BLUE },
              { label: T.resubmitted ? 'Sent to Xtrium' : 'Sent to Xtrium', v: T.submitted, of: T.sources, right: String(T.submitted), color: DEEP, note: T.resubmitted ? `${T.resubmitted} twice` : undefined },
            ]} />
            {T.blocked > 0 && <div style={{ marginTop: 22, background: '#fff6e0', border: '1px solid #f3d99a', borderRadius: 14, padding: '16px 22px', fontSize: 18, lineHeight: 1.5 }}>
              <b style={{ color: AMBER }}>{plural(T.blocked, 'source needs', 'sources need')} a decision:</b> {blockedItems.slice(0, 2).map((i: any) => `${i.item_no ? `#${i.item_no} ` : ''}${i.name}`).join('; ')}. {blockedItems[0]?.why}.
            </div>}
          </div>
        </div>
      </Frame>

      {/* 2. batches side by side */}
      {real.length > 0 && (
        <Frame n={next()} project={project} title={`${plural(real.length, 'batch', 'batches')}, side by side`} lede="A batch is the set of sources Xtrium gave us on one day. The chart shows what review added to each batch's accuracy.">
          <div style={{ display: 'grid', gridTemplateColumns: '520px 1fr', gap: 30 }}>
            <div>
              <H3>Accuracy before and after review</H3>
              {real.some((b: any) => b.quality?.first_pass_accuracy != null) ? <Dumbbell rows={real.filter((b: any) => b.quality?.first_pass_accuracy != null).map((b: any) => ({ label: bname(b), a: b.quality.first_pass_accuracy, b: b.quality.final_accuracy ?? b.quality.first_pass_accuracy }))} /> : <p style={{ color: MUTE }}>No audited fields yet.</p>}
              <div style={{ display: 'flex', gap: 18, fontSize: 13.5, color: MUTE, marginTop: 4 }}><span><span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 6, background: AMBER, marginRight: 6 }} />right first time</span><span><span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 6, background: GREEN, marginRight: 6 }} />accurate when delivered</span></div>
            </div>
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 18 }}>
                <thead><tr style={{ textAlign: 'left', color: MUTE, fontSize: 14 }}>{['Batch', 'Pulled', 'Delivered', 'Records', 'Days', 'Returned'].map(h => <th key={h} style={{ padding: '0 8px 10px', fontWeight: 600, borderBottom: `2px solid ${INK}` }}>{h}</th>)}</tr></thead>
                <tbody>{real.map((b: any, i: number) => (
                  <tr key={b.key} style={{ background: i % 2 ? '#f8faff' : '#fff' }}>
                    <td style={{ padding: '22px 8px', whiteSpace: 'nowrap', fontWeight: 700 }}>{bname(b)}</td>
                    <td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{dshort(b.date)}</td>
                    <td style={{ padding: '22px 8px', whiteSpace: 'nowrap', fontWeight: 700, color: b.totals.delivered === b.totals.sources ? GREEN : AMBER }}>{b.totals.delivered} of {b.totals.sources}</td>
                    <td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{nf(b.totals.records_approved)}</td>
                    <td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{b.times?.dates?.deliver_days ?? '–'}</td>
                    <td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{b.times?.corrections?.records_returned ?? '–'}</td>
                  </tr>))}
                  {real.length > 1 && <tr style={{ borderTop: `2px solid ${INK}`, fontWeight: 800 }}><td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>Together</td><td /><td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{T.delivered} of {T.sources}</td><td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{nf(T.records_approved)}</td><td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{spanDays ?? '–'}</td><td style={{ padding: '22px 8px', whiteSpace: 'nowrap' }}>{returned}</td></tr>}
                </tbody>
              </table>
              <div style={{ fontSize: 13, color: MUTE, marginTop: 8 }}>Days is from the pull to the last source sent back to Xtrium. Returned is records sent back for correction.</div>
            </div>
          </div>
        </Frame>
      )}

      {/* 3. time line and delivery curve */}
      {pullT.length > 0 && sentT.length > 0 && (
        <Frame n={next()} project={project} title={spanDays != null ? `${spanDays} days from the first pull to the last source sent back` : 'How delivery tracked the pulls'} lede="Each bar is one batch, from the day it was pulled to the day its last source went back to Xtrium. The dark mark is when its first source went to review.">
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 120px', gap: 14, alignItems: 'center', marginBottom: 14 }}>
            {real.filter((b: any) => b.times?.dates?.pulled).map((b: any) => {
              const d = b.times.dates, s0 = +new Date(d.pulled[0]), e0 = ends(b), f0 = +new Date(d.submitted?.[0])
              const pos = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100
              return (
                <Fragment key={b.key}>
                  <div><div style={{ fontWeight: 700, fontSize: 17 }}>{bname(b)}</div><div style={{ fontSize: 13, color: MUTE }}>{plural(b.totals.sources, 'source', 'sources')}</div></div>
                  <div style={{ position: 'relative', height: 28, background: PALE, borderRadius: 14 }}>
                    <div style={{ position: 'absolute', left: `${pos(s0)}%`, width: `${Math.max(2, pos(e0) - pos(s0))}%`, top: 5, height: 18, borderRadius: 9, background: b.totals.delivered === b.totals.sources ? BLUE : AMBER }} />
                    {!isNaN(f0) && <div style={{ position: 'absolute', left: `${pos(f0)}%`, top: 2, width: 5, height: 24, borderRadius: 3, background: INK }} />}
                  </div>
                  <div style={{ fontSize: 15 }}><b>{d.deliver_days ?? r1((e0 - s0) / DAY)} days</b></div>
                </Fragment>
              )
            })}
          </div>
          <H3>Cumulative sources: pulled and sent back</H3>
          <Steps pulled={pullT} sent={sentT} lo={lo} hi={hi} w={1150} h={Math.max(210, 330 - real.length * 30)} />
        </Frame>
      )}

      {/* 4. quality */}
      {hasQuality && (
        <Frame n={next()} project={project} title={`Review lifts accuracy from ${p1(T.first_pass_accuracy)} to ${p1(T.final_accuracy)}`} lede={`Checked against the real sources across ${nf(T.fields)} fields. ${returned ? `${plural(returned, 'record', 'records')} of ${recsAll} (${Math.round((100 * returned) / Math.max(1, recsAll))}%) went back for correction.` : ''}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '250px 250px 1fr', gap: 30, alignItems: 'start' }}>
            <Panel style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20 }}><Ring pct={T.first_pass_accuracy} size={210} stroke={24} color={AMBER} /><div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>Right first time</div><div style={{ fontSize: 13, color: MUTE }}>before review</div></Panel>
            <Panel style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20 }}><Ring pct={T.final_accuracy} size={210} stroke={24} color={GREEN} /><div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>Accurate when delivered</div><div style={{ fontSize: 13, color: MUTE }}>after review and sign-off</div></Panel>
            <div>
              <H3>Where the corrections came from</H3>
              {topFields.length ? <Bars labelW={200} color={AMBER} h={20} gap={16} rows={topFields.map(([f, c]) => ({ label: f.replace(/_/g, ' '), v: c }))} /> : <p style={{ color: MUTE }}>No field-level notes were recorded.</p>}
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', gap: 60 }}>
            <Big size={44} v={nf(T.fields)} l="fields checked against the real sources" c={DEEP} />
            <Big size={44} v={String(r1(100 - T.first_pass_accuracy))} l="errors per 100 fields before review" c={AMBER} />
            {T.caught_rate != null && <Big size={44} v={p1(T.caught_rate)} l="of known errors caught by peer reviewers" />}
            <Big size={44} v={`${reviewed} of ${T.sources}`} l="sources had a submitted peer review" c={GREEN} />
          </div>
        </Frame>
      )}

      {/* 5. extraction time per extractor */}
      {tmAll && people.length > 0 && (
        <Frame n={next()} project={project} title={tmAll.extraction ? `Extraction took ${tmAll.extraction.avg} days on average per source` : 'Time per extractor'} lede={`Days from starting a source to sending it for review, as elapsed time, so waiting and weekends are included.${names ? '' : ' Names are left out of this version.'}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 19 }}>
            <thead><tr style={{ textAlign: 'left', color: MUTE, fontSize: 14 }}>{['Extractor', 'Sources', 'Records', 'Average', 'Fastest', 'Slowest', ''].map((h, i) => <th key={i} style={{ padding: '0 12px 10px', fontWeight: 600, borderBottom: `2px solid ${INK}` }}>{h}</th>)}</tr></thead>
            <tbody>{people.map((x: any, i: number) => (
              <tr key={x.user_id} style={{ background: i % 2 ? '#f8faff' : '#fff' }}>
                <td style={{ padding: '14px 12px', fontWeight: 600 }}>{who(i, x.name)}</td>
                <td style={{ padding: '14px 12px' }}>{x.sources}</td>
                <td style={{ padding: '14px 12px' }}>{nf(x.records)}</td>
                <td style={{ padding: '14px 12px', fontWeight: 700, color: BLUE }}>{x.extraction?.avg ?? '–'} days</td>
                <td style={{ padding: '14px 12px' }}>{x.extraction?.min ?? '–'}</td>
                <td style={{ padding: '14px 12px' }}>{x.extraction?.max ?? '–'}</td>
                <td style={{ padding: '14px 12px', width: 220 }}><div style={{ height: 12, background: LINE, borderRadius: 6 }}><div style={{ height: 12, borderRadius: 6, background: BLUE, width: `${((x.extraction?.avg ?? 0) / slowest) * 100}%` }} /></div></td>
              </tr>))}</tbody>
          </table>
          {tmAll.extraction && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', gap: 70 }}><Big size={46} v={`${tmAll.extraction.min} d`} l="fastest source" c={GREEN} /><Big size={46} v={`${tmAll.extraction.median} d`} l="median source" c={BLUE} /><Big size={46} v={`${tmAll.extraction.max} d`} l="slowest source" c={AMBER} /></div>}
        </Frame>
      )}

      {/* 6. what the work was */}
      <Frame n={next()} project={project} title="What the work was" lede="The kind of record each source is, and the SOP Xtrium attached to it. Bars show how much of each is delivered.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 44 }}>
          <div>
            <H3>Categories of work</H3>
            <Bars labelW={170} gap={18} h={20} rows={(e.by_category ?? []).slice(0, 8).map((c: any) => ({ label: c.category, v: c.delivered, of: c.total, right: `${c.delivered} of ${c.total}`, color: c.delivered === c.total ? GREEN : BLUE }))} />
          </div>
          <div>
            <H3>SOP standards in use</H3>
            <Bars labelW={250} gap={18} h={20} rows={(e.by_sop ?? []).slice(0, 8).map((s: any) => ({ label: String(s.code).replace(/^SOP-/, '').replace(/^KG-/, '').replace(/-DS003/, ''), v: s.delivered, of: s.total, right: `${s.delivered} of ${s.total}`, color: s.delivered === s.total ? GREEN : BLUE, note: s.new ? 'new' : undefined }))} />
          </div>
        </div>
      </Frame>

      {/* 7. obstacles and questions */}
      <Frame n={next()} project={project} title="What got in the way, and how it was settled" lede="We escalate rather than guess, and confirm with the client side before going further.">
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 36 }}>
          <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
            {(['link', 'nodata', 'question'] as const).map(k => <Panel key={k} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '20px 24px' }}><div style={{ fontFamily: SERIF, fontSize: 48, fontWeight: 700, color: chCount(k) ? BLUE : '#a9b6cc', width: 54 }}>{chCount(k)}</div><div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{CH[k]}</div></Panel>)}
            {e.observations?.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{e.observations.slice(0, 6).map((o: any) => <span key={o.kind} style={{ background: '#fff6e0', border: '1px solid #f3d99a', borderRadius: 20, padding: '6px 14px', fontSize: 14 }}>{o.label} <b>{o.count}</b></span>)}</div>}
          </div>
          <div>
            <H3>{e.qa.answered} of {e.qa.answered + e.qa.open} client questions answered{e.qa.open ? `, ${e.qa.open} still open` : ''}</H3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>{e.qa.topics.map((x: any) => <span key={x.topic} style={{ background: PALE, borderRadius: 20, padding: '5px 14px', fontSize: 14, fontWeight: 600 }}>{x.topic} <span style={{ color: BLUE }}>{x.answered} of {x.asked}</span></span>)}</div>
            {answered.slice(0, 3).map((x: any, i: number) => (
              <div key={i} style={{ borderLeft: `4px solid ${BLUE}`, background: PALE, borderRadius: '0 12px 12px 0', padding: '14px 20px', marginBottom: 14 }}>
                <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35 }}>{clip(x.question, 120)}</div>
                <div style={{ fontSize: 15.5, color: MUTE, lineHeight: 1.4, marginTop: 4 }}>{clip(x.answer, 170)}</div>
              </div>
            ))}
          </div>
        </div>
      </Frame>

      {/* each batch on its own */}
      {batches.flatMap((b: any) => batchSlides(b))}

      {/* what comes next */}
      <Frame n={next()} project={project} title="What comes next">
        <div>
          {e.next.slice(0, 4).map((x: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 24, padding: '20px 0', borderTop: i ? `1px solid ${LINE}` : 'none', alignItems: 'baseline' }}>
              <div style={{ fontFamily: SERIF, fontSize: 38, fontWeight: 700, color: BLUE, width: 44 }}>{i + 1}</div>
              <div><div style={{ fontSize: 26, fontWeight: 700 }}>{x.title}</div><div style={{ fontSize: 19, color: MUTE, marginTop: 6, lineHeight: 1.5 }}>{x.text}</div></div>
            </div>
          ))}
        </div>
      </Frame>

      {/* appendix */}
      {batches.map((b: any) => appendix(b))}

      {/* close */}
      <div className="deck-slide" style={{ width: SLIDE.w, height: SLIDE.h, position: 'relative', overflow: 'hidden', background: `linear-gradient(135deg, ${BLUE} 0%, ${DEEP} 100%)`, color: '#fff', fontFamily: SANS }}>
        <div style={{ position: 'absolute', left: 80, bottom: 150 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 60, lineHeight: 1.08, fontWeight: 700, letterSpacing: -1, color: '#fff' }}>Thank you</h2>
          <p style={{ margin: '18px 0 0', fontSize: 21, lineHeight: 1.55, opacity: .93, maxWidth: 680 }}>To the Xtrium team, for the collaboration across this program so far and for the work ahead.</p>
          <div style={{ marginTop: 38, fontSize: 16, opacity: .85 }}>{project} · {rangeA} to {rangeB}</div>
        </div>
      </div>
    </div>
  )
}

/** Scales the 1280×720 slides to the width available on screen; printing always uses full size. */
export function useFit(w: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [s, setS] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const f = () => setS(Math.min(1, (el.clientWidth || w) / w))
    f()
    const ro = new ResizeObserver(f); ro.observe(el)
    return () => ro.disconnect()
  }, [w])
  return { ref, s }
}
