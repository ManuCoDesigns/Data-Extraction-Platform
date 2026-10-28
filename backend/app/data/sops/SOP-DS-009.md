# SOP-DS-009 | Market Intelligence & Critical Materials Supply Chain Extraction
SOP Number

SOP-DS-009

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

BloombergNEF, future Benchmark Mineral Intelligence, S&P
Global, Fastmarkets, IEA market reports, public market
summaries

Target Schemas

Xtrium Material Graph, Supplier Graph, Source/Reference Graph,
Certification/Compliance Graph, Location Graph, Relationship
Records

Purpose of this Document
This SOP governs extraction from market intelligence and supply-chain forecasting sources that describe critical-material demand,
supply concentration, capacity, prices, regional bottlenecks, and energy-transition materials trends. Use this SOP only when access
and citation rights are clear.

## 1. Purpose & Scope
This SOP governs extraction from market intelligence and supply-chain forecasting sources that describe critical-material demand,
supply concentration, capacity, prices, regional bottlenecks, and energy-transition materials trends. Use this SOP only when
access and citation rights are clear. The SOP applies only to publicly available information unless Xtrium explicitly provides
credentials and authorizes extraction from a restricted source. The objective is to produce schema-compliant JSON and sourcebacked relationships that can be reviewed and loaded into Xtrium's knowledge graph infrastructure.

### 1.1 Objectives





Extract market-level signals that enrich Xtrium's material and supply-chain intelligence layers.
Capture demand, supply, capacity, price, regional concentration, and forecast information with dates and scenarios.
Separate current measured data from forecast, scenario, analyst commentary, or paywalled/proprietary claims.
Respect access restrictions and avoid copying confidential or paywalled content into deliverables.

### 1.2 Source Coverage
Source Pattern

Typical Extractable Data

Authority / Use

Public insight article

Market trend, demand/supply signal, material
focus, region

Tier 2/3 depending on source

Downloadable public report

Forecast tables, assumptions, charts, regional
analysis

Tier 2/3

Paywalled dashboard

Restricted data

Do not extract unless Xtrium authorizes access
and use

News/press release

High-level trend claim

Use for discovery; verify with report when
possible

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

Public market article

Market Intelligence Record + Material
Relationship

Capture material, trend, region, date, and
source.

Forecast table

Market Metric object

Include scenario, forecast year, base year, units.

Supply concentration chart

Supply Risk/Region relationship

Do not infer exact values from charts unless
visible.

Paywalled portal

Escalate

No extraction without permission and access
guidance.

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

material_or_commodity

Lithium, nickel, cobalt, graphite, rare earths, etc.

Use normalized material name and source label.

metric_type

Demand, supply, price, capacity, concentration,
shortage, surplus

Choose controlled label.

value

Metric value if stated

Include unit and date; no estimates from charts.

time_period

Current year, forecast year, horizon

Required for market data.

scenario

Base case, net zero, EV adoption, policy
scenario, etc.

Required when forecast scenario is provided.

region

Country, region, supply-chain geography

Record exact region terminology.

source_access_status

Public, restricted, paywalled, licensed

Required for market sources.

source_url

Exact page/report URL

Required.

Step

Action

Output

Receive market URL

Documented extraction decision or JSONready value

Check access status

Documented extraction decision or JSONready value

Identify material focus

Documented extraction decision or JSONready value

Classify metric as current or forecast

Documented extraction decision or JSONready value

Extract values with time period

Documented extraction decision or JSONready value

Capture scenario and region

Documented extraction decision or JSONready value

Link material to market record

Documented extraction decision or JSONready value

Run citation/access check

Documented extraction decision or JSONready value

QA and submit

Documented extraction decision or JSONready value

## 6. Step-by-Step Workflow

## 7. Edge Cases & Special Handling
Situation

Required Action

Article references paid data

Do not extract paid table values unless visible and authorized.

Chart has no data labels

Describe qualitative trend only; do not estimate values.

Forecast horizon is unclear

Set forecast year null and capture raw wording.

Same metric appears in multiple sources

Do not average; create separate source-specific records.

Analyst opinion vs fact

Label as commentary unless backed by data table.

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
"market_intelligence_record": {
"material_name": "natural graphite",
"metric_type": "supply deficit forecast",
"value": null,
"unit": null,
"time_period": "<forecast horizon if stated>",
"region": "global",
"scenario": "<scenario if stated>",
"source_access_status": "public summary",
"source_url": "<URL>",
"raw_summary": "<traceable market statement>"
}
}

## 10. Good vs. Bad Extraction Patterns
The following table gives acceptance examples for this SOP family. Use it during self-review before submission. The goal is not to
extract more data; the goal is to extract only defensible data and preserve the source context that makes it defensible.
Topic

Reject

Accept

Paywalled data

Copying restricted dashboard values into JSON.

Escalate access and citation rules before
extraction.

Forecasts

Removing scenario and forecast year from
market data.

Always preserve time period, scenario, region,
and source date.

Charts

Eyeballing chart values.

Use visible labels/tables only; otherwise record
qualitative direction.

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

Requirement

Criterion
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
