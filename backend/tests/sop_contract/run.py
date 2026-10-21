import os
os.environ['DATABASE_URL']='sqlite:///./_e10.db'
from datetime import datetime, timezone
from types import SimpleNamespace as NS
from app.services import quality as q, source_audit as sa, sop_requirements as sr
F=[]
def chk(c,m): print('ok  ' if c else 'FAIL',m); (not c) and F.append(m)
md="""# SOP-KG-ORGANIZATION-DS003-v4.1.0
Entity: Organization
Spec version: 4.1.0
## Fields
| field | type | need | allowed |
|---|---|---|---|
| company_name | string | required | |
| headquarters_country | string | required | ISO 3166-1 alpha-2 country code |
| is_supplier | boolean | required | |
| is_buyer | boolean | required | |
| is_manufacturer | boolean | required | |
| source_url | string | optional | |
| evidence | string | optional | verbatim snippet |
| data_origin | enum | auto-filled | one of: curated, source_derived, ai_generated |
| retrieved_at | datetime | auto-filled | YYYY-MM-DDTHH:MM:SSZ |
| method | enum | auto-filled | one of: manual, llm_extraction |
"""
src=NS(id='s',name='OMRON',category='MarketSegment',external_ref_id='1',xtrium_sop={'sop':{'sop_code':'SOP-KG-ORGANIZATION-DS003-v4.1.0','entity':'Organization','spec_version':'4.1.0','markdown':md,'required_fields':['company_name','headquarters_country','is_supplier','is_buyer','is_manufacturer']},'meta':{}})
b=sr.build(src)
chk(b['stale'] is True,'category MarketSegment vs SOP Organization is flagged stale')
chk(not b['no_contract'],'Organization has a contract')
page="OMRON Corporation sector initiative. "*40
pages={'https://x.com/a':{'ok':True,'text':page,'clean':page,'final_url':'https://x.com/a'}}
f=dict(segment_name='Aluminium',company_name='',headquarters_country='',is_supplier='',is_buyer='',is_manufacturer='',source_url='https://x.com/a',data_origin='curated',method='manual',retrieved_at='2026-10-14T09:00:00Z',regions=['JP'])
r={'record_id':'r','record':'R1','fields':[{'name':n,'value':v,'signals':[]} for n,v in f.items()]}
o=sa.audit_source({'peers':[],'records':[r]},pages,'Src','https://x.com','N',datetime(2026,10,16,tzinfo=timezone.utc),sop=b); R={x['field']:x for x in o['rows']}
for n in ('company_name','headquarters_country','is_supplier','is_buyer','is_manufacturer'):
    chk(R[n]['verdict']=='WRONG' and R[n]['error_kind']=='missing_value',f'{n} empty -> Wrong missing_value: {R[n]["verdict"]} {R[n].get("error_kind")}')
for n in ('segment_name','regions'):
    chk(R[n]['verdict']=='WRONG' and R[n]['error_kind']=='schema',f'{n} not in SOP -> Wrong schema: {R[n]["verdict"]} {R[n].get("error_kind")}')
for n in ('data_origin','method','retrieved_at'):
    chk(R[n]['verdict']=='CORRECT',f'{n} correct: {R[n]["verdict"]} {R[n]["comment"][:60]}')
# boolean false is filled, country name wrong
f.update(company_name='OMRON Corporation',headquarters_country='Japan',is_supplier=False,is_buyer=False,is_manufacturer=True)
r={'record_id':'r','record':'R1','fields':[{'name':n,'value':v,'signals':[]} for n,v in f.items()]}
o=sa.audit_source({'peers':[],'records':[r]},pages,'Src','https://x.com','N',datetime(2026,10,16,tzinfo=timezone.utc),sop=b); R={x['field']:x for x in o['rows']}
chk(R.get('is_supplier',{}).get('verdict')!='WRONG','explicit false is filled')
chk(R['headquarters_country']['verdict']=='WRONG','country name instead of alpha-2 is Wrong: %s %s'%(R['headquarters_country']['verdict'],R['headquarters_country']['comment'][:70]))
# Unclassified
md2="# Unclassified\nNo deliverable contract applies to this source.\n"
u=NS(id='u',name='PubMed',category='Unclassified',external_ref_id='2',xtrium_sop={'sop':{'sop_code':'SOP-KG-UNCLASSIFIED','entity':'Unclassified','markdown':md2,'required_fields':[]},'meta':{}})
bu=sr.build(u)
chk(bu['no_contract'] is True,'Unclassified is no_contract')
chk(not bu['stale'],'Unclassified is not stale')
f2=dict(title='x',source_url='https://x.com/a',data_origin='curated',method='manual',retrieved_at='2026-10-14T09:00:00Z',evidence='a - b')
r2={'record_id':'r','record':'R1','fields':[{'name':n,'value':v,'signals':[]} for n,v in f2.items()]}
o=sa.audit_source({'peers':[],'records':[r2]},pages,'Src','https://x.com','N',datetime(2026,10,16,tzinfo=timezone.utc),sop=bu)
chk(not any(x['verdict']=='WRONG' and x.get('error_kind') in ('schema','missing_value') for x in o['rows']),'Unclassified: no schema/missing flags: %s'%[(x['field'],x['verdict'],x.get('error_kind')) for x in o['rows'] if x['verdict']=='WRONG'])
print('FAILED' if F else 'ALL OK',len(F)); raise SystemExit(1 if F else 0)
