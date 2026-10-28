# SOP-DS-006 | Mindat Mineral Locality & Deposit Extraction
SOP Number

SOP-DS-006

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

Mindat mineral pages, locality pages, mine pages, deposit pages,
regional mineral occurrence pages

Target Schemas

Xtrium Material Graph, Supplier Graph, Source/Reference Graph,
Certification/Compliance Graph, Location Graph, Relationship
Records

Purpose of this Document
This SOP governs extraction from Mindat-style mineral species and locality records. Mindat should be treated as a mineral and locality
enrichment source, not as a supplier catalog. It can support mineral identity, locality, mine/deposit relationships, associated minerals,
and references.

## 1. Purpose & Scope
This SOP governs extraction from Mindat-style mineral species and locality records. Mindat should be treated as a mineral and
locality enrichment source, not as a supplier catalog. It can support mineral identity, locality, mine/deposit relationships,
associated minerals, and references. The SOP applies only to publicly available information unless Xtrium explicitly provides
credentials and authorizes extraction from a restricted source. The objective is to produce schema-compliant JSON and sourcebacked relationships that can be reviewed and loaded into Xtrium's knowledge graph infrastructure.

### 1.1 Objectives





Extract mineral species, formula, classification, and aliases where available.
Extract locality, mine/deposit, country, region, and geographic hierarchy data.
Create relationships between mineral species, localities, mines, deposits, and associated minerals.
Prevent confusion between a mine/locality and a current supplier or producer.

### 1.2 Source Coverage
Source Pattern

Typical Extractable Data

Authority / Use

Mineral species page

Name, formula, classification, images,
references, related localities

Tier 2 reference unless cross-verified

Locality page

Mine/deposit/locality name, administrative
region, listed minerals

Tier 2 reference

Photo/specimen page

Images and specimen-level metadata

Use only if needed; not primary for supplier
extraction

Reference section

Bibliographic citations supporting mineral/locality
data

Use to enrich source references

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

Resolve ambiguous source authority, duplicates, parent/subsidiary
cases, schema gaps, confidential access issues, and contractor
questions.

Project Lead

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

Mineral page

Material Schema + Source

Create mineral material object; link to localities
when visible.

Locality/mine page

Location/Mining Site + Material Relationship

Do not create supplier unless operator is clearly
named and current.

Associated minerals list

Material-to-Material Relationship

Use relationship type associated_with or
co_occurs_with.

Reference list

Source objects

Capture citations where available; do not treat
every reference as a property source unless
used.

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

mineral_name

Mineral species name

Copy as listed; preserve variants/aliases
separately.

chemical_formula

Formula if shown

Copy exactly; do not normalize chemistry.

mineral_group_or_class

Group, class, type, or category

Set null if not clear.

locality_name

Mine, quarry, deposit, locality, region

Use full hierarchy when available.

country_region

Country/state/province/district

Record as separate components if possible.

associated_minerals

Minerals listed at same locality

Create relationship records, not duplicate notes
only.

references

Mindat reference list or citation text

Preserve raw citation when structured parsing is
not possible.

source_url

Exact Mindat page URL

Required for every object.

Step

Action

Output

Receive Mindat URL

Documented extraction decision or JSONready value

Identify mineral or locality page

Documented extraction decision or JSONready value

Extract page identity fields

Documented extraction decision or JSONready value

Capture formula/classification if present

Documented extraction decision or JSONready value

Extract locality hierarchy

Documented extraction decision or JSONready value

Create mineral-locality relationships

Documented extraction decision or JSONready value

Capture associated minerals

Documented extraction decision or JSONready value

Run duplicate check

Documented extraction decision or JSONready value

QA and submit

Documented extraction decision or JSONready value

## 6. Step-by-Step Workflow

## 7. Edge Cases & Special Handling
Situation

Required Action

Locality is historical

Record as historical/unknown status if status is not current; do not infer
active production.

Mine operator missing

Do not create supplier. Create locality only.

Mineral name duplicates existing material

Merge only if canonical mineral identity matches; otherwise escalate.

Many associated minerals

Extract all if feasible; otherwise ask for batch guidance.

Coordinates are approximate

Mark as approximate in raw notes if indicated by source.

## 8. Quality Assurance Checklist
QA Item

Acceptance Standard

Source URL present

Every object has a source URL or source object that points to the
exact page/report/database used.

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
"material_name": "<mineral species>",
"canonical_name": "<mineral-species>",
"chemical_formula": "<formula if stated>",
"material_type": "mineral",
"localities": [
{
"locality_name": "<mine/deposit/locality>",
"country": "<country>",
"region": "<region>",
"raw": "<source locality hierarchy>"
}
],
"relationships": [
{"type": "occurs_at", "target": "locality:<canonical-locality>"}
],
"sources": [{"source_name": "Mindat", "source_url": "<URL>", "tier": "tier2"}]
}

## 10. Good vs. Bad Extraction Patterns
The following table gives acceptance examples for this SOP family. Use it during self-review before submission. The goal is not to
extract more data; the goal is to extract only defensible data and preserve the source context that makes it defensible.
Topic

Reject

Accept

Mine status

Treating every locality as an active producer.

Create locality/deposit record; create supplier
only when current operator is clearly stated.

Mineral identity

Merging similar mineral names without
confirmation.

Use exact mineral species and escalate
variant/synonym questions.

Associated minerals

Dropping long associated-mineral lists.

Extract all feasible associations or request batch
guidance if the list is too large.

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
across rows.

Apply this SOP consistently or document the
exception.

## 11. Common Contractor Mistakes

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
