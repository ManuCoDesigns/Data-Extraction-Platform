# SOP-DS-005 | Responsible Minerals & Supply Chain Compliance Extraction
SOP Number

SOP-DS-005

Version

1.0

Effective Date

July 27, 2026

Department

Data Operations

Prepared By

Xtrium Data Team

Applies To

Careerflow AI Contractors; Xtrium Data Operations; QA
Reviewers

Example Sources

Responsible Minerals Initiative, OECD Due Diligence Guidance,
EU Battery Regulation, Assent reference materials, future
REACH/RoHS/PFAS/conflict minerals sources

Target Schemas

Xtrium Material Graph, Supplier Graph, Source/Reference Graph,
Certification/Compliance Graph, Location Graph, Relationship
Records

Purpose of this Document
This SOP governs extraction from responsible sourcing, supply-chain due diligence, mineral compliance, and regulatory sources.
These sources define obligations and risk frameworks rather than normal material properties or supplier product catalogs.

## 1. Purpose & Scope
This SOP governs extraction from responsible sourcing, supply-chain due diligence, mineral compliance, and regulatory sources.
These sources define obligations and risk frameworks rather than normal material properties or supplier product catalogs. The
SOP applies only to publicly available information unless Xtrium explicitly provides credentials and authorizes extraction from a
restricted source. The objective is to produce schema-compliant JSON and source-backed relationships that can be reviewed and
loaded into Xtrium's knowledge graph infrastructure.

### 1.1 Objectives





Identify regulated or reportable materials, minerals, metals, and supply-chain risk categories.
Extract compliance frameworks, reporting templates, audit expectations, and due diligence obligations.
Create certification, regulation, standard, material, and supplier-risk relationship records without legal interpretation beyond
the source text.
Preserve exact source terminology for obligations, effective dates, covered materials, and jurisdiction.

### 1.2 Source Coverage
Source Pattern

Typical Extractable Data

Authority / Use

Industry initiative

Reporting templates, conformant smelter/refiner
lists, due diligence tools

Tier 1/2 depending on source authority

International guidance

Frameworks, steps, risk categories,
recommended controls

Tier 1 for guidance

Regulation text

Legal obligations, covered products/materials,
dates, reporting requirements

Tier 1

Commercial compliance platform

Educational summaries, workflow concepts,
supplier compliance fields

Tier 3 unless primary source is linked

## 2. Roles & Responsibilities
Role

Responsibility

Data Extraction Contractor

Open assigned source links, classify source/entity type, extract only
supported public data, normalize values, create JSON outputs, and
document any uncertainty.

Data Transformation Specialist

Apply schema rules, split supplier/material/compliance/location
records as required, preserve raw source context, and ensure
relationships are represented consistently.

QA Reviewer

Validate JSON syntax, source traceability, field completeness,
duplicate checks, and compliance with this SOP before accepting the

batch.
Project Lead

Resolve ambiguous source authority, duplicates, parent/subsidiary
cases, schema gaps, confidential access issues, and contractor
questions.

Raghu/Sirisha

Final escalation path for duplicate supplier/material decisions, source
prioritization, and cases that may affect Xtrium schema or production
ingestion.

## 3. Non-Negotiable Operating Rules
Rule 1

SOURCE-BACKED EXTRACTION
Every extracted value must be traceable to a page, report, table,
figure, file, or reference. If QA cannot find the supporting source,
the value fails.

Rule 2

NULL OVER GUESSING
If a field is absent, set null or [] according to schema. Never
estimate values, dates, locations, ownership, certifications, or
production capacity.

Rule 3

PRESERVE SOURCE SCOPE
Do not expand a local, regional, or source-specific claim into a
global fact. Keep jurisdiction, date, report scope, and scenario
labels attached.

Rule 4

NO SCHEMA MODIFICATION
Do not create new fields. Use approved raw/notes/source fields
and escalation files for unsupported but potentially valuable data.

Rule 5

DUPLICATE PREVENTION
Search current working outputs before creating new entities.
Names, aliases, subsidiaries, and abbreviations must be
checked.

## 4. Schema Selection & Mapping Strategy
The contractor must choose the schema based on the dominant entity in the source. If the source describes both a company and
materials/products, create both objects and link them. If the source describes a framework, obligation, or regulatory requirement,
create compliance/reference objects first and link materials or suppliers only when explicitly supported.
If the source primarily describes...

Create / Update

Required Caution

Regulatory text

Regulation/Compliance Reference + Material
Relationship

Extract covered materials and obligations; no
legal advice.

Reporting template page

Standard/Template + Material + Supplier
relationship fields

Capture required report fields and material
scope.

Audit/conformance program

Certification/Program + Supplier/Facility
relationships

Only create facility/smelter records if directly
provided.

Commercial blog/guide

Source Reference only unless verified by
primary source

Use as discovery, not authoritative extraction.

### 4.1 Decision Tree
START -> Classify source -> Identify primary entity -> Choose schema -> Extract supported fields -> Create relationships -> Validate
-> Submit

IMPORTANT

If the page supports multiple entity types, do not collapse them into one object. Create separate Supplier, Material, Compliance,
Location, Property, or Source objects as appropriate, then link them through explicit relationship records.

## 5. Field-by-Field Extraction Reference
Field / Object

Source Evidence

Transformation Rule

framework_name

Name of regulation, guidance, template, or
initiative

Use official title exactly.

covered_materials

Materials or minerals named in the source

Do not infer additional materials from category
language.

jurisdiction

EU, global, OECD, industry, country, etc.

Required when obligations are jurisdictional.

obligation_type

Due diligence, reporting, recycled content, risk
assessment, supplier declaration

Use controlled label if available.

effective_date_or_version

Date, version, publication year

Never invent; set null if absent.

auditable_entity

Supplier, smelter, refiner, importer,
manufacturer, economic operator

Use exact source terminology.

source_url

Official page or document URL

Required.

raw_requirement_text

Concise source excerpt or paraphrased rule with
section reference

Keep enough detail for QA to verify.

Step

Action

Output

Receive compliance URL

Documented extraction decision or JSONready value

Identify framework type

Documented extraction decision or JSONready value

Find covered material scope

Documented extraction decision or JSONready value

Extract obligation categories

Documented extraction decision or JSONready value

Capture jurisdiction and version

Documented extraction decision or JSONready value

Link materials to obligations

Documented extraction decision or JSONready value

Avoid legal interpretation

Documented extraction decision or JSONready value

Validate citations

Documented extraction decision or JSONready value

QA and submit

Documented extraction decision or JSONready value

## 6. Step-by-Step Workflow

## 7. Edge Cases & Special Handling
Situation

Required Action

Source is legal text

Extract obligations as structured facts; do not give legal advice or interpret
applicability beyond source wording.

Commercial platform summarizes a regulation

Use as discovery; verify with primary regulation before creating
compliance records.

Template has many columns

Preserve all column names in raw or template_field arrays.

Material list includes groups

Record exact group and member materials only when listed.

Conformance lists are downloadable

Extract only public rows and retain version/date of list.

## 8. Quality Assurance Checklist
QA Item

Acceptance Standard

Every object has a source URL or source object that points to the
exact page/report/database used.

Source URL present
No hallucinations

All facts are directly supported or marked as inference when inference
is allowed by SOP-DS-003.

Schema valid

JSON parses successfully and uses only approved schema fields.

Required nulls applied

Absent values are null or [] rather than guessed.

Duplicate check complete

Supplier/material/location/compliance records checked against
working dataset.

Relationships verified

Links between materials, suppliers, locations, standards, and sources
are explicit and source-supported.

Escalations documented

Ambiguous decisions are recorded in a review file or sent to the
Project Lead.

## 9. Complete Worked Example
The following simplified example illustrates the output pattern. Contractors must still follow the exact Xtrium schema version
assigned for the live batch. Field names shown here are representative and may require adjustment to the active schema
template.
{
"compliance_reference": {
"framework_name": "<official framework name>",
"jurisdiction": "<jurisdiction>",
"covered_materials": ["cobalt", "lithium", "nickel", "natural graphite"],
"obligation_type": "supply chain due diligence",
"effective_date": "<date if stated>",
"raw_requirement_text": "<traceable source text or section summary>",
"source_url": "<official URL>"
},
"relationships": [
{"from": "material:cobalt", "to": "compliance_reference:<canonical>", "type": "covered_by"}
]
}

## 10. Good vs. Bad Extraction Patterns
The following table gives acceptance examples for this SOP family. Use it during self-review before submission. The goal is not to
extract more data; the goal is to extract only defensible data and preserve the source context that makes it defensible.
Topic

Reject

Accept

Compliance

Interpreting regulation applicability for a
company.

Extract covered materials, obligations, and
jurisdiction exactly; escalate applicability
questions.

Certifications

Inventing a certification because a supplier says
responsible sourcing.

Create certification/program records only when
the program, conformance list, or certificate is
explicitly stated.

Commercial summaries

Using a blog summary as the only authority for a
legal obligation.

Use commercial summaries for discovery, then
verify against primary regulation or initiative
source.

Mistake

Why It Fails QA

Correction

Missing source context

Value is copied but the exact URL, page,
section, date, or source tier is missing.

Add source_url and raw context before
submission.

Over-merging entities

Parent company, subsidiary, mine, locality,
material, and product are collapsed into a single
object.

Split entities and create explicit relationships.

Unsupported inference

Contractor infers production, certification,
capacity, or active status from vague language.

Use null and escalate.

Schema drift

Contractor adds a new convenient field to
capture unusual data.

Use approved raw/notes fields and log schema
enhancement request.

Batch inconsistency

Same source pattern is processed differently

Apply this SOP consistently or document the

## 11. Common Contractor Mistakes

across rows.

exception.

## 12. Pilot Batch Acceptance Criteria
For the first extraction batch under this SOP, contractors should submit a small pilot before processing the full source. A pilot
should contain enough examples to expose edge cases without over-producing records that may need rework.
Criterion

Requirement

Minimum pilot size

5-10 representative records or pages, unless the Project Lead
requests a different sample.

Required variety

Include at least one simple record, one missing-data case, one
relationship case, and one ambiguity/escalation case.

Review artifacts

Submit JSON, source list, review log, and QA checklist together.

Approval gate

Do not proceed to full extraction until pilot feedback has been
addressed.

## 13. Submission Package
Deliverable

Required Contents

Filename Guidance

JSON outputs

One JSON file per entity or per approved batch.
Supplier, material, compliance, location, and
relationship outputs must remain separable.

{canonical_name}.json or {source_slug}
_{batch}.json

Review log

Ambiguities, duplicates, inaccessible pages,
excluded restricted data, and source conflicts.

{source_slug}_review_log.xlsx/json

Source list

URLs, titles, dates accessed, source tier, and
extraction status.

{source_slug}_sources.csv/json

QA checklist

Completed acceptance checklist for the batch.

{source_slug}_qa_checklist.pdf/xlsx

Batch Acceptance Rule
A batch is not ready for Xtrium review until JSON syntax, source URLs, duplicate checks, and null handling have all passed. A single
invented certification, duplicate supplier, or unsupported value can cause the batch to be rejected.
