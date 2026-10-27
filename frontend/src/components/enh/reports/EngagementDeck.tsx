import { useEffect, useRef, useState } from 'react'

/** The full engagement summary as 16:9 slides, one phase per Xtrium batch. Numbers come from the platform when the report opens. */
export const SLIDE = { w: 1280, h: 720 }
const BLUE = '#4285f4', DARK = '#1a1f36', SOFT = '#f4f7ff', AMBER = '#c9930f', GREEN = '#1e9e5a', GREY = '#5b6475'
const SERIF = "Cambria, 'Source Serif 4', Georgia, 'Times New Roman', serif"
const SANS = "'Inter','Segoe UI',system-ui,sans-serif"
const nf = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toLocaleString())
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const dshort = (s: string) => { const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }

function Slide({ n, kicker, title, children, dark }: { n?: number; kicker?: string; title?: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="deck-slide" style={{ width: SLIDE.w, height: SLIDE.h, position: 'relative', overflow: 'hidden', background: dark ? BLUE : '#fff', color: dark ? '#fff' : DARK, fontFamily: SANS, boxSizing: 'border-box' }}>
      {!dark && (
        <div style={{ position: 'absolute', left: 56, top: 50, right: 56 }}>
          {kicker && <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.4, color: BLUE, textTransform: 'uppercase' }}>{kicker}</div>}
          {title && <h2 style={{ margin: '10px 0 0', fontFamily: SERIF, fontSize: 38, fontWeight: 800, color: DARK, lineHeight: 1.15 }}>{title}</h2>}
        </div>
      )}
      <div style={{ position: 'absolute', left: 56, right: 56, top: dark ? 0 : 150, bottom: dark ? 0 : 56 }}>{children}</div>
      {!dark && <div style={{ position: 'absolute', left: 56, right: 56, bottom: 20, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}><span>Xtrium Critical Materials Extraction · Confidential · Full Engagement Report</span><span>{n}</span></div>}
    </div>
  )
}

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => <div style={{ background: SOFT, borderRadius: 14, padding: 22, ...style }}>{children}</div>

function Bars({ phases }: { phases: any[] }) {
  const max = Math.max(1, ...phases.map(p => p.sources))
  const W = 1168, H = 400, bw = Math.min(110, (W / phases.length) * 0.62), gap = W / phases.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 40}`} width="100%" height="100%">
      <line x1="0" y1={H} x2={W} y2={H} stroke="#cbd2dc" />
      {phases.map((p, i) => {
        const h = (p.sources / max) * (H - 50), x = i * gap + (gap - bw) / 2
        return <g key={p.key}>
          <rect x={x} y={H - h} width={bw} height={h} fill={BLUE} rx="2" />
          {p.delivered < p.sources && <rect x={x} y={H - h} width={bw} height={h * (1 - p.delivered / p.sources)} fill={AMBER} rx="2" />}
          <text x={x + bw / 2} y={H - h - 10} textAnchor="middle" fontSize="20" fontWeight="700" fill={DARK}>{p.sources}</text>
          <text x={x + bw / 2} y={H + 26} textAnchor="middle" fontSize="16" fill={GREY}>{p.key === 'other' ? 'Other' : dshort(p.date)}{p.status !== 'covered' ? '*' : ''}</text>
        </g>
      })}
    </svg>
  )
}

export function EngagementDeck({ e }: { e: any }) {
  const T = e.totals
  const phases: any[] = e.phases
  const L = e.latest
  const rangeA = e.period_from ? dt(e.period_from) : ''
  const rangeB = dt(e.generated_at)
  const projects = e.projects.length ? e.projects.join(', ') : 'Xtrium Critical Materials Program'
  const openPhases = phases.filter(p => p.status !== 'covered' && p.key !== 'other')
  let n = 0
  const next = () => ++n
  const phasesShown = phases.slice(-11)
  const CH: Record<string, { title: string; text: string }> = {
    link: { title: 'Broken links & blocked pages', text: 'Links that no longer open, sites that block automated access and pages behind a sign-in. They are flagged and escalated, never bypassed.' },
    nodata: { title: 'Nothing to extract', text: 'Sources with genuinely no extractable data or outside the schemas. Escalated with a written reason instead of forced into an ill-fitting schema.' },
    question: { title: 'Questions for the client', text: 'Entity names, schema choice and corrected URLs that only the client side can confirm. Each is logged as a question and tracked until answered.' },
  }
  const challenges = ['link', 'nodata', 'question'].map(k => ({ k, c: e.challenges.find((x: any) => x.kind === k) }))
  const latestRows: any[] = L ? L.sources.slice(0, 8) : []
  const bigOpen = L ? [...L.sources].filter((s: any) => s.stage !== 'delivered').sort((a: any, b: any) => b.records - a.records).slice(0, 2) : []

  return (
    <div className="deck-wrap">
      {/* cover */}
      <Slide dark>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, background: 'linear-gradient(160deg, transparent 55%, rgba(255,255,255,.14) 100%)' }} />
        <div style={{ position: 'absolute', left: 0, top: 56 }}><div style={{ fontSize: 26, fontWeight: 800 }}>Careerflow &lt;&gt; XTrium</div><div style={{ fontSize: 14, letterSpacing: 2, opacity: .85, marginTop: 6 }}>CRITICAL MATERIALS EXTRACTION</div></div>
        <div style={{ position: 'absolute', left: 0, top: 250 }}>
          <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 62, lineHeight: 1.1, fontWeight: 800, color: '#fff' }}>Full Engagement<br />Work Summary</h1>
          <p style={{ margin: '28px 0 0', fontSize: 24, fontStyle: 'italic', opacity: .92 }}>{T.batches} assignment {T.batches === 1 ? 'batch' : 'batches'}, {T.sources} sources, and the platform built to run them</p>
        </div>
        <div style={{ position: 'absolute', left: 0, bottom: 70, fontSize: 16 }}>Coverage period <b>{rangeA} – {rangeB}</b><div style={{ marginTop: 10, opacity: .9 }}>Prepared for {projects}</div></div>
      </Slide>

      <Slide n={next()} kicker="Agenda" title="What this report covers">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {[['Results at a glance', 'Headline numbers, batch-by-batch delivery and SOP coverage'], ['Current batch', 'The latest pull, what is delivered and what is moving'], ['Challenges', 'The recurring patterns and how they were handled'], ['Live delivery', 'Status table for the latest batch'], ['The platform', 'What the tool does, in numbers from the system'], ['Open issues and next steps', 'What is blocked and what comes next']].map(([h, s], i) => (
            <Card key={h} style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '20px 24px' }}>
              <div style={{ background: BLUE, color: '#fff', fontFamily: SERIF, fontSize: 24, fontWeight: 800, width: 60, height: 60, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{String(i + 1).padStart(2, '0')}</div>
              <div><div style={{ fontSize: 22, fontWeight: 700 }}>{h}</div><div style={{ fontSize: 15, color: GREY, marginTop: 4 }}>{s}</div></div>
            </Card>
          ))}
        </div>
      </Slide>

      <Slide n={next()} kicker="At a glance" title={`${T.batches_covered} of ${T.batches} batches fully delivered, ${T.sops} SOP standards in use`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18 }}>
          {[[nf(T.sources), 'sources covered to date'], [`${T.batches_covered}/${T.batches}`, 'batches fully delivered'], [nf(T.records_approved), 'records approved'], [nf(T.sops), 'SOP standards in use']].map(([v, l]) => (
            <Card key={l} style={{ height: 150 }}><div style={{ fontFamily: SERIF, fontSize: 52, fontWeight: 800, color: BLUE, lineHeight: 1 }}>{v}</div><div style={{ fontSize: 18, color: GREY, marginTop: 14 }}>{l}</div></Card>
          ))}
        </div>
        <div style={{ marginTop: 22, background: BLUE, color: '#fff', borderRadius: 14, padding: '26px 30px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, marginBottom: 10 }}>Engagement overview</div>
          <div style={{ fontSize: 18, lineHeight: 1.65 }}>Since {rangeA}, the team has worked through {T.batches} {T.batches === 1 ? 'batch' : 'batches'} pulled from Xtrium Catalog IQ, {nf(T.delivered)} of {nf(T.sources)} sources are delivered with {nf(T.records_approved)} approved records
            {T.final_accuracy !== null && T.final_accuracy !== undefined ? `, and ${Math.round(T.final_accuracy * 10) / 10}% final accuracy across ${nf(T.fields)} fields checked against the real sources` : ''}.
            {T.peer_total ? ` ${T.peer_done} of ${T.peer_total} peer reviews are submitted.` : ''} {L && L.totals.sources !== L.totals.delivered ? `The latest batch, ${L.label}, is the team's current focus.` : ''}</div>
        </div>
      </Slide>

      <Slide n={next()} kicker="Batch-by-batch summary" title={`From the first pull to ${T.sources} sources`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: phasesShown.length > 8 ? 15 : 17 }}>
          <thead><tr style={{ background: BLUE, color: '#fff', textAlign: 'left' }}>{['Date', 'Batch', 'Sources', 'Records', 'Accuracy', 'Status'].map(h => <th key={h} style={{ padding: '10px 12px', fontWeight: 700 }}>{h}</th>)}</tr></thead>
          <tbody>{phasesShown.map((p, i) => (
            <tr key={p.key} style={{ background: i % 2 ? SOFT : '#fff' }}>
              <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{p.key === 'other' ? '–' : dshort(p.date)}</td>
              <td style={{ padding: '9px 12px' }}>{p.label}{p.types.length ? <span style={{ color: GREY }}> · {p.types.join(', ')}</span> : null}</td>
              <td style={{ padding: '9px 12px', color: BLUE, fontWeight: 800 }}>{p.sources}</td>
              <td style={{ padding: '9px 12px' }}>{p.records}</td>
              <td style={{ padding: '9px 12px' }}>{p.accuracy === null || p.accuracy === undefined ? '–' : `${Math.round(p.accuracy * 10) / 10}%`}</td>
              <td style={{ padding: '9px 12px', fontWeight: 800, color: p.status === 'covered' ? GREEN : AMBER }}>{p.status === 'covered' ? 'Covered' : `In progress · ${p.delivered}/${p.sources}`}</td>
            </tr>))}
          </tbody>
        </table>
        {phases.length > phasesShown.length && <div style={{ fontSize: 13, color: GREY, marginTop: 8 }}>Showing the latest {phasesShown.length} of {phases.length} batches.</div>}
      </Slide>

      <Slide n={next()} kicker="Delivery volume" title="Sources, by batch">
        <div style={{ height: 460 }}><Bars phases={phases} /></div>
        {openPhases.length > 0 && <div style={{ fontSize: 14, fontStyle: 'italic', color: GREY }}>* In progress. Amber shows sources not yet delivered.</div>}
      </Slide>

      <Slide n={next()} kicker="SOP coverage" title={`${T.sops} SOP ${T.sops === 1 ? 'standard' : 'standards'} in use`}>
        <p style={{ margin: '0 0 18px', fontSize: 17, color: GREY, lineHeight: 1.55 }}>Each source follows the SOP Xtrium assigned to its item. Bars show delivered sources against all sources for that SOP{e.by_sop.some((x: any) => x.new) ? '; amber marks SOPs that first appeared in the latest batch' : ''}.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 50, rowGap: 14 }}>
          {e.by_sop.slice(0, 12).map((s: any) => (
            <div key={s.code}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: s.new ? 700 : 500, color: s.new ? AMBER : DARK }}><span>{s.code}</span><span>{s.delivered} of {s.total}</span></div>
              <div style={{ height: 16, background: '#e3e8f1', borderRadius: 4, marginTop: 5 }}><div style={{ height: 16, borderRadius: 4, width: `${(100 * s.delivered) / s.total}%`, background: s.new ? AMBER : BLUE }} /></div>
            </div>
          ))}
        </div>
      </Slide>

      <Slide n={next()} kicker="Challenges encountered" title="Recurring patterns, one consistent response">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
          {challenges.map(({ k, c }) => (
            <Card key={k} style={{ minHeight: 300 }}>
              <div style={{ fontFamily: SERIF, fontSize: 54, fontWeight: 800, color: c ? BLUE : '#9ca3af', lineHeight: 1 }}>{c ? c.count : 0}</div>
              <div style={{ fontSize: 20, fontWeight: 700, margin: '10px 0 8px' }}>{CH[k].title}</div>
              <div style={{ fontSize: 15.5, color: GREY, lineHeight: 1.6 }}>{CH[k].text}</div>
              {c && c.examples.length > 0 && <div style={{ fontSize: 14, color: DARK, marginTop: 12 }}>For example: {c.examples.join(', ')}</div>}
            </Card>
          ))}
        </div>
        <p style={{ margin: '20px 0 0', fontSize: 18, fontStyle: 'italic', color: GREY, lineHeight: 1.6 }}>The response is the same every time: escalate rather than guess, and stay in close contact with the client-side team to confirm entity names, resolve schema classification and verify corrected URLs.</p>
      </Slide>

      <Slide dark>
        <div style={{ position: 'absolute', left: 0, right: 40, top: 80 }}>
          <div style={{ fontFamily: SERIF, fontSize: 90, lineHeight: .6 }}>&ldquo;</div>
          <h2 style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 800, lineHeight: 1.35, margin: '16px 0 22px', color: '#fff' }}>One auditable system of record replaces ad-hoc spreadsheet tracking.</h2>
          <p style={{ fontSize: 19, lineHeight: 1.7, opacity: .93, maxWidth: 1060 }}>The platform receives assigned work from Xtrium Catalog IQ, tracks every source through extraction, peer review and admin sign-off, and reports approved results back to Xtrium. A source with genuinely no extractable data is escalated with a documented reason, and every record keeps the SOP it was extracted under.</p>
          <div style={{ marginTop: 22, background: 'rgba(0,0,0,.2)', borderRadius: 12, padding: '20px 26px', maxWidth: 880, fontSize: 17, lineHeight: 1.6 }}><b>In numbers.</b> {nf(T.sources)} sources pulled, {nf(T.delivered)} delivered, {nf(T.records_approved)} records approved, {nf(T.submitted)} sources submitted back to Xtrium{T.peer_total ? `, ${T.peer_done} of ${T.peer_total} peer reviews done` : ''}.</div>
        </div>
      </Slide>

      <Slide n={next()} kicker="The platform" title="What it does, in numbers from the system">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
          {[
            ['Automatic work intake', `${nf(T.sources)} sources`, 'Items assigned by Xtrium Catalog IQ are pulled in, each becoming a trackable source.'],
            ['Full pipeline tracking', `${T.batches_covered} of ${T.batches} batches`, 'Every source moves through extraction, peer review and final admin approval.'],
            ['Peer review', T.peer_total ? `${T.peer_done} of ${T.peer_total}` : 'Built in', 'Independent peer reviews, with each reviewer\'s comment required before sign-off.'],
            ['Quality checks', T.fields ? `${nf(T.fields)} fields` : 'Field checks', T.final_accuracy !== null && T.final_accuracy !== undefined ? `Checked against the real sources: ${Math.round(T.final_accuracy * 10) / 10}% final accuracy.` : 'Fields are checked against the real sources and scored.'],
            ['Automatic reporting', `${nf(T.submitted)} submitted`, 'Approved sources are reported back to Xtrium, and their status is checked afterwards.'],
            ['Client questions', T.questions_asked ? `${T.questions_answered} of ${T.questions_asked} answered` : 'Tracked', 'Unclear points are logged as questions for the client and followed until answered.'],
          ].map(([h, v, s], i) => (
            <Card key={h} style={i === 5 ? { background: BLUE, color: '#fff', height: 200 } : { height: 200 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{h}</div>
              <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 800, color: i === 5 ? '#fff' : BLUE, margin: '8px 0' }}>{v}</div>
              <div style={{ fontSize: 14.5, lineHeight: 1.5, color: i === 5 ? 'rgba(255,255,255,.9)' : GREY }}>{s}</div>
            </Card>
          ))}
        </div>
      </Slide>

      {L && (
        <Slide n={next()} kicker="Current batch" title={`${L.label}: ${L.totals.delivered} of ${L.totals.sources} delivered`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
            {L.by_type.slice(0, 3).map((t: any) => (
              <Card key={t.type} style={{ height: 250 }}>
                <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 800 }}>{t.type}</div>
                <div style={{ fontSize: 15, color: BLUE, fontWeight: 700, margin: '6px 0 12px' }}>{t.delivered} of {t.total} delivered</div>
                <div style={{ height: 12, background: '#dfe5f1', borderRadius: 4 }}><div style={{ width: `${(100 * t.delivered) / t.total}%`, height: 12, background: BLUE, borderRadius: 4 }} /></div>
                <div style={{ fontSize: 14.5, color: GREY, lineHeight: 1.55, marginTop: 14 }}>{L.sources.filter((s: any) => s.type === t.type).slice(0, 4).map((s: any) => s.name).join(', ')}{t.total > 4 ? ` and ${t.total - 4} more` : ''}.</div>
                <span style={{ display: 'inline-block', marginTop: 10, padding: '4px 14px', borderRadius: 14, background: t.delivered === t.total ? GREEN : AMBER, color: '#fff', fontSize: 12, fontWeight: 700 }}>{t.delivered === t.total ? 'Delivered' : 'In progress'}</span>
              </Card>
            ))}
          </div>
          {L.highlights.length > 0 && <p style={{ margin: '22px 0 0', fontSize: 18, fontStyle: 'italic', color: GREY, lineHeight: 1.6 }}>{L.highlights.join(' ')}</p>}
        </Slide>
      )}

      {L && (
        <Slide n={next()} kicker="Live delivery snapshot" title={`${L.label}: ${L.totals.delivered} delivered, ${L.totals.in_progress + L.totals.blocked} still open`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
            {[[L.totals.delivered, 'sources delivered'], [L.totals.records_approved, 'records approved and delivered'], [L.totals.in_progress, 'sources still in review'], [L.totals.records - L.totals.records_approved, 'records awaiting approval']].map(([v, l]) => (
              <Card key={l as string} style={{ padding: '14px 18px' }}><div style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 800, color: BLUE }}>{v}</div><div style={{ fontSize: 14, color: GREY }}>{l}</div></Card>
            ))}
          </div>
          <table style={{ width: '82%', borderCollapse: 'collapse', fontSize: 14.5, marginTop: 14 }}>
            <thead><tr style={{ background: BLUE, color: '#fff', textAlign: 'left' }}>{['Source', 'Status', 'Total time', 'Records'].map(h => <th key={h} style={{ padding: '7px 12px' }}>{h}</th>)}</tr></thead>
            <tbody>{latestRows.map((s: any, i: number) => (
              <tr key={s.source_id} style={{ background: i % 2 ? SOFT : '#fff' }}>
                <td style={{ padding: '6px 12px' }}>{s.name}</td>
                <td style={{ padding: '6px 12px', fontWeight: 700, color: s.stage === 'delivered' ? GREEN : s.stage === 'blocked' ? '#c2410c' : AMBER }}>{L.stages.find((x: any) => x.key === s.stage)?.label}</td>
                <td style={{ padding: '6px 12px' }}>{s.days === null ? '–' : `${s.days} days`}</td>
                <td style={{ padding: '6px 12px' }}>{s.approved} / {s.records}</td>
              </tr>))}
            </tbody>
          </table>
          {L.sources.length > latestRows.length && <div style={{ fontSize: 12.5, color: GREY, marginTop: 6 }}>and {L.sources.length - latestRows.length} more sources in this batch.</div>}
          {bigOpen.length > 0 && bigOpen[0].records > 1 && <div style={{ marginTop: 10, border: `1.5px solid ${AMBER}`, background: '#fff8e8', borderRadius: 10, padding: '10px 16px', fontSize: 14.5 }}><b>{bigOpen.map((s: any) => s.name).join(' and ')}</b> {bigOpen.length > 1 ? 'carry' : 'carries'} the most records still open ({bigOpen.map((s: any) => s.records).join(' and ')}).</div>}
        </Slide>
      )}

      <Slide n={next()} kicker="Open issues" title={e.blocked.length ? `${T.blocked} ${T.blocked === 1 ? 'source needs' : 'sources need'} a decision` : 'Nothing is blocked'}>
        {e.blocked.length === 0 ? (
          <Card style={{ fontSize: 20, lineHeight: 1.6 }}>Every source can move forward as written. Nothing is waiting on the client or on a link fix.</Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, e.blocked.length)},1fr)`, gap: 16 }}>
            {e.blocked.slice(0, 3).map((g: any) => (
              <div key={g.title} style={{ border: `1.5px solid ${AMBER}`, background: SOFT, borderRadius: 14, padding: '16px 20px', maxHeight: 440, overflow: 'hidden' }}>
                <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 800, color: AMBER, lineHeight: 1 }}>{g.items.length}</div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: '6px 0 2px' }}>{g.title}</div>
                <div style={{ fontSize: 13, color: GREY, marginBottom: 8 }}><b style={{ color: AMBER }}>Need from you:</b> {g.need}</div>
                {g.items.slice(0, 9).map((i: any, j: number) => <div key={j} style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b style={{ color: AMBER }}>{i.item_no ? `#${i.item_no}` : '•'}</b> {i.name}</div>)}
                {g.items.length > 9 && <div style={{ fontSize: 13, color: GREY }}>and {g.items.length - 9} more</div>}
              </div>
            ))}
          </div>
        )}
        {e.blocked.length > 3 && <div style={{ fontSize: 14, color: GREY, marginTop: 10 }}>and {e.blocked.slice(3).reduce((s: number, g: any) => s + g.items.length, 0)} more in other groups.</div>}
      </Slide>

      <Slide n={next()} kicker="Looking ahead" title="What comes next">
        <div>
          {e.next.map((x: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 22, padding: '16px 0', borderBottom: i < e.next.length - 1 ? '1px solid #e5e7eb' : 'none', alignItems: 'flex-start' }}>
              <div style={{ background: BLUE, color: '#fff', width: 50, height: 50, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, flex: 'none' }}>{i + 1}</div>
              <div><div style={{ fontSize: 24, fontWeight: 700 }}>{x.title}</div><div style={{ fontSize: 17, color: GREY, marginTop: 6, lineHeight: 1.5 }}>{x.text}</div></div>
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: SOFT, borderRadius: 12, padding: '16px 22px', fontStyle: 'italic', fontSize: 17 }}>Thank you for the continued effort and collaboration across this program.</div>
      </Slide>

      <Slide dark>
        <div style={{ position: 'absolute', left: 0, bottom: 150 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 60, lineHeight: 1.1, fontWeight: 800, color: '#fff' }}>Building on<br />the momentum</h2>
          <p style={{ margin: '20px 0 0', fontSize: 21, fontStyle: 'italic', opacity: .92, maxWidth: 700, lineHeight: 1.5 }}>Thank you to the Xtrium team for the collaboration across this program so far, and for the work ahead.</p>
          <div style={{ marginTop: 40, fontSize: 16 }}><b>Xtrium Critical Materials Extraction</b><div style={{ opacity: .8, marginTop: 6 }}>Coverage period: {rangeA} – {rangeB}</div></div>
        </div>
      </Slide>
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
