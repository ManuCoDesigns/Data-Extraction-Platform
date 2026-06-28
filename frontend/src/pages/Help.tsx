import { useState } from 'react'
import {
  BookOpen, Database, Upload, CheckCircle, Shield, Download,
  ChevronDown, ChevronRight, FileJson, Globe, Brain, Search,
  Eye, Send, FolderKanban, Layers, Users, RotateCcw, Unlock,
  Trash2, Edit3, ArrowRight, AlertCircle, Code, Lock
} from 'lucide-react'

// ── Design tokens ─────────────────────────────────────────────────────────────
const ROLES = {
  admin:    { label: 'Admin',    color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  extractor:{ label: 'Extractor',color: '#059669', bg: '#ecfdf5', border: '#6ee7b7' },
  reviewer: { label: 'Reviewer', color: '#7c3aed', bg: '#faf5ff', border: '#c4b5fd' },
  any:      { label: 'All',      color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
}

const STEPS = [
  { id: 1, icon: '📁', label: 'Create Project',  color: '#2563eb' },
  { id: 2, icon: '📋', label: 'Define Schema',   color: '#7c3aed' },
  { id: 3, icon: '🏢', label: 'Add Sources',     color: '#0891b2' },
  { id: 4, icon: '📤', label: 'Upload Data',     color: '#059669' },
  { id: 5, icon: '🔍', label: 'Review Records',  color: '#d97706' },
  { id: 6, icon: '✅', label: 'Approve Source',  color: '#10b981' },
  { id: 7, icon: '🚀', label: 'Submit',          color: '#ea580c' },
  { id: 8, icon: '📦', label: 'Export',          color: '#6366f1' },
]

// ── Sub-components ─────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: keyof typeof ROLES }) {
  const r = ROLES[role]
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: r.bg, color: r.color, border: `1px solid ${r.border}`, display: 'inline-block', letterSpacing: '0.04em' }}>
      {r.label}
    </span>
  )
}

function StepBadge({ n }: { n: number }) {
  const s = STEPS[n - 1]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: s.color + '15', color: s.color, border: `1px solid ${s.color}30` }}>
      {s.icon} Step {n}
    </span>
  )
}

function InfoBox({ type, children }: { type: 'tip' | 'warning' | 'note'; children: React.ReactNode }) {
  const cfg = {
    tip:     { icon: '💡', bg: '#f0fdf4', border: '#86efac', color: '#166534', label: 'Tip' },
    warning: { icon: '⚠️', bg: '#fffbeb', border: '#fcd34d', color: '#92400e', label: 'Important' },
    note:    { icon: 'ℹ️', bg: '#eff6ff', border: '#93c5fd', color: '#1e40af', label: 'Note' },
  }[type]
  return (
    <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
      <div style={{ fontSize: 13, color: cfg.color, lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre style={{ background: '#0f172a', color: '#e2e8f0', borderRadius: 10, padding: '14px 16px', fontSize: 12, lineHeight: 1.7, margin: 0, overflowX: 'auto', fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace' }}>
      {code}
    </pre>
  )
}

function StepList({ items }: { items: string[] }) {
  return (
    <ol style={{ margin: '10px 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
            {i + 1}
          </span>
          <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{item}</span>
        </li>
      ))}
    </ol>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '8px 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: '#2563eb', marginTop: 6, fontSize: 8, flexShrink: 0 }}>●</span>
          <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

// ── Accordion section ─────────────────────────────────────────────────────────
function Section({ id, icon, title, badge, children, defaultOpen = false }: {
  id: string; icon: React.ReactNode; title: string; badge?: React.ReactNode
  children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#2563eb' }}>
          {icon}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', flex: 1 }}>{title}</span>
        {badge}
        {open ? <ChevronDown style={{ width: 18, height: 18, color: '#94a3b8' }} /> : <ChevronRight style={{ width: 18, height: 18, color: '#94a3b8' }} />}
      </button>
      {open && (
        <div style={{ padding: '0 22px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ height: 16 }} />
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main Help Page ────────────────────────────────────────────────────────────
export function HelpPage() {
  return (
    <div style={{ padding: '32px', maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #2563eb, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BookOpen style={{ width: 22, height: 22, color: '#fff' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0 }}>Help Guide</h1>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Xtrium DataOps Platform · v2.0</p>
          </div>
        </div>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, margin: 0, maxWidth: 700 }}>
          This guide covers the complete workflow from project setup to final export.
          Every step is linked to a role — follow the badge to know who does what.
        </p>
      </div>

      {/* Role legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28, padding: '14px 18px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginRight: 4, alignSelf: 'center' }}>ROLES:</span>
        {Object.entries(ROLES).map(([key, r]) => (
          <span key={key} style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: r.bg, color: r.color, border: `1px solid ${r.border}` }}>
            {r.label}
          </span>
        ))}
      </div>

      {/* Pipeline overview */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 22px', marginBottom: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 16px' }}>The 8-Step Workflow at a Glance</h2>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ textAlign: 'center', padding: '8px 12px', borderRadius: 10, background: s.color + '12', border: `1px solid ${s.color}30` }}>
                <p style={{ fontSize: 18, margin: 0 }}>{s.icon}</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: s.color, margin: '3px 0 0', whiteSpace: 'nowrap' }}>{s.label}</p>
              </div>
              {i < STEPS.length - 1 && <ArrowRight style={{ width: 14, height: 14, color: '#cbd5e1', flexShrink: 0 }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* 1. Create Project */}
        <Section id="project" icon={<FolderKanban style={{ width: 18, height: 18 }} />} title="Step 1 — Create a Project" badge={<RoleBadge role="admin" />} defaultOpen>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Every dataset lives inside a project. A project groups related sources, schemas, and team members together.
          </p>
          <StepList items={[
            'Go to Projects in the sidebar → click New Project',
            'Enter a clear name (e.g. "Critical Materials Intelligence 2025")',
            'Add an optional description explaining what data you are collecting',
            'Click Create — the project is now ready for sources and team members',
            'Open the project → Members tab → Add Member to assign your team',
          ]} />
          <InfoBox type="tip">
            One project per data contract or client is a good rule of thumb. Keep project names consistent with the client's naming convention.
          </InfoBox>
        </Section>

        {/* 2. Define Schema */}
        <Section id="schema" icon={<Layers style={{ width: 18, height: 18 }} />} title="Step 2 — Define a Schema" badge={<RoleBadge role="admin" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            A schema defines what a valid record looks like — field names, types, required fields, allowed values, and extraction rules for the AI.
            Xtrium uses the <strong>BGS Supplier Graph Schema v1.0</strong> as the base for all critical materials data.
          </p>

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Creating a schema:</p>
            <StepList items={[
              'Go to Schemas → New Schema',
              'Enter a name and paste your schema JSON definition',
              'Save — then assign this schema when creating sources',
            ]} />
          </div>

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Schema field structure:</p>
            <CodeBlock code={`{
  "name": "BGS Supplier Schema v1.0",
  "extraction_instructions": "Extract data following the BGS SOP...",
  "fields": [
    {
      "name": "canonical_name",
      "type": "string",
      "required": true,
      "description": "URL-safe name: lowercase, hyphens, no punctuation"
    },
    {
      "name": "supply_chain_tier",
      "type": "integer",
      "required": true,
      "description": "1=Mine/Extractor, 2=Refiner/Processor, 3=Trader"
    },
    {
      "name": "industry_sector",
      "type": "string",
      "required": true,
      "enum": ["metals mining", "industrial minerals", "coal", "recycling"]
    }
  ]
}`} />
          </div>

          <InfoBox type="warning">
            <strong>canonical_name is the SOP tracking key.</strong> It must be lowercase with hyphens — e.g. <code>albemarle-corporation</code>. Never transform or rename it — it is used as the filename in exports and to track records in the database.
          </InfoBox>
        </Section>

        {/* 3. Add Sources */}
        <Section id="sources" icon={<Database style={{ width: 18, height: 18 }} />} title="Step 3 — Add Sources" badge={<RoleBadge role="admin" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            One source = one company (or one dataset). Sources move through the pipeline step by step.
          </p>
          <StepList items={[
            'Go to Projects → open your project → click Sources Board',
            'Click New Source',
            'Enter the company name, select the schema, and paste the company website URL',
            'Assign an Extractor and Reviewer from your team',
            'Click Create — the source appears in the "Not Started" column',
          ]} />

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Source status flow:</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {[
                { label: 'Not Started', color: '#94a3b8' },
                { label: '→', color: '#cbd5e1' },
                { label: 'Uploading', color: '#3b82f6' },
                { label: '→', color: '#cbd5e1' },
                { label: 'In Review', color: '#7c3aed' },
                { label: '→', color: '#cbd5e1' },
                { label: 'Approved ✓', color: '#10b981' },
              ].map((s, i) => (
                <span key={i} style={{ fontSize: 12, fontWeight: s.label === '→' ? 400 : 600, color: s.color, background: s.label === '→' ? 'transparent' : s.color + '15', padding: s.label === '→' ? 0 : '3px 10px', borderRadius: 20 }}>
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          <InfoBox type="note">
            The website URL is critical — it powers the LLM Verify button that cross-checks your extracted data against the real company website. Always set it.
          </InfoBox>
        </Section>

        {/* 4. Upload Data */}
        <Section id="upload" icon={<Upload style={{ width: 18, height: 18 }} />} title="Step 4 — Upload Data" badge={<RoleBadge role="extractor" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Open a source and click <strong>Upload Data</strong>. Four upload methods are supported:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { icon: '📊', title: 'Excel / CSV', desc: 'Columns auto-map to schema fields. Best for bulk data with consistent column names.' },
              { icon: '📄', title: 'JSON file', desc: 'Single pre-structured record. Best for high-quality manually extracted files like IGO Limited or Ivanhoe Mines.' },
              { icon: '🗂️', title: 'ZIP of JSONs', desc: 'Bundle of JSON files — each file becomes one record. Used for Atlas 517 mines dataset.' },
              { icon: '📋', title: 'PDF / TXT', desc: 'AI reads the document and extracts records matching the schema automatically. Takes 15–30 seconds.' },
            ].map(m => (
              <div key={m.title} style={{ padding: '14px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <p style={{ fontSize: 20, margin: '0 0 6px' }}>{m.icon}</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>{m.title}</p>
                <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{m.desc}</p>
              </div>
            ))}
          </div>

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Auto-Scrape Website (recommended for company data):</p>
            <BulletList items={[
              'Click Auto-Scrape Website on any source with a website URL set',
              'The system fetches the homepage + 16 sub-pages (/operations, /about, /newsroom, /sustainability)',
              'Claude extracts manufacturing sites, products, company description, ticker symbol, certifications',
              'Takes 15–30 seconds — records appear automatically',
              'If the site returns no text (JavaScript-heavy), try uploading the annual report PDF instead',
            ]} />
          </div>

          <InfoBox type="tip">
            After upload, the source status moves to <strong>Schema Errors</strong> (if some records have invalid fields) or <strong>Awaiting Review</strong> (if all records pass validation). The extractor should fix any schema errors before handing to the reviewer.
          </InfoBox>
        </Section>

        {/* 5. Review Records */}
        <Section id="review" icon={<Eye style={{ width: 18, height: 18 }} />} title="Step 5 — Review Records" badge={<RoleBadge role="reviewer" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Open the source → click any record row to open the full-screen review panel. Every record must be individually approved before the source can be approved.
          </p>

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Review panel layout:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Top bar', desc: '← → navigation · Company name + status badges · Schema error count · Web flags · ✓ Approve and ✗ Send Back always visible' },
                { label: 'Left column', desc: 'Core fields: company_name, headquarters, website, sector, description. Click any value to edit inline — press Enter to save.' },
                { label: 'Right column', desc: 'Complex data: Manufacturing Sites (colour-coded), Products, JV Stakes, Annual Production, Source Citations' },
                { label: 'JSON Editor tab', desc: 'Switch to { } JSON Editor for full code view with syntax highlighting, search (Ctrl+F), and direct JSON editing.' },
              ].map(p => (
                <div key={p.label} style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>{p.label}</p>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{p.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Approving records:</p>
            <StepList items={[
              'Check company_name and canonical_name are correct',
              'Verify industry_sector and supply_chain_tier make sense for this company',
              'Confirm manufacturing_sites has at least one real location',
              'Confirm products_offered lists real commodities this company produces',
              'Click ✓ Approve — panel automatically moves to the next record',
            ]} />
          </div>

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>Sending back for fixes:</p>
            <StepList items={[
              'Click ✗ Send Back',
              'Type exactly what needs to be corrected (required — this goes to the extractor)',
              'Click Send Back — source status changes to Corrections Needed',
              'The extractor will see the note when they open the record',
            ]} />
          </div>

          <InfoBox type="tip">
            Site type colour coding in the right column: 🔵 Blue = mine · 🟢 Green = exploration site · 🟠 Orange = processing plant · 🔴 Red = smelter · 🟡 Amber = refinery
          </InfoBox>
        </Section>

        {/* 5b. LLM Verify */}
        <Section id="verify" icon={<Shield style={{ width: 18, height: 18 }} />} title="LLM Website Verification" badge={<RoleBadge role="reviewer" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Runs Claude AI against the company's live website to cross-check every field value. Flags mismatches between what was extracted and what the website actually says.
          </p>
          <StepList items={[
            'Open a source that has a website URL set',
            'Click 🛡 LLM Verify vs Website in the source header',
            'Wait 15–30 seconds while it fetches and analyses the website',
            'A banner shows: ✓ N verified (data matches) · ⚠ N flagged (conflicts found)',
            'Open any flagged record to see the red flag box with field, issue, and suggested value',
            'Apply corrections inline or dismiss flags that are incorrect',
          ]} />
          <InfoBox type="note">
            If a flag is wrong (the LLM made an error), click <strong>✕ Dismiss</strong> on the flag. It is removed permanently. The system logs who dismissed it and when.
          </InfoBox>
        </Section>

        {/* 6. Approve Source */}
        <Section id="approve" icon={<CheckCircle style={{ width: 18, height: 18 }} />} title="Step 6 — Approve the Source" badge={<RoleBadge role="reviewer" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Once every record has been individually approved, you can approve the source as a whole. This locks the source and enables the Submit step.
          </p>
          <StepList items={[
            'Ensure all records show a green ✓ Approved status in the records table',
            'The Step 3 action panel turns green: "All N records approved — ready to approve"',
            'Click Approve Source',
            'Source moves to Approved ✓ status — all jobs are marked as validated',
          ]} />
          <InfoBox type="note">
            <strong>Admins can approve even with pending records</strong> as an override. Reviewers must wait for all records to be approved first.
          </InfoBox>
        </Section>

        {/* 7. Submit */}
        <Section id="submit" icon={<Send style={{ width: 18, height: 18 }} />} title="Step 7 — Submit Records" badge={<RoleBadge role="any" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Submission packages the approved records into a signed JSON file with a SHA256 audit trail. This is the final delivery step.
          </p>
          <StepList items={[
            'Open an approved source',
            'The Step 4 panel shows a green Submit N Records → button',
            'Click Submit Records — a JSON file downloads automatically',
            'The file includes all approved records + SHA256 hash + submission timestamp',
            'Records are marked is_submitted = true and locked',
          ]} />

          <InfoBox type="warning">
            <strong>Submit ≠ Export.</strong> Submit creates an auditable delivery record with a cryptographic hash. Export just downloads the data. Use Submit for final client delivery, Export for progress sharing at any stage.
          </InfoBox>

          <div style={{ padding: '14px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#9a3412', margin: '0 0 6px' }}>Unlock Records (Admin only)</p>
            <p style={{ fontSize: 13, color: '#c2410c', margin: 0 }}>If submitted records need to be corrected, an admin can click <strong>Unlock Records</strong> in the Admin Actions dropdown. This resets is_submitted = false on all records and moves the source back to In Review. The original submission batch is kept in the audit log — a new submission creates a fresh batch.</p>
          </div>
        </Section>

        {/* 8. Export */}
        <Section id="export" icon={<Download style={{ width: 18, height: 18 }} />} title="Step 8 — Export & Download" badge={<RoleBadge role="admin" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Export downloads all approved records as a ZIP folder named after the project. Files are named exactly by canonical_name — never transformed.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: '14px', background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#065f46', margin: '0 0 6px' }}>Export Approved</p>
              <p style={{ fontSize: 12, color: '#047857', margin: 0, lineHeight: 1.5 }}>Downloads only sources with status=approved and records with review_status=approved. Use this to share clean verified data with the client at any stage.</p>
            </div>
            <div style={{ padding: '14px', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', margin: '0 0 6px' }}>Export All</p>
              <p style={{ fontSize: 12, color: '#1d4ed8', margin: 0, lineHeight: 1.5 }}>Downloads all records from all sources regardless of status. Use this for internal progress checks and audits.</p>
            </div>
          </div>

          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>ZIP folder structure:</p>
            <CodeBlock code={`Critical Materials Intelligence/
  ├── albemarle-corporation.json     ← named by canonical_name
  ├── ivanhoe-mines.json
  ├── rainbow-rare-earths.json
  ├── combined.json                  ← all records in one array
  └── README.md                      ← export summary + timestamps`} />
          </div>

          <InfoBox type="tip">
            Use <strong>Preview & Download Records</strong> on the project page to browse all approved records in a folder view before downloading. You can expand any record to see its full JSON and download individual files.
          </InfoBox>
        </Section>

        {/* Admin actions */}
        <Section id="admin" icon={<Lock style={{ width: 18, height: 18 }} />} title="Admin Actions" badge={<RoleBadge role="admin" />}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Admins have a dropdown (⋯ Admin Actions) on every source with these tools:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { icon: <Edit3 style={{ width: 14, height: 14 }} />, title: 'Edit Source', color: '#2563eb', desc: 'Update the source name, description, or website URL. Use this to correct the URL before running auto-scrape.' },
              { icon: <Trash2 style={{ width: 14, height: 14 }} />, title: 'Clear Records', color: '#d97706', desc: 'Delete all records from the source but keep the source itself. Status and name stay the same. Use to wipe test data before a real run.' },
              { icon: <RotateCcw style={{ width: 14, height: 14 }} />, title: 'Reset Source', color: '#d97706', desc: 'Resets status back to Not Started, zeroes all counts and timestamps. Optional checkbox to also clear records. Use to restart a bad extraction from scratch.' },
              { icon: <Unlock style={{ width: 14, height: 14 }} />, title: 'Unlock Records', color: '#d97706', desc: 'Resets is_submitted = false on all submitted records and moves source back to In Review. Preserves the original submission batch in the audit log. Use when submitted records need correction.' },
              { icon: <Trash2 style={{ width: 14, height: 14 }} />, title: 'Delete Source', color: '#dc2626', desc: 'Permanently removes the source, all its jobs, and all records. Cannot be undone. Only available on non-approved sources.' },
            ].map(a => (
              <div key={a.title} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', alignItems: 'flex-start' }}>
                <span style={{ color: a.color, marginTop: 1, flexShrink: 0 }}>{a.icon}</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: a.color, margin: '0 0 3px' }}>{a.title}</p>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{a.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* JSON Editor */}
        <Section id="jsoneditor" icon={<Code style={{ width: 18, height: 18 }} />} title="JSON Editor">
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Switch to the <strong>{'{ } JSON Editor'}</strong> tab inside any record review panel for a Monaco-powered code editor (the same engine as VS Code).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { role: 'Extractor', color: '#059669', items: ['Fully editable JSON', 'Ctrl+F to search', 'Ctrl+Z to undo', 'Ctrl+Shift+F to auto-format', 'Yellow EDITED badge on modified fields', 'Save only after JSON is valid'] },
              { role: 'Reviewer', color: '#7c3aed', items: ['Read-only — cannot type', 'Blue Read Only badge in corner', 'Can still dismiss LLM flags', 'Can switch between Code / Tree view', 'Tree view shows collapsible JSON tree', 'Expand All / Collapse All buttons'] },
            ].map(m => (
              <div key={m.role} style={{ padding: '14px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: m.color, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.role} mode</p>
                <BulletList items={m.items} />
              </div>
            ))}
          </div>
        </Section>

        {/* Status reference */}
        <Section id="statuses" icon={<AlertCircle style={{ width: 18, height: 18 }} />} title="Status Reference">
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Every source has one of these statuses at any time. Statuses are synced automatically when records change.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { status: 'Not Started',        color: '#94a3b8', bg: '#f1f5f9', meaning: 'Source created but no records uploaded yet.' },
              { status: 'Uploading…',          color: '#3b82f6', bg: '#eff6ff', meaning: 'File is being processed and records are being extracted.' },
              { status: 'Schema Errors',       color: '#f59e0b', bg: '#fffbeb', meaning: 'Some records have invalid fields. Extractor needs to fix them.' },
              { status: 'Awaiting Review',     color: '#6366f1', bg: '#eef2ff', meaning: 'All records are schema-valid. Waiting for reviewer to start.' },
              { status: 'In Review',           color: '#a855f7', bg: '#faf5ff', meaning: 'Reviewer is actively approving/rejecting records.' },
              { status: 'Corrections Needed',  color: '#ef4444', bg: '#fef2f2', meaning: 'Reviewer sent one or more records back. Extractor must fix and resubmit.' },
              { status: 'LLM Check Done',      color: '#a855f7', bg: '#faf5ff', meaning: 'LLM verification has run. Some records may have flags to review.' },
              { status: 'Approved ✓',          color: '#10b981', bg: '#ecfdf5', meaning: 'All records approved. Source is locked and ready for submission.' },
            ].map(s => (
              <div key={s.status} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: s.bg, color: s.color, whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
                  {s.status}
                </span>
                <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{s.meaning}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Roles reference */}
        <Section id="roles" icon={<Users style={{ width: 18, height: 18 }} />} title="Team Roles Reference">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { role: 'org_admin', label: 'Org Admin', color: '#dc2626', bg: '#fef2f2', can: ['Full system access', 'Create/delete projects', 'Manage all users', 'Override any approval', 'Reset or unlock any source', 'All extractor and reviewer actions'] },
              { role: 'project_admin', label: 'Project Admin', color: '#d97706', bg: '#fffbeb', can: ['Manage one project', 'Add team members', 'Review and approve records', 'Reset and unlock sources', 'Export and submit records'] },
              { role: 'qa_lead', label: 'QA Lead', color: '#2563eb', bg: '#eff6ff', can: ['Review and approve records across all projects', 'Submit records', 'Run LLM verification', 'Upload data'] },
              { role: 'extractor', label: 'Extractor (Pipeline Operator)', color: '#059669', bg: '#ecfdf5', can: ['Upload data to assigned sources', 'Run auto-scrape', 'Fix schema errors', 'Edit records sent back by reviewer'] },
              { role: 'reviewer', label: 'Reviewer', color: '#7c3aed', bg: '#faf5ff', can: ['Review and approve records on assigned sources', 'Dismiss LLM flags', 'Run LLM verification'] },
              { role: 'read_only', label: 'Read Only', color: '#64748b', bg: '#f8fafc', can: ['View approved records only', 'Download export packages'] },
            ].map(r => (
              <div key={r.role} style={{ padding: '14px 16px', background: r.bg, border: `1px solid ${r.color}30`, borderRadius: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: r.color, margin: '0 0 8px' }}>{r.label}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {r.can.map(c => (
                    <span key={c} style={{ fontSize: 11, color: '#374151', background: 'rgba(255,255,255,0.8)', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: 20 }}>
                      ✓ {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq" icon={<Search style={{ width: 18, height: 18 }} />} title="Common Questions & Troubleshooting">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              {
                q: 'Export says "No records found" even though I can see approved sources',
                a: 'Check that the source status is "Approved ✓" (not just having approved records). The export queries sources where status = approved. Use the Preview & Download page to verify what records the query finds before downloading.',
              },
              {
                q: 'Auto-scrape returns "page returned no readable text"',
                a: 'The website uses JavaScript rendering. Try: (1) Use the company\'s newsroom or annual results URL instead of the homepage. (2) Download the annual report PDF and upload it via Upload Data. (3) The PDF AI extraction handles JS-heavy sites that the scraper cannot reach.',
              },
              {
                q: 'Source is stuck at "Corrections Needed" after extractor fixed the record',
                a: 'Status syncs automatically when records change. If the status hasn\'t updated, click Refresh (or wait 20 seconds for the auto-refresh). If it still shows Corrections Needed, there may be another record still in rejected state.',
              },
              {
                q: 'Submit button says "All records already submitted"',
                a: 'The records in this source have already been submitted. If you need to re-submit (due to corrections), an admin must click Unlock Records in Admin Actions. This resets is_submitted on all records and moves the source back to In Review.',
              },
              {
                q: 'canonical_name is wrong — how do I fix it without breaking tracking?',
                a: 'Open the record → JSON Editor tab → edit canonical_name directly → Save. The canonical_name is used as the filename in exports, so fixing it here also fixes the exported file name. Do NOT change it after a source has been submitted — this breaks the audit trail.',
              },
              {
                q: 'How do I update existing records without re-uploading everything?',
                a: 'Use the patch_existing_records.py script with --dry-run first to preview changes, then run without --dry-run to apply. It updates records without creating duplicates. Or open individual records in the review panel and edit inline.',
              },
            ].map(faq => (
              <div key={faq.q} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 6px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: '#2563eb', flexShrink: 0 }}>Q.</span> {faq.q}
                </p>
                <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.7, paddingLeft: 18 }}>
                  <span style={{ color: '#059669', fontWeight: 700 }}>A.</span> {faq.a}
                </p>
              </div>
            ))}
          </div>
        </Section>

      </div>

      {/* Footer */}
      <div style={{ marginTop: 40, padding: '20px 24px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>Need more help?</p>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>Contact the platform team at raghu@xtrium.ai</p>
        </div>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>Xtrium DataOps Platform v2.0 · Internal Use Only</span>
      </div>
    </div>
  )
}
