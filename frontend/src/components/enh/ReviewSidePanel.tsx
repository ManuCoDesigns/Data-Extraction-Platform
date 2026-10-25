import { useEffect, useMemo, useRef, useState } from 'react'
import { xtriumApi } from '@/api/client'
import { SopViewer } from '@/components/SopViewer'
import { Blank, Chip, Skeletons, Tabs } from '@/components/enh/kit'
import { Button } from '@/components/ui'
import { PageReader } from '@/components/enh/PageReader'
import { highlightTerms, termsPattern, noTextReason } from '@/lib/highlightTerms'

type Tab = 'sop' | 'text' | 'web' | 'page'

const present = (v: unknown) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0))

/** Everything needed to check a record, beside the record: the SOP, the text it came from, the website, and the page as Nimble reads it. */
export function ReviewSidePanel({ sourceId, website, rec, sopRequired, onJumpField, warnings, onRefreshCheck, refreshBusy, activeValue, activeField, pageText, pageBusy, nimbleReady, onFetchPage }: {
  sourceId: string; website?: string | null; rec: any; sopRequired: string[]; onJumpField?: (name: string) => void; warnings?: string[]; onRefreshCheck?: () => void; refreshBusy?: boolean; activeValue: unknown; activeField: string
  pageText?: string; pageBusy: boolean; nimbleReady: boolean; onFetchPage: () => void
}) {
  const [tab, setTabRaw] = useState<Tab>(() => { try { const v = localStorage.getItem('dx.reviewTab'); return (v === 'text' || v === 'web' || v === 'page' ? v : 'sop') as Tab } catch { return 'sop' } })
  const setTab = (t: Tab) => { setTabRaw(t); try { localStorage.setItem('dx.reviewTab', t) } catch { /* ignore */ } }
  const [sop, setSop] = useState<any>(null)
  const [sopErr, setSopErr] = useState('')
  useEffect(() => {
    if (tab !== 'sop' || sop || sopErr) return
    xtriumApi.sop(sourceId).then(setSop).catch((e: any) => setSopErr(e?.response?.status === 422 ? "This source wasn't pulled from Xtrium, so it has no SOP." : "Couldn't load the SOP."))
  }, [tab, sop, sopErr, sourceId])

  const urls = useMemo(() => {
    const out: { url: string; label: string }[] = []
    const add = (u: unknown, label: string) => { if (typeof u === 'string' && /^https?:\/\//i.test(u) && !out.some(o => o.url === u)) out.push({ url: u, label }) }
    rec?.fields?.forEach((f: any) => { if (/website|url|link/i.test(f.name)) add(f.value, f.name) })
    add(website, 'Source website')
    return out
  }, [rec, website])
  const [ui, setUi] = useState(0)
  useEffect(() => { setUi(0) }, [rec?.record_id])
  const cur = urls[ui]

  // The SOP's required fields against this record, so gaps are visible without reading the guide.
  const auto = ['data_origin', 'retrieved_at', 'method']
  const checklist = [...sopRequired, ...auto.filter(a => !sopRequired.includes(a))].map(n => {
    const f = rec?.fields?.find((x: any) => x.name === n)
    return { name: n, onRecord: !!f, ok: !!f && present(f.value) && !/^(n\/a|na|tbd|unknown|none|null|-|--|\?)$/i.test(String(f.value).trim()) }
  })
  const missing = checklist.filter(c => !c.ok).length

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap pb-3">
        <Tabs value={tab} onChange={setTab} items={[{ key: 'sop', label: 'SOP' }, { key: 'text', label: 'Source text' }, { key: 'web', label: 'Website' }, { key: 'page', label: 'Page text' }]} />
        {tab === 'web' && cur && <a href={cur.url} target="_blank" rel="noreferrer" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">Open in new tab</a>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-4">
        {tab === 'sop' && (
          <div className="space-y-4">
            {checklist.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2"><h3 className="text-sm font-bold text-gray-900 m-0">Required by the SOP</h3><Chip tone={missing ? 'red' : 'green'}>{missing ? `${missing} missing on this record` : 'All filled in'}</Chip></div>
                <ul className="m-0 p-0 list-none grid gap-1.5 sm:grid-cols-2">
                  {checklist.map(c => (
                    <li key={c.name}>
                      <button type="button" disabled={!c.onRecord || !onJumpField} onClick={() => onJumpField?.(c.name)}
                        title={c.onRecord ? 'Go to this field in the review' : 'This record has no such field'}
                        className={'w-full text-left text-sm flex items-center gap-2 rounded-lg px-2 py-1 border ' + (c.ok ? 'border-gray-100 hover:bg-gray-50' : 'border-red-400 bg-transparent hover:bg-red-500/10') + (c.name === activeField ? ' ring-2 ring-brand-500' : '')}>
                        <span className={c.ok ? 'text-emerald-600' : 'text-red-600'} aria-hidden>{c.ok ? '✓' : '✗'}</span>
                        <span className={'font-mono text-[12.5px] ' + (c.ok ? 'text-gray-700' : 'text-red-500 font-semibold')}>{c.name}</span>
                        <span className={'ml-auto text-[11px] ' + (c.ok ? 'text-gray-400' : 'text-red-500')}>{c.ok ? (auto.includes(c.name) ? 'auto-filled' : 'filled') : c.onRecord ? 'empty' : 'not on record'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {warnings && warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <b className="block mb-1">{warnings.length} thing{warnings.length === 1 ? '' : 's'} to settle with this SOP</b>
                <ul className="m-0 pl-4 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                {onRefreshCheck && <div className="mt-2"><Button size="sm" disabled={refreshBusy} onClick={onRefreshCheck} title="Ask Xtrium for the SOP and category again, then run the system checks">{refreshBusy ? 'Refreshing…' : 'Refresh from Xtrium and re-check'}</Button></div>}
              </div>
            )}
            {sopErr ? <Blank title={sopErr} /> : !sop ? <Skeletons rows={4} /> : <SopViewer data={sop} compact />}
          </div>
        )}
        {tab === 'text' && (rec?.raw ? <Highlighted text={prettyJson(rec.raw)} needle={activeValue} field={activeField} /> : <Blank title="No source text was saved with this record" />)}
        {tab === 'web' && (cur ? (
          <div className="flex flex-col h-[70vh] min-h-[320px] -m-4">
            {urls.length > 1 && <select value={ui} onChange={e => setUi(Number(e.target.value))} aria-label="Which link" className="m-3 mb-0 text-xs rounded-lg border border-gray-200 px-2 py-1.5 bg-white text-gray-700">{urls.map((u, k) => <option key={u.url} value={k}>{u.label}: {u.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}</option>)}</select>}
            <iframe key={cur.url} src={cur.url} title={cur.label} sandbox="allow-scripts allow-popups allow-forms" referrerPolicy="no-referrer" className="flex-1 w-full border-0 bg-white" />
            <p className="m-0 px-3 py-2 text-[11px] text-gray-400 border-t border-gray-100">Many sites refuse to show inside another page. If it stays blank, use Open in new tab, or read it in the Page text tab.</p>
          </div>
        ) : <Blank title="No website to show" text="This record and source have no web address." />)}
        {tab === 'page' && (pageText ? (
          <div>
            <p className="text-xs text-gray-500 mt-0 mb-1">The page as Nimble read it. {activeField ? <>Matches for <b>{activeField}</b> are highlighted.</> : 'Click a field to highlight its value here.'}</p>
            <PageReader text={pageText} needle={activeValue} field={activeField} />
          </div>
        ) : (
          <Blank title="Read the page here" text={nimbleReady ? 'Nimble fetches the source website and shows its text here, with the value of the field you are on highlighted.' : 'Add NIMBLE_API_KEY in the server settings to turn this on.'}
            action={nimbleReady ? <Button disabled={pageBusy} onClick={onFetchPage}>{pageBusy ? 'Reading the site…' : 'Read the page'}</Button> : undefined} />
        ))}
      </div>
    </div>
  )
}

function prettyJson(t: string) { try { return JSON.stringify(JSON.parse(t), null, 2) } catch { return t } }

/** Text with every occurrence of the active field's value marked, and the first one scrolled into view. A flag or empty value marks its own line instead. */
function Highlighted({ text, needle, field }: { text: string; needle: unknown; field?: string }) {
  const first = useRef<HTMLElement | null>(null)
  const { parts, note } = useMemo(() => {
    const terms = highlightTerms(needle, field)
    const all = [...terms, ...terms.map(x => JSON.stringify(x).slice(1, -1)).filter(x => !terms.includes(x))] // the raw text may hold the JSON-escaped form
    const find = (alt: string) => { try { return alt ? text.split(new RegExp(`(${alt})`, 'ig')) : [text] } catch { return [text] } }
    let p = find(termsPattern(all))
    if (p.length > 1) return { parts: p, note: '' }
    if (field) {
      const key = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      p = find(`"${key}"\\s*:[^\\n]*`)
      if (p.length > 1) return { parts: p, note: terms.length ? 'The value itself is not written in this text, so its line is marked.' : `${noTextReason(needle)} Its line is marked instead.` }
    }
    return { parts: [text], note: terms.length ? 'This value is not in the source text.' : noTextReason(needle) }
  }, [text, needle, field])
  useEffect(() => { first.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [parts])
  let seen = false
  return (
    <div>
      {note && field && <p className="text-xs text-gray-500 mt-0 mb-2"><b>{field}</b>: {note}</p>}
      <pre className="m-0 text-[12.5px] leading-6 text-gray-800 whitespace-pre-wrap break-words font-mono">
        {parts.map((p, i) => {
          if (i % 2 === 1) {
            const ref = !seen ? (el: HTMLElement | null) => { first.current = el } : undefined
            seen = true
            return <mark key={i} ref={ref} className="rounded px-0.5" style={{ background: '#fbbf24', color: '#1c1917' }}>{p}</mark>
          }
          return <span key={i}>{p}</span>
        })}
      </pre>
    </div>
  )
}
