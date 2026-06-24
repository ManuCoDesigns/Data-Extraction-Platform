import { useState } from 'react'
import {
  BookOpen, Database, Layers, Users, FolderKanban, Upload,
  CheckCircle, Shield, Download, ChevronDown, ChevronRight,
  FileJson, Globe, Zap, AlertTriangle, Eye, ArrowRight,
  Code2, FileText, FileSpreadsheet, Archive, Brain, Search
} from 'lucide-react'
import { Card, Badge, cn } from '@/components/ui'

// ─── Types ───────────────────────────────────────────────────────────────────
interface Step {
  number: number
  title: string
  who: string
  whoColor: 'red' | 'green' | 'purple' | 'blue' | 'amber'
  description: string
  details: string[]
  tip?: string
}

// ─── Data ────────────────────────────────────────────────────────────────────
const WORKFLOW_STEPS: Step[] = [
  {
    number: 1,
    title: 'Create a Project',
    who: 'Admin',
    whoColor: 'red',
    description: 'Every dataset lives inside a project. A project groups related sources, schemas, and team members.',
    details: [
      'Go to Projects → New Project',
      'Give it a clear name (e.g. "BGS Supplier Data 2025" or "NASA Materials Q3")',
      'Add team members via the Members tab — assign each person their role (Extractor, Reviewer, etc.)',
    ],
    tip: 'One project per data contract or client is a good rule of thumb.',
  },
  {
    number: 2,
    title: 'Define a Schema',
    who: 'Admin',
    whoColor: 'red',
    description: 'A schema defines what a valid record looks like — field names, types, required fields, allowed values, and extraction rules for the AI.',
    details: [
      'Go to Schemas → New Schema, pick the project',
      'Write the definition as JSON — each field needs: name, type (string / integer / boolean), required (true/false)',
      'Add description to each field so extractors and the AI know what to look for',
      'Add enum to restrict values (e.g. industry_sector can only be "construction minerals", "industrial minerals", etc.)',
      'Add extraction_instructions at the top level — these are the SOP rules the AI follows word-for-word',
      'Add fixed_value on fields that should always be the same (e.g. is_verified: false)',
    ],
    tip: 'Example schema field: {"name": "supply_chain_tier", "type": "integer", "required": true, "description": "1 for extraction sites (quarries/mines), 2 for processing/handling"}',
  },
  {
    number: 3,
    title: 'Create a Source',
    who: 'Admin',
    whoColor: 'red',
    description: 'A source is one dataset you\'re tracking — one website, one directory, one PDF. Create one per dataset.',
    details: [
      'Go to Sources → New Source (or open a project and click Sources Board)',
      'Pick the project and schema for this source',
      'Add the website URL — this is used for auto-scraping and LLM verification later',
      'Assign an Extractor (the person who will pull and upload the data)',
      'Assign a Reviewer (the person who will check the extracted data)',
      'The source starts in "Not Started" status automatically',
    ],
    tip: 'If you assign an Extractor when creating the source, it automatically moves to "Extracting" status.',
  },
  {
    number: 4,
    title: 'Extract the Data',
    who: 'Extractor',
    whoColor: 'green',
    description: 'The extractor pulls data from the source website using whatever method works — a Python script, manual copy, or the built-in auto-scrape.',
    details: [
      'Option A — Auto-Scrape: open the source, click "Auto-Scrape Website" — the AI fetches the page and extracts records automatically',
      'Option B — Upload a file: run your extractor script, save output as JSON/CSV/Excel, then upload via the Upload button',
      'Option C — Upload a ZIP: if your script outputs one JSON file per operator/supplier, zip them all and upload the ZIP',
      'After upload, the tool validates every row against the schema and shows exactly which fields are wrong and why',
      'Fix validation errors using the inline editor — click any record to open the JSON viewer, click any field value to edit it',
      'Once every record passes schema validation, the source automatically moves to "Ready for Review"',
    ],
    tip: 'Your extractor script can output {"company_name": "...", "canonical_name": "..."} objects — one per company. Wrap them in an array for batch upload.',
  },
  {
    number: 5,
    title: 'Review the Records',
    who: 'Reviewer',
    whoColor: 'purple',
    description: 'The reviewer opens each record, checks the extracted values against the source website, and either approves or sends it back.',
    details: [
      'Open the source → click any record row to open the JSON viewer',
      'The schema reference panel on the right shows the rules for every field — use it to know what values are valid',
      'Open the source website URL in a new tab to cross-reference field values',
      'Approve: if the record looks correct — click Approve at the bottom, the viewer advances to the next record automatically',
      'Send back: if something is wrong — click Send Back, add a note explaining what needs fixing, the Extractor is notified',
      'Fix yourself: click any value in the JSON viewer to edit it inline, save, then approve',
      'Once every record is approved, click "Approve Source" to finalize the whole source',
    ],
    tip: 'Use the Prev / Next buttons to move through records without returning to the list. Press Escape to exit the viewer.',
  },
  {
    number: 6,
    title: 'LLM Verification (optional)',
    who: 'Reviewer',
    whoColor: 'purple',
    description: 'After human review, run the AI cross-check to automatically compare every record against the live source website.',
    details: [
      'Click "LLM Verify vs Website" on the source detail page',
      'The AI fetches the source website, reads it, and checks each extracted record field by field',
      'Flagged records show exactly which field is wrong and what the website says it should be',
      'A "use this →" button lets you apply the AI\'s suggestion with one click',
      'Records that pass the AI check get a green "website verified" badge',
      'This stage is optional — you can approve a source and skip it if you\'re confident in the data',
    ],
    tip: 'LLM verification works best on server-rendered pages. JavaScript-heavy SPAs may return limited content.',
  },
  {
    number: 7,
    title: 'Export the Package',
    who: 'Admin',
    whoColor: 'red',
    description: 'Once a source is approved, export the complete data package — JSON, raw upload, and a cover sheet.',
    details: [
      'On the source detail page, click "Export Package"',
      'You receive a ZIP file containing three things:',
      '  1. data.json — all approved records in structured JSON format matching the schema',
      '  2. The original raw file that was uploaded (CSV, Excel, PDF, etc.)',
      '  3. COVER_SHEET.md — a readme with the schema name, record counts, extractor name, reviewer name, timestamps, and any notes',
      'The cover sheet records exactly how long extraction and review took',
    ],
    tip: 'Only approved sources can be exported. The Export button is hidden until the source reaches "Approved" status.',
  },
]

const ROLES = [
  {
    role: 'Admin',
    color: 'red' as const,
    icon: Shield,
    can: [
      'Create and delete projects, schemas, sources',
      'Add and remove team members, change roles',
      'See all sources across all projects',
      'View team performance dashboard',
      'Export approved data packages',
      'Reassign extractors and reviewers',
    ],
  },
  {
    role: 'Project Admin',
    color: 'amber' as const,
    icon: FolderKanban,
    can: [
      'Manage one project — same as Admin within that project',
      'Create sources and schemas inside the project',
      'Add/remove project members',
    ],
  },
  {
    role: 'Extractor',
    color: 'green' as const,
    icon: Upload,
    can: [
      'See sources assigned to them',
      'Upload files (JSON, CSV, Excel, PDF, ZIP)',
      'Use Auto-Scrape on the source website',
      'Fix validation errors on records',
      'Add notes and assumptions to a source',
    ],
  },
  {
    role: 'Reviewer',
    color: 'purple' as const,
    icon: Eye,
    can: [
      'See sources assigned for review',
      'Open and inspect every record in the JSON viewer',
      'Approve or send back individual records',
      'Fix record values themselves in the viewer',
      'Run LLM verification against the source website',
      'Approve the whole source once all records pass',
    ],
  },
  {
    role: 'QA Lead',
    color: 'blue' as const,
    icon: CheckCircle,
    can: [
      'Review any source in any project (not just assigned ones)',
      'Same review capabilities as Reviewer, but cross-project',
    ],
  },
  {
    role: 'Read Only',
    color: 'gray' as const,
    icon: BookOpen,
    can: [
      'View projects, sources, and records',
      'Cannot upload, edit, approve, or export anything',
    ],
  },
]

const FILE_TYPES = [
  { ext: 'ZIP', icon: Archive, color: 'indigo', desc: 'Bundle of JSON files from your extractor script — all processed at once. README and .DS_Store are ignored automatically.' },
  { ext: 'JSON', icon: FileJson, color: 'green', desc: 'Array of records [{...}, {...}] or a single record object. Also accepts {"items": [...]} or {"records": [...]} wrappers.' },
  { ext: 'CSV / Excel', icon: FileSpreadsheet, color: 'amber', desc: 'Spreadsheet where each row is one record. Column headers must match the schema field names.' },
  { ext: 'PDF', icon: FileText, color: 'purple', desc: 'Raw document. Claude reads the PDF and extracts records automatically using the schema\'s extraction_instructions.' },
  { ext: 'TXT', icon: FileText, color: 'purple', desc: 'Plain text dump from a website or script output. Claude extracts structured records using the schema rules.' },
]

const BADGE_COLOR: Record<string, 'red'|'amber'|'green'|'purple'|'blue'|'gray'|'indigo'> = {
  red: 'red', amber: 'amber', green: 'green', purple: 'purple',
  blue: 'blue', gray: 'gray', brand: 'indigo', indigo: 'indigo',
}

// ─── Components ───────────────────────────────────────────────────────────────
function WorkflowStep({ step, isLast }: { step: Step; isLast: boolean }) {
  const [open, setOpen] = useState(step.number <= 3)

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-6 top-16 bottom-0 w-px bg-gray-200 -mb-4" />
      )}

      <div className="flex gap-4">
        {/* Step badge */}
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center font-bold text-gray-600 text-sm z-10">
          {step.number}
        </div>

        <Card className={cn('flex-1 overflow-hidden transition-all mb-4', open && 'shadow-sm')}>
          <button
            onClick={() => setOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition text-left"
          >
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900">{step.title}</p>
                  <Badge variant={BADGE_COLOR[step.whoColor]}>{step.who}</Badge>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{step.description}</p>
              </div>
            </div>
            {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
          </button>

          {open && (
            <div className="px-5 pb-5 border-t border-gray-50">
              <ul className="mt-4 space-y-2">
                {step.details.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
              {step.tip && (
                <div className="mt-4 flex items-start gap-2 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
                  <Zap className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-brand-700"><strong>Tip: </strong>{step.tip}</p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

type SectionKey = 'workflow' | 'roles' | 'files' | 'schema' | 'faq'

// ─── Main page ────────────────────────────────────────────────────────────────
export function HelpPage() {
  const [activeSection, setActiveSection] = useState<SectionKey>('workflow')

  const sections: { key: SectionKey; label: string; icon: React.ElementType }[] = [
    { key: 'workflow', label: 'How It Works', icon: ArrowRight },
    { key: 'roles',    label: 'Roles & Access', icon: Users },
    { key: 'files',    label: 'File Formats', icon: FileJson },
    { key: 'schema',   label: 'Schema Format', icon: Code2 },
    { key: 'faq',      label: 'FAQ', icon: BookOpen },
  ]

  return (
    <div className="flex min-h-full">
      {/* Sidebar */}
      <nav className="w-52 shrink-0 border-r border-gray-100 bg-white p-4 space-y-1 sticky top-0 h-screen overflow-y-auto">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-3">Help Center</p>
        {sections.map(s => {
          const Icon = s.icon
          return (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition text-left',
                activeSection === s.key
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {s.label}
            </button>
          )
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 max-w-3xl">

        {activeSection === 'workflow' && (
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">How Xtrium DataOps Works</h1>
            <p className="text-gray-500 mb-8">
              Xtrium tracks datasets through a structured pipeline from raw extraction to approved, exportable JSON.
              Follow these steps for every new dataset you work on.
            </p>

            {/* Visual pipeline */}
            <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8">
              {['Create Project', 'Define Schema', 'Create Source', 'Extract Data', 'Review', 'LLM Verify', 'Export'].map((s, i, arr) => (
                <div key={s} className="flex items-center gap-2 shrink-0">
                  <div className="px-3 py-2 bg-gray-100 rounded-lg text-xs font-medium text-gray-700 whitespace-nowrap">
                    {i + 1}. {s}
                  </div>
                  {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />}
                </div>
              ))}
            </div>

            {WORKFLOW_STEPS.map((step, i) => (
              <WorkflowStep key={step.number} step={step} isLast={i === WORKFLOW_STEPS.length - 1} />
            ))}
          </div>
        )}

        {activeSection === 'roles' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Roles & Access</h1>
              <p className="text-gray-500 mt-1">Each user has one global role. Roles control what they can see and do across the entire platform.</p>
            </div>
            {ROLES.map(r => {
              const Icon = r.icon
              return (
                <Card key={r.role} className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{r.role}</h3>
                        <Badge variant={BADGE_COLOR[r.color]}>{r.role}</Badge>
                      </div>
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {r.can.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                        <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </Card>
              )
            })}
          </div>
        )}

        {activeSection === 'files' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Supported File Formats</h1>
              <p className="text-gray-500 mt-1">You can upload data to a source in any of these formats. The tool picks the right processing path automatically.</p>
            </div>
            {FILE_TYPES.map(f => {
              const Icon = f.icon
              return (
                <Card key={f.ext} className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono font-bold text-gray-900">.{f.ext.toLowerCase().replace(' / excel', '.xlsx')}</span>
                        <Badge variant={BADGE_COLOR[f.color]}>{f.ext}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
                    </div>
                  </div>
                </Card>
              )
            })}

            <Card className="p-5 bg-purple-50 border-purple-100">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-purple-900 mb-1">AI Extraction (PDF & TXT)</p>
                  <p className="text-sm text-purple-700 leading-relaxed">
                    When you upload a PDF or TXT file, Claude reads the entire document and extracts structured records
                    matching the schema automatically. The AI uses your schema's <code className="bg-purple-100 px-1 rounded">extraction_instructions</code> field
                    word-for-word, so the better your instructions, the better the extraction.
                    This typically takes 10–30 seconds. Large documents are truncated to 80,000 characters.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5 bg-brand-50 border-brand-100">
              <div className="flex items-start gap-3">
                <Globe className="w-5 h-5 text-brand-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-brand-900 mb-1">Auto-Scrape Website</p>
                  <p className="text-sm text-brand-700 leading-relaxed">
                    Instead of uploading a file, click "Auto-Scrape Website" on a source that has a URL set.
                    The tool fetches the live page, strips HTML, and runs AI extraction — same as uploading a TXT file.
                    Works best on server-rendered pages (most government and industry directories). JavaScript-heavy
                    SPAs may return limited content.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeSection === 'schema' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Schema Format Reference</h1>
              <p className="text-gray-500 mt-1">Schemas are defined as JSON. Here's the full structure with every option.</p>
            </div>

            <Card className="p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Full Schema Template</h3>
              <pre className="bg-gray-950 text-gray-100 rounded-xl p-4 text-xs overflow-x-auto leading-relaxed">{`{
  "name": "BGS Supplier Graph Schema",
  "grouping_key": "company_name",
  "extraction_instructions": "Create ONE record per unique company.
    Group all sites for the same company together.
    Use the exact company name as printed, not abbreviations.",
  "fields": [
    {
      "name": "company_name",
      "type": "string",
      "required": true,
      "description": "Full legal company name as printed in the source"
    },
    {
      "name": "canonical_name",
      "type": "string",
      "required": true,
      "description": "Lowercase, spaces to hyphens, & to 'and', remove punctuation.
        e.g. 'Tarmac Ltd' → 'tarmac-ltd'"
    },
    {
      "name": "supply_chain_tier",
      "type": "integer",
      "required": true,
      "description": "1 for extraction sites (quarries/mines), 2 for processing"
    },
    {
      "name": "industry_sector",
      "type": "string",
      "required": true,
      "enum": [
        "construction minerals",
        "industrial minerals",
        "building stone",
        "cement and lime",
        "metals mining",
        "recycled aggregates",
        "peat"
      ]
    },
    {
      "name": "website",
      "type": "string",
      "required": false,
      "description": "Company website URL, or null if not found"
    },
    {
      "name": "is_verified",
      "type": "boolean",
      "required": true,
      "fixed_value": false
    }
  ]
}`}</pre>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Field Types</h3>
              <div className="space-y-2">
                {[
                  { type: 'string', desc: 'Any text value. Trimmed of whitespace.' },
                  { type: 'integer', desc: 'Whole numbers only. Decimals are rejected.' },
                  { type: 'number', desc: 'Decimal numbers allowed (e.g. 1.5).' },
                  { type: 'boolean', desc: 'true or false.' },
                  { type: 'array', desc: 'A list of values. Useful for multi-value fields like sites or products.' },
                ].map(f => (
                  <div key={f.type} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <code className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-xs font-mono shrink-0 mt-0.5">{f.type}</code>
                    <p className="text-sm text-gray-600">{f.desc}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Special Field Options</h3>
              <div className="space-y-3">
                {[
                  { prop: 'required: true', desc: 'Record is invalid if this field is missing or null.' },
                  { prop: 'enum: [...]', desc: 'Value must be one of the listed strings. Record is invalid if it doesn\'t match.' },
                  { prop: 'fixed_value: false', desc: 'Always set to this exact value, regardless of what the source says. AI will not try to extract it.' },
                  { prop: 'description: "..."', desc: 'Explains to the AI (and human extractors) what this field means and how to extract it. More detail = better AI extraction.' },
                ].map(f => (
                  <div key={f.prop} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <code className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-xs font-mono shrink-0">{f.prop}</code>
                    <p className="text-sm text-gray-600">{f.desc}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {activeSection === 'faq' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-gray-900">Frequently Asked Questions</h1>

            {[
              {
                q: 'Can I upload an Excel file and get JSON output?',
                a: 'Yes. Upload your Excel file (.xlsx or .xls) where each row is a record and column headers match the schema field names. The tool maps each row to the schema, validates it, and when you export the approved source you get data.json with all approved records in proper structured JSON.',
              },
              {
                q: 'My schema dropdown is empty when creating a source — why?',
                a: 'You need to create a schema in the project first, before creating a source. Go to Schemas, click New Schema, pick the project, and define your fields. Then come back to Sources and create the source — the schema will appear in the dropdown.',
              },
              {
                q: 'Can multiple extractors upload to the same source?',
                a: 'Currently one extractor is assigned per source. Re-uploading replaces all previous records. If you need multiple people to contribute, have them merge their files into one ZIP and upload the ZIP.',
              },
              {
                q: 'What happens when I send a record back?',
                a: 'The source moves back to "Changes Requested" status. The assigned extractor receives a notification. They can see which records were sent back, read your note, and fix the values in the JSON viewer. Once fixed, the source can be re-reviewed.',
              },
              {
                q: 'The auto-scrape returned no records — what should I try?',
                a: 'Some pages require JavaScript to render their content, which the scraper can\'t execute. Try downloading the page as a PDF and uploading that instead — the AI PDF extraction handles this well. Alternatively, export the data to CSV from the website if it offers that option.',
              },
              {
                q: 'How long does AI extraction take?',
                a: 'For PDF/TXT files and auto-scrape, extraction takes 10–30 seconds depending on document size. The AI reads up to 80,000 characters. For CSV, Excel, and JSON uploads there is no AI involved — validation is instant.',
              },
              {
                q: 'Can I update the schema after records have been uploaded?',
                a: 'You can add a new schema version at any time. Existing records are validated against the version that was current when they were uploaded. Re-upload the data to re-validate against the new schema version.',
              },
              {
                q: 'What\'s in the export package?',
                a: 'The ZIP contains: (1) data.json — every approved record in structured JSON format matching the schema, (2) the original raw file uploaded by the extractor, and (3) COVER_SHEET.md — a readme with the schema name, record counts, who extracted and reviewed the data, timestamps, and any notes added to the source.',
              },
              {
                q: 'Can I delete a source after it\'s approved?',
                a: 'No. Approved sources are locked and cannot be deleted — they are part of the audit trail. You can export the data. If you need to reprocess an approved source, create a new source instead.',
              },
            ].map((item, i) => (
              <Card key={i} className="p-5">
                <p className="font-semibold text-gray-900 mb-2 flex items-start gap-2">
                  <span className="text-brand-600 shrink-0">Q.</span> {item.q}
                </p>
                <p className="text-sm text-gray-600 leading-relaxed ml-5">{item.a}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
