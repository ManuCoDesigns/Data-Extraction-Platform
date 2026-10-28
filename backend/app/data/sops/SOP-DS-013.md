SOP-DS-013

Mineral Projects, Resources & Mining
Company Extraction
Document Owner

Xtrium Data / Knowledge Graph Team

Document Type

Standard Operating Procedure

Version

1.0

Status

Internal Working Standard

Primary Output

Validated JSON objects and relationships

Applies To

Publicly available web pages, PDFs, databases and technical sources

Revision History
Version

Date

Change

1.0

September 2026

Initial release for Xtrium source extraction workflow.

## 1. Purpose
Define a structured method for extracting commercial mining-company identity together with the underlying mineral project,
resource, reserve, technical-study and development-lifecycle information.

## 2. Scope
• Mining companies and mineral exploration companies.
• Junior miners and strategic-mineral project developers.
• Mineral-processing and tailings-reprocessing projects.
• Critical-mineral project developers.
• Technical reports, NI 43-101 reports, JORC reports, PEAs, feasibility studies and resource estimates.
• Project pages, geological reports, metallurgical studies, permits and investor presentations.

## 3. Supported Source Types
• Company/project websites.
• NI 43-101 technical reports.
• JORC and other recognized resource/reserve reports.
• PEA, PFS and feasibility studies.
• Government geological and permitting records.
• Environmental assessments and technical studies.
• Public company announcements and investor presentations.

## 4. Expected Output
The extraction must produce structured JSON using the pre-decided Xtrium schema. Do not create, rename, remove, or
redesign schema fields. When both an organization and a material/project/technology are present, create separate objects and
link them through the appropriate relationship fields.
• Company identity/ownership
• Project
• Location
• Commodity
• Deposit/geology
• Development stage
• Resource/reserve
• Processing
• Products
• Economics
• Permitting/environment
• Technical reports

## 5. Core Workflow
RECEIVE SOURCE → OPEN SOURCE → IDENTIFY SOURCE TYPE → IDENTIFY ENTITY TYPE → EXTRACT EVIDENCE
→ NORMALIZE → POPULATE SCHEMA → VALIDATE → CHECK DUPLICATES → SUBMIT

## 6. Source Authority
Tier

Sources

Use

Official company sites; government agencies; NASA/USGS;
peer-reviewed journals; original technical reports

Primary evidence; preferred for factual fields.

Manufacturer catalogs; distributor pages; Thomasnet;
established technical databases

Useful secondary evidence; verify important claims when practical.

LinkedIn; Wikipedia; Gemini/Perplexity summaries

Discovery and cross-checking only; AI summaries require
verification against original sources.

## 7. Controlled Inference
Inference is permitted only when the source statement directly supports the inferred field. Example: a statement that a company
manufactures aerospace-grade titanium forgings can support Industry = Aerospace and Product = Titanium Forgings.
Certifications, test results, resource/reserve classifications, commercial deployment, and performance values must not be
inferred.

## 8. Missing Information
Search the official source first, then use a focused Google search or another reputable source if needed. If the value cannot be
established quickly and reliably, leave the field null. Do not estimate or manufacture values.

## 9. AI-Assisted Research
Gemini, Perplexity, or similar tools may be used to summarize long PDFs, identify likely relevant pages, locate terminology, or
suggest candidate entities. AI-generated facts are not evidence by themselves. Verify material, company, project, performance,
certification, ownership, and status claims against the original source before entering them into JSON.

## 10. Duplicate Detection & Naming
Normalize canonical names to lowercase, replace '&' with 'and', normalize punctuation/hyphens/spaces, and compare
parent/subsidiary relationships before creating a new record. If duplicate identity is uncertain, escalate to Raghu/Sirisha before
creating a second supplier/company record.

## 11. QA / Rejection Rules
• Reject hallucinated or unsupported fields.
• Reject missing required schema fields.
• Reject duplicate company/supplier records.
• Reject invented certifications, performance values, ownership, permits, reserves, or commercial status.
• Reject source records without traceable URLs.
• Reject claims that contradict the source's stated date, status, or test conditions.

## 12. Escalation Matrix

Issue

Action

Potential duplicate supplier/company

Pause and confirm with Raghu/Sirisha once before creating a duplicate.

Conflicting authoritative sources

Record the conflict; use the newest applicable source only when date/context resolves it;
otherwise escalate.

Unknown material/project/technology
classification

Do not guess; escalate.

Confidential or login-only information

Do not bypass access controls; use public information and escalate if essential.

Schema ambiguity

Do not edit the schema; escalate for field mapping.

## 13. Company vs Project
Treat the corporate entity and the mineral project as separate concepts. A company may own, operate, develop, earn into, or
hold an interest in multiple projects. Capture the stated ownership/operator relationship rather than assuming ownership from
branding.

## 14. Project Lifecycle
Stage

Examples of evidence

Exploration

Exploration target, drilling, sampling, geophysics, mapping.

Resource definition

Mineral resource estimate, inferred/indicated/measured classifications.

Study

PEA, PFS, feasibility study, metallurgical study.

Permitting / development

Permit application, construction decision, financing, site development.

Construction

Explicit construction activities or project execution.

Production

Explicit operating/production evidence and reported output.

Closure / reclamation

Closure plan, reclamation or post-production activities.

## 15. Resource & Reserve Rules
• Preserve the classification exactly as reported: inferred, indicated, measured, probable, proven, or another stated category.
• Never convert a resource into a reserve.
• Never combine resource categories unless the source itself reports a combined figure.
• Record tonnes, grade, contained metal/mineral and cut-off grade exactly as reported when available.
• Record effective date and technical-report date where relevant.
• If a report is superseded, prefer the current applicable estimate while retaining historical context when the workflow requires it.

## 16. Technical & Economic Data
Capture study type, study date, currency, assumptions and stated metrics. Examples include CAPEX, OPEX, NPV, IRR, mine
life, production rate and payback period. Do not convert currencies or estimate missing economics unless explicitly required by
the schema. Forecasts are not actual production.

## 17. Geology & Processing
• Capture deposit type, host rock, mineralization, orebody and geology only when stated.
• Capture processing route only when supported: crushing, grinding, flotation, leaching, magnetic separation, roasting, solvent
extraction, ion exchange, etc.
• For tailings/reprocessing projects, preserve the input stream → processing route → recovered product relationship.
• Do not infer final product purity or recovery from a generic process description.

## 18. Permitting & Environmental Status
Distinguish permit application, review, approval, construction authorization and operating authorization. Do not treat an
application as approval. Capture environmental assessments, reclamation commitments and stated environmental metrics
without inferring regulatory status.

## 19. Routing
• General company information → SOP-DS-003.
• Government resource/geological agency information → SOP-DS-004.
• Market forecasts and supply-demand intelligence → SOP-DS-009.
• Engineering material properties → SOP-DS-010.
• Computational/crystal data → SOP-DS-011.
• Responsible-minerals/compliance information → SOP-DS-005.

## 20. Worked Example Pattern
Source: project page and technical report describing a manganese tailings reprocessing project. Extract: Company; project
name; location; commodity; project stage; resource classification and date; processing route; expected products; technical-study
metrics; permits/status. Do not infer: operating mine status, reserves from resources, approved permits, or actual production
from a feasibility forecast.
