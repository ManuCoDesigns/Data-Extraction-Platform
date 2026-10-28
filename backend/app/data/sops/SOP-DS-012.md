SOP-DS-012

Advanced Battery, Electrochemical &
Functional Materials Extraction
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
Define a consistent method for extracting structured information from organizations and technical sources working on advanced
batteries, electrochemical energy-storage systems, fuel cells, battery-management systems, and functional electrochemical
materials.

## 2. Scope
• Battery technology companies and advanced battery developers.
• Battery-material and functional-material developers.
• Fuel-cell and electrochemical technology organizations.
• Battery-management-system (BMS) developers.
• Patents, technical publications, demonstrations, research programs and technology pages.
• Capture company, technology, materials, products, performance, applications, research/IP and development status.

## 3. Supported Source Types
• Company and technology websites.
• Technical datasheets and product pages.
• Patents and patent databases.
• Peer-reviewed papers and conference publications.
• Government and laboratory research pages.
• Investor/technical presentations where publicly available.

## 4. Expected Output
The extraction must produce structured JSON using the pre-decided Xtrium schema. Do not create, rename, remove, or
redesign schema fields. When both an organization and a material/project/technology are present, create separate objects and
link them through the appropriate relationship fields.
• Company / organization
• Technology
• Material
• Product/component
• Performance
• Application
• Research/IP
• Commercial or development status

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

Issue

Action

Unknown material/project/technology
classification

Do not guess; escalate.

Confidential or login-only information

Do not bypass access controls; use public information and escalate if essential.

Schema ambiguity

Do not edit the schema; escalate for field mapping.

## 13. Entity Identification
Source evidence

Create

Company develops a battery chemistry or platform

Company + Technology

Specific electrode/electrolyte material is described

Material + Technology/Component relationship

Commercial battery product is explicitly named

Product + Company + Technology relationship

Patent describes an invention

Research/IP record; do not automatically create a commercial product

Research prototype or demonstration

Technology/Research record with status = prototype/demonstration when
stated

## 14. Battery / Electrochemical Extraction Rules
• Capture the chemistry exactly as stated: e.g., lithium-ion, sodium-ion, solid-state, flow battery, PEM fuel cell. Do not infer
chemistry from generic terms such as 'next-generation battery.'
• Capture specific materials only when the source names them. Examples may include cathode, anode, electrolyte, separator,
catalyst or current collector materials.
• Preserve architecture/configuration: cell format, electrode configuration, stack configuration, voltage range, capacity basis,
temperature, cycle protocol and other stated test conditions.
• Separate measured/experimental values from projected, modeled, target, roadmap or theoretical values.
• Record units exactly as presented and retain the test basis whenever available.
• Distinguish commercial product, pilot, prototype, laboratory result, demonstration, research concept and future technology.

## 15. Performance Data
Field

Rule

Energy density

Record value, unit, gravimetric/volumetric basis, cell/system level, date and test basis when stated.

Power density

Record value, unit and configuration/test basis.

Cycle life

Record cycles plus retention criterion and protocol if provided.

Efficiency

Record round-trip, coulombic, electrical or other defined efficiency exactly as specified.

Safety / operating window

Capture only stated limits or test outcomes; do not infer safety from marketing language.

## 16. Research & IP
Patent ≠ commercial product. A patent may support an invention, material composition, process, architecture or application, but
it does not establish commercial availability. Research papers may establish experimental results without establishing a
company product.

## 17. Routing to Other SOPs
• General company/product information → SOP-DS-003.
• Engineering material properties and handbook-style data → SOP-DS-010.
• Computational materials, crystal structures and calculated properties → SOP-DS-011.
• Responsible-minerals or supply-chain compliance content → SOP-DS-005.
• Market forecasts and market intelligence → SOP-DS-009.

## 18. Worked Example Pattern
Source: technology company page stating that it develops a solid-state battery using a named electrolyte and reporting
prototype cycle data. Extract: Company; Technology = solid-state battery; Material = named electrolyte; Prototype status;
measured cycle data with retention/test condition if stated. Do not extract: commercial availability, future production volume, or
unreported chemistry details.
