import { useMemo, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'

interface Props {
  record: any
  localFields: Record<string, unknown>
  sourceWebsiteUrl?: string
  onClose: () => void
}

/** Side panel next to the record: the text it was extracted from, and the website, so values can be checked without leaving. */
export function EvidencePanel({ record, localFields, sourceWebsiteUrl, onClose }: Props) {
  const urls = useMemo(() => {
    const out: { url: string; label: string }[] = []
    const add = (u: unknown, label: string) => {
      if (typeof u === 'string' && /^https?:\/\//i.test(u) && !out.some(o => o.url === u)) out.push({ url: u, label })
    }
    add(localFields.website, 'Company website')
    add(sourceWebsiteUrl, 'Source website')
    const list = Array.isArray(localFields.sources) ? (localFields.sources as any[]) : []
    list.forEach((s, i) => add(s?.url ?? s?.source_url ?? (typeof s === 'string' ? s : null), s?.title ? String(s.title).slice(0, 40) : `Source link ${i + 1}`))
    return out
  }, [localFields, sourceWebsiteUrl])
  const [tab, setTab] = useState<'text' | 'web'>(record.raw_text ? 'text' : 'web')
  const [i, setI] = useState(0)
  const current = urls[i]
  const tabBtn = (id: 'text' | 'web', label: string) => (
    <button key={id} type="button" onClick={() => setTab(id)} style={{
      padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, borderRadius: 7,
      background: tab === id ? 'var(--bg-fff)' : 'transparent', color: tab === id ? 'var(--tx-1d4ed8)' : 'var(--tx-64748b)', boxShadow: tab === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
    }}>{label}</button>
  )
  let pretty = record.raw_text || ''
  try { pretty = JSON.stringify(JSON.parse(pretty), null, 2) } catch { /* keep as is */ }

  return (
    <aside aria-label="Evidence" style={{ position: 'fixed', top: 59, right: 0, bottom: 0, width: '44%', minWidth: 360, background: 'var(--bg-fff)', borderLeft: '1px solid var(--bd-e2e8f0)', display: 'flex', flexDirection: 'column', zIndex: 5, boxShadow: '-6px 0 18px rgba(15,23,42,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--bd-f1f5f9)', flexShrink: 0 }}>
        <div style={{ display: 'flex', background: 'var(--bg-f1f5f9)', borderRadius: 9, padding: 3, border: '1px solid var(--bd-e2e8f0)' }}>{tabBtn('text', 'Source text')}{tabBtn('web', 'Website')}</div>
        {tab === 'web' && urls.length > 1 && (
          <select value={i} onChange={e => setI(Number(e.target.value))} aria-label="Which link"
            style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '6px 8px', border: '1px solid var(--bd-e2e8f0)', borderRadius: 8, background: 'var(--bg-fff)', color: 'var(--tx-334155)' }}>
            {urls.map((u, k) => <option key={u.url} value={k}>{u.label}: {u.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        {tab === 'web' && current && (
          <a href={current.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--tx-2563eb)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Open in new tab <ExternalLink size={12} />
          </a>
        )}
        <button type="button" onClick={onClose} aria-label="Close side panel" style={{ padding: 6, border: 'none', background: 'var(--bg-f1f5f9)', borderRadius: 8, cursor: 'pointer', display: 'flex' }}><X size={14} color="#64748b" /></button>
      </div>
      {tab === 'text' ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }} className="scrollbar-thin">
          {pretty ? <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--tx-334155)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{pretty}</pre>
            : <p style={{ fontSize: 13, color: '#94a3b8' }}>No source text was saved with this record.</p>}
        </div>
      ) : current ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <iframe key={current.url} src={current.url} title={current.label} sandbox="allow-scripts allow-popups allow-forms" referrerPolicy="no-referrer"
            style={{ flex: 1, border: 'none', width: '100%', background: 'var(--bg-fff)' }} />
          <p style={{ margin: 0, padding: '8px 14px', fontSize: 11, color: '#94a3b8', borderTop: '1px solid var(--bd-f1f5f9)', background: '#fafafa' }}>
            Some websites refuse to be shown inside another page. If this stays blank, use Open in new tab.
          </p>
        </div>
      ) : <div style={{ padding: 24 }}><p style={{ fontSize: 13, color: '#94a3b8' }}>This record has no website to show.</p></div>}
    </aside>
  )
}
