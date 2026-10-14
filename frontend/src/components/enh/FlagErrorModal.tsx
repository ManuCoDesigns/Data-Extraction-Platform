import { useEffect, useState } from 'react'
import { qualityApi } from '@/api/client'
import { Button, Modal, Select, Textarea, toast } from '@/components/ui'
import { Chip, type Tone } from '@/components/enh/kit'

export const CATEGORY_OPTIONS = [
  { value: 'wrong_value', label: 'Wrong value', hint: 'The source says something different' },
  { value: 'missing_value', label: 'Missing value', hint: 'The source has it but the record does not' },
  { value: 'unsupported_value', label: 'Not in the source', hint: 'The record has something the source does not say' },
  { value: 'format', label: 'Format', hint: 'Right value, wrong format' },
  { value: 'sop_rule', label: 'SOP rule', hint: 'Breaks a rule in the SOP' },
  { value: 'schema', label: 'Schema', hint: 'Does not fit the schema (type, allowed values)' },
  { value: 'duplicate', label: 'Duplicate', hint: 'Same company appears twice' },
  { value: 'other', label: 'Something else', hint: '' },
]
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: 'System agrees', tone: 'green' }, supported: { label: 'System also sees it', tone: 'green' },
  not_reproduced: { label: 'System cannot see it', tone: 'amber' }, needs_human: { label: 'Needs checking at the source', tone: 'gray' },
}
const STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Waiting for an admin', tone: 'amber' }, confirmed: { label: 'Confirmed', tone: 'green' }, dismissed: { label: 'Dismissed', tone: 'gray' },
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** A reviewer logs a specific error on a record. The system says whether it agrees; an admin settles it. */
export function FlagErrorModal({ record, onClose, onChanged }: { record: { id: string; label: string } | null; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<any>(null)
  const [field, setField] = useState('')
  const [category, setCategory] = useState('wrong_value')
  const [severity, setSeverity] = useState('major')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => { if (record) qualityApi.recordFindings(record.id).then(setData).catch(() => setData({ items: [], fields: [], can_raise: false })) }
  useEffect(() => { setData(null); setField(''); setNote(''); setCategory('wrong_value'); setSeverity('major'); load() }, [record?.id])

  const save = async () => {
    if (!record) return
    setSaving(true)
    try {
      await qualityApi.raise({ record_id: record.id, field: field || undefined, category, severity, note: note.trim() || undefined })
      toast.success('Error logged'); setNote(''); load(); onChanged?.()
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Couldn't log that error") } finally { setSaving(false) }
  }
  const needsNote = ['wrong_value', 'unsupported_value', 'other'].includes(category)
  return (
    <Modal open={!!record} onClose={onClose} title="Flag an error" description={record ? `On ${record.label}. Log one error at a time so it can be counted and checked.` : ''} size="lg">
      {!data ? <div className="h-24 rounded-xl bg-gray-100 animate-pulse" /> : (
        <div className="space-y-5">
          {data.items.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 m-0 mb-2">Already logged on this record</h3>
              <ul className="m-0 p-0 list-none space-y-2 max-h-52 overflow-y-auto">
                {data.items.map((f: any) => (
                  <li key={f.id} className="rounded-xl border border-gray-100 px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="font-semibold text-gray-900">{f.field ?? 'Whole record'}</span>
                      <Chip tone={f.severity === 'critical' ? 'red' : f.severity === 'major' ? 'amber' : 'gray'}>{f.severity}</Chip>
                      <Chip tone="indigo">{f.category_label}</Chip>
                      {f.origin === 'system' && <Chip tone="blue">System check</Chip>}
                      <Chip tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Chip>
                    </div>
                    {f.note && <p className="m-0 text-gray-600">{f.note}</p>}
                    {f.field && <p className="m-0 text-xs text-gray-400 mt-0.5">Record says: {show(f.extracted_value)}{f.truth_value ? `. Source says: ${f.truth_value}` : ''}</p>}
                    {f.origin === 'reviewer' && f.auto_verdict && <p className="m-0 text-xs mt-1"><Chip tone={VERDICT[f.auto_verdict]?.tone ?? 'gray'}>{VERDICT[f.auto_verdict]?.label ?? f.auto_verdict}</Chip> <span className="text-gray-500">{f.auto_note}</span></p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.can_raise ? (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <Select label="Field" value={field} onChange={e => setField(e.target.value)}>
                  <option value="">Whole record</option>
                  {data.fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                </Select>
                <Select label="What kind of error" value={category} onChange={e => setCategory(e.target.value)}>
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <Select label="How serious" value={severity} onChange={e => setSeverity(e.target.value)}>
                  <option value="minor">Minor (cosmetic)</option><option value="major">Major (wrong data)</option><option value="critical">Critical (unusable)</option>
                </Select>
              </div>
              <p className="text-xs text-gray-400 m-0">{CATEGORY_OPTIONS.find(o => o.value === category)?.hint}</p>
              <Textarea rows={3} label={needsNote ? 'What is wrong, and what does the source say?' : 'Note (optional)'} value={note} onChange={e => setNote(e.target.value)}
                placeholder="For example: the source says 2021, the record says 2012." />
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={saving} onClick={save} disabled={needsNote && !note.trim()}>Log error</Button></div>
            </div>
          ) : <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>}
        </div>
      )}
    </Modal>
  )
}
