/**
 * JsonEditor — Monaco-powered JSON editor for Xtrium DataOps
 *
 * Extractor role: fully editable tree + code view, validates before save, highlights changes
 * Reviewer role: read-only, can dismiss incorrect LLM flags
 *
 * Features:
 *   - Monaco Editor (VS Code engine) with JSON syntax highlighting
 *   - Tree view / Code view toggle
 *   - Expand All / Collapse All
 *   - Ctrl+F search built into Monaco
 *   - Validation before save (no invalid JSON ever saved)
 *   - Modified field highlighting (yellow gutter markers)
 *   - Dismiss LLM web flags individually
 *   - Role-aware: extractor = editable, reviewer = read-only
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react'
import { Save, RotateCcw, Code, List, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, X, Eye, EyeOff, Globe } from 'lucide-react'
import { toast } from '@/components/ui'
import type { ExtractedRecord } from '@/types'
import { sourcesApi } from '@/api/client'

interface Props {
  record: ExtractedRecord
  sourceId: string
  canEdit: boolean
  onSave: (fields: Record<string, unknown>) => Promise<void>
  onClose?: () => void
}

type ViewMode = 'code' | 'tree'

// ── Tree node renderer (read-only preview when not in code mode) ──────────────
function TreeNode({
  k, value, depth, original, modified
}: {
  k: string | null; value: unknown; depth: number
  original: unknown; modified: Record<string, boolean>
}) {
  const [open, setOpen] = useState(depth < 2)
  const isObj = value !== null && typeof value === 'object'
  const isArr = Array.isArray(value)
  const isModified = k !== null && modified[k]
  const indent = depth * 20

  const scalar = (v: unknown) => {
    if (v === null) return <span style={{ color: '#94a3b8' }}>null</span>
    if (typeof v === 'boolean') return <span style={{ color: '#60a5fa' }}>{String(v)}</span>
    if (typeof v === 'number') return <span style={{ color: '#34d399' }}>{v}</span>
    const s = String(v)
    const display = s.length > 120 ? s.slice(0, 120) + '…' : s
    return <span style={{ color: '#fca5a5' }}>"{display}"</span>
  }

  if (!isObj) {
    return (
      <div style={{ paddingLeft: indent, display: 'flex', gap: 8, alignItems: 'baseline', minHeight: 22, background: isModified ? '#fef9c3' : 'transparent' }}>
        {k !== null && <span style={{ color: '#93c5fd', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{k}:</span>}
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{scalar(value)}</span>
        {isModified && <span style={{ fontSize: 9, background: '#f59e0b', color: '#fff', padding: '0 5px', borderRadius: 3, fontWeight: 700 }}>EDITED</span>}
      </div>
    )
  }

  const entries = isArr ? value.map((v, i) => [String(i), v] as [string, unknown]) : Object.entries(value as Record<string, unknown>)
  const bracket = isArr ? ['[', ']'] : ['{', '}']

  return (
    <div style={{ background: isModified ? '#fef9c3' : 'transparent' }}>
      <div style={{ paddingLeft: indent, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minHeight: 22 }} onClick={() => setOpen(o => !o)}>
        <span style={{ color: '#64748b', fontSize: 10 }}>{open ? '▼' : '▶'}</span>
        {k !== null && <span style={{ color: '#93c5fd', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{k}:</span>}
        <span style={{ color: '#fbbf24', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{bracket[0]}</span>
        {!open && <span style={{ color: '#475569', fontSize: 11 }}>{entries.length} {isArr ? 'items' : 'keys'}</span>}
        {!open && <span style={{ color: '#fbbf24', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{bracket[1]}</span>}
        {isModified && open && <span style={{ fontSize: 9, background: '#f59e0b', color: '#fff', padding: '0 5px', borderRadius: 3, fontWeight: 700 }}>EDITED</span>}
      </div>
      {open && (
        <>
          {entries.map(([ek, ev]) => (
            <TreeNode key={ek} k={isArr ? null : ek} value={ev} depth={depth + 1}
              original={(original as Record<string, unknown>)?.[ek]} modified={modified} />
          ))}
          <div style={{ paddingLeft: indent }}>
            <span style={{ color: '#fbbf24', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{bracket[1]}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main JsonEditor ───────────────────────────────────────────────────────────
export function JsonEditor({ record, sourceId, canEdit, onSave, onClose }: Props) {
  const original = record.extracted_fields || {}
  const [draft, setDraft] = useState(() => JSON.stringify(original, null, 2))
  const [mode, setMode] = useState<ViewMode>('code')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [modifiedKeys, setModifiedKeys] = useState<Record<string, boolean>>({})
  const [webFlags, setWebFlags] = useState<any[]>(record.web_check_flags || [])
  const [dismissingIdx, setDismissingIdx] = useState<number | null>(null)
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<Monaco | null>(null)

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    // Enable Ctrl+F search
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      editor.getAction('actions.find')?.run()
    })
  }

  const handleChange = useCallback((val: string | undefined) => {
    const v = val ?? ''
    setDraft(v)
    try {
      const parsed = JSON.parse(v)
      setError(null)
      // Detect modified top-level keys
      const mods: Record<string, boolean> = {}
      for (const k of Object.keys(parsed)) {
        if (JSON.stringify(parsed[k]) !== JSON.stringify((original as Record<string, unknown>)[k])) {
          mods[k] = true
        }
      }
      setModifiedKeys(mods)
      setIsDirty(Object.keys(mods).length > 0)
    } catch (e: any) {
      setError(e.message)
      setIsDirty(true)
    }
  }, [original])

  const handleSave = async () => {
    if (error) { toast.error('Fix JSON errors before saving'); return }
    setSaving(true)
    try {
      const parsed = JSON.parse(draft)
      await onSave(parsed)
      setIsDirty(false)
      setModifiedKeys({})
      toast.success('Record saved')
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally { setSaving(false) }
  }

  const handleReset = () => {
    setDraft(JSON.stringify(original, null, 2))
    setError(null)
    setIsDirty(false)
    setModifiedKeys({})
  }

  const expandAll = () => editorRef.current?.getAction('editor.unfoldAll')?.run()
  const collapseAll = () => editorRef.current?.getAction('editor.foldAll')?.run()

  const dismissFlag = async (idx: number) => {
    setDismissingIdx(idx)
    try {
      await sourcesApi.dismissFlag(sourceId, record.id, idx)
      setWebFlags(prev => prev.filter((_, i) => i !== idx))
      toast.success('Flag dismissed — LLM was wrong on this one')
    } catch {
      toast.error('Could not dismiss flag')
    } finally { setDismissingIdx(null) }
  }

  const modifiedCount = Object.keys(modifiedKeys).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>

        {/* Mode toggle */}
        <div style={{ display: 'flex', background: '#0f172a', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
          {(['code', 'tree'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: mode === m ? '#3b82f6' : 'transparent',
              color: mode === m ? '#fff' : '#64748b', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              {m === 'code' ? <Code size={12} /> : <List size={12} />}
              {m === 'code' ? 'Code' : 'Tree'}
            </button>
          ))}
        </div>

        {/* Expand/Collapse (code mode only) */}
        {mode === 'code' && (
          <>
            <button onClick={expandAll} style={{ padding: '5px 10px', background: '#1e3a5f', border: '1px solid #2563eb40', borderRadius: 6, color: '#7dd3fc', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ChevronDown size={11} /> Expand All
            </button>
            <button onClick={collapseAll} style={{ padding: '5px 10px', background: '#1e3a5f', border: '1px solid #2563eb40', borderRadius: 6, color: '#7dd3fc', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ChevronUp size={11} /> Collapse All
            </button>
          </>
        )}

        {/* Modified indicator */}
        {modifiedCount > 0 && !error && (
          <span style={{ fontSize: 11, background: '#fef9c3', color: '#92400e', padding: '3px 10px', borderRadius: 20, fontWeight: 600, border: '1px solid #fcd34d' }}>
            ✏ {modifiedCount} field{modifiedCount > 1 ? 's' : ''} modified
          </span>
        )}

        {/* Validation error */}
        {error && (
          <span style={{ fontSize: 11, background: '#fef2f2', color: '#dc2626', padding: '3px 10px', borderRadius: 20, fontWeight: 600, border: '1px solid #fca5a5', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ✗ {error}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Role badge */}
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: canEdit ? '#ecfdf5' : '#f0f9ff', color: canEdit ? '#059669' : '#0369a1', border: `1px solid ${canEdit ? '#6ee7b7' : '#7dd3fc'}`, fontWeight: 700 }}>
          {canEdit ? '✏ Extractor — Editable' : '👁 Reviewer — Read Only'}
        </span>

        {/* Action buttons */}
        {canEdit && (
          <>
            <button onClick={handleReset} disabled={!isDirty}
              style={{ padding: '5px 12px', background: 'transparent', border: '1px solid #475569', borderRadius: 6, color: '#94a3b8', fontSize: 12, cursor: isDirty ? 'pointer' : 'not-allowed', opacity: isDirty ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 5 }}>
              <RotateCcw size={12} /> Reset
            </button>
            <button onClick={handleSave} disabled={saving || !!error || !isDirty}
              style={{ padding: '5px 14px', background: (!error && isDirty) ? '#10b981' : '#1e293b', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700, cursor: (!error && isDirty) ? 'pointer' : 'not-allowed', opacity: (!error && isDirty) ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Save size={12} /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        )}
      </div>

      {/* ── Web flags panel ─────────────────────────────────────────────────── */}
      {webFlags.length > 0 && (
        <div style={{ background: '#1c1917', borderBottom: '1px solid #44403c', padding: '10px 16px', flexShrink: 0, maxHeight: 180, overflow: 'auto' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#fb923c', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Globe size={11} /> LLM Web Flags ({webFlags.length}) — click Dismiss if the flag is incorrect
          </p>
          {webFlags.map((f: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, padding: '8px 12px', background: '#292524', borderRadius: 8, border: '1px solid #57534e' }}>
              <AlertTriangle size={13} color="#f97316" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#fbbf24', fontWeight: 600 }}>{f.field}</span>
                <span style={{ fontSize: 12, color: '#a8a29e', marginLeft: 8 }}>{f.issue}</span>
                {f.suggested_value && (
                  <span style={{ fontSize: 11, color: '#34d399', marginLeft: 8 }}>→ {f.suggested_value}</span>
                )}
              </div>
              <button onClick={() => dismissFlag(i)} disabled={dismissingIdx === i}
                style={{ flexShrink: 0, padding: '3px 10px', background: '#292524', border: '1px solid #57534e', borderRadius: 6, color: '#a8a29e', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                title="Dismiss this flag — the LLM was wrong">
                {dismissingIdx === i ? '…' : <><X size={10} /> Dismiss</>}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Editor body ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {mode === 'code' ? (
          <Editor
            height="100%"
            language="json"
            theme="vs-dark"
            value={draft}
            onChange={canEdit ? handleChange : undefined}
            onMount={handleEditorMount}
            options={{
              readOnly: !canEdit,
              minimap: { enabled: true },
              lineNumbers: 'on',
              folding: true,
              foldingStrategy: 'auto',
              wordWrap: 'on',
              formatOnPaste: true,
              formatOnType: true,
              scrollBeyondLastLine: false,
              renderLineHighlight: 'all',
              fontSize: 13,
              fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
              fontLigatures: true,
              tabSize: 2,
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              scrollbar: { useShadows: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              suggest: { showWords: false },
              quickSuggestions: false,
              occurrencesHighlight: 'off',
              find: { addExtraSpaceOnTop: false },
            }}
          />
        ) : (
          /* Tree view */
          <div style={{ height: '100%', overflow: 'auto', padding: '12px 16px', background: '#0f172a' }}>
            {(() => {
              try {
                const parsed = JSON.parse(draft)
                return (
                  <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                    <TreeNode k={null} value={parsed} depth={0} original={original} modified={modifiedKeys} />
                  </div>
                )
              } catch {
                return <div style={{ color: '#f87171', fontSize: 12, padding: 16 }}>⚠ Invalid JSON — switch to Code view to fix the error</div>
              }
            })()}
          </div>
        )}

        {/* Read-only overlay badge */}
        {!canEdit && (
          <div style={{ position: 'absolute', bottom: 16, right: 16, background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
            <Eye size={13} color="#60a5fa" />
            <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 600 }}>Read-only — Reviewer Mode</span>
          </div>
        )}
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#1e293b', borderTop: '1px solid #334155', padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: error ? '#ef4444' : '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
          {error ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
          {error ? 'Invalid JSON' : 'Valid JSON'}
        </span>
        <span style={{ fontSize: 11, color: '#475569' }}>
          {Object.keys(typeof draft === 'string' ? (() => { try { return JSON.parse(draft) } catch { return {} } })() : {}).length} fields
        </span>
        {isDirty && canEdit && (
          <span style={{ fontSize: 11, color: '#f59e0b' }}>● Unsaved changes</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#334155' }}>Ctrl+F to search  ·  Ctrl+Z to undo  ·  Ctrl+Shift+F to format</span>
      </div>
    </div>
  )
}
