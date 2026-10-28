# SOP-DS-004 | Government Critical Minerals & Resource Agency Extraction
SOP Number

SOP-DS-004

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

DOD Defense Logistics Agency, CSIRO, Geoscience Australia,
future USGS/DOE/EU critical materials agencies

Target Schemas

Xtrium Material Graph, Supplier Graph, Source/Reference Graph,
Certification/Compliance Graph, Location Graph, Relationship
Records

Purpose of this Document
This SOP governs extraction from official government, national resource, and public agency sources that describe critical minerals,
strategic materials, mineral resources, mining projects, supply risk, national lists, and geographic resource data.

## 1. Purpose & Scope
This SOP governs extraction from official government, national resource, and public agency sources that describe critical
minerals, strategic materials, mineral resources, mining projects, supply risk, national lists, and geographic resource data. The
SOP applies only to publicly available information unless Xtrium explicitly provides credentials and authorizes extraction from a
restricted source. The objective is to produce schema-compliant JSON and source-backed relationships that can be reviewed and
loaded into Xtrium's knowledge graph infrastructure.

### 1.1 Objectives





Capture official critical-material names, aliases, classifications, and government-list status.
Extract mine, project, region, resource, reserve, production, and supply-chain information when publicly available.
Create material, source, location, producer, and relationship records that preserve source authority and traceability.
Avoid mixing policy statements with verified quantitative resource or production data.

### 1.2 Source Coverage
Source Pattern

Typical Extractable Data

Authority / Use

Official agency page

Material list, program description, policy
statement, project page

Tier 1

Government PDF/report

Resource summaries, tables, maps, market risk,
commodity profiles

Tier 1

Interactive map/database

Mine/project locations, commodities, ownership
if visible

Tier 1 when public

Agency news/research article

Program updates, funding, high-level supplychain insights

Tier 1 for source claim; lower priority for
structured records

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

Critical mineral list page

Material Schema + Source Reference

Create or update material records and mark list
membership in source/notes fields.

Mine/project page

Supplier/Producer + Manufacturing Site/Mining
Location + Material Relationship

Create producer only if operator/owner is clearly
stated.

Resource map/database

Material + Location + Source

Extract only visible public fields; preserve map
URL and raw labels.

Policy or strategy document

Regulation/Source + Material mentions

Do not infer operational producers unless
explicitly stated.

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

material_name

Official material/mineral/commodity name

Copy source spelling; preserve aliases
separately.

criticality_status

Government list membership or strategic
designation

Do not generalize from one jurisdiction to global
criticality.

country_or_region

Country, state, territory, or deposit region

Use the most specific public location available.

producer_or_project

Operator, mine, project, agency, or company
when named

Escalate if ownership is uncertain or historical.

resource_or_production_data

Reserves, resources, production, import
reliance, stockpile indicators

Include units, year, and source context; never
estimate.

source_url

Exact page, PDF, or database URL

Required for every object or batch.

source_tier

Usually tier1

Do not downgrade official agency sources
unless the page is non-authoritative
commentary.

raw_notes

Tables, map legends, caveats, dates,
methodology

Use for information that does not map cleanly.

Step

Action

Output

Receive agency URL

Documented extraction decision or JSONready value

Identify page/report/map type

Documented extraction decision or JSONready value

Locate critical-material content

Documented extraction decision or JSONready value

Extract official names and list status

Documented extraction decision or JSONready value

Capture location/project/producer fields

Documented extraction decision or JSONready value

Normalize names

Documented extraction decision or JSONready value

Create JSON objects

Documented extraction decision or JSONready value

Run duplicate check

Documented extraction decision or JSONready value

QA and submit

Documented extraction decision or JSONready value

## 6. Step-by-Step Workflow

## 7. Edge Cases & Special Handling
Situation

Required Action

National list differs from another country

Record jurisdiction; do not overwrite global material status.

Map requires interaction

Extract visible table rows only; do not scrape hidden API data unless
authorized.

Resource year is old

Keep the year and source date; do not refresh from another source unless
instructed.

Agency names a company but not its role

Do not create supplier role; capture in raw_notes and escalate.

Report contains many commodities

Process commodity by commodity and submit batch plan before large
extraction.

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
"material_name": "Lithium",
"canonical_name": "lithium",
"material_type": "critical mineral",
"jurisdictional_status": {
"status": "critical/strategic material",
"jurisdiction": "source-specific government list",
"source_url": "<official agency URL>"
},
"resource_locations": [
{
"location_name": "<mine/project/region if stated>",
"country": "<country>",
"raw": "<verbatim public source text or table row>"
}
],
"sources": [{"source_name": "<agency name>", "source_url": "<URL>", "tier": "tier1"}]
}

## 10. Good vs. Bad Extraction Patterns
The following table gives acceptance examples for this SOP family. Use it during self-review before submission. The goal is not to
extract more data; the goal is to extract only defensible data and preserve the source context that makes it defensible.
Topic

Reject

Accept

Criticality

Setting criticality_status = critical globally
because one country lists the material.

Record criticality_status with the jurisdiction and
source list that supports it.

Producer

Creating a supplier because a government
report mentions a company in a paragraph.

Create supplier/producer only when the source
states operator, owner, producer, or project role.

Resource value

Copying a reserve number without year, unit, or
country.

Capture value, unit, year, geography, source
URL, and raw row/context.

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

Same source pattern is processed differently

Apply this SOP consistently or document the

## 11. Common Contractor Mistakes

Batch inconsistency

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
