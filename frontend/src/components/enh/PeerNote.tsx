import { useState } from 'react'
import { Chip } from '@/components/enh/kit'

const URL_RE = /https?:\/\/[^\s)]+/g
const trimUrl = (u: string) => u.replace(/[.,;:]+$/, '')
const host = (u: string) => { try { return new URL(trimUrl(u)).hostname.replace(/^www\./, '') } catch { return trimUrl(u).slice(0, 30) } }
const pathBit = (u: string) => { try { const x = new URL(trimUrl(u)); const last = x.pathname.split('/').filter(Boolean).pop() || ''; return last.length > 18 ? last.slice(0, 18) + '…' : last } catch { return '' } }

/** Split a note into what is wrong and the how-to steps that follow ("What to do: 1. …"). */
export function splitNote(text: string): { lead: string; fix: string } {
  const m = text.match(/\b(what to do|suggested fix|how to fix|to fix this|steps?)\s*:/i) || text.match(/\s(?=1[.)]\s+\S)/)
  if (!m || m.index === undefined || m.index < 20) return { lead: text.trim(), fix: '' }
  return { lead: text.slice(0, m.index).trim(), fix: text.slice(m.index).trim() }
}

/** Plain text with each link turned into a short chip (site and last path bit), full address on hover. */
function Linked({ text }: { text: string }) {
  const out: React.ReactNode[] = []
  let last = 0, k = 0
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const u = trimUrl(m[0])
    out.push(<a key={k++} href={u} target="_blank" rel="noreferrer" title={u} className="inline-flex items-center gap-1 align-baseline rounded-md bg-white border border-gray-200 px-1.5 py-0 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 no-underline">{host(u)}{pathBit(u) ? <span className="text-gray-400 font-normal">/{pathBit(u)}</span> : null}</a>)
    last = i + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

/** One peer note, laid out so the complaint reads first and the how-to steps stay out of the way. */
export function PeerNote({ p }: { p: any }) {
  const [open, setOpen] = useState(false)
  const { lead, fix } = splitNote(String(p.comment || ''))
  const tied = p.fields?.length > 0
  const quiet = !tied && !p.unknown?.length && lead.length < 40
  if (quiet) return (
    <div className="px-3 py-1 text-xs text-gray-400"><span className="font-semibold text-gray-500">{p.name}</span> wrote “{lead}” <span title="It reads as an acknowledgement or names no field. Comment on the field itself to credit it.">· no field</span></div>
  )
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm">
      <div className="flex items-baseline gap-2"><span className="font-semibold text-gray-900">{p.name}</span><span className="text-[11px] text-gray-400">peer note</span></div>
      <p className="m-0 mt-0.5 text-gray-700 leading-relaxed"><Linked text={lead} /></p>
      {fix && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="text-[11px] font-semibold text-gray-500 hover:text-gray-800">{open ? '▾ Hide suggested fix' : '▸ Suggested fix'}</button>
          {open && <p className="m-0 mt-1 text-[13px] text-gray-600 leading-relaxed border-l-2 border-gray-200 pl-3"><Linked text={fix} /></p>}
        </div>
      )}
      {tied && <span className="flex items-center gap-1.5 flex-wrap mt-1.5"><span className="text-[11px] text-gray-500">Points at:</span>{p.fields.map((n: string) => <Chip key={n} tone="red" title={p.why?.[n] ? `${p.why[n].why}: "${p.why[n].clause}"` : undefined}>{n}</Chip>)}</span>}
      {!tied && !quiet && <span className="block text-[11px] text-gray-400 mt-1.5">Not tied to a field. Comment on the field itself to credit it.</span>}
      {p.unknown?.length > 0 && <span className="flex items-center gap-1.5 flex-wrap mt-1"><span className="text-[11px] text-gray-500">Named but not a field on this source:</span>{p.unknown.map((n: string) => <Chip key={n} tone="amber" title="Not in the record, the schema or the SOP. Check it by hand.">{n}</Chip>)}</span>}
    </div>
  )
}
