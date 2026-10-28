# SOP-DS-010 | Engineering Materials Property & Handbook Database
Extraction
## 1. Purpose & Scope
This SOP governs extraction from broad engineering-materials property databases, handbook platforms, and reference
sources. These sources are useful to Xtrium because they provide experimentally measured, handbook-derived,
literature-derived, manufacturer-reported, or consolidated reference property data for metals, alloys, polymers,
ceramics, composites, semiconductors, fibers, and other engineering materials.
This SOP is not limited to critical materials. It is designed for sources such as MatWeb, ASM Handbooks,
SpringerMaterials, and similar materials reference databases where the primary value is material identity, grade/alloy
designation, composition, properties, conditions, standards, phase diagrams, processing notes, and references.

### 1.1 Sources Covered
Source
MatWeb

Type
Online material property
database

ASM Handbook / ASM Digital
Library

Engineering
handbook/reference library

SpringerMaterials

Commercial materials database

Similar handbook/property
platforms

Commercial or open reference
database

Typical Data Available
Datasheets for metals, alloys,
polymers, ceramics,
semiconductors, fibers, and
other engineering materials;
physical, mechanical, thermal,
electrical properties; categories
and supplier/manufacturer
references where listed.
Peer-reviewed/time-tested
reference content on properties,
processing, performance, heat
treatment, testing,
microstructure, joining,
corrosion, manufacturing, and
applications.
Interactive graphs, corrosion
datasets, phase diagrams,
crystal structures, material
property comparisons, multisource datasets.
Material records, property
tables, phase diagrams,
standards, testing conditions,
literature references.

Special Handling
Treat as property datasheet
source. Preserve source URL
and original units. Do not
assume source is primary
manufacturer.

Treat as
handbook-derived/literaturederived data. Capture
volume/chapter/article citation
where visible.

Respect access limits. Preserve
dataset/module name and do
not over-extract
hidden/paywalled content.
Apply same rules. Escalate if
source type is unclear.

### 1.2 Objectives






Create schema-compliant material objects from engineering materials property records and reference content.
Extract material identity, canonical name, material type, subtype, grade, alloy designation, trade names, identifiers,
composition, property values, conditions, standards, processing notes, and sources.
Preserve provenance for every property, including whether the value is measured, supplier-reported, handbook-derived,
literature-derived, or database-consolidated.
Avoid mixing minimum, maximum, typical, calculated, estimated, and range values into a single property object.
Respect commercial-access limitations and capture only the data contractors are authorized to access.

## 2. Non-Negotiable Operating Rules
Rule 1

ONE PROPERTY OBJECT PER
VALUE CONTEXT

Do not collapse values with different
conditions, units, temperatures,
directions, heat treatments, or
typical/min/max labels into a single
property object.

Rule 2

PRESERVE ORIGINAL UNITS

Copy the unit exactly as shown. Do not
convert units unless the active Xtrium
batch explicitly requires normalization
in a separate normalized field.

Rule 3

NO PROPERTY ESTIMATION

Never estimate values from graphs,
ranges, or incomplete tables. If a graph
value is not explicitly readable, mark it
for review.

Rule 4

PROVENANCE REQUIRED

Every property must carry source
name, URL or citation, access date,
data source type, and raw source
context.

Rule 5

HANDBOOK IS NOT SUPPLIER
CLAIM

Handbook-derived data is reference
data. Do not treat it as supplier
certification, current product
availability, or a commercial datasheet.

Rule 6

COMMERCIAL ACCESS
BOUNDARIES

Do not bypass paywalls, download
restricted bulk data, or extract content
outside Xtrium-authorized access.
Escalate access questions.

Rule 7

SCHEMA MUST NOT CHANGE

If a source contains data not
represented in the current schema,
place it in raw/additional_properties or
escalate. Do not create new schema
fields independently.

## 3. Data Extraction Model
Engineering materials sources typically create one material object per distinct material/grade/designation. Within that
object, every property is captured as a separate property record with method, condition, source, and raw evidence. If a
source contains multiple grades, alloys, heat treatments, or tempers, each should be evaluated as a separate material
variant or grade-level record.
Source Concept
Material name

Xtrium Destination
material_name

Alloy/grade/temper/designation

grade and/or material_subtype

UNS/ASTM/ISO/AISI/SAE designation

external identifiers / standards_referenced

Composition table

composition / additional_properties / raw

Property table row

properties array

Temperature/direction/heat treatment

condition

Phase diagram

phase_diagrams array or
raw/additional_properties

Processing/heat treatment notes

processing_notes

Application notes
Supplier/manufacturer reference

applications_mentioned
supplier_context

Transformation Rule
Copy exact source name. Do not simplify
trade names or alloy designations.
Extract explicit grade/temper such as 6061T6, Ti Grade 5, Inconel 718, PEEK 450G.
Capture identifiers separately from material
name when visible.
Capture elements, ranges, weight %, and
notes. Preserve ranges as strings.
Create one property object per value
context. Include value, numeric_value when
parseable, unit, condition, category, raw,
and source.
Record exactly. Examples: at 23 C;
transverse; annealed; T6; after aging.
Capture diagram title, system, axes, source,
and citation. Do not digitize values unless
assigned.
Copy source-supported process notes with
citations.
Extract only directly stated applications.
Capture only if source lists a specific
supplier or manufacturer. Do not infer
supplier role from database category.

## 4. Property Object Standard
Each property object must preserve both the normalized interpretation and the raw source context. If the active schema
already defines a property object, follow that schema exactly. If not, use the structure below as a reference pattern for
QA and transformation.
{
"name": "Yield Strength",
"canonical_name": "yield_strength",
"value": "276",
"numeric_value": 276,
"unit": "MPa",
"condition": "T6 temper; room temperature",
"property_category": "mechanical",
"value_role": "minimum | maximum | typical | nominal | range | unspecified",
"data_source_type": "measured | supplier_reported | handbook_derived | literature_derived |
database_consolidated",
"raw": {
"source_label": "<property table label>",
"source_value": "276",
"source_unit": "MPa",
"source_condition": "<verbatim condition>",
"notes": "<source notes if present>"
},
"source": {
"source_name": "<MatWeb | ASM Handbook | SpringerMaterials | other>",
"source_url": "<URL or citation>",
"tier": "tier2",
"accessed_date": "YYYY-MM-DD"
}
}

### 4.1 Property Category Mapping
Property Category
physical

Examples
density, molecular weight, porosity, water
absorption
tensile strength, yield strength, elongation,
modulus, hardness, fatigue strength, impact
strength
thermal conductivity, CTE, specific heat,
melting point, glass transition temperature
resistivity, conductivity, dielectric constant,
dielectric strength
corrosion resistance, oxidation behavior,
chemical compatibility

mechanical

thermal
electrical
chemical/corrosion

processing

heat treatment, forming behavior,
weldability, machinability, processing
temperature
phase, lattice, crystal structure when
present in handbook source

structural/crystallographic

Notes
Store condition if temperature, humidity, or
sample state is listed.
Keep direction, test method, temperature,
and heat treatment separate in
condition/raw.
Preserve temperature range and direction.
Do not average directional values.
Preserve frequency, temperature, and test
method.
Often qualitative. Store qualitative
statements as value strings with raw
context.
Use processing_notes if not a numeric
property.
If source is primarily crystallographic,
consider SOP-DS-011.

## 5. Source-Specific Guidance
### 5.1 MatWeb






Treat MatWeb records as material datasheets, not as primary manufacturer datasheets unless a manufacturer is explicitly
identified.
Extract material family, material name, grade/designation, physical/mechanical/thermal/electrical properties, conditions,
and source URL.
Preserve units and value labels such as average, typical, minimum, maximum, or range.
Do not infer current commercial availability from the existence of a MatWeb datasheet.
If MatWeb lists a supplier, manufacturer, or resin producer, capture it as supplier_context only with the exact source
wording.

### 5.2 ASM Handbook / ASM Digital Library





Capture citation metadata: handbook title, volume, chapter/article title, section, table/figure number, page if available, and
URL or DOI if visible.
Treat handbook values as reference/handbook-derived unless the source explicitly states a specific measured dataset.
For heat treatment and processing guidance, preserve the sequence and conditions. Do not compress into generic notes.
Do not extract entire copyrighted tables beyond what is authorized. Use minimal structured facts needed for the assigned
Xtrium record and cite the source.

### 5.3 SpringerMaterials





Identify the module or dataset type: property table, phase diagram, corrosion dataset, crystal structure, interactive graph,
or reference work.
Extract only content accessible under Xtrium-authorized access. Do not bypass access controls.
For interactive graphs, capture displayed data only if exact values are visible or export is explicitly provided.
For phase diagrams, capture system, phases, axes, source citation, and diagram title. Do not manually digitize phase
boundaries unless assigned.

## 6. Step-by-Step Workflow
10. Open the assigned material database or handbook URL and record source name, page title, URL, and access date.
11. Identify whether the page describes a single material, multiple materials, a property comparison, a handbook article, a
phase diagram, or a search result list.

12. Create one material object per distinct material/grade/designation that has extractable source-supported data.
13. Extract identity fields: name, canonical name, material type, subtype, grade, identifiers, trade names, and composition if
visible.

14. For each property table, group values by property name and condition. Create separate property objects for
min/max/typical/range or differing conditions.

15. Capture source metadata for every property, including source name, URL/citation, source tier, and data_source_type.
16. Extract applications, processing notes, phase diagrams, standards, and references only where explicitly stated.
17. Run duplicate checks for material variants and grade aliases before creating new records.
18. Validate JSON syntax, required fields, source traceability, and null handling before submission.

## 7. Edge Cases & Special Handling
Situation
Same material appears with multiple names

Same property appears as min, max, and typical
Property appears as a range
Units missing
Graph only, no table
Paywalled table partially visible
Handbook contains narrative guidance
Material has many heat treatments

Required Action
Create one canonical material when clearly the same
grade/designation; record aliases/trade names. Escalate uncertain
synonyms.
Create separate property objects or preserve value_role. Never
average.
Keep value as string range and numeric_value as null unless
schema supports numeric range fields.
Set unit to null and record source label in raw. Do not infer unit from
similar rows.
Do not estimate values. Capture graph title/source and escalate if
values are needed.
Extract only authorized visible data. Escalate before using restricted
content.
Use processing_notes or applications_mentioned. Do not turn
qualitative guidance into quantitative properties.
Treat each heat treatment/temper as distinct condition or variant
according to active schema.

## 8. QA Checklist
QA Item
Material identity
Property grouping
Units
Provenance
Commercial limits
Supplier distinction
Null handling

Pass Criteria
Material name, grade/designation, and canonical name are
consistent and source-supported.
Properties are separated by condition, value role, unit, heat
treatment, direction, and source context.
Original units preserved; no unsupported conversions.
Each property has source name, URL/citation, accessed date,
data_source_type, and raw evidence.
No restricted/paywalled/bulk content used outside authorization.
Handbook/database records not mislabeled as current supplier
products.
Missing values are null or omitted from raw as required; no invented
values.

QA Item
JSON validity

Pass Criteria
Output validates against active Xtrium schema or assigned staging
template.

## 9. Complete Worked Example - Engineering Datasheet
{
"material_name": "Aluminum 6061-T6",
"canonical_name": "aluminum-6061-t6",
"material_type": "alloy",
"material_subtype": "aluminum alloy",
"grade": "T6",
"identifiers": [{"type": "AA", "value": "6061"}],
"composition": [{"element": "Al", "value": "balance"}],
"properties": [
{
"name": "Density",
"canonical_name": "density",
"value": "2.70",
"numeric_value": 2.70,
"unit": "g/cm3",
"condition": "T6 temper",
"property_category": "physical",
"value_role": "typical",
"data_source_type": "database_consolidated",
"raw": {"source_value": "2.70", "source_unit": "g/cm3", "source_condition": "T6"},
"source": {"source_name": "<database name>", "source_url": "<URL>", "tier": "tier2"}
}
],
"processing_notes": "<heat treatment or processing notes if explicitly stated>",
"sources": [{"source_name": "<database or handbook>", "source_url": "<URL>", "tier": "tier2"}]
}

## 10. Submission Package
Deliverable
Material JSON files
Property review log

Source list
QA checklist

Required Contents
One JSON per material/grade or per
assigned batch file.
Ambiguous values, graph-only values, unit
issues, paywall limitations, duplicate/alias
decisions.
URLs/citations, titles, access dates, source
type, source tier.
Completed checklist for each batch.

Filename Guidance
{canonical_name}.json or {source_slug}
_{batch}.json
{source_slug}_property_review_log.xlsx/
json
{source_slug}_sources.csv/json
{source_slug}_qa_checklist.pdf/xlsx
