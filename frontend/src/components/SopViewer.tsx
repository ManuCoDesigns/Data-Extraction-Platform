import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Copy, Download, FileText, Braces, ListChecks, AlertTriangle } from 'lucide-react'
import { cn, toast } from '@/components/ui'

// ── A small, safe Markdown renderer (no HTML injection: everything is React nodes) ──
type Block =
  | { t: 'h'; level: number; text: string; id: string }
  | { t: 'p'; text: string }
  | { t: 'list'; ordered: boolean; items: { depth: number; text: string }[] }
  | { t: 'quote'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' }

const slugify = (s: string) =>
  s.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  const used = new Map<string, number>()
  const uniqueId = (text: string) => {
    const base = slugify(text)
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    return n === 0 ? base : `${base}-${n + 1}`
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { buf.push(lines[i]); i++ }
      i++ // closing fence
      blocks.push({ t: 'code', lang, text: buf.join('\n') })
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ t: 'h', level: h[1].length, text: h[2].trim(), id: uniqueId(h[2]) })
      i++
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++ }
      blocks.push({ t: 'table', head, rows })
      continue
    }
    if (line.trimStart().startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ t: 'quote', text: buf.join('\n') })
      continue
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (li) {
      const ordered = /\d/.test(li[2])
      const items: { depth: number; text: string }[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (!m) break
        items.push({ depth: Math.min(3, Math.floor(m[1].length / 2)), text: m[3] })
        i++
      }
      blocks.push({ t: 'list', ordered, items })
      continue
    }
    const buf: string[] = []
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,4}\s|```|\s*>|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) { buf.push(lines[i].replace(/\s+$/, '')); i++ }
    if (buf.length === 0) { buf.push(line); i++ }
    blocks.push({ t: 'p', text: buf.join('\n') })
  }
  return blocks
}

function inline(text: string, keyPrefix = 'i'): ReactNode[] {
  const whole = /^_([^_].*[^_])_$/.exec(text.trim())
  if (whole) return [<em key={`${keyPrefix}-em`} className="text-gray-500">{inline(whole[1], `${keyPrefix}e`)}</em>]
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyPrefix}-${n++}`
    if (tok.startsWith('`')) {
      out.push(<code key={k} className="px-1.5 py-0.5 rounded-md bg-gray-100 text-[0.85em] text-gray-800 font-mono break-words">{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('**')) {
      out.push(<strong key={k} className="font-semibold text-gray-900">{inline(tok.slice(2, -2), k)}</strong>)
    } else {
      const lm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok)
      if (lm) out.push(<a key={k} href={lm[2]} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700 underline break-all">{lm[1]}</a>)
      else out.push(tok)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const copyText = async (text: string, what: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error("Couldn't copy — select the text manually")
  }
}

const download = (filename: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function CodeBlock({ text, lang, label }: { text: string; lang?: string; label?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden my-3">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{label ?? (lang || 'text')}</span>
        <button onClick={() => copyText(text, 'Code')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
          <Copy className="w-3.5 h-3.5" /> Copy
        </button>
      </div>
      <pre className="m-0 p-4 text-xs leading-relaxed text-gray-800 overflow-auto bg-white" style={{ maxHeight: 420 }}>{text}</pre>
    </div>
  )
}

export function MarkdownView({ blocks }: { blocks: Block[] }) {
  return (
    <div className="text-sm text-gray-700 leading-relaxed">
      {blocks.map((b, idx) => {
        const key = `b${idx}`
        switch (b.t) {
          case 'h': {
            const cls = b.level === 1
              ? 'text-xl font-extrabold text-gray-900 mt-8 mb-3 pb-2 border-b border-gray-100'
              : b.level === 2
                ? 'text-base font-bold text-gray-900 mt-7 mb-2'
                : 'text-sm font-bold text-gray-800 mt-5 mb-1.5'
            const Tag = (`h${Math.min(b.level + 1, 6)}`) as 'h2'
            return <Tag key={key} id={b.id} className={cn(cls, 'scroll-mt-4')}>{inline(b.text, key)}</Tag>
          }
          case 'p':
            return <p key={key} className="my-2.5 whitespace-pre-line">{inline(b.text, key)}</p>
          case 'hr':
            return <hr key={key} className="my-6 border-gray-100" />
          case 'quote':
            return (
              <div key={key} className="my-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="whitespace-pre-line">{inline(b.text, key)}</div>
              </div>
            )
          case 'code':
            return <CodeBlock key={key} text={b.text} lang={b.lang} />
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={key} className={cn('my-2.5 pl-5 space-y-1', b.ordered ? 'list-decimal' : 'list-disc')}>
                {b.items.map((it, j) => (
                  <li key={j} style={{ marginLeft: it.depth * 16 }}>{inline(it.text, `${key}-${j}`)}</li>
                ))}
              </Tag>
            )
          }
          case 'table':
            return (
              <div key={key} className="my-4 overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      {b.head.map((c, j) => (
                        <th key={j} className="px-3 py-2 text-left font-bold text-gray-600 border-b border-gray-200 whitespace-nowrap">{inline(c, `${key}h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} className="border-b border-gray-100 last:border-0">
                        {r.map((c, ci) => (
                          <td key={ci} className="px-3 py-2 align-top text-gray-700">{inline(c, `${key}r${ri}c${ci}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2)
const chipCls = 'inline-flex items-center text-[11px] font-semibold px-2 py-1 rounded-full'

type Tab = 'guide' | 'template' | 'schema'

// ── The SOP, laid out for people who have to work from it ────────────────────
export function SopViewer({ data }: { data: any }) {
  const sop = data.sop
  const meta = data.meta ?? {}
  const [tab, setTab] = useState<Tab>('guide')
  const blocks = useMemo(() => parseMarkdown(String(sop?.markdown ?? '')), [sop?.markdown])
  const toc = blocks.filter((b): b is Extract<Block, { t: 'h' }> => b.t === 'h' && b.level <= 2)
  const required: string[] = Array.isArray(meta.required_fields) ? meta.required_fields
    : Array.isArray(sop?.required_fields) ? sop.required_fields : []
  const code = sop?.sop_code ?? meta.sop_code
  const template = sop?.deliverable_template
  const schema = sop?.deliverable_schema

  const tabs: { id: Tab; label: string; icon: any; show: boolean }[] = [
    { id: 'guide', label: 'Guide', icon: FileText, show: true },
    { id: 'template', label: 'Fill-in template', icon: Braces, show: !!template },
    { id: 'schema', label: 'JSON schema', icon: ListChecks, show: !!schema },
  ]

  return (
    <div className="space-y-5">
      <div className="relative bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-500 to-brand-700" />
        <div className="px-6 pt-6 pb-5">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider m-0">Standard operating procedure</p>
          <h2 className="text-lg font-extrabold text-gray-900 mt-1 mb-3">{sop?.title ?? code ?? 'SOP'}</h2>
          <div className="flex flex-wrap gap-2">
            {code && <span className={cn(chipCls, 'bg-gray-900 text-white font-mono')}>{code}</span>}
            {(sop?.entity ?? meta.target_entity) && <span className={cn(chipCls, 'bg-violet-50 text-violet-700')}>Entity: {sop?.entity ?? meta.target_entity}</span>}
            {sop?.spec_version && <span className={cn(chipCls, 'bg-blue-50 text-blue-700')}>Spec v{sop.spec_version}</span>}
            {sop?.template_id && <span className={cn(chipCls, 'bg-gray-100 text-gray-600')}>{sop.template_id}</span>}
          </div>
          {required.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider m-0 mb-1.5">Required for every record</p>
              <div className="flex flex-wrap gap-2">
                {required.map(f => (
                  <code key={f} className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-semibold">{f}</code>
                ))}
                {['data_origin', 'retrieved_at', 'method'].map(f => (
                  <code key={f} className="px-2 py-1 rounded-lg bg-amber-50 text-amber-800 text-xs font-semibold" title="Provenance — required on every record">{f}</code>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5 m-0">Green: item fields · Amber: provenance. A record missing any of these is rejected on upload.</p>
            </div>
          )}
        </div>
        <div className="flex gap-1 px-4 border-t border-gray-100 bg-gray-50/60">
          {tabs.filter(t => t.show).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px transition',
                tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'guide' && (
        <div className="grid lg:grid-cols-[220px_1fr] gap-6 items-start">
          {toc.length > 1 && (
            <nav aria-label="Contents" className="hidden lg:block lg:sticky lg:top-4 bg-white rounded-2xl border border-gray-100 shadow-card px-4 py-4">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider m-0 mb-2">Contents</p>
              <ul className="list-none m-0 p-0 space-y-1.5">
                {toc.map(h => (
                  <li key={h.id} style={{ paddingLeft: h.level === 2 ? 10 : 0 }}>
                    <a href={`#${h.id}`} className={cn('text-xs hover:text-brand-700', h.level === 1 ? 'font-bold text-gray-800' : 'text-gray-500')}>
                      {h.text.replace(/`/g, '')}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-6 py-5 min-w-0">
            <MarkdownView blocks={blocks} />
          </div>
        </div>
      )}

      {tab === 'template' && template && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-6 py-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-gray-900 m-0">Deliverable skeleton (one record)</h3>
              <p className="text-xs text-gray-500 mt-1 mb-0 max-w-xl">
                Placeholders are blank on purpose — empty values count as missing. Fill the required and provenance fields,
                fill what the source supports in the rest, and delete every key you cannot source.
              </p>
            </div>
            <button onClick={() => download(`${code ?? 'sop'}-template.json`, pretty(template))}
              className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
              <Download className="w-3.5 h-3.5" /> Download .json
            </button>
          </div>
          <CodeBlock text={pretty(template)} lang="json" label="JSON template" />
        </div>
      )}

      {tab === 'schema' && schema && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card px-6 py-5">
          <h3 className="text-sm font-bold text-gray-900 m-0">JSON schema Xtrium validates against</h3>
          <p className="text-xs text-gray-500 mt-1 mb-0">Wrong-typed values are rejected exactly like missing ones — no coercion is applied.</p>
          <CodeBlock text={pretty(schema)} lang="json" label="JSON schema" />
        </div>
      )}
    </div>
  )
}
