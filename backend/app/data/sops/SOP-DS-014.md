SOP-DS-014

Industrial Waste Valorization, Circular
Materials & LCA Extraction
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
Define a consistent method for extracting organizations and technical programs that convert industrial waste or by-products into
recovered materials, construction materials, reusable products, or circular-economy applications.

## 2. Scope
• Industrial waste treatment and valorization organizations.
• Recycling, reuse and circular-material companies.
• Environmental process developers and industrial ecology programs.
• LCA, ecobalance and sustainability-analysis sources.
• Projects converting waste streams into useful materials/products.
• Pilot, demonstration and turnkey process providers.

## 3. Supported Source Types
• Company/process websites.
• Technical reports and research papers.
• Environmental and LCA studies.
• Patents and public project descriptions.
• Government and research-organization pages.
• Product/application documentation.

## 4. Expected Output
The extraction must produce structured JSON using the pre-decided Xtrium schema. Do not create, rename, remove, or
redesign schema fields. When both an organization and a material/project/technology are present, create separate objects and
link them through the appropriate relationship fields.
• Company
• Waste input
• Waste characteristics
• Valorization type
• Process
• Recovered material/product
• Application
• Testing
• LCA/ecobalance
• Circularity
• Commercial/pilot status

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

## 13. Mandatory Chain: Input → Process → Output → Application
Whenever possible, preserve the complete relationship: WASTE INPUT → PROCESS → RECOVERED MATERIAL/PRODUCT
→ APPLICATION. This prevents a recovered material from being disconnected from the waste stream and process that
produced it.

## 14. Waste Input
• Capture the waste/by-product exactly as named: slag, ash, tailings, sludge, spent catalyst, industrial residue, scrap,
wastewater-derived solids, etc.
• Capture source industry or generating process when stated.
• Capture composition only when supported by the source.
• Do not infer hazardous/non-hazardous classification, toxicity or regulatory status.

## 15. Valorization Process
Category

Examples

Physical

Sorting, crushing, grinding, separation, classification.

Thermal

Calcination, pyrolysis, thermal treatment.

Chemical

Leaching, precipitation, neutralization, extraction.

Biological

Biological treatment or bio-based recovery when explicitly stated.

Direct reuse

Use of by-product with minimal transformation.

Material conversion

Conversion into cementitious, ceramic, aggregate, polymer-filled or other products.

## 16. Recovered Materials & Applications
Create a material/product object when the recovered output is explicitly identified. Capture composition, grade, form,
specifications and application only when stated. A waste stream is not automatically a material product; distinguish raw waste,
intermediate, recovered material and finished product.

## 17. LCA & Environmental Claims
• Capture LCA results only when a study provides the metric and system boundary.
• Preserve functional unit, geographic scope, timeframe, scenario and comparison baseline where available.
• Do not infer carbon reduction, energy savings, water savings or circularity benefits from the fact that a process recycles waste.
• Do not treat marketing claims as independently verified LCA results.

## 18. Testing & Validation
Capture named standards, laboratory tests, mechanical/chemical properties, durability tests and other validation only when
explicitly reported. Certification is not implied by testing, and testing is not implied by product claims.

## 19. Research & Patents
Patents establish disclosed inventions, not necessarily commercial deployment. Research projects establish investigated
processes or materials, not necessarily production-scale availability. Record status explicitly when the source provides it.

## 20. Routing
• General company/product information → SOP-DS-003.
• Engineering material properties → SOP-DS-010.
• Computational materials/crystal data → SOP-DS-011.
• Government recycling/resource information → SOP-DS-004.
• Responsible supply-chain compliance → SOP-DS-005.
• Market intelligence → SOP-DS-009.

## 21. Worked Example Pattern
Source: industrial company describes converting a mineral-processing residue into a construction material and provides an
LCA/ecobalance study. Extract: waste input; treatment process; recovered material; application; testing; LCA metrics with
boundary/unit; pilot or commercial status. Do not infer: hazardous classification, regulatory approval, universal carbon benefit,
or commercial scale unless explicitly supported.

## 22. Universal Final Submission Checklist
• Correct SOP selected for the source.
• Every extracted field is supported by source evidence or clearly permitted direct inference.
• All required fields are populated or explicitly null.
• No estimated values.
• No invented certifications.
• No unsupported material chemistry.
• No unsupported commercial/production claims.
• Dates, units, classifications and statuses are preserved.
• Parent/subsidiary and duplicate-company checks completed.
• Source URL(s) are attached for traceability.
• JSON structure matches the approved Xtrium schema exactly.
• Potential conflicts or ambiguities have been escalated.

End of SOP Package
