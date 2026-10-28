# SOP-DS-008 | National Lab & Research Program Extraction
SOP Number

SOP-DS-008

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

Argonne National Laboratory, future NREL, ORNL, Sandia,
Berkeley Lab, NASA research programs, DOE-funded research
pages

Target Schemas

Xtrium Material Graph, Supplier Graph, Source/Reference Graph,
Certification/Compliance Graph, Location Graph, Relationship
Records

Purpose of this Document
This SOP governs extraction from national laboratory and public research program sources. These sources often describe emerging
technologies, battery materials, recycling pathways, critical-material demand, pilot systems, and process relationships rather than
commercial suppliers.

## 1. Purpose & Scope
This SOP governs extraction from national laboratory and public research program sources. These sources often describe
emerging technologies, battery materials, recycling pathways, critical-material demand, pilot systems, and process relationships
rather than commercial suppliers. The SOP applies only to publicly available information unless Xtrium explicitly provides
credentials and authorizes extraction from a restricted source. The objective is to produce schema-compliant JSON and sourcebacked relationships that can be reviewed and loaded into Xtrium's knowledge graph infrastructure.

### 1.1 Objectives





Extract materials, processes, applications, research programs, datasets, and technology relationships from lab sources.
Represent research findings separately from supplier claims or commercial availability.
Capture battery, recycling, recovery, substitution, manufacturing, and sustainability relationships where directly supported.
Preserve methodology, publication date, project names, and source context for QA.

### 1.2 Source Coverage
Source Pattern

Typical Extractable Data

Authority / Use

Research highlight page

Material/process/application summary, project
contacts, related publications

Tier 1/2 depending on lab authority

Dataset/tool page

Model outputs, assumptions, downloadable
data, documentation

Tier 1/2

Technical report/PDF

Detailed methods, figures, tables, metrics

Tier 1/2

News article

High-level research claim, team/project names

Use for discovery; verify against report if
available

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

Material demand/recovery page

Material + Application + Sustainability
relationship

Capture claim with source context; avoid
converting model result into current market fact.

Recycling/process page

Process Method + Material Relationship

Create process relationships such as
recovered_from, recycled_by, substitutes_for.

Lab dataset

Source + Property/Market/Sustainability object

Preserve version and methodology.

Publication/report

Research Source + Extracted material facts

Extract only values supported by tables/text.

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

program_or_project

Lab program, project, model, or initiative name

Required when extraction is from project page.

materials_mentioned

Materials, elements, battery chemistries,
feedstocks

Normalize but preserve source terminology.

process_method

Recycling, recovery, separation, manufacturing,
substitution, modeling method

Use direct source terms.

application

Battery, EV, aerospace, energy storage,
defense, etc.

Inference allowed only when explicit context
supports it.

quantitative_result

Demand, recovery rate, mass, efficiency, cost,
emissions, etc.

Include unit, year, scenario, and source.

technology_readiness

TRL or maturity if stated

Set null if absent.

limitations

Methodology caveats and assumptions

Capture in raw_notes.

source_url

Exact research page/report URL

Required.

Step

Action

Output

Receive lab URL

Documented extraction decision or JSONready value

Identify source type

Documented extraction decision or JSONready value

Identify material/process/application focus

Documented extraction decision or JSONready value

Extract direct claims and tables

Documented extraction decision or JSONready value

Capture methodology/version

Documented extraction decision or JSONready value

Create material and process relationships

Documented extraction decision or JSONready value

Separate model results from facts

Documented extraction decision or JSONready value

Validate citations

Documented extraction decision or JSONready value

QA and submit

Documented extraction decision or JSONready value

## 6. Step-by-Step Workflow

## 7. Edge Cases & Special Handling
Situation

Required Action

Source is a news article about a paper

Use article for discovery; locate report/paper when possible.

Result is scenario-based

Store scenario label and assumptions; do not treat as actual current value.

Research mentions a company partner

Do not create supplier unless role is explicit and public.

Figures contain data

Extract only if readable; otherwise note figure and escalate if needed.

Method is experimental

Mark as research_stage/experimental when indicated.

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
"research_record": {
"program_or_project": "<lab project name>",
"materials_mentioned": ["lithium", "nickel", "cobalt"],
"process_method": "battery material recovery",
"application": "electric vehicle batteries",
"quantitative_results": [
{"metric": "<metric>", "value": "<value>", "unit": "<unit>", "scenario": "<scenario if stated>"}
],
"limitations": "<methodology caveats>",
"source_url": "<lab URL>"
}
}

## 10. Good vs. Bad Extraction Patterns
The following table gives acceptance examples for this SOP family. Use it during self-review before submission. The goal is not to
extract more data; the goal is to extract only defensible data and preserve the source context that makes it defensible.
Topic

Reject

Accept

Research claims

Treating scenario model output as a current
market fact.

Label forecast, scenario, model, method, and
assumptions.

Partners

Creating suppliers from organizations mentioned
in research collaborations.

Create supplier relationship only when
commercial role is explicit.

Figures

Estimating values from charts without labels.

Extract labeled values only; otherwise capture
qualitative trend and figure reference.

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

5-10 representative records or pages, unless the Project Lead
requests a different sample.

Minimum pilot size
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

Amendment (v1.1, August 4, 2026)

# SOP-DS-008 | National Lab & Research Program Extraction - Amendment
v1.1
Amendment Scope
This amendment expands SOP-DS-008 beyond individual national laboratory websites. It now applies to national
laboratories, DOE research programs, federal materials-discovery initiatives, public research consortia, and official program
portals that describe clean-energy materials, defense materials, sustainability, materials discovery, data infrastructure, or
manufacturing research.

## 1. Purpose & Scope
This SOP governs extraction from national laboratory and public research-program sources. These sources often
describe emerging technologies, material discovery programs, advanced manufacturing capabilities, test facilities,
battery and energy-materials research, recycling pathways, critical-material substitution, and public datasets. They
usually do not behave like supplier websites, because their goal is not to sell a product. Their value to Xtrium is in the
relationships they reveal between materials, processes, applications, facilities, research programs, datasets, and publicsector funding priorities.
The SOP applies to publicly available information only. Restricted project pages, controlled technical data, proprietary
sponsor deliverables, export-controlled content, and non-public collaborator records must not be extracted unless
Xtrium leadership explicitly authorizes the batch and provides access instructions.

### 1.1 Sources Covered by Amendment v1.1
Source Type
National laboratory website

Example Rows / Sources
Lawrence Berkeley National
Laboratory; Sandia National
Laboratories

DOE program or consortium

DOE Energy Materials Network

Federal materials-discovery
initiative

Materials Genome Initiative

Lab-hosted database landing
page

Materials Project hosted by
LBNL

Research paper linked from lab
page

Lab publication describing a
material/process

Primary Xtrium Value
Research areas, facilities,
program pages, publications,
datasets, clean-energy material
work, defense and energy
materials capabilities
Program nodes, capability
nodes, partner institutions,
materials-development
objectives, testing infrastructure
Materials data infrastructure,
standards, repositories,
discovery frameworks, policy
priorities
Landing pages and institutional
context only. Database record
extraction follows SOP-DS-011.
Material/process/application
relationships and measured or
computed results if supported.

Default SOP Handling
Use SOP-DS-008

Use SOP-DS-008 with
consortium subsection

Use SOP-DS-008 with initiative
subsection

Route database records to
SOP-DS-011
Use SOP-DS-008 plus
research-paper rules from SOPDS-003

### 1.2 Objectives






Extract research programs, technical capabilities, facilities, datasets, materials, processes, applications, and relationships
from public national-lab and federal-program sources.
Represent research findings separately from supplier claims, commercial availability, and production capacity.
Capture clean-energy, defense, battery, recycling, recovery, substitution, manufacturing, and sustainability relationships
when directly supported by the source.
Preserve project names, program names, sponsoring agency, publication date, methodology context, and source URL so
QA can trace every claim.
Identify when the source points to a separate database that requires SOP-DS-010 or SOP-DS-011 rather than continuing
under SOP-DS-008.

## 2. Non-Negotiable Operating Rules
Rule 1

NO COMMERCIAL SUPPLIER
INFERENCE

Do not label a national lab as a
supplier or manufacturer of a material
unless the source explicitly describes a
publicly available product, licensing
record, or technology-transfer offering.

Rule 2

RESEARCH IS NOT AVAILABILITY

A lab study showing a material,
process, or prototype does not prove
commercial availability, manufacturing
capacity, lead time, or supplier
readiness.

Rule 3

PRESERVE PROGRAM CONTEXT

Every extracted claim must retain the
lab, program, project, source page,
date accessed, and any funding or
sponsor context visible on the page.

Rule 4

SEPARATE MEASURED, MODELED,
AND DEMONSTRATED DATA

Experimental results, simulation
results, demonstration-scale claims,
and roadmap statements must be
stored as different evidence types.

Rule 5

ROUTE DATABASE RECORDS
CORRECTLY

If the source leads to a materialproperty database, use SOP-DS-010. If
it leads to a computed/crystal-structure
database, use SOP-DS-011.

Rule 6

NO RESTRICTED DATA

Do not extract export-controlled,
proprietary, confidential, loginrestricted, or non-public sponsor
content without written authorization
from Xtrium leadership.

## 3. Schema Selection & Extraction Strategy
National-lab and research-program sources usually require more relationship thinking than simple field extraction.
Contractors must first identify the dominant entity: program, project, facility, dataset, material, process, application, or
publication. Then create the minimal set of schema objects needed to preserve that source accurately.
Dominant Source Content
Research program page

Primary Object
research_program

Secondary Objects
materials, processes,
applications, facilities

Lab facility page

facility

Battery or recycling research
page

research_record

methods, instruments, materials
tested, partner programs
materials, processes, waste
streams, applications

Technology-transfer page

technology_record

IP/licensing status, process,
application, material

Materials-data initiative page

program/initiative

Lab-hosted database record

material/computation/structure

repositories, standards, data
infrastructure, participating
agencies
properties, sources, references

Relationship Examples
program studies material;
program supports process;
program targets application
facility characterizes material;
facility supports method
process recovers material;
material used in battery
application
technology applicable to
material; technology licensed by
organization if stated
initiative supports repository;
initiative defines data standard
use SOP-DS-010 or SOPDS-011 for individual records

### 3.1 Decision Tree
START
|
+-- Is this source a national lab, DOE program, federal initiative, or research consortium?
|
+-- YES --> Use SOP-DS-008 for page-level extraction.
|
|
|
+-- Does the page link to individual material datasheets?
|
|
+-- YES --> Route record extraction to SOP-DS-010.
|
|

|
+-- Does the page link to computed materials or crystal structures?
|
+-- YES --> Route record extraction to SOP-DS-011.
|
+-- NO --> Use SOP-DS-003 schema selection or another source-specific SOP.

## 4. Field-by-Field Extraction Reference
Field / Data Element
program_or_project_name

Where to Look
Page title, program heading,
DOE program card

Extraction Rule
Copy exact public name. Do not
rename or summarize.

host_organization

Lab logo, About page, footer,
source domain

materials_mentioned

Body text, figures, data tables,
publication abstracts

process_or_method

Research description, methods
section, facility capability

application_domain

Program goal, industry use
case, funding objective

quantitative_results

Tables, charts, abstract,
research highlight

facility_or_capability

Facility pages, user facility
pages, equipment descriptions

Use official lab/program name,
e.g., Lawrence Berkeley
National Laboratory or Sandia
National Laboratories.
Extract specific materials,
elements, compounds, alloys,
polymers, ceramics,
electrolytes, catalysts, or
minerals named directly.
Extract processes such as
synthesis, recovery, recycling,
additive manufacturing,
characterization, highthroughput screening, or
modeling.
Allowed inference from explicit
phrasing such as battery, grid
storage, aerospace, defense,
semiconductor, hydrogen, or
solar.
Capture value, unit, metric,
sample/material, method, and
condition.
Capture facility name and
capability category.

source_date

Page metadata, publication
date, news date
Data availability section,
downloads, links

Capture visible
publication/update date.
Capture URL and route record
extraction to relevant SOP.

linked_dataset_or_repository

Null / Escalation Rule
If no project/program name
exists, use page title and flag for
review.
If source ownership is unclear,
escalate.

Do not extract generic terms
such as advanced materials
unless no specific material is
provided; record generic term in
raw notes.
If method is implied but not
named, record null and add
note.

Do not infer final product market
beyond what source states.

If chart value is not readable, do
not estimate. Escalate if
important.
Do not imply public access
unless source states user
program or access route.
If absent, use accessed date
only.
If download requires login,
escalate.

## 5. Step-by-Step Workflow
1.
2.
3.
4.
5.
6.
7.
8.
9.

Open the assigned lab/program URL and confirm the source is public and within scope.
Classify the source as lab page, federal program, research consortium, facility page, publication, technology-transfer
page, or database landing page.
Identify the dominant entity and select the primary object type before extracting details.
Extract only source-supported materials, processes, applications, datasets, facilities, project names, and quantitative
results.
If the source links to individual material-property records, stop and route those records to SOP-DS-010.
If the source links to computed material or crystal-structure records, stop and route those records to SOP-DS-011.
Populate source metadata, access date, source tier, raw snippet, and relationship notes.
Run duplicate checks against existing programs, labs, materials, facilities, and databases.
Complete QA checklist and submit JSON with a review log for ambiguous items.

## 6. Edge Cases & Required Handling
Situation
Lab page mentions a material but provides no property data
Program page describes substitution for critical materials
Research page links to a journal article
DOE program lists multiple partner labs
Lab page mentions a company collaborator

Required Action
Create material mention or relationship only. Do not create a
property object.
Create relationship: program targets substitution of material.
Preserve source wording and do not infer success.
Extract visible page data. Use the article only if assigned and
accessible.
Create organization relationships only when partner list is explicit.
Do not create supplier record unless source gives company identity
and role; otherwise record collaborator relationship and escalate.

Situation
Page contains classified/export-control language
Page is a press release with promotional language
Page is outdated

Required Action
Stop extraction and escalate to Raghu/Sirisha.
Extract factual claims only; keep marketing statements in raw notes
if useful.
Capture date and flag staleness. Do not update from newer sources
unless assigned.

## 7. QA Checklist
QA Item
Source classification
Schema routing
Source traceability
Research vs commercial distinction
Method context
Duplicates
Escalations

Pass Criteria
Source is correctly classified as
lab/program/consortium/facility/publication/database landing page.
Database records routed to SOP-DS-010 or SOP-DS-011 when
required.
Every claim has URL, source title, source date/accessed date, and
raw support.
No lab research result is represented as commercial availability or
supplier capacity.
Quantitative results include metric, unit, condition, method/context
where available.
Existing lab/program/material/facility records checked before new
records are created.
Restricted content, ambiguous collaborators, and conflicting
program names are logged.

## 8. Worked Example - Research Program Page
Input source pattern: A DOE or national-lab page describes a clean-energy materials program focused on accelerating
materials discovery, improving data sharing, and supporting battery or semiconductor applications.
{
"research_program": {
"program_name": "<exact program or initiative name>",
"host_organization": "<lab, DOE office, or federal initiative>",
"program_type": "national_lab_research_program",
"materials_mentioned": ["<material 1>", "<material 2>"],
"processes_or_methods": ["<method, e.g., high-throughput screening>"],
"applications": ["<application, e.g., clean energy materials>"],
"linked_repositories": [{"name": "<repository>", "url": "<url>", "route_to_sop": "SOP-DS-010 or
SOP-DS-011 if record-level extraction is required"}],
"evidence_type": "program_page",
"source_url": "<public URL>",
"source_tier": "tier1",
"notes": "Do not infer supplier availability from research content."
}
}
