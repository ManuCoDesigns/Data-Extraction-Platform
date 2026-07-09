import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Database, CheckCircle, AlertCircle, Upload, Eye, ArrowRight,
  Activity, Clock, RefreshCw, ShieldCheck, Users, BarChart3,
} from 'lucide-react'
import { statsApi, sourcesApi, projectsApi } from '@/api/client'
// Productivity data loaded in AdminDashboard
import { safeFromNow } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts'

// ── helpers ───────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const STATUS_META: Record<string, {label:string;color:string;bg:string}> = {
  not_started:         {label:'Not Started',       color:'#94a3b8',bg:'#f1f5f9'},
  extracting:          {label:'Uploading',          color:'#3b82f6',bg:'#eff6ff'},
  needs_fixes:         {label:'Schema Errors',      color:'#f59e0b',bg:'#fffbeb'},
  ready_for_review:    {label:'Awaiting Review',    color:'#6366f1',bg:'#eef2ff'},
  in_review:           {label:'In Review',          color:'#a855f7',bg:'#faf5ff'},
  changes_requested:   {label:'Corrections Needed', color:'#ef4444',bg:'#fef2f2'},
  llm_verification:    {label:'LLM Check',          color:'#a855f7',bg:'#faf5ff'},
  approved:            {label:'Approved',           color:'#10b981',bg:'#ecfdf5'},
}

function KpiCard({label,value,sub,icon,color,trend}:{
  label:string;value:number|string;sub:string;icon:React.ReactNode;color:string;trend?:{value:number;label:string}
}) {
  const C = ({blue:{bg:'#eff6ff',ic:'#2563eb',tx:'#1d4ed8'},purple:{bg:'#faf5ff',ic:'#7c3aed',tx:'#6d28d9'},
    green:{bg:'#ecfdf5',ic:'#059669',tx:'#047857'},red:{bg:'#fef2f2',ic:'#dc2626',tx:'#b91c1c'},
    amber:{bg:'#fffbeb',ic:'#d97706',tx:'#b45309'}} as any)[color] ?? {bg:'#f8fafc',ic:'#64748b',tx:'#475569'}
  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:14,padding:'16px 18px',
      boxShadow:'0 1px 3px rgba(0,0,0,0.04)',position:'relative',overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{width:34,height:34,borderRadius:10,background:C.bg,display:'flex',
          alignItems:'center',justifyContent:'center',color:C.ic}}>{icon}</div>
        {trend && trend.value > 0 && (
          <span style={{fontSize:10,fontWeight:700,color:'#059669',background:'#ecfdf5',padding:'2px 7px',borderRadius:20}}>
            +{trend.value} {trend.label}
          </span>
        )}
      </div>
      <p style={{fontSize:24,fontWeight:800,color:'#0f172a',margin:0,lineHeight:1}}>{value}</p>
      <p style={{fontSize:12,fontWeight:600,color:C.tx,margin:'3px 0 1px'}}>{label}</p>
      <p style={{fontSize:11,color:'#94a3b8',margin:0}}>{sub}</p>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{padding:'22px 28px',maxWidth:1140,margin:'0 auto'}}>
      {[1,2,3].map(i=>(
        <div key={i} style={{background:'#f1f5f9',borderRadius:16,height:i===1?32:120,marginBottom:16}}/>
      ))}
    </div>
  )
}

function StatusPill({status}:{status:string}) {
  const m = STATUS_META[status]; if (!m) return null
  return <span style={{fontSize:10,fontWeight:600,padding:'3px 8px',borderRadius:20,
    background:m.bg,color:m.color,whiteSpace:'nowrap'}}>{m.label}</span>
}

function SectionCard({title,sub,badge,badgeColor='#2563eb',linkTo,children}:{
  title:string;sub?:string;badge?:string|number;badgeColor?:string;linkTo?:string;children:React.ReactNode
}) {
  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,
      overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,0.05)',marginBottom:20}}>
      <div style={{padding:'13px 20px',borderBottom:'1px solid #f1f5f9',
        display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h2 style={{fontSize:14,fontWeight:700,color:'#0f172a',margin:0}}>{title}</h2>
          {sub && <p style={{fontSize:12,color:'#94a3b8',margin:'2px 0 0'}}>{sub}</p>}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {badge !== undefined && (
            <span style={{fontSize:12,fontWeight:700,padding:'3px 10px',borderRadius:20,
              background:badgeColor+'15',color:badgeColor,border:`1px solid ${badgeColor}30`}}>{badge}</span>
          )}
          {linkTo && (
            <Link to={linkTo} style={{fontSize:12,color:'#2563eb',textDecoration:'none',
              fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
              View all <ArrowRight style={{width:12,height:12}}/>
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function SourceRow({s,i,total}:{s:any;i:number;total:number}) {
  return (
    <Link to={`/projects/${s.project_id}/sources/${s.id}`}
      style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'11px 20px',textDecoration:'none',
        borderBottom:i<total-1?'1px solid #f8fafc':'none',transition:'background 0.1s'}}
      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#f8fafc'}}
      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
        <div style={{width:36,height:36,borderRadius:10,flexShrink:0,
          background:STATUS_META[s.status]?.bg??'#f8fafc',
          display:'flex',alignItems:'center',justifyContent:'center'}}>
          <Database style={{width:16,height:16,color:STATUS_META[s.status]?.color??'#94a3b8'}}/>
        </div>
        <div style={{minWidth:0}}>
          <p style={{fontSize:13,fontWeight:600,color:'#1e293b',margin:0,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</p>
          <p style={{fontSize:11,color:'#94a3b8',margin:'2px 0 0'}}>{safeFromNow(s.updated_at)}</p>
        </div>
      </div>
      <StatusPill status={s.status}/>
    </Link>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────
function useSummary() {
  const [data,setData]     = useState<any>(null)
  const [loading,setLoading] = useState(true)
  const [refresh,setRefresh] = useState(new Date())
  const load = useCallback(() => {
    setLoading(true)
    statsApi.sourcesSummary()
      .then(d=>{setData(d);setRefresh(new Date())})
      .catch(()=>setData({}))
      .finally(()=>setLoading(false))
  },[])
  useEffect(()=>{
    load()
    const iv = setInterval(load,30_000)
    window.addEventListener('focus',load)
    return ()=>{clearInterval(iv);window.removeEventListener('focus',load)}
  },[load])
  return {data,loading,load,lastRefresh:refresh}
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard() {
  const {user}              = useAuthStore()
  const {data:summary,loading,load,lastRefresh} = useSummary()
  const [projects,setProjects] = useState<any[]>([])
  const [activeProject,setActiveProject] = useState<string|null>(null)

  useEffect(()=>{
    projectsApi.list().then((r:any)=>{
      const list = Array.isArray(r) ? r : r?.items ?? []
      setProjects(list)
    }).catch(()=>{})
  },[])

  if (loading) return <Skeleton/>

  const byStatus      = summary?.by_status ?? {}
  const total         = summary?.total ?? 0
  const approvedCount = byStatus['approved'] ?? 0
  const inProgress    = ['extracting','needs_fixes','ready_for_review','in_review','changes_requested']
    .reduce((s,k)=>s+(byStatus[k]??0),0)
  const notStarted    = byStatus['not_started'] ?? 0
  const pendingAdmin  = (summary?.pending_admin_review ?? []).length

  const perProject: any[] = summary?.per_project ?? []

  // Filter sources by selected project
  const recent = (summary?.recent ?? []).filter((s:any)=>
    !activeProject || s.project_id === activeProject
  )

  const chartData = Object.entries(byStatus)
    .filter(([,v])=>(v as number)>0)
    .map(([status,count])=>({
      name:STATUS_META[status]?.label??status,
      value:count as number,
      color:STATUS_META[status]?.color??'#94a3b8',
    }))

  // Get project name from projects list
  const projectName = (id:string) => projects.find(p=>p.id===id)?.name ?? id.slice(0,8)+'...'

  return (
    <div style={{padding:'22px 28px',maxWidth:1140,margin:'0 auto'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:800,color:'#0f172a',margin:0}}>
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p style={{fontSize:13,color:'#94a3b8',marginTop:4}}>
            Platform overview · {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={load} style={{padding:'8px 16px',background:'#fff',border:'1px solid #e2e8f0',
            borderRadius:10,cursor:'pointer',fontSize:13,color:'#64748b',display:'flex',alignItems:'center',gap:6}}>
            <RefreshCw style={{width:14,height:14}}/> Refresh
          </button>
          <Link to="/sources" style={{padding:'8px 16px',
            background:'linear-gradient(135deg,#2563eb,#4f46e5)',border:'none',borderRadius:10,
            fontSize:13,fontWeight:600,color:'#fff',textDecoration:'none',display:'flex',alignItems:'center',gap:6}}>
            <Database style={{width:14,height:14}}/> All Sources
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:18}}>
        <KpiCard label="Total Sources"  value={total}         sub="across all projects" icon={<Database style={{width:18,height:18}}/>}   color="blue"   />
        <KpiCard label="In Progress"    value={inProgress}    sub="uploading or review"  icon={<Activity style={{width:18,height:18}}/>}   color="purple" />
        <KpiCard label="Approved"       value={approvedCount} sub="fully complete"       icon={<CheckCircle style={{width:18,height:18}}/>} color="green"  trend={{value:summary?.approved_this_week??0,label:'this week'}}/>
        <KpiCard label="Not Started"    value={notStarted}    sub="waiting for work"     icon={<Clock style={{width:18,height:18}}/>}      color="amber"  />
        <KpiCard label="Needs Admin ✓"  value={pendingAdmin}  sub="reviewer approved"    icon={<ShieldCheck style={{width:18,height:18}}/>} color="red"    />
      </div>

      {/* Pending Admin Review alert */}
      {pendingAdmin > 0 && (
        <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:14,
          padding:'14px 20px',marginBottom:18,display:'flex',alignItems:'center',gap:12}}>
          <ShieldCheck style={{width:20,height:20,color:'#dc2626',flexShrink:0}}/>
          <div style={{flex:1}}>
            <p style={{fontSize:14,fontWeight:700,color:'#dc2626',margin:0}}>
              {pendingAdmin} source{pendingAdmin!==1?'s':''} waiting for your final approval
            </p>
            <p style={{fontSize:12,color:'#94a3b8',margin:'2px 0 0'}}>
              Reviewer has approved — you need to do the admin final review
            </p>
          </div>
          <Link to="/sources" style={{padding:'7px 14px',background:'#dc2626',color:'#fff',
            borderRadius:8,fontSize:12,fontWeight:600,textDecoration:'none'}}>
            Review now →
          </Link>
        </div>
      )}

      {/* Per-project cards */}
      {perProject.length > 0 && (
        <div style={{marginBottom:18}}>
          <p style={{fontSize:12,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
            letterSpacing:'.06em',marginBottom:10}}>Project breakdown</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10}}>
            {perProject.map((pp:any)=>{
              const pct = pp.total > 0 ? Math.round((pp.approved/pp.total)*100) : 0
              const isActive = activeProject === pp.project_id
              return (
                <div key={pp.project_id}
                  onClick={()=>setActiveProject(isActive ? null : pp.project_id)}
                  style={{background:isActive?'#eff6ff':'#fff',
                    border:`1px solid ${isActive?'#2563eb':'#e2e8f0'}`,
                    borderRadius:14,padding:'14px 16px',cursor:'pointer',transition:'all 0.12s'}}>
                  <p style={{fontSize:12,fontWeight:700,color:'#0f172a',margin:'0 0 2px',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {projectName(pp.project_id)}
                  </p>
                  <p style={{fontSize:11,color:'#94a3b8',margin:'0 0 10px'}}>
                    {pp.approved}/{pp.total} approved · {pp.in_progress} active
                  </p>
                  <div style={{background:'#e2e8f0',borderRadius:99,height:6,overflow:'hidden'}}>
                    <div style={{background:pct===100?'#10b981':'#2563eb',height:'100%',
                      width:`${pct}%`,borderRadius:99,transition:'width 0.6s ease'}}/>
                  </div>
                  <p style={{fontSize:10,color:'#94a3b8',margin:'4px 0 0'}}>{pct}% complete</p>
                </div>
              )
            })}
          </div>
          {activeProject && (
            <p style={{fontSize:11,color:'#2563eb',marginTop:6,cursor:'pointer'}}
              onClick={()=>setActiveProject(null)}>
              ✕ Clear project filter
            </p>
          )}
        </div>
      )}

      {/* Productivity */}
      <SectionCard title="Team Productivity" sub="Per-person extraction and review metrics"
        badge={summary?.per_project?.length ? `${summary.per_project.length} projects` : undefined}>
        <div style={{padding:'16px 20px'}}>
          <ProductivityPanel projectId={activeProject ?? undefined}/>
        </div>
      </SectionCard>

      {/* Chart + Recent */}
      <div style={{display:'grid',gridTemplateColumns:'360px 1fr',gap:16,marginBottom:18}}>
        <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,
          padding:'18px 20px',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <p style={{fontSize:13,fontWeight:700,color:'#0f172a',margin:'0 0 12px'}}>Sources by status</p>
          {chartData.length === 0
            ? <div style={{height:160,display:'flex',alignItems:'center',justifyContent:'center',color:'#94a3b8',fontSize:12}}>No data yet</div>
            : <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
                    {chartData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                  </Pie>
                  <Tooltip formatter={(v,n)=>[v,n]} contentStyle={{border:'1px solid #e2e8f0',borderRadius:8,fontSize:11}}/>
                  <Legend formatter={(v)=><span style={{fontSize:11}}>{v}</span>}/>
                </PieChart>
              </ResponsiveContainer>
          }
        </div>

        <SectionCard title="Recent Activity"
          sub={activeProject?`Filtered: ${projectName(activeProject)}`:"All projects"}
          linkTo="/sources">
          {recent.length === 0
            ? <div style={{padding:40,textAlign:'center',color:'#94a3b8',fontSize:13}}>No recent activity</div>
            : recent.map((s:any,i:number)=><SourceRow key={s.id} s={s} i={i} total={recent.length}/>)
          }
        </SectionCard>
      </div>
    </div>
  )
}

// ── Productivity Panel (used inside AdminDashboard) ──────────────────────────
function ProductivityPanel({projectId}:{projectId?:string}) {
  const [data, setData]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState<'extractors'|'reviewers'>('extractors')

  useEffect(()=>{
    statsApi.productivity(projectId)
      .then(setData).catch(()=>setData(null)).finally(()=>setLoading(false))
  },[projectId])

  if (loading) return (
    <div style={{padding:32,textAlign:'center',color:'#94a3b8',fontSize:13}}>Loading productivity data…</div>
  )
  if (!data) return null

  const extractors: any[] = data.extractors ?? []
  const reviewers:  any[] = data.reviewers  ?? []
  const hasFlagged = reviewers.some((r:any)=>r.flagged)

  return (
    <div>
      {/* Fast-review warning banner */}
      {hasFlagged && (
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:12,
          padding:'12px 18px',marginBottom:16,display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:18}}>⚡</span>
          <div>
            <p style={{fontSize:13,fontWeight:700,color:'#c2410c',margin:0}}>
              Suspiciously fast reviews detected
            </p>
            <p style={{fontSize:12,color:'#94a3b8',margin:'2px 0 0'}}>
              One or more reviewers completed records in under 90 seconds — investigate for quality issues
            </p>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div style={{display:'flex',gap:0,marginBottom:14,border:'1px solid #e2e8f0',
        borderRadius:10,overflow:'hidden',width:'fit-content'}}>
        {(['extractors','reviewers'] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{padding:'7px 18px',fontSize:13,fontWeight:500,cursor:'pointer',border:'none',
              background:tab===t?'#2563eb':'transparent',
              color:tab===t?'#fff':'#64748b'}}>
            {t === 'extractors' ? `⛏ Extractors (${extractors.length})` : `🔍 Reviewers (${reviewers.length})`}
          </button>
        ))}
      </div>

      {tab === 'extractors' && (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0'}}>
                {['Extractor','Sources','Records','Valid','Errors','Error %','Approval %'].map(h=>(
                  <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:700,
                    color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.07em',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {extractors.length === 0
                ? <tr><td colSpan={7} style={{padding:32,textAlign:'center',color:'#94a3b8'}}>No extraction data yet</td></tr>
                : extractors.map((e:any,i:number)=>(
                  <tr key={e.user_id} style={{borderBottom:'1px solid #f8fafc'}}
                    onMouseEnter={el=>{(el.currentTarget as HTMLElement).style.background='#f8fafc'}}
                    onMouseLeave={el=>{(el.currentTarget as HTMLElement).style.background='transparent'}}>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:28,height:28,borderRadius:'50%',background:'#059669',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:11,fontWeight:700,color:'#fff',flexShrink:0}}>
                          {(e.name??'?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p style={{fontSize:13,fontWeight:600,color:'#1e293b',margin:0}}>{e.name}</p>
                          <p style={{fontSize:11,color:'#94a3b8',margin:0}}>{e.email}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'11px 14px',fontWeight:600,color:'#1e293b'}}>{e.sources_worked}</td>
                    <td style={{padding:'11px 14px',fontWeight:700,color:'#2563eb'}}>{e.total_records}</td>
                    <td style={{padding:'11px 14px',color:'#059669',fontWeight:600}}>{e.valid_records}</td>
                    <td style={{padding:'11px 14px',color:e.invalid_records>0?'#dc2626':'#94a3b8',fontWeight:e.invalid_records>0?700:400}}>{e.invalid_records}</td>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <div style={{background:'#e2e8f0',borderRadius:99,height:6,width:50,overflow:'hidden'}}>
                          <div style={{background:e.error_rate_pct>10?'#ef4444':'#10b981',height:'100%',
                            width:`${Math.min(100,e.error_rate_pct*5)}%`,borderRadius:99}}/>
                        </div>
                        <span style={{fontSize:12,fontWeight:600,color:e.error_rate_pct>10?'#dc2626':'#059669'}}>
                          {e.error_rate_pct}%
                        </span>
                      </div>
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      <span style={{fontSize:12,fontWeight:700,
                        color:e.approval_rate_pct>=80?'#059669':e.approval_rate_pct>=50?'#d97706':'#dc2626'}}>
                        {e.approval_rate_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'reviewers' && (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0'}}>
                {['Reviewer','Reviewed','Approved','Rejected','Avg Time','Fast Reviews','Approval %'].map(h=>(
                  <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:700,
                    color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.07em',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviewers.length === 0
                ? <tr><td colSpan={7} style={{padding:32,textAlign:'center',color:'#94a3b8'}}>No review data yet</td></tr>
                : reviewers.map((r:any)=>(
                  <tr key={r.user_id} style={{borderBottom:'1px solid #f8fafc',
                    background:r.flagged?'#fff7ed':'transparent'}}
                    onMouseEnter={el=>{(el.currentTarget as HTMLElement).style.background=r.flagged?'#fed7aa30':'#f8fafc'}}
                    onMouseLeave={el=>{(el.currentTarget as HTMLElement).style.background=r.flagged?'#fff7ed':'transparent'}}>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:28,height:28,borderRadius:'50%',background:'#7c3aed',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:11,fontWeight:700,color:'#fff',flexShrink:0}}>
                          {(r.name??'?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p style={{fontSize:13,fontWeight:600,color:'#1e293b',margin:0}}>{r.name}</p>
                          <p style={{fontSize:11,color:'#94a3b8',margin:0}}>{r.email}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'11px 14px',fontWeight:700,color:'#7c3aed'}}>{r.total_reviewed}</td>
                    <td style={{padding:'11px 14px',color:'#059669',fontWeight:600}}>{r.approved}</td>
                    <td style={{padding:'11px 14px',color:r.rejected>0?'#dc2626':'#94a3b8'}}>{r.rejected}</td>
                    <td style={{padding:'11px 14px'}}>
                      <span style={{fontSize:12,fontWeight:600,
                        color:r.avg_review_secs&&r.avg_review_secs<90?'#dc2626':
                              r.avg_review_secs&&r.avg_review_secs<300?'#d97706':'#059669'}}>
                        {r.avg_review_label}
                      </span>
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      {r.fast_reviews > 0
                        ? <span style={{fontSize:11,fontWeight:700,padding:'3px 8px',borderRadius:20,
                            background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca'}}>
                            ⚡ {r.fast_reviews}
                          </span>
                        : <span style={{fontSize:11,color:'#94a3b8'}}>—</span>
                      }
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      <span style={{fontSize:12,fontWeight:700,
                        color:r.approval_rate_pct>=80?'#059669':r.approval_rate_pct>=50?'#d97706':'#dc2626'}}>
                        {r.approval_rate_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


// ── Extractor Dashboard ────────────────────────────────────────────────────────
function ExtractorDashboard() {
  const {user}  = useAuthStore()
  const {data:summary,loading,load,lastRefresh} = useSummary()
  if (loading) return <Skeleton/>
  const mine      : any[] = summary?.my_extracting ?? []
  const available : any[] = summary?.available     ?? []
  const needsAction = mine.filter((s:any)=>['needs_fixes','changes_requested'].includes(s.status))
  return (
    <div style={{padding:'22px 28px',maxWidth:1140,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:800,color:'#0f172a',margin:0}}>
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p style={{fontSize:13,color:'#94a3b8',marginTop:4}}>Your extraction workspace · {lastRefresh.toLocaleTimeString()}</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={load} style={{padding:'8px 16px',background:'#fff',border:'1px solid #e2e8f0',borderRadius:10,cursor:'pointer',fontSize:13,color:'#64748b',display:'flex',alignItems:'center',gap:6}}>
            <RefreshCw style={{width:14,height:14}}/> Refresh
          </button>
          <Link to="/sources" style={{padding:'8px 16px',background:'linear-gradient(135deg,#2563eb,#4f46e5)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,color:'#fff',textDecoration:'none',display:'flex',alignItems:'center',gap:6}}>
            <Database style={{width:14,height:14}}/> All Sources
          </Link>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <KpiCard label="My Sources"         value={mine.length}       sub="assigned to me"          icon={<Upload style={{width:18,height:18}}/>}    color="blue"  />
        <KpiCard label="Needs Fixes"        value={needsAction.length} sub="errors or sent back"    icon={<AlertCircle style={{width:18,height:18}}/>} color="red"   />
        <KpiCard label="Available"          value={available.length}  sub="unclaimed sources"        icon={<Activity style={{width:18,height:18}}/>}   color="green" />
        <KpiCard label="Approved"           value={mine.filter((s:any)=>s.status==='approved').length} sub="fully complete" icon={<CheckCircle style={{width:18,height:18}}/>} color="purple"/>
      </div>
      {needsAction.length > 0 && (
        <SectionCard title="Needs Your Attention" sub="Reviewer sent these back" badge={needsAction.length} badgeColor="#dc2626">
          {needsAction.map((s:any,i:number)=><SourceRow key={s.id} s={s} i={i} total={needsAction.length}/>)}
        </SectionCard>
      )}
      {available.length > 0 && (
        <SectionCard title="Available to Claim" sub="No extractor assigned yet" badge={`${available.length} available`} badgeColor="#059669">
          {available.slice(0,6).map((s:any,i:number)=>(
            <Link key={s.id} to={`/projects/${s.project_id}/sources/${s.id}`}
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 20px',textDecoration:'none',borderBottom:i<Math.min(available.length,6)-1?'1px solid #f0fdf4':'none'}}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#f0fdf4'}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:34,height:34,borderRadius:10,background:'#ecfdf5',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>✋</div>
                <div>
                  <p style={{fontSize:13,fontWeight:600,color:'#1e293b',margin:0}}>{s.name}</p>
                  <p style={{fontSize:11,color:'#94a3b8',margin:'2px 0 0'}}>{safeFromNow(s.updated_at)}</p>
                </div>
              </div>
              <span style={{fontSize:12,fontWeight:700,padding:'4px 12px',borderRadius:8,background:'#059669',color:'#fff'}}>Claim →</span>
            </Link>
          ))}
        </SectionCard>
      )}
      <SectionCard title="My Sources" sub="All sources assigned to you" linkTo="/sources">
        {mine.length === 0
          ? <div style={{padding:48,textAlign:'center',color:'#94a3b8'}}><Database style={{width:36,height:36,margin:'0 auto 8px',opacity:.2}}/><p>No sources assigned yet</p></div>
          : mine.map((s:any,i:number)=><SourceRow key={s.id} s={s} i={i} total={mine.length}/>)
        }
      </SectionCard>
    </div>
  )
}

// ── Reviewer Dashboard ────────────────────────────────────────────────────────
function ReviewerDashboard() {
  const {user}  = useAuthStore()
  const {data:summary,loading,load,lastRefresh} = useSummary()
  if (loading) return <Skeleton/>
  const mine             : any[] = summary?.my_reviewing       ?? []
  const approvedRecords          = summary?.my_approved_records ?? 0
  const approvedThisWeek         = summary?.my_approved_this_week ?? 0
  const pendingTotal             = summary?.my_pending_total    ?? 0
  const ready = mine.filter((s:any)=>s.status==='ready_for_review')
  const pct   = approvedRecords + pendingTotal > 0
    ? Math.round((approvedRecords/(approvedRecords+pendingTotal))*100) : 0
  return (
    <div style={{padding:'22px 28px',maxWidth:1140,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:800,color:'#0f172a',margin:0}}>
            {greeting()}, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p style={{fontSize:13,color:'#94a3b8',marginTop:4}}>Your review workspace · {lastRefresh.toLocaleTimeString()}</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={load} style={{padding:'8px 16px',background:'#fff',border:'1px solid #e2e8f0',borderRadius:10,cursor:'pointer',fontSize:13,color:'#64748b',display:'flex',alignItems:'center',gap:6}}>
            <RefreshCw style={{width:14,height:14}}/> Refresh
          </button>
          <Link to="/sources" style={{padding:'8px 16px',background:'linear-gradient(135deg,#7c3aed,#6366f1)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,color:'#fff',textDecoration:'none',display:'flex',alignItems:'center',gap:6}}>
            <Eye style={{width:14,height:14}}/> All Sources
          </Link>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <KpiCard label="Records Approved" value={approvedRecords} sub="total by you"        icon={<CheckCircle style={{width:18,height:18}}/>} color="green"  trend={{value:approvedThisWeek,label:'this week'}}/>
        <KpiCard label="Pending"          value={pendingTotal}    sub="awaiting review"      icon={<Clock style={{width:18,height:18}}/>}      color="amber"  />
        <KpiCard label="Ready for Review" value={ready.length}    sub="sources waiting"      icon={<Eye style={{width:18,height:18}}/>}        color="purple" />
        <KpiCard label="My Sources"       value={mine.length}     sub="assigned to review"   icon={<Activity style={{width:18,height:18}}/>}   color="blue"   />
      </div>
      <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:'16px 20px',marginBottom:18,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <div>
            <p style={{fontSize:14,fontWeight:700,color:'#0f172a',margin:0}}>Review Progress</p>
            <p style={{fontSize:12,color:'#94a3b8',margin:'3px 0 0'}}>{approvedRecords} approved · {pendingTotal} pending</p>
          </div>
          <p style={{fontSize:26,fontWeight:800,color:'#7c3aed',margin:0}}>{pct}%</p>
        </div>
        <div style={{background:'#f1f5f9',borderRadius:99,height:10,overflow:'hidden'}}>
          <div style={{background:'linear-gradient(90deg,#7c3aed,#6366f1)',height:'100%',borderRadius:99,width:`${pct}%`,transition:'width 0.8s ease'}}/>
        </div>
      </div>
      <SectionCard title="My Review Queue" sub="Click any row to open" linkTo="/sources">
        {mine.length === 0
          ? <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}><Eye style={{width:32,height:32,margin:'0 auto 8px',opacity:.2}}/><p>No sources in review queue</p></div>
          : mine.map((s:any,i:number)=><SourceRow key={s.id} s={s} i={i} total={mine.length}/>)
        }
      </SectionCard>
    </div>
  )
}

// ── Router ────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const {user} = useAuthStore()
  if (!user) return null
  const roles = new Set(Array.isArray(user.roles) ? user.roles : [])
  if (roles.has('org_admin')||roles.has('project_admin')||roles.has('qa_lead')) return <AdminDashboard/>
  const isExtractor = roles.has('pipeline_operator')
  const isReviewer  = roles.has('reviewer')
  if (isReviewer && isExtractor) return <AdminDashboard/>  // dual role sees admin view
  if (isReviewer)  return <ReviewerDashboard/>
  return <ExtractorDashboard/>
}
