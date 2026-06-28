/**
 * ExportPreview — Browse all approved records before downloading.
 *
 * Shows a clean folder-style view:
 *   📂 Critical Materials Intelligence
 *     📄 albemarle-corporation.json   ✓ Approved · Submitted
 *     📄 ivanhoe-mines.json           ✓ Approved
 *
 * Users can expand any record to see the full JSON, then download
 * the whole project as a ZIP.
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Download, ChevronRight, ChevronDown, CheckCircle, Folder, FileJson, ArrowLeft, RefreshCw } from 'lucide-react'
import { projectsApi } from '@/api/client'
import { Button, Spinner, EmptyState, Badge, toast } from '@/components/ui'

interface PreviewRecord {
  record_id: string
  canonical_name: string
  company_name: string
  is_submitted: boolean
  fields: Record<string, unknown>
}

interface PreviewSource {
  source_id: string
  source_name: string
  approved_at: string | null
  record_count: number
  records: PreviewRecord[]
}

interface PreviewData {
  project: string
  project_folder: string
  total_sources: number
  total_records: number
  sources: PreviewSource[]
}

export function ExportPreviewPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [data, setData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())
  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const load = async () => {
    if (!projectId) return
    try {
      const result = await projectsApi.exportPreview(projectId)
      setData(result)
      // Auto-expand all sources if there are 5 or fewer
      if (result.sources.length <= 5) {
        setExpandedSources(new Set(result.sources.map((s: PreviewSource) => s.source_id)))
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not load preview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId])

  const toggleSource = (id: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleRecord = (id: string) => {
    setExpandedRecords(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDownloadAll = async () => {
    if (!projectId || !data) return
    setDownloading(true)
    try {
      await projectsApi.exportProject(projectId, 'approved',
        `${data.project_folder}_approved_${new Date().toISOString().slice(0, 10)}.zip`)
      toast.success(`Downloaded — ${data.project_folder}/ folder with ${data.total_records} records`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Download failed')
    } finally {
      setDownloading(false) }
  }

  const handleDownloadRecord = (record: PreviewRecord) => {
    const json = JSON.stringify(record.fields, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${record.canonical_name}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Downloaded ${record.canonical_name}.json`)
  }

  const filteredSources = (data?.sources || []).filter(s =>
    !searchQuery ||
    s.source_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.records.some(r => r.canonical_name.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Spinner className="w-8 h-8" />
      <p className="text-sm text-gray-500">Loading approved records…</p>
    </div>
  )

  if (!data || data.total_sources === 0) return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to={`/projects/${projectId}`} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Project
      </Link>
      <EmptyState
        title="No approved sources yet"
        description="Complete the workflow for at least one source: Upload → Review → Approve. Approved records will appear here ready for download."
      />
    </div>
  )

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to={`/projects/${projectId}`} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Project
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Folder className="w-6 h-6 text-amber-500" />
            {data.project}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {data.total_sources} approved source{data.total_sources !== 1 ? 's' : ''} · {data.total_records} record{data.total_records !== 1 ? 's' : ''} ready for download
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button size="sm" loading={downloading} onClick={handleDownloadAll}
            style={{ background: '#10b981', border: 'none', color: '#fff', padding: '8px 20px' }}>
            <Download className="w-4 h-4" />
            Download All ({data.total_records} records)
          </Button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search sources or companies…"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        style={{
          width: '100%', padding: '10px 16px', border: '1px solid #e2e8f0',
          borderRadius: 10, fontSize: 14, outline: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      />

      {/* Folder view */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

        {/* Project folder header */}
        <div style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Folder size={20} color="#f59e0b" fill="#fde68a" />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', fontFamily: 'var(--font-mono)' }}>
            📂 {data.project_folder}/
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
            {data.total_records} .json files
          </span>
        </div>

        {/* Sources */}
        {filteredSources.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            No sources match your search
          </div>
        )}
        {filteredSources.map((source, si) => {
          const isExpanded = expandedSources.has(source.source_id)
          return (
            <div key={source.source_id} style={{ borderBottom: si < filteredSources.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              {/* Source row */}
              <div
                onClick={() => toggleSource(source.source_id)}
                style={{
                  padding: '12px 20px 12px 28px', display: 'flex', alignItems: 'center',
                  gap: 10, cursor: 'pointer', background: isExpanded ? '#f0fdf4' : '#fff',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '#f8fafc' }}
                onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '#fff' }}
              >
                {isExpanded ? <ChevronDown size={14} color="#94a3b8" /> : <ChevronRight size={14} color="#94a3b8" />}
                <Folder size={16} color={isExpanded ? '#10b981' : '#94a3b8'} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{source.source_name}</span>
                <span style={{ fontSize: 10, background: '#ecfdf5', color: '#059669', border: '1px solid #6ee7b7', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>✓ Approved</span>
                <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
                  {source.record_count} record{source.record_count !== 1 ? 's' : ''}
                  {source.approved_at && ` · ${new Date(source.approved_at).toLocaleDateString()}`}
                </span>
              </div>

              {/* Records inside source */}
              {isExpanded && source.records.map((record, ri) => {
                const isRecordExpanded = expandedRecords.has(record.record_id)
                return (
                  <div key={record.record_id}>
                    <div
                      style={{
                        padding: '10px 20px 10px 56px', display: 'flex', alignItems: 'center',
                        gap: 10, background: '#f9fafb', borderTop: '1px solid #f1f5f9',
                        cursor: 'pointer',
                      }}
                    >
                      <button
                        onClick={() => toggleRecord(record.record_id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                      >
                        {isRecordExpanded ? <ChevronDown size={12} color="#94a3b8" /> : <ChevronRight size={12} color="#94a3b8" />}
                        <FileJson size={14} color="#6366f1" />
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#1e293b', fontWeight: 500 }}>
                          {record.canonical_name}.json
                        </span>
                        {record.is_submitted && (
                          <span style={{ fontSize: 10, background: '#ecfdf5', color: '#059669', border: '1px solid #6ee7b7', padding: '1px 6px', borderRadius: 20, fontWeight: 700 }}>
                            🚀 Submitted
                          </span>
                        )}
                        {!record.is_submitted && (
                          <span style={{ fontSize: 10, background: '#eff6ff', color: '#3b82f6', border: '1px solid #93c5fd', padding: '1px 6px', borderRadius: 20 }}>
                            ✓ Approved
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => handleDownloadRecord(record)}
                        style={{ padding: '3px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: '#64748b', flexShrink: 0 }}
                        title={`Download ${record.canonical_name}.json`}
                      >
                        <Download size={11} /> .json
                      </button>
                    </div>

                    {/* Expanded JSON preview */}
                    {isRecordExpanded && (
                      <div style={{ padding: '0 20px 12px 56px', background: '#f9fafb', borderTop: '1px solid #f1f5f9' }}>
                        <div style={{ background: '#0f172a', borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ padding: '8px 16px', background: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: '#7dd3fc', fontFamily: 'var(--font-mono)' }}>
                              {record.canonical_name}.json
                            </span>
                            <span style={{ fontSize: 10, color: '#475569' }}>
                              {Object.keys(record.fields).length} fields
                            </span>
                          </div>
                          <pre style={{
                            margin: 0, padding: '12px 16px', fontSize: 11, lineHeight: 1.7,
                            color: '#e2e8f0', fontFamily: 'var(--font-mono)', overflowX: 'auto',
                            maxHeight: 400, overflowY: 'auto',
                          }}>
                            {JSON.stringify(record.fields, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Footer */}
        <div style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            📂 {data.project_folder} · {data.total_records} files · combined.json + README.md included in ZIP
          </span>
          <Button size="sm" loading={downloading} onClick={handleDownloadAll}
            style={{ background: '#10b981', border: 'none', color: '#fff' }}>
            <Download className="w-3.5 h-3.5" /> Download ZIP
          </Button>
        </div>
      </div>
    </div>
  )
}
