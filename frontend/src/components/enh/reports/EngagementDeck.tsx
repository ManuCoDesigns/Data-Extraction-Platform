import { useEffect, useRef, useState } from 'react'

/** The full engagement report, as 16:9 slides. One slide per Xtrium batch is not needed: batches are the rows and bars inside.
 *  Every number is read from the platform when the report opens. Names appear only on the timing slides, and only when `names` is on. */
export const SLIDE = { w: 1280, h: 720 }
const INK = '#0b2447', BLUE = '#1473f0', DEEP = '#0d3b8f', PALE = '#eef4ff', LINE = '#dbe5f5', MUTE = '#5a6b86', AMBER = '#e39b0b', GREEN = '#12a06b', RED = '#d6453d'
const SERIF = "Georgia, Cambria, 'Times New Roman', serif"
const SANS = "'Inter','Segoe UI',system-ui,sans-serif"
const nf = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toLocaleString())
const p1 = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${Math.round(n * 10) / 10}%`)
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const dshort = (s: string) => { const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }

function Ring({ pct, size = 120, stroke = 14, color = BLUE, track = LINE, label, sub, textColor = INK }: { pct: number; size?: number; stroke?: number; color?: string; track?: string; label?: string; sub?: string; textColor?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y={sub ? '48%' : '54%'} textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize={size * 0.26} fill={textColor}>{label ?? `${Math.round(v)}%`}</text>
      {sub && <text x="50%" y="66%" textAnchor="middle" fontSize={size * (size > 300 ? 0.055 : 0.11)} fill={textColor} opacity=".8">{sub}</text>}
    </svg>
  )
}

function Frame({ n, title, lede, children, project }: { n: number; title: string; lede?: string; children: React.ReactNode; project: string }) {
  return (
    <div className="deck-slide" style={{ width: SLIDE.w, height: SLIDE.h, position: 'relative', overflow: 'hidden', background: '#fff', color: INK, fontFamily: SANS, boxSizing: 'border-box' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 10, background: `linear-gradient(${BLUE}, ${DEEP})` }} />
      <div style={{ position: 'absolute', left: 64, right: 64, top: 44 }}>
        <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 38, lineHeight: 1.15, fontWeight: 700, letterSpacing: -.5, color: INK, maxWidth: 1000 }}>{title}</h2>
        {lede && <p style={{ margin: '12px 0 0', fontSize: 20, color: MUTE, maxWidth: 940, lineHeight: 1.5 }}>{lede}</p>}
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: lede ? 180 : 130, bottom: 58 }}>{children}</div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 22, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8593ab' }}><span>Careerflow.ai · {project}</span><span>{n}</span></div>
    </div>
  )
}

const Panel = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => <div style={{ background: PALE, borderRadius: 16, padding: 28, ...style }}>{children}</div>
const Big = ({ v, l, c = BLUE }: { v: string; l: string; c?: string }) => <div><div style={{ fontFamily: SERIF, fontSize: 62, fontWeight: 700, color: c, lineHeight: 1, letterSpacing: -1 }}>{v}</div><div style={{ fontSize: 17, color: MUTE, marginTop: 8, lineHeight: 1.35 }}>{l}</div></div>

export function EngagementDeck({ e, names = false }: { e: any; names?: boolean }) {
  const T = e.totals, phases: any[] = e.phases
  const project = e.scope && e.scope.kind !== 'all' ? String(e.scope.label).replace(/\s*\(.*\)/, '') : (e.projects[0] || 'Data extraction')
  const projLine = e.projects.length > 1 ? `${e.projects.length} projects` : (e.projects[0] || 'Data extraction')
  const month = e.scope && e.scope.kind === 'month' ? String(e.scope.label).split(' ')[0] : ''
  const bname = (b: any) => (b.ordinal ? (month ? `${month} batch ${b.ordinal}` : String(b.label).replace(/\s*\(.*\)/, '')) : 'Other sources')
  const rangeA = e.period_from ? dt(e.period_from) : '', rangeB = dt(e.generated_at)
  const pct = T.sources ? Math.round((100 * T.delivered) / T.sources) : 0
  const stageColor: Record<string, string> = { delivered: DEEP, signoff: BLUE, peer_review: '#6ea8fb', needs_fixes: AMBER, extracting: '#b9cdf3', not_started: '#d4dbe8', blocked: RED, ready_to_send: '#4f86e8' }
  const stages: any[] = e.stages.filter((s: any) => s.count > 0)
  let n = 0
  const next = () => ++n
  const hasQuality = T.final_accuracy !== null && T.final_accuracy !== undefined
  const answered = (e.qa?.items ?? []).filter((x: any) => x.status === 'answered').map((x: any) => ({ ...x, answer: String(x.answer ?? '').replace(/^FROM CLIENT:\s*/i, '') })).sort((a: any, b: any) => (a.answer.length > 300 ? 1 : 0) - (b.answer.length > 300 ? 1 : 0))
  const CH: Record<string, { title: string; text: string }> = {
    link: { title: 'Pages we could not reach', text: 'Dead links, sites that block automated access and pages behind a sign-in are flagged and escalated, never bypassed.' },
    nodata: { title: 'Nothing to extract', text: 'Sources with no extractable data are escalated with a written reason rather than forced into a schema that does not fit.' },
    question: { title: 'Points only the client can settle', text: 'Entity names, classification and corrected links are logged as questions and tracked until answered.' },
  }
  const ch = ['link', 'nodata', 'question'].map(k => ({ k, c: e.challenges.find((x: any) => x.kind === k) }))
  const tm = e.timing && !e.timing.empty ? e.timing : null
  const who = (i: number, name?: string | null) => (names && name ? name : `Extractor ${i + 1}`)
  const hrs = (h: number | null | undefined) => (h === null || h === undefined ? '–' : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`)
  const dd = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v}`)
  const people = (tm?.people ?? []).filter((x: any) => x.sources > 0).slice(0, 10)
  const slowest = Math.max(1, ...people.map((x: any) => x.extraction?.max ?? 0))
  const extIdx: Record<string, number> = Object.fromEntries((tm?.people ?? []).filter((x: any) => x.sources > 0).map((x: any, i: number) => [x.name, i]))

  /** One batch on its own: summary, timeline, every source, how review went, and what needs a decision. */
  const batchSlides = (b: any) => {
    const tt = b.times && !b.times.empty ? b.times : null
    const qq = b.quality
    const sts = b.stages.filter((s: any) => s.count > 0)
    const per: Record<string, any> = Object.fromEntries((tt?.per_source ?? []).map((x: any) => [x.source_id, x]))
    const nm = bname(b)
    const together = tt?.approved_together ?? 0
    const out: React.ReactNode[] = []
    out.push(
      <Frame key={`${b.key}-a`} n={next()} project={project} title={`${nm}: ${b.totals.delivered} of ${b.totals.sources} delivered`} lede={[b.key === 'other' ? '' : `Pulled from Xtrium on ${dt(b.date)}.`, ...b.highlights.slice(1, 3)].filter(Boolean).join(' ') || undefined}>
        <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 44, alignItems: 'center' }}>
          <Panel style={{ display: 'flex', justifyContent: 'center', padding: 26 }}><Ring pct={b.totals.percent} size={270} stroke={30} /></Panel>
          <div>
            <div style={{ display: 'flex', gap: 5, height: 46, borderRadius: 10, overflow: 'hidden' }}>
              {sts.map((s: any) => <div key={s.key} title={`${s.label}: ${s.count}`} style={{ flex: s.count, background: stageColor[s.key], color: ['extracting', 'not_started', 'peer_review'].includes(s.key) ? INK : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>{s.count}</div>)}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', fontSize: 14, color: MUTE }}>{sts.map((s: any) => <span key={s.key}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: stageColor[s.key], marginRight: 6 }} />{s.label}</span>)}</div>
            <div style={{ marginTop: 22 }}>
              {b.by_type.slice(0, 4).map((x: any) => (
                <div key={x.type} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17 }}><b>{x.type}</b><span style={{ color: MUTE }}>{x.delivered} of {x.total}</span></div>
                  <div style={{ height: 12, background: LINE, borderRadius: 6, marginTop: 5, overflow: 'hidden' }}><div style={{ width: `${(100 * x.delivered) / x.total}%`, height: 12, background: x.delivered === x.total ? GREEN : BLUE }} /></div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 40, marginTop: 18 }}>
              <Big v={nf(b.totals.records_approved)} l="records approved" /><Big v={nf(b.totals.submitted_to_xtrium)} l={b.totals.resubmitted ? `sent to Xtrium, ${b.totals.resubmitted} twice` : 'sent to Xtrium'} c={GREEN} />
              {b.totals.in_progress > 0 && <Big v={nf(b.totals.in_progress)} l="still moving" c={AMBER} />}
              <Big v={nf(b.totals.blocked)} l="needs a decision" c={b.totals.blocked ? RED : GREEN} />
            </div>
          </div>
        </div>
      </Frame>
    )
    if (tt && tt.milestones.length > 1) out.push(
      <Frame key={`${b.key}-b`} n={next()} project={project} title={`${nm}: ${tt.span_days ? `from first pull to final approval in ${tt.span_days} days` : 'how the work moved through the steps'}`} lede={`${tt.caveat}${together ? ` ${together} sources were approved together in one sitting, so their review times are left out.` : ''}`}>
        <div style={{ position: 'relative', paddingTop: 30 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 41, height: 4, background: LINE, borderRadius: 2 }} />
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tt.milestones.length},1fr)`, gap: 14 }}>
            {tt.milestones.map((m: any, i: number) => (
              <div key={m.key} style={{ position: 'relative' }}>
                <div style={{ width: 24, height: 24, borderRadius: 12, background: i === tt.milestones.length - 1 ? GREEN : BLUE, border: '4px solid #fff', boxShadow: `0 0 0 2px ${LINE}`, marginBottom: 20 }} />
                <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700 }}>{dshort(m.at)}{m.at_end ? ` to ${dshort(m.at_end)}` : ''}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: BLUE, margin: '6px 0' }}>{m.label}</div>
                <div style={{ fontSize: 15, color: MUTE, lineHeight: 1.5 }}>{m.detail}</div>
              </div>
            ))}
          </div>
        </div>
        {qq && qq.fields > 0 && <Panel style={{ marginTop: 46, padding: 22, display: 'flex', gap: 80, alignItems: 'center' }}>
          <Big v={nf(qq.fields)} l="fields checked against the real sources" /><Big v={p1(qq.first_pass_accuracy)} l="right the first time" c={AMBER} /><Big v={p1(qq.final_accuracy)} l="accurate when delivered" c={GREEN} />
        </Panel>}
      </Frame>
    )
    out.push(
      <Frame key={`${b.key}-c`} n={next()} project={project} title={`${nm}: where each source stands`} lede={b.sources.length > 12 ? `Showing 12 of ${b.sources.length} sources.` : undefined}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15.5 }}>
          <thead><tr style={{ textAlign: 'left', color: MUTE, fontSize: 13.5 }}>{['Source', 'Category', 'Stage', 'Extraction', 'Records approved', 'Peer reviews', 'Accuracy'].map(h => <th key={h} style={{ padding: '0 8px 10px', fontWeight: 600, borderBottom: `2px solid ${INK}` }}>{h}</th>)}</tr></thead>
          <tbody>{b.sources.slice(0, 12).map((s: any, i: number) => (
            <tr key={s.source_id} style={{ background: i % 2 ? '#f8faff' : '#fff' }}>
              <td style={{ padding: '8px', fontWeight: 600, maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</td>
              <td style={{ padding: '8px' }}>{s.category}</td>
              <td style={{ padding: '8px', whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: stageColor[s.stage], marginRight: 7 }} />{b.stages.find((x: any) => x.key === s.stage)?.label}{s.submissions > 1 ? ` (sent ${s.submissions}×)` : ''}</td>
              <td style={{ padding: '8px' }}>{per[s.source_id]?.extraction_days != null ? `${per[s.source_id].extraction_days} d` : '–'}</td>
              <td style={{ padding: '8px' }}>{s.approved} of {s.records}</td>
              <td style={{ padding: '8px' }}>{s.peers_done} of {s.peers_total} submitted{s.peers_flagged > 0 && s.peers_done < s.peers_total ? `, ${s.peers_flagged} raised findings` : ''}</td>
              <td style={{ padding: '8px' }}>{p1(s.final_accuracy)}</td>
            </tr>))}</tbody>
        </table>
      </Frame>
    )
    if (tt) {
      const v = tt.validation, c = tt.corrections
      out.push(
        <Frame key={`${b.key}-d`} n={next()} project={project} title={`${nm}: how review went`} lede="Peer review, admin sign-off and corrections for this batch alone. Times are measured between recorded steps on the platform.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
            <Panel style={{ minHeight: 250 }}><div style={{ fontSize: 19, fontWeight: 700 }}>Peer review</div><div style={{ marginTop: 16 }}><Big v={String(v.peer.submitted)} l={`reviews submitted${v.peer.turnaround_days ? `, ${v.peer.turnaround_days.avg} days on average after submission to review` : ''}`} c={DEEP} /></div></Panel>
            <Panel style={{ minHeight: 250 }}><div style={{ fontSize: 19, fontWeight: 700 }}>Admin sign-off</div><div style={{ marginTop: 16 }}>{v.admin.hours && v.admin.hours.n >= 3 ? <Big v={hrs(v.admin.hours.avg)} l={`average from sending to a decision, over ${v.admin.hours.n} decisions`} c={GREEN} /> : <Big v={String(v.admin.hours?.n ?? 0)} l="decisions recorded. Too few to average." c={GREEN} />}</div></Panel>
            <Panel style={{ minHeight: 250 }}><div style={{ fontSize: 19, fontWeight: 700 }}>Returned for correction</div><div style={{ marginTop: 16 }}><Big v={String(c.records_returned)} l={`${c.records_returned === 1 ? 'record' : 'records'} across ${c.sources_returned} ${c.sources_returned === 1 ? 'source' : 'sources'}, with ${c.notes} reviewer notes${c.resets ? `, and ${c.resets} reset to start again` : ''}`} c={c.records_returned ? AMBER : GREEN} /></div></Panel>
          </div>
          {c.top_fields.length > 0 && <div style={{ marginTop: 26 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>Fields reviewers commented on most</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{c.top_fields.slice(0, 6).map((f: any) => <span key={f.field} style={{ background: '#fff6e0', border: '1px solid #f3d99a', borderRadius: 20, padding: '7px 16px', fontSize: 15 }}>{f.field.replace(/_/g, ' ')} <b>{f.count}</b></span>)}</div>
          </div>}
        </Frame>
      )
    }
    if (b.blocked.length > 0) out.push(
      <Frame key={`${b.key}-e`} n={next()} project={project} title={`${nm}: ${b.totals.blocked} ${b.totals.blocked === 1 ? 'source needs' : 'sources need'} a decision`} lede="These cannot move as things stand. Each group says what we need.">
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, b.blocked.length)},1fr)`, gap: 18 }}>
          {b.blocked.slice(0, 3).map((g: any) => (
            <div key={g.title} style={{ background: '#fff6e0', border: '1px solid #f3d99a', borderRadius: 16, padding: '24px 26px', maxHeight: 440, overflow: 'hidden' }}>
              <div style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 700, color: AMBER, lineHeight: 1 }}>{g.items.length}</div>
              <div style={{ fontSize: 21, fontWeight: 700, margin: '8px 0 6px' }}>{g.title}</div>
              <div style={{ fontSize: 15, color: MUTE, marginBottom: 14 }}><b style={{ color: AMBER }}>We need:</b> {g.need}</div>
              {g.items.slice(0, 8).map((i: any, j: number) => <div key={j} style={{ fontSize: 15.5, lineHeight: 1.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b style={{ color: AMBER }}>{i.item_no ? `#${i.item_no}` : '•'}</b> {i.name}</div>)}
            </div>
          ))}
        </div>
      </Frame>
    )
    return out
  }

  return (
    <div className="deck-wrap">
      {/* 1. cover */}
      <div className="deck-slide" style={{ width: SLIDE.w, height: SLIDE.h, position: 'relative', overflow: 'hidden', background: `linear-gradient(135deg, ${BLUE} 0%, ${DEEP} 100%)`, color: '#fff', fontFamily: SANS }}>
        <div style={{ position: 'absolute', right: 90, top: 110 }}><Ring pct={pct} size={430} stroke={34} color="#fff" track="rgba(255,255,255,.2)" label={`${pct}%`} sub="of sources delivered" textColor="#fff" /></div>
        <div style={{ position: 'absolute', left: 80, top: 64 }}><span style={{ background: '#fff', color: '#1f2937', borderRadius: 12, padding: '9px 20px', fontWeight: 800, fontSize: 20 }}>Careerflow.ai</span></div>
        <div style={{ position: 'absolute', left: 80, top: 250, width: 640 }}>
          <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 66, lineHeight: 1.04, fontWeight: 700, letterSpacing: -1.5, color: '#fff' }}>{e.scope && e.scope.kind !== 'all' ? e.scope.label.replace(/\s*\(.*\)/, '') : 'Engagement report'}</h1>
          <p style={{ margin: '22px 0 0', fontSize: 23, lineHeight: 1.5, opacity: .93 }}>{nf(T.sources)} sources across {T.batches} {T.batches === 1 ? 'batch' : 'batches'}, extracted, peer-reviewed and approved on one auditable platform.</p>
        </div>
        <div style={{ position: 'absolute', left: 80, bottom: 70, fontSize: 16, lineHeight: 1.7, opacity: .92 }}>{projLine}<br />{rangeA} to {rangeB}</div>
      </div>

      {/* 2. summary */}
      <Frame n={next()} project={project} title={`${nf(T.delivered)} of ${nf(T.sources)} sources are delivered, with ${nf(T.records_approved)} approved records`} lede={`${T.batches_covered} of ${T.batches} ${T.batches === 1 ? 'batch is' : 'batches are'} fully delivered${T.blocked ? `, and ${T.blocked} ${T.blocked === 1 ? 'source needs' : 'sources need'} a decision` : ''}. Each batch is reported on its own further on.`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
          <Panel><Big v={nf(T.sources)} l="sources pulled from Xtrium" /></Panel>
          <Panel><Big v={nf(T.records_approved)} l="records approved" /></Panel>
          <Panel><Big v={nf(T.submitted)} l={`sources submitted back to Xtrium${T.resubmitted ? `, ${T.resubmitted} of them a second time` : ''}`} c={GREEN} /></Panel>
          <Panel><Big v={nf(T.sops)} l={T.sops === 1 ? 'SOP standard in use' : 'SOP standards in use'} c={DEEP} /></Panel>
        </div>
        <div style={{ marginTop: 40, display: 'flex', gap: 5, height: 72, borderRadius: 12, overflow: 'hidden' }}>
          {stages.map(s => <div key={s.key} title={`${s.label}: ${s.count}`} style={{ flex: s.count, background: stageColor[s.key], color: ['extracting', 'not_started', 'peer_review'].includes(s.key) ? INK : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 22 }}>{s.count}</div>)}
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap', fontSize: 16, color: MUTE }}>
          {stages.map(s => <span key={s.key}><span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 3, background: stageColor[s.key], marginRight: 7 }} />{s.label}</span>)}
        </div>
        {hasQuality && <p style={{ marginTop: 40, fontSize: 24, lineHeight: 1.6, maxWidth: 1000 }}>Delivered data is <b style={{ color: BLUE }}>{p1(T.final_accuracy)}</b> accurate across <b>{nf(T.fields)}</b> fields checked against the real sources{T.peer_total ? `, with ${T.peer_done} of ${T.peer_total} independent peer reviews submitted` : ''}.</p>}
      </Frame>

      {/* 3. pipeline */}
      <Frame n={next()} project={project} title="Every source takes the same four steps" lede="Work is pulled from Xtrium Catalog IQ, extracted, independently peer-reviewed, signed off by an admin, and then reported back. Each step is recorded.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0, alignItems: 'stretch' }}>
          {[
            ['Pulled and extracted', `${nf(T.sources)} sources`, 'Each Xtrium item becomes a source with its SOP attached, then an extractor works it.'],
            ['Peer review', T.peer_total ? `${T.peer_done} of ${T.peer_total} reviews` : 'Independent', 'Peer reviewers check the extraction separately. Each must comment before sign-off.'],
            ['Admin sign-off', `${nf(T.approved ?? T.delivered)} approved`, 'An admin checks the reviews and approves the records. Approved records are locked.'],
            ['Reported to Xtrium', `${nf(T.submitted)} submitted`, T.resubmitted ? `${T.resubmitted} were sent a second time with corrected values after the final check. The status is checked afterwards.` : 'Approved sources are sent back and the status is checked afterwards.'],
          ].map(([h, v, s], i) => (
            <div key={h} style={{ position: 'relative', padding: '0 14px 0 0' }}>
              <div style={{ background: i === 3 ? DEEP : i === 2 ? BLUE : i === 1 ? '#6ea8fb' : '#b9cdf3', color: i < 2 ? INK : '#fff', height: 76, display: 'flex', alignItems: 'center', padding: '0 22px', clipPath: 'polygon(0 0, calc(100% - 26px) 0, 100% 50%, calc(100% - 26px) 100%, 0 100%, 26px 50%)', marginLeft: i ? -14 : 0, paddingLeft: i ? 40 : 22 }}>
                <span style={{ fontFamily: SERIF, fontSize: 27, fontWeight: 700 }}>{h}</span>
              </div>
              <div style={{ padding: '20px 18px 0 6px' }}><div style={{ fontFamily: SERIF, fontSize: 31, fontWeight: 700, color: i === 3 ? DEEP : BLUE }}>{v}</div><div style={{ fontSize: 16, color: MUTE, lineHeight: 1.5, marginTop: 8 }}>{s}</div></div>
            </div>
          ))}
        </div>
        <Panel style={{ marginTop: 14, padding: 20, display: 'flex', gap: 80, alignItems: 'center' }}>
          <Big v={nf(T.fields)} l="fields checked against the real sources" />
          <Big v={p1(T.first_pass_accuracy)} l="right the first time" c={AMBER} />
          <Big v={p1(T.final_accuracy)} l="accurate when delivered" c={GREEN} />
        </Panel>
      </Frame>

      {/* 4. batch by batch */}
      <Frame n={next()} project={project} title={`${(e.batches ?? []).length} ${(e.batches ?? []).length === 1 ? 'batch' : 'batches'}, side by side`} lede="Each batch is the set of sources Xtrium gave us on one day. Every figure below is that batch alone, and each batch has its own pages after the overview.">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 17 }}>
          <thead><tr style={{ textAlign: 'left', color: MUTE, fontSize: 14 }}>{['Batch', 'Pulled', 'Sources', 'Delivered', 'Records', 'Right first time', 'Accurate when delivered', 'Days to deliver', 'Needs decision'].map(h => <th key={h} style={{ padding: '0 10px 12px', fontWeight: 600, borderBottom: `2px solid ${INK}` }}>{h}</th>)}</tr></thead>
          <tbody>{(e.batches ?? []).map((b: any, i: number) => (
            <tr key={b.key} style={{ background: i % 2 ? '#f8faff' : '#fff' }}>
              <td style={{ padding: '14px 10px', fontWeight: 700 }}>{bname(b)}</td>
              <td style={{ padding: '14px 10px' }}>{b.key === 'other' ? '–' : dshort(b.date)}</td>
              <td style={{ padding: '14px 10px' }}>{b.totals.sources}</td>
              <td style={{ padding: '14px 10px', fontWeight: 700, color: b.totals.delivered === b.totals.sources ? GREEN : AMBER }}>{b.totals.delivered} of {b.totals.sources}</td>
              <td style={{ padding: '14px 10px' }}>{nf(b.totals.records_approved)}</td>
              <td style={{ padding: '14px 10px' }}>{p1(b.quality?.first_pass_accuracy)}</td>
              <td style={{ padding: '14px 10px' }}>{p1(b.quality?.final_accuracy)}</td>
              <td style={{ padding: '14px 10px' }}>{b.timing?.avg_days_delivered ?? '–'}</td>
              <td style={{ padding: '14px 10px', color: b.totals.blocked ? RED : MUTE, fontWeight: b.totals.blocked ? 700 : 400 }}>{b.totals.blocked || '–'}</td>
            </tr>))}
            {(e.batches ?? []).length > 1 && (
              <tr style={{ borderTop: `2px solid ${INK}` }}>
                <td style={{ padding: '14px 10px', fontWeight: 800 }}>Together</td><td />
                <td style={{ padding: '14px 10px', fontWeight: 800 }}>{T.sources}</td>
                <td style={{ padding: '14px 10px', fontWeight: 800 }}>{T.delivered} of {T.sources}</td>
                <td style={{ padding: '14px 10px', fontWeight: 800 }}>{nf(T.records_approved)}</td>
                <td style={{ padding: '14px 10px', fontWeight: 800 }}>{p1(T.first_pass_accuracy)}</td>
                <td style={{ padding: '14px 10px', fontWeight: 800 }}>{p1(T.final_accuracy)}</td>
                <td /><td style={{ padding: '14px 10px', fontWeight: 800 }}>{T.blocked || '–'}</td>
              </tr>)}
          </tbody>
        </table>
      </Frame>

      {/* timing: timeline, per extractor, per source, validation, corrections */}
      {tm && tm.milestones.length > 1 && (
        <Frame n={next()} project={project} title={tm.span_days ? `From first pull to final approval in ${tm.span_days} days` : 'How the work moved through the steps'} lede={tm.caveat}>
          <div style={{ position: 'relative', paddingTop: 30 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 41, height: 4, background: LINE, borderRadius: 2 }} />
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tm.milestones.length},1fr)`, gap: 14 }}>
              {tm.milestones.map((m: any, i: number) => (
                <div key={m.key} style={{ position: 'relative' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 12, background: i === tm.milestones.length - 1 ? GREEN : BLUE, border: '4px solid #fff', boxShadow: `0 0 0 2px ${LINE}`, marginBottom: 20 }} />
                  <div style={{ fontFamily: SERIF, fontSize: 25, fontWeight: 700 }}>{dshort(m.at)}{m.at_end ? ` to ${dshort(m.at_end)}` : ''}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, color: BLUE, margin: '6px 0' }}>{m.label}</div>
                  <div style={{ fontSize: 15.5, color: MUTE, lineHeight: 1.5 }}>{m.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </Frame>
      )}
      {tm && people.length > 0 && (
        <Frame n={next()} project={project} title={tm.extraction ? `Extraction took ${tm.extraction.avg} days on average per source` : 'Time per extractor'} lede={`Days from starting a source to sending it for review, as elapsed time. ${names ? '' : 'Names are left out of this version.'}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 18 }}>
            <thead><tr style={{ textAlign: 'left', color: MUTE, fontSize: 15 }}>{['Extractor', 'Sources', 'Records', 'Average', 'Fastest', 'Slowest', ''].map((h, i) => <th key={i} style={{ padding: '0 12px 12px', fontWeight: 600, borderBottom: `2px solid ${INK}` }}>{h}</th>)}</tr></thead>
            <tbody>{people.map((x: any, i: number) => (
              <tr key={x.user_id} style={{ background: i % 2 ? '#f8faff' : '#fff' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{who(i, x.name)}</td>
                <td style={{ padding: '10px 12px' }}>{x.sources}</td>
                <td style={{ padding: '10px 12px' }}>{nf(x.records)}</td>
                <td style={{ padding: '10px 12px', fontWeight: 700, color: BLUE }}>{dd(x.extraction?.avg)} days</td>
                <td style={{ padding: '10px 12px' }}>{dd(x.extraction?.min)}</td>
                <td style={{ padding: '10px 12px' }}>{dd(x.extraction?.max)}</td>
                <td style={{ padding: '10px 12px', width: 220 }}><div style={{ height: 12, background: LINE, borderRadius: 6 }}><div style={{ height: 12, borderRadius: 6, background: BLUE, width: `${((x.extraction?.avg ?? 0) / slowest) * 100}%` }} /></div></td>
              </tr>))}</tbody>
          </table>
        </Frame>
      )}

      {/* 5. quality */}
      {hasQuality && (
        <Frame n={next()} project={project} title={`Review lifts accuracy from ${p1(T.first_pass_accuracy)} to ${p1(T.final_accuracy)}`} lede="First pass is what extractors got right before any review. Final is what was delivered after peer review and admin sign-off.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 24, alignItems: 'center' }}>
            <Panel style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 28 }}><Ring pct={T.first_pass_accuracy || 0} size={230} stroke={24} color={AMBER} /><div style={{ fontSize: 17, fontWeight: 700, marginTop: 14 }}>Right first time</div><div style={{ fontSize: 14, color: MUTE }}>before review</div></Panel>
            <Panel style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 28 }}><Ring pct={T.final_accuracy || 0} size={230} stroke={24} color={GREEN} /><div style={{ fontSize: 17, fontWeight: 700, marginTop: 14 }}>Accurate when delivered</div><div style={{ fontSize: 14, color: MUTE }}>after review and sign-off</div></Panel>
            <div style={{ display: 'grid', gap: 30 }}>
              <Big v={nf(T.fields)} l="fields checked against the real sources" c={DEEP} />
              <Big v={T.first_pass_accuracy === null || T.first_pass_accuracy === undefined ? '–' : String(Math.round((100 - T.first_pass_accuracy) * 10) / 10)} l="errors found per 100 fields" c={AMBER} />
              {T.caught_rate !== null && T.caught_rate !== undefined && <Big v={p1(T.caught_rate)} l="of known errors caught by peer reviewers" />}
            </div>
          </div>
        </Frame>
      )}

      {/* 6. SOP coverage */}
      <Frame n={next()} project={project} title={`${T.sops} SOP ${T.sops === 1 ? 'standard' : 'standards'} in use`} lede="Each source follows the SOP Xtrium assigned to its item. The ring shows how much of that SOP's work is delivered.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 18 }}>
          {e.by_sop.slice(0, 12).map((s: any) => (
            <div key={s.code} style={{ background: s.new ? '#fff6e0' : PALE, borderRadius: 14, padding: '26px 8px 20px', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Ring pct={(100 * s.delivered) / s.total} size={120} stroke={12} color={s.new ? AMBER : BLUE} track="#fff" label={`${s.delivered}/${s.total}`} /></div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>{s.code.replace('SOP-', '')}</div>
              {s.new && <div style={{ fontSize: 13, color: AMBER, fontWeight: 700 }}>New this batch</div>}
            </div>
          ))}
        </div>
      </Frame>

      {/* 6b. categories */}
      {(e.by_category ?? []).length > 0 && (
        <Frame n={next()} project={project} title={`${e.by_category.length} ${e.by_category.length === 1 ? 'category' : 'categories'} of work`} lede="What kind of record each source is, taken from the SOP Xtrium attached. The ring shows how much of each category is delivered.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 18 }}>
            {e.by_category.slice(0, 10).map((c: any) => (
              <div key={c.category} style={{ background: PALE, borderRadius: 14, padding: '26px 8px 20px', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}><Ring pct={(100 * c.delivered) / c.total} size={120} stroke={12} color={BLUE} track="#fff" label={`${c.delivered}/${c.total}`} /></div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 12 }}>{c.category}</div>
                <div style={{ fontSize: 14, color: MUTE }}>{c.records} {c.records === 1 ? 'record' : 'records'} approved</div>
              </div>
            ))}
          </div>
        </Frame>
      )}

      {/* 7. challenges */}
      <Frame n={next()} project={project} title="What got in the way, and what we did about it" lede="The response is the same each time: escalate rather than guess, and confirm with the client side before going further.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
          {ch.map(({ k, c }) => (
            <Panel key={k} style={{ minHeight: 300 }}>
              <div style={{ fontFamily: SERIF, fontSize: 56, fontWeight: 700, color: c ? BLUE : '#a9b6cc', lineHeight: 1 }}>{c ? c.count : 0}</div>
              <div style={{ fontSize: 22, fontWeight: 700, margin: '14px 0 10px' }}>{CH[k].title}</div>
              <div style={{ fontSize: 17, color: MUTE, lineHeight: 1.6 }}>{CH[k].text}</div>
            </Panel>
          ))}
        </div>
        {e.observations?.length > 0 && (
          <div style={{ marginTop: 34 }}>
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>Recorded by extractors and reviewers while working</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{e.observations.slice(0, 8).map((o: any) => <span key={o.kind} style={{ background: '#fff6e0', border: `1px solid #f3d99a`, borderRadius: 20, padding: '8px 18px', fontSize: 16 }}>{o.label} <b>{o.count}</b></span>)}</div>
          </div>
        )}
      </Frame>

      {/* 8. questions */}
      {answered.length > 0 && (
        <Frame n={next()} project={project} title={`${e.qa.answered} questions settled with Xtrium${e.qa.open ? `, ${e.qa.open} still open` : ''}`} lede="Unclear points are logged as questions, sent together, and the answers stay with the work.">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
            {e.qa.topics.map((x: any) => <span key={x.topic} style={{ background: PALE, borderRadius: 20, padding: '8px 18px', fontSize: 16, fontWeight: 600 }}>{x.topic} <span style={{ color: BLUE }}>{x.answered} of {x.asked}</span></span>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            {answered.slice(0, 6).map((x: any, i: number) => (
              <div key={i} style={{ borderLeft: `4px solid ${BLUE}`, background: PALE, borderRadius: '0 12px 12px 0', padding: '12px 22px', height: 128, overflow: 'hidden' }}>
                <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.question}</div>
                <div style={{ fontSize: 15, color: MUTE, lineHeight: 1.45, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.answer}</div>
              </div>
            ))}
          </div>
        </Frame>
      )}

      {/* 9. platform */}
      <Frame n={next()} project={project} title="One system of record replaces spreadsheet tracking" lede="What the platform did over this engagement, in its own numbers.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 22 }}>
          {[
            [nf(T.sources), 'sources received automatically from Xtrium Catalog IQ'],
            [T.peer_total ? `${T.peer_done} of ${T.peer_total}` : '–', 'independent peer reviews submitted'],
            [nf(T.fields), 'fields checked against the real sources'],
            [nf(T.submitted), 'sources reported back to Xtrium'],
            [T.questions_asked ? `${T.questions_answered} of ${T.questions_asked}` : '–', 'client questions answered'],
            [nf(e.observations?.reduce((s: number, o: any) => s + o.count, 0) || 0), 'issues recorded while working sources'],
          ].map(([v, l], i) => <Panel key={i} style={{ height: 210, display: 'flex', alignItems: 'center' }}><Big v={v as string} l={l as string} c={i % 2 ? DEEP : BLUE} /></Panel>)}
        </div>
      </Frame>

      {/* 12. open issues (left out when nothing is waiting) */}
      {e.blocked.length > 0 && <Frame n={next()} project={project} title={`${T.blocked} ${T.blocked === 1 ? 'source needs' : 'sources need'} a decision`} lede="These cannot move as things stand. Each group says what we need.">
        {e.blocked.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, e.blocked.length)},1fr)`, gap: 18 }}>
            {e.blocked.slice(0, 3).map((g: any) => (
              <div key={g.title} style={{ background: '#fff6e0', border: '1px solid #f3d99a', borderRadius: 16, padding: '24px 26px', maxHeight: 440, overflow: 'hidden' }}>
                <div style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 700, color: AMBER, lineHeight: 1 }}>{g.items.length}</div>
                <div style={{ fontSize: 21, fontWeight: 700, margin: '8px 0 6px' }}>{g.title}</div>
                <div style={{ fontSize: 15, color: MUTE, marginBottom: 14 }}><b style={{ color: AMBER }}>We need:</b> {g.need}</div>
                {g.items.slice(0, 8).map((i: any, j: number) => <div key={j} style={{ fontSize: 15.5, lineHeight: 1.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b style={{ color: AMBER }}>{i.item_no ? `#${i.item_no}` : '•'}</b> {i.name}</div>)}
                {g.items.length > 8 && <div style={{ fontSize: 13, color: MUTE }}>and {g.items.length - 8} more</div>}
              </div>
            ))}
          </div>
        )}
      </Frame>}

      {(e.batches ?? []).flatMap((b: any) => batchSlides(b))}

      {/* 13. next */}
      <Frame n={next()} project={project} title="What comes next">
        <div>
          {e.next.map((x: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 24, padding: e.next.length > 3 ? '16px 0' : '30px 0', borderTop: i ? `1px solid ${LINE}` : 'none', alignItems: 'baseline' }}>
              <div style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 700, color: BLUE, width: 44 }}>{i + 1}</div>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{x.title}</div><div style={{ fontSize: 20, color: MUTE, marginTop: 8, lineHeight: 1.5 }}>{x.text}</div></div>
            </div>
          ))}
        </div>
      </Frame>

      {/* 14. close */}
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
