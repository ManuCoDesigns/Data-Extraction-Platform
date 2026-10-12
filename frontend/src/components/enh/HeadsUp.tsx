import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LinkIcon, MessageCircleQuestion } from 'lucide-react'
import { enhApi } from '@/api/client'
import { LinkChip } from '@/pages/DataHealth'
import { shortAgo } from '@/components/enh/kit'

const BAD = new Set(['login', 'blocked', 'dead', 'error'])

/** Two quiet cards on the work page: link problems on my sources, and answers the client sent on them.
 *  Renders nothing when there is nothing to say. */
export function HeadsUp({ mine }: { mine: Set<string> }) {
  const [links, setLinks] = useState<any[]>([])
  const [answers, setAnswers] = useState<any[]>([])

  useEffect(() => {
    let off = false
    enhApi.links().then((r: any) => { if (!off) setLinks((r.items ?? []).filter((i: any) => mine.has(i.source_id) && BAD.has(i.status) && i.source_status !== 'approved')) }).catch(() => {})
    enhApi.questions({ status: 'answered' }).then((r: any) => {
      const cutoff = Date.now() - 14 * 86400000
      if (!off) setAnswers((r.items ?? []).filter((q: any) => q.source_id && mine.has(q.source_id) && new Date(q.answered_at ?? 0).getTime() >= cutoff))
    }).catch(() => {})
    return () => { off = true }
  }, [mine.size])

  if (!links.length && !answers.length) return null
  return (
    <div className={'grid gap-3 ' + (links.length && answers.length ? 'md:grid-cols-2' : '')}>
      {answers.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-card p-4" aria-label="Answers from the client">
          <h2 className="text-sm font-semibold text-gray-900 m-0 flex items-center gap-2">
            <MessageCircleQuestion className="w-4 h-4 text-emerald-500" /> The client answered {answers.length === 1 ? 'a question' : `${answers.length} questions`}
          </h2>
          <ul className="m-0 mt-2.5 p-0 list-none space-y-2.5">
            {answers.slice(0, 3).map(q => (
              <li key={q.id}>
                <Link to={`/projects/${q.project_id}/sources/${q.source_id}`} className="text-sm font-medium text-gray-800 hover:text-brand-600">{q.source_name}</Link>
                <p className="text-xs text-gray-500 m-0 mt-0.5 line-clamp-2">{q.answer}</p>
                <p className="text-[11px] text-gray-400 m-0 mt-0.5">{shortAgo(q.answered_at)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {links.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-card p-4" aria-label="Links that need attention">
          <h2 className="text-sm font-semibold text-gray-900 m-0 flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-amber-500" /> {links.length === 1 ? 'A website link needs a look' : `${links.length} website links need a look`}
          </h2>
          <ul className="m-0 mt-2.5 p-0 list-none space-y-2">
            {links.slice(0, 4).map(l => (
              <li key={l.source_id} className="flex items-center gap-2">
                <Link to={`/projects/${l.project_id}/sources/${l.source_id}`} className="text-sm text-gray-800 hover:text-brand-600 truncate flex-1 min-w-0">{l.source_name}</Link>
                <LinkChip status={l.status} detail={l.detail} />
              </li>
            ))}
          </ul>
          {links.length > 4 && <Link to="/data-health" className="text-xs font-medium text-brand-600 hover:underline mt-2.5 inline-block">See all {links.length}</Link>}
        </section>
      )}
    </div>
  )
}
