import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Globe, RefreshCw } from 'lucide-react'
import { xtriumApi } from '@/api/client'
import { SopViewer } from '@/components/SopViewer'

// The Xtrium SOP for one source, readable by everyone who can open the source —
// extractors and reviewers as well as admins.
export function SourceSopPage() {
  const { projectId, sourceId } = useParams<{ projectId: string; sourceId: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!sourceId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    xtriumApi.sop(sourceId)
      .then((r: any) => { if (!cancelled) setData(r) })
      .catch((err: any) => {
        if (cancelled) return
        const status = err?.response?.status
        setError(
          status === 403 ? "You don't have access to this source."
            : status === 422 ? "This source wasn't pulled from Xtrium, so it has no Xtrium SOP."
              : err?.response?.data?.detail || "Couldn't load the SOP.",
        )
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sourceId, attempt])

  const back = `/projects/${projectId}/sources/${sourceId}`

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Link to={back} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to source
          </Link>
          <h1 className="text-xl font-extrabold text-gray-900 mt-2 mb-0 truncate">{data?.source_name ?? 'Source SOP'}</h1>
          <p className="text-xs text-gray-400 mt-1 mb-0 flex items-center gap-3 flex-wrap">
            {data?.item_id && <span>Xtrium item #{data.item_id}</span>}
            {data?.website_url && (
              <a href={data.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700">
                <Globe className="w-3 h-3" /> {data.website_url}
              </a>
            )}
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400 m-0">Loading the SOP…</p>}

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}{' '}
          <button onClick={() => setAttempt(a => a + 1)} className="font-semibold underline">Retry</button>
        </div>
      )}

      {!loading && !error && data && data.origin === 'saved' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          Showing the last saved copy{data.saved_at ? ` (saved ${new Date(data.saved_at).toLocaleString()})` : ''}. Xtrium couldn't be reached just now,
          so this may not be their latest version.
        </div>
      )}

      {!loading && !error && data && !data.sop && (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-8 text-center shadow-card">
          <p className="text-sm font-semibold text-gray-800 m-0">No SOP available yet</p>
          <p className="text-sm text-gray-500 mt-1.5 mb-4">
            Xtrium hasn't given us an SOP we can read for this item{data.live_error ? ` (${data.live_error})` : ''}.
            Ask an admin to check the item on the Xtrium dashboard.
          </p>
          <button onClick={() => setAttempt(a => a + 1)}
            className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      )}

      {!loading && !error && data?.sop && <SopViewer data={data} />}
    </div>
  )
}
