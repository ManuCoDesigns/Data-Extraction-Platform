STANDARD OPERATING PROCEDURE

BGS Directory of Mines & Quarries
→ Xtrium Supplier Graph
SOP Number:

SOP-DS-002

Version:

1.1

Effective Date:

June 4, 2026

Department:

Data Operations

Prepared By:

Xtrium Data Team

Source Dataset:

BGS Directory of Mines and Quarries 2020 (11th Edition)

Source URL:

https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-qu
arries-2020/

Target Schema:

Xtrium Supplier Graph Schema v1.0

Applies To:

External Data Scraping Contractors

Purpose of this Document
This SOP provides complete, step-by-step instructions for extracting operator, mine, and quarry data
from the BGS Directory of Mines and Quarries 2020 PDF and transforming each record into a valid
Xtrium Supplier Graph Schema JSON object. The objective is to build a material-centric sourcing
map — enabling anyone searching for a raw mineral or commodity to locate every UK extraction site
and operator associated with it.

## 1. Purpose & Scope
This Standard Operating Procedure (SOP) governs the extraction, transformation, and output of data from
the British Geological Survey (BGS) Directory of Mines and Quarries (DMQ) 2020 PDF into the Xtrium
Supplier Graph Schema JSON format.
The DMQ covers active mineral operations in the United Kingdom during the period 2019–2020. Each site
record identifies a physical extraction location, the operator responsible for it, and the commodity
produced. The Xtrium goal is material-centric: for any given mineral or commodity, the graph must be able
to answer the question — who produces it, where, and under what operator?

### 1.1 Objectives
•​

Parse every mine, quarry, pit, oil/gas site, peat working, and mineral handling site from the BGS
DMQ 2020 PDF.

•​

Create one supplier JSON object per unique operating company, not per site.

•​

Record each site as a products_offered entry within its operator's supplier object.

•​

Map commodity and geological data to product entries so materials can be traced back to source.

•​

Produce valid JSON conforming to the Xtrium Supplier Graph Schema for direct ingestion.

### 1.2 Source Dataset Overview
Attribute

Detail

Publication

Directory of Mines and Quarries 2020 — Eleventh Edition

Publisher

British Geological Survey (BGS) / UKRI

Coverage Period

Active mineral operations 2019–2020

Geographic Scope

United Kingdom (England, Scotland, Wales, Northern Ireland, Channel
Islands, Isle of Man)

Source Database

BRITPITS — BGS relational database of mineral workings (230,000+
records)

Data Organisation

Firstly by commodity, then by Mineral Planning Authority (MPA), then
by operator

Download URL

https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-qu
arries-2020/

Format

Free PDF download (~10.5 MB)

Key Fields per Site

Site name, operator name, operator address/postcode, OS grid
reference, MPA, commodity, secondary commodity, end use, geological
formation

## 2. Roles & Responsibilities

Role

Responsibility

PDF Extraction Specialist

Downloads the BGS DMQ 2020 PDF. Parses or manually transcribes site
records. Exports structured data (CSV or JSON) for handoff to the
Transformation Specialist.

Data Transformation
Specialist

Applies this SOP to group site records by operator, build supplier objects,
and populate all schema fields. Produces one JSON output file per
operator.

QA Reviewer

Runs the validation checklist (Section 11) against each completed JSON
file. Rejects non-compliant files and returns them for correction.

Project Lead

Resolves ambiguous operator name conflicts, handles edge cases not
covered by this SOP, and accepts final deliverables.

## 3. Understanding the BGS DMQ Data Structure
Before transforming any data, every team member must understand how the BGS DMQ organises its
content, because this directly determines how supplier objects are assembled.

### 3.1 How the PDF Is Organised
The DMQ PDF is structured in three nested layers:
Layer

Description

Example

1—
Commodity

The outermost grouping. Every entry
appears under its commodity heading.

LIMESTONE, SANDSTONE, SILICA
SAND, FLUORSPAR, GYPSUM,
COAL, etc.

2 — Mineral
Planning
Authority
(MPA)

Within each commodity, sites are listed by
the local authority responsible for mineral
planning.

Derbyshire County Council, Highland
Council, Antrim & Newtownabbey
Borough Council

3 — Site
Record

The individual mine or quarry entry.
Contains site name, operator, address, grid
reference, end use, and geology.

Tunstead Quarry, Buxton Lime
Industries Ltd, SK089748, Portland
Limestone Fm

### 3.2 Fields Available Per Site Record
Each site entry in the DMQ typically contains some or all of the following fields. Not all fields appear for
every site — treat any absent field as null.
DMQ Field

Description

Example Value

Site Name

Name of the mine, quarry, or operation

Tunstead Quarry

Operator Name

Company operating the site

Buxton Lime Industries Ltd

Operator Address

Registered or operational address of
the operator

Tunstead, Buxton, Derbyshire,
SK17 8TG

DMQ Field

Description

Example Value

OS Grid Reference

Ordnance Survey national grid
reference (2-letter + 6-digit format)

SK089748

Mineral Planning
Authority

Local authority with planning jurisdiction
over the site

Derbyshire County Council

Region Code

BGS region abbreviation covering the
site (17 defined regions)

EMD (East Midlands)

Commodity

Primary mineral commodity produced
at the site

Limestone

Secondary Commodity

A secondary mineral produced at the
same site, if listed

Clay, Chert

End Use

How the extracted commodity is used

Aggregate, Chemical,
Agricultural, Cement

Geological Formation

Rock or deposit type being worked

Portland Limestone Formation

Site Type (inferred)

Type of mineral working — infer from
site name and DMQ section heading

Quarry, Mine, Pit, Oil Well, Gas
Well, Brine Well, Handling Site,
Wharf, Processing Plant, Peat
Workings

KEY INSIGHT — One Operator, Many Sites
A single operating company (e.g., Tarmac Ltd, CEMEX UK, Aggregate Industries) may operate
dozens of sites across different commodities and regions. In the Xtrium schema, the company is
ONE supplier object. Each site becomes one entry in that supplier's products_offered array. Always
group by operator first, then list sites as products.

### 3.3 The 17 BGS Regions
Region Code

Region Name

Notes

CHA

Channel Islands

Grid coordinates are UTM

CSCT

Central Scotland

EEN

East England

EMD

East Midlands (England)

IOM

Isle of Man

LON

Greater London

NEA

North-east England

NIR

Northern Ireland

NSCT

North Scotland

NWE

North-west England

Supplied with Northern Ireland data

Region Code

Region Name

NWLS

North Wales

SEA

South-east England

SSCT

South Scotland

SWE

South-west England

SWLS

South Wales

WMD

West Midlands (England)

YHU

Yorkshire and Humberside (England)

Notes

CHA data included here

## 4. Schema Mapping Strategy
This section explains the fundamental design decisions for how BGS data maps into the Xtrium Supplier
Graph Schema. Read this before attempting any data entry.

### 4.1 Core Design Principle — Operator as Supplier
In the Xtrium schema, the supplier object represents a company, not a physical site. The BGS DMQ
operator is the company. The operator's individual mine or quarry sites map to products_offered entries
within that company's supplier object.
BGS DMQ Concept

Xtrium Schema Destination

Notes

Operator (company)

suppliers[] — one object per
unique operator

Primary mapping unit

Operator address / postcode

headquarters_location

Use as proxy for HQ if no better
data

Individual site (mine/quarry)

products_offered[] — one entry
per site per commodity

Each site is a 'product' of the
supplier

Commodity produced at site

products_offered[].product_name
AND products_offered[].category

The mineral is the product

Secondary commodity at
site

Additional products_offered[]
entries — one per secondary
commodity

Same site entry; separate product
entries. See Rule 2.

End use of commodity

products_offered[].grade

End use functions as a
grade/variant designation

Geological formation

products_offered[].product_id (as
site code) or raw

No direct schema field; treat as
supplemental product data

OS Grid Reference

manufacturing_sites[].location

Primary location identifier for the
site

Mineral Planning Authority

manufacturing_sites[].raw

Regulatory context, not a
standalone schema field

BGS DMQ Concept

Xtrium Schema Destination

Notes

BGS Region Code

manufacturing_sites[].country
(inferred) + raw

Infer country from region; record
raw code

Site type (mine vs quarry
etc.)

manufacturing_sites[].site_type

See full permitted list in Section
5.2

### 4.2 Supply Chain Tier Assignment
Operators in the BGS DMQ are active extractors — they are raw material producers. Apply the following
tier logic:
Operator Type

supply_cha
in_tier

Rationale

Mine / quarry / pit operator (direct
extraction)

Tier 1 = raw material producer. All BGS
DMQ operators extracting at source.

Peat workings (direct extraction)

Peat extraction is primary production. Same
tier as quarry operators.

Mineral handling site only (no
extraction)

Tier 2 = processor/redistributor. Handling
sites process or redistribute rather than
extract.

Processing plant (lime works, tileworks,
salt plant)

Tier 2 = processor. These sites transform
extracted material, not extract at source.

Spoil heap / bing operations

Tier 2 = secondary processor. Bings rework
existing waste material, not primary
extraction.

Recycling facility (aggregate recycling,
waste mgmt.)

Tier 2 = processor. Recycled aggregates are
processed from waste, not extracted from
ground.

Wharf / maritime handling site

Tier 2 = redistributor. Wharves handle
imported or transferred material.

Distributor / reseller (if identifiable)

Tier 3 = distributor. Rare in DMQ but apply if
operator description indicates distribution
only.

⚠ IMPORTANT Default to tier 1 for all standard quarry, mine, and pit operators unless the site
record specifically describes the operation as handling, processing, recycling, or distribution only.

### 4.3 Industry Sector Mapping [AMENDED v1.1]
This table has been extended in v1.1 to include Clay and Shale, Basalt (NI), Igneous & Metamorphic
Rock, Recycled aggregates, and Peat — five commodity types not addressed in the original SOP.

BGS Commodity Category

Xtrium industry_sector

Construction aggregates (sand, gravel, crushed rock,
limestone for aggregate)

construction minerals

Industrial minerals (silica sand, ball clay, china clay,
fluorspar, gypsum, potash, salt)

industrial minerals

Clay and Shale (brick, tile, ceramics)

industrial minerals

Building stone (sandstone, granite, slate, marble quarried
for building)

building stone

Cement and lime raw materials (limestone/chalk for
cement, quicklime)

cement and lime

Coal (surface and underground)

coal

Oil and gas extraction (onshore)

oil and gas

Metals (iron ore, tin, copper, lead-zinc, gold)

metals mining

Basalt (NI) — used primarily as aggregate in Northern
Ireland

construction minerals

Igneous & Metamorphic Rock — aggregate and building
stone

construction minerals

Recycled aggregates (crushed, reprocessed from waste
or demolition material)

recycled aggregates

Peat (extraction from peat workings)

peat

Mineral handling sites (wharves, import terminals)

mineral handling

## 5. Field-by-Field Mapping Reference

### 5.1 Supplier-Level Fields
Schema Field

BGS Source

Transformation Rule

supplier_id

None

Always null — assigned by load_to_neo4j.py

duns_number

None

null — not in BGS DMQ; may be resolvable
post-extraction via D&B lookup

company_name

Operator Name

Copy exactly as printed in DMQ. Do not
abbreviate or expand.

canonical_name

Derived

Lowercase, spaces to hyphens, & to 'and',
remove remaining punctuation. See Section 7.2
for full rules.

headquarters_location

Operator Address

Extract town/city and country. Format: 'City,
Country'. e.g. 'Buxton, United Kingdom'

Schema Field

BGS Source

Transformation Rule

website

None

null — not in DMQ. May be populated
post-extraction via web search.

company_description

None / inferred

null from DMQ alone. Optionally populate with
brief operator summary from public sources.

industry_sector

Commodity (inferred)

Apply sector mapping table in Section 4.3. Use
primary commodity type.

supply_chain_tier

Site type (inferred)

Apply tier rules in Section 4.2. Default: 1 for
extraction sites.

typical_lead_time_days

None

Always null — not stated in DMQ.

is_verified

N/A

Always false from scraper.

certifications

None

Empty array [] — not in DMQ.

regulation_references

None

Empty array [] — not in DMQ.

certifications_raw

None

null — not in DMQ.

### 5.2 Manufacturing Sites Array [AMENDED v1.1]
Each physical mine or quarry operated by the company becomes one entry in the manufacturing_sites
array. Use the OS Grid Reference as the primary location identifier.
Schema Field

BGS Source

Transformation Rule

location

Site Name + OS Grid
Reference

Format: '{Site Name} ({OS Grid Ref})'. e.g.
'Tunstead Quarry (SK089748)'

country

BGS Region Code
(inferred)

CSCT/NSCT/SSCT → 'Scotland'; NIR →
'Northern Ireland'; NWLS/SWLS → 'Wales'; CHA
→ 'Channel Islands'; IOM → 'Isle of Man'; all
others → 'England'

site_type

Site type label (inferred)

Infer from site name and DMQ section heading.
See Section 10 for edge case guidance.
Permitted values (v1.1 extended list):
quarry | mine | pit | oil well |
gas well | brine well
handling site | wharf | processing
plant
spoil heap | recycling facility |
peat workings

raw

Full verbatim DMQ entry

Copy the complete text of the site record as it
appears in the PDF, including MPA, end use,
and formation.

### 5.3 Products Offered Array [AMENDED v1.1]
Primary commodity: Each unique combination of site + commodity becomes one products_offered
entry.

Secondary commodity: If the DMQ lists a secondary commodity for a site, create an additional
products_offered entry for it, using the secondary commodity as product_name. Use a different
abbreviation suffix in product_id to ensure uniqueness.
If a single site produces two distinct end uses for the same commodity (e.g., limestone for aggregate AND
limestone for cement), create two separate products_offered entries with different grade values.

Schema Field

BGS Source

Transformation Rule

product_name

Commodity (primary or
secondary)

Commodity name in Title Case. e.g. 'Limestone',
'Silica Sand', 'Coal (Surface Mined)'

grade

End Use

Map end use as grade/variant. e.g. 'Aggregate',
'Chemical', 'Agricultural', 'Cement raw material',
'Graded'. Graded variants (e.g., 'Graded sand &
gravel') use grade = 'Graded' — do not create a
separate product_name.

product_id

OS Grid Ref + Commodity
code

Format: '{GridRef}_{CommodityAbbrev}'. e.g.
'SK089748_LS'. Secondary commodities use a
different abbreviation suffix to maintain
uniqueness.

category

BGS Commodity Section
heading

Copy the section heading. e.g. 'LIMESTONE',
'SILICA SAND', 'FLUORSPAR'

source_url

BGS DMQ download
page

Always:
'https://www.bgs.ac.uk/mineralsuk/download/dire
ctory-of-mines-and-quarries-2020/'

datasheet_url

None

null — PDFs are publication-level, not
product-level

cross_graph_material
_id

None

Always null during extraction — populated
post-load by the ID resolver

### 5.4 Sources Array
Every supplier object must include at least one source citation pointing to the BGS DMQ publication. This
is a government/official source and is always tier1.
"sources": [
{
"source_name": "BGS Directory of Mines and Quarries 2020, 11th Edition",
"source_url":
"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/",
"doi":
null,
"tier":
"tier1"
}
]

### 5.5 Data Completeness Flags
Set these flags as shown below for all BGS DMQ records. These values are fixed — they signal
downstream agents what can and cannot be sourced from this publication.

Flag Field

Value

Reason

review_score

manual_only

Supplier performance reviews are not in DMQ;
require human research

defect_rate_ppm

manual_only

Not available from any public source; requires
direct supplier contact

on_time_delivery_rate

manual_only

Not available from any public source; requires
direct supplier contact

pricing

api_only

Commodity pricing available via market price APIs,
not on operator websites

inventory_levels

api_only

Mine output statistics available from BGS World
Mineral Statistics API

## 6. Non-Negotiable Operating Rules
RULE 1 — ONE SUPPLIER OBJECT PER OPERATOR
Group all sites belonging to the same operating company into a single supplier object. Never create
two supplier objects for the same legal entity. If an operator appears under multiple commodities or
regions, consolidate all their sites into the one object.

RULE 2 [AMENDED v1.1] — ONE products_offered ENTRY PER SITE PER
COMMODITY PER END USE
A site producing limestone for aggregate AND cement creates two products_offered entries with
different grade values. A site that also lists a secondary commodity (e.g., clay alongside limestone)
creates additional products_offered entries — one per secondary commodity. A site producing only
one commodity with one end use creates one entry. Never collapse multiple sites into one
products_offered entry.

RULE 3 — EXACT TEXT PRESERVATION IN raw
The raw field on every manufacturing_sites entry must contain the verbatim text of the DMQ site
record as it appears in the PDF. Do not paraphrase, summarise, or clean this field. It is the audit trail
back to the source.

RULE 4 — NULL FOR ABSENT DATA — NEVER INVENT
If the DMQ does not state a value for a field (e.g., website, lead time, certifications), set that field to
null or []. Do not search the web to fill in gaps during extraction — that is a separate enrichment step.

RULE 5 — source_url IS ALWAYS THE PUBLICATION PAGE

The source_url for every products_offered entry and every sources[] entry must point to the BGS
DMQ 2020 download page — not to a search result, not to the BGS homepage, not to an operator's
website. This is the authoritative citation.

RULE 6 — is_verified IS ALWAYS false
The is_verified flag is set to false by all scrapers without exception. It is set to true only after a human
reviewer has independently verified the operator information. Never set this to true during extraction.

## 7. Operator Deduplication Rules
The DMQ lists operators repeatedly across different commodities and regions. Before creating a new
supplier object, always check whether the operator already exists in your working dataset.

### 7.1 Matching Rules (apply in order)
•​

Exact company_name match → same supplier object. Add new sites to existing products_offered
and manufacturing_sites arrays.

•​

Near match (e.g., 'Tarmac Trading Ltd' vs 'Tarmac Ltd') → flag for Project Lead review. Do not
auto-merge.

•​

Same address + similar name → likely same entity. Flag for Project Lead review.

•​

Same name, different postcode region → may be a subsidiary or regional division. Flag for
Project Lead review.

⚠ IMPORTANT Large aggregate producers (Tarmac, CEMEX, Aggregate Industries, Hanson,
Breedon Group) operate across dozens of sites. You will encounter these names repeatedly as you
work through different commodity sections. Always add new sites to the existing supplier object. Do
not create duplicate entries.

7.2 canonical_name Transformation [AMENDED v1.1]
Apply all transformations below in order. The key v1.1 addition is the explicit conversion of & to 'and'
before other processing.
•​

Convert full company_name to lowercase.

•​

Convert & to 'and' before any other processing. e.g. 'A & D Sutherland' — the & becomes 'and',
not silently dropped. Silently dropping & risks false matches with unrelated entities sharing the
same initials.

•​

Replace spaces with hyphens.

•​

Remove all remaining punctuation (commas, dots, parentheses, apostrophes).

•​

Keep common suffixes as-is: ltd, plc, llp, uk, group.

company_name

canonical_name

Tarmac Ltd

tarmac-ltd

CEMEX UK Operations Ltd

cemex-uk-operations-ltd

Aggregate Industries UK Ltd

aggregate-industries-uk-ltd

Hanson Quarry Products Europe Ltd

hanson-quarry-products-europe-ltd

Breedon Group plc

breedon-group-plc

Sibelco UK Ltd

sibelco-uk-ltd

Imerys Minerals Ltd

imerys-minerals-ltd

British Gypsum Ltd

british-gypsum-ltd

A & D Sutherland

a-and-d-sutherland

## 8. Complete Worked Examples

### 8.1 Single-Site Operator — Specialist Industrial Mineral
Source DMQ Entry (verbatim from PDF)
FLUORSPAR
Derbyshire County Council
Glebe Mine
Cavendish Mill Fluorite Ltd
Cavendish Mill, Stoney Middleton, Hope Valley, Derbyshire, S32 4TF
Grid Ref: SK222756
End Use: Acid grade fluorspar, Ceramic grade fluorspar
Formation: Blue John Cavern Formation (Derbyshire limestone)

Output JSON
{

"supplier_id": null,
"duns_number": null,
"company_name": "Cavendish Mill Fluorite Ltd",
"canonical_name": "cavendish-mill-fluorite-ltd",
"headquarters_location": "Hope Valley, United Kingdom",
"website": null,
"company_description": null,
"industry_sector": "industrial minerals",
"supply_chain_tier": 1,
"typical_lead_time_days": null,
"manufacturing_sites": [
{
"location": "Glebe Mine (SK222756)",
"country": "England",
"site_type": "mine",

"raw": "Glebe Mine, Cavendish Mill Fluorite Ltd, Stoney Middleton,
Derbyshire. Grid: SK222756. MPA: Derbyshire County Council. End Use: Acid grade
fluorspar, Ceramic grade fluorspar. Formation: Blue John Cavern Formation."
}
],
"certification_references": [],
"certifications_raw": null,
"regulation_references": [],
"products_offered": [
{
"product_name": "Fluorspar",
"grade": "Acid grade",
"product_id": "SK222756_FLU_AG",
"category": "FLUORSPAR",
"source_url":
"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/",
"datasheet_url": null,
"cross_graph_material_id": null
},
{
"product_name": "Fluorspar",
"grade": "Ceramic grade",
"product_id": "SK222756_FLU_CER",
"category": "FLUORSPAR",
"source_url":
"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/",
"datasheet_url": null,
"cross_graph_material_id": null
}
],
"is_verified": false,
"data_completeness_flags": {
"review_score": "manual_only", "defect_rate_ppm": "manual_only",
"on_time_delivery_rate": "manual_only", "pricing": "api_only",
"inventory_levels": "api_only"
},
"sources": [{ "source_name": "BGS Directory of Mines and Quarries 2020, 11th
Edition",
"source_url":
"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/",
"doi": null, "tier": "tier1" }]
}

### 8.2 Multi-Site, Multi-Commodity Operator — Large Aggregate Producer
Source DMQ Entries — Same Operator Across Two Commodity Sections
LIMESTONE (CRUSHED ROCK)
Derbyshire County Council
Tunstead Quarry
Tarmac Ltd
Tunstead, Buxton, Derbyshire, SK17 8TG
Grid Ref: SK089748 | End Use: Aggregate, Cement
Fm
GRITSTONE / SANDSTONE
West Yorkshire (Kirklees MBC)
Crosland Moor Quarry
Tarmac Ltd

|

Formation: Eyam Limestone

Huddersfield, West Yorkshire, HD4 7AE
Grid Ref: SE107138 | End Use: Aggregate

|

Formation: Rough Rock

Output JSON — Single Supplier Object, Three products_offered Entries
{

"company_name": "Tarmac Ltd",
"canonical_name": "tarmac-ltd",
"headquarters_location": "Buxton, United Kingdom",
"industry_sector": "construction minerals",
"supply_chain_tier": 1,
"manufacturing_sites": [
{ "location": "Tunstead Quarry (SK089748)", "country": "England", "site_type":
"quarry",
"raw": "Tunstead Quarry, Tarmac Ltd, Tunstead, Buxton, SK17 8TG. MPA:
Derbyshire CC. End Use: Aggregate, Cement. Formation: Eyam Limestone Fm." },
{ "location": "Crosland Moor Quarry (SE107138)", "country": "England",
"site_type": "quarry",
"raw": "Crosland Moor Quarry, Tarmac Ltd, Huddersfield, HD4 7AE. MPA:
Kirklees MBC. End Use: Aggregate. Formation: Rough Rock." }
],
"products_offered": [
{ "product_name": "Limestone", "grade": "Aggregate",
"product_id": "SK089748_LS_AGG", "category": "LIMESTONE",
"source_url":
"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/"
},
{ "product_name": "Limestone", "grade": "Cement raw material",
"product_id": "SK089748_LS_CEM", "category": "LIMESTONE",
"source_url":
"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/"
},
{ "product_name": "Sandstone", "grade": "Aggregate",
"product_id": "SE107138_SS_AGG", "category": "GRITSTONE / SANDSTONE",
"source_url":
"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/" }
],
"is_verified": false,
...
}

## 9. Step-by-Step Transformation Workflow
Follow these steps in sequence. Complete Step 1 before starting Step 2. Do not attempt to transform and
extract simultaneously.
Step

Name

Action

Download & Prepare
PDF

Download the BGS DMQ 2020 PDF from the BGS MineralsUK
download page. Confirm the file is the 2020 Eleventh Edition (file
size ~10.5 MB). Save locally with filename:
BGS_DMQ_2020_11thEd.pdf.

Parse PDF Structure

Open the PDF and identify all commodity section headings (all-caps,
e.g., LIMESTONE, SILICA SAND, GYPSUM). For each section, note

Step

Name

Action
the sub-groupings by Mineral Planning Authority. Use a PDF
extraction tool (e.g., pdfplumber, Camelot, or Adobe Acrobat Export)
to extract text by section. Validate that all 17 regions are
represented.

Build Operator Index

Scan the entire PDF and compile a deduplicated list of all unique
operator names before transforming any records. This index
prevents duplicate supplier objects. Record: operator name, first site
encountered, regions present.

Process Commodity
by Commodity

Work through each commodity section from beginning to end. Do not
skip sections. For each site record: (a) Identify the operator; (b) Look
up operator in your index; (c) If new — create a new supplier object;
(d) If existing — retrieve the existing object; (e) Add site to
manufacturing_sites; (f) Add one products_offered entry per
commodity per end use. If a secondary commodity is listed, add an
additional products_offered entry for it.

Populate
Supplier-Level Fields

After all sites for an operator are added, populate:
headquarters_location (from most common address), industry_sector
(from primary commodity per Section 4.3), supply_chain_tier (per
Section 4.2), canonical_name (per Section 7.2).

Set Fixed Fields

For every supplier object, set: is_verified = false; all
data_completeness_flags per Section 5.5 defaults; sources array
with BGS DMQ tier1 citation.

Handle Handling
Sites

Separately process any mineral handling sites, wharves, processing
plants, and recycling facilities. Assign supply_chain_tier = 2. Their
products_offered entries should reflect the minerals they handle, with
grade = 'Import/handling' where end use is not specified.

Validate Each Object

Run the validation checklist in Section 11 against each completed
supplier object before saving. Do not proceed to the next operator
until the current one passes.

Assemble Output

Wrap all supplier objects in the top-level suppliers array: {
"suppliers": [ ...all objects... ] }. Write to file:
bgs_dmq_2020_suppliers.json.

Final Batch QA

Confirm total supplier object count is plausible given the PDF size.
Cross-check 10 randomly selected operators to confirm all their sites
appear across commodity sections. Submit to QA Reviewer.

## 10. Edge Cases & Special Handling [AMENDED v1.1]
This section has been extended in v1.1 to cover site_type edge cases, recycling facilities, peat workings,
secondary commodities, and graded variants raised by contractor questions.

Situation

Required Action

Operator listed with no address

Set headquarters_location to null. Use region code to infer
country for manufacturing_sites.country.

Site with multiple end uses listed
(e.g., 'Aggregate, Chemical, Filler')

Create one products_offered entry per end use — all pointing
to the same site (same product_id base, different grade
suffix).

Operator name appears with slight
variation across sections (e.g.,
'Tarmac Ltd' vs 'Tarmac Trading Ltd')

Do not auto-merge. Flag to Project Lead. Keep separate until
confirmed.

Site name is generic or missing (e.g.,
unnamed quarry, blank field)

Use grid reference as site name: 'Unnamed Site ({Grid Ref})'.
Never leave location blank.

Oil and gas wells — no fixed site
name structure

Use well identifier or licence block as location. site_type = 'oil
well' or 'gas well'. Commodity = 'Natural Gas' or 'Crude Oil'.

Brine wells and solution mining

site_type = 'brine well'. Commodity = 'Salt' or 'Brine'.
supply_chain_tier = 1.

Same physical site, different operator
sections (site changed hands)

Create separate products_offered entries under each
operator. Note the discrepancy in raw.

Operator has sites in both England
and Scotland

Two manufacturing_sites entries with different country values.
Both within the same supplier object.

Channel Islands (CHA) sites

country = 'Channel Islands'. Note in raw that grid coordinates
are UTM, not OS National Grid.

Handling site with no extraction,
commodity listed as 'Various'

product_name = 'Various Minerals'. grade = 'Import'.
supply_chain_tier = 2.

Site name contains 'Pit' (e.g.,
Marston's Pit, sand pit, clay pit)

site_type = 'pit'. Used for surface workings of sand, gravel,
and clay that are distinct from hard-rock quarries.
supply_chain_tier = 1. Commodity and grade follow the
standard rules.

Site name contains 'Wharf' or is a
maritime/river handling point (e.g.,
Derryclone Wharf)

site_type = 'wharf'. supply_chain_tier = 2. product_name
reflects the mineral handled. grade = 'Import' if no end use is
stated. industry_sector = 'mineral handling'.

Site is a processing or manufacturing
facility (e.g., Babylon Tileworks,
Crundale Lime Works, Porthkerris
Sea Salt Plant)

site_type = 'processing plant'. supply_chain_tier = 2. These
facilities transform an extracted mineral into a processed
product; they do not extract at source. Apply the correct
site_type per site even if the same operator also operates
quarries — each site entry is independent.

Site is a spoil heap or bing (e.g.,
Drumshoreland Bing — coal waste tip
reworked for aggregate or fill)

site_type = 'spoil heap'. supply_chain_tier = 2. product_name
= 'Colliery Spoil' or the specific material. grade = 'Fill' or
'Aggregate'. industry_sector = 'coal'.

Recycling or waste management
facility (e.g., Myers Road Waste
Recycling Facility, Southwood Waste
Management Facility)

site_type = 'recycling facility'. supply_chain_tier = 2.
industry_sector = 'recycled aggregates' if the output is
recycled aggregate material. product_name = 'Recycled
Aggregate' or the specific material handled.

Situation

Required Action

Peat workings (e.g., Lindow Moss
Peat Workings)

site_type = 'peat workings'. supply_chain_tier = 1.
industry_sector = 'peat'. product_name = 'Peat'. grade reflects
end use (e.g., 'Horticultural', 'Fuel').

End use is described as 'Graded
[commodity]' (e.g., 'Graded sand &
gravel')

Do NOT create a separate product_name for the graded
variant. Keep product_name = the base commodity (e.g.,
'Sand and Gravel'). Set grade = 'Graded' or the full end-use
phrase. Grading is a processing variant, not a distinct
commodity.

Secondary commodity listed at a site
(e.g., Clay listed alongside
Limestone)

Create an additional products_offered entry with
product_name = the secondary commodity. Use the
secondary commodity abbreviation in the product_id suffix to
ensure uniqueness (e.g., 'SK089748_CL' for clay at that grid
ref). The manufacturing_sites entry remains the same — do
not duplicate it.

## 11. Pre-Submission Validation Checklist
Run this checklist against every supplier object before submitting the batch. Reject any object that fails
one or more items.

⚠ IMPORTANT Work through each item in order for every supplier object. A single failed item
means the object must be corrected before submission. Do not submit incomplete batches —
complete all objects or none.

Required Fields
•​

company_name is present and non-empty.

•​

products_offered array contains at least one entry.

•​

sources array contains at least one tier1 BGS DMQ entry.

•​

Each products_offered entry has product_name and source_url populated.

•​

Each manufacturing_sites entry has location and raw populated.

Identity & Classification
•​

canonical_name is lowercase-hyphenated, derived from company_name (& converted to 'and'
per Section 7.2).

•​

supply_chain_tier is set (1 for extraction/peat; 2 for handling/processing/recycling/wharf/spoil
heap).

•​

industry_sector is set and matches primary commodity per Section 4.3 (including new sectors:
recycled aggregates, peat).

•​

headquarters_location is in 'City, Country' format or null if not available.

Site-Level Accuracy
•​

Each manufacturing_sites entry has site_type set to a permitted value from the list in Section 5.2.

•​

Each manufacturing_sites entry has country set or inferred from region code.

•​

raw field on every manufacturing_sites entry contains full verbatim DMQ text.

•​

OS Grid Reference appears in either location string or raw field.

Product-Level Accuracy
•​

product_id is unique per site-commodity-grade combination.

•​

Secondary commodities have their own products_offered entry with a distinct product_id suffix.

•​

Graded variants (e.g., 'Graded sand & gravel') use grade = 'Graded' — not a separate
product_name.

•​

grade reflects the DMQ end use value for that entry.

•​

cross_graph_material_id is null (not populated during extraction).

•​

source_url is exactly the BGS DMQ 2020 download page URL.

Fixed / System Fields
•​

is_verified is false.

•​

supplier_id is null.

•​

duns_number is null (DMQ does not provide this).

•​

website is null (unless separately researched — flag if so).

•​

All data_completeness_flags match defaults in Section 5.5.

No Duplicates
•​

No two supplier objects share the same company_name or canonical_name.

•​

All sites for the same operator are in one object, not spread across multiple.

## 12. Common BGS Commodity Reference [AMENDED v1.1]
This table has been extended in v1.1 to include Clay and Shale, Basalt (NI), Igneous & Metamorphic
Rock, Recycled aggregates, and Peat (shown at bottom of table).
Commodity (as in
DMQ)

product_name

industry_sector

Typical End Uses (→ grade)

Limestone (crushed
rock)

Limestone

construction minerals

Aggregate, Cement,
Agricultural, Chemical, Filler

Sandstone / Gritstone

Sandstone

construction minerals
/ building stone

Aggregate, Building Stone

Commodity (as in
DMQ)

product_name

industry_sector

Typical End Uses (→ grade)

Sand and Gravel

Sand and Gravel

construction minerals

Concrete Aggregate, Asphalt,
Fill, Graded

Chalk

Chalk

construction minerals
/ cement and lime

Agricultural Lime, Cement raw
material

Granite

Granite

construction minerals
/ building stone

Aggregate, Building Stone

Slate

Slate

building stone

Roofing Slate, Aggregate

Silica Sand

Silica Sand

industrial minerals

Glass, Foundry Sand, Frac
Sand

Ball Clay

Ball Clay

industrial minerals

Ceramics, Sanitaryware

China Clay (Kaolin)

China Clay

industrial minerals

Paper coating, Ceramics,
Filler

Fluorspar

Fluorspar

industrial minerals

Acid grade, Ceramic grade,
Metallurgical grade

Gypsum / Anhydrite

Gypsum

industrial minerals

Plasterboard, Cement
retarder, Agricultural

Potash

Potash

industrial minerals

Fertiliser

Salt (Rock Salt / Brine)

Salt

industrial minerals

De-icing, Food grade,
Chemical

Coal (Surface)

Coal

coal

Power Generation, Industrial

Coal (Underground)

Coal

coal

Power Generation, Industrial,
Coking

Natural Gas (Onshore)

Natural Gas

oil and gas

Energy

Crude Oil (Onshore)

Crude Oil

oil and gas

Refinery feedstock

Iron Ore

Iron Ore

metals mining

Steel making

Barytes

Barytes (Barite)

industrial minerals

Drilling fluid, Chemical, Filler

Clay and Shale

Clay / Shale

industrial minerals

Brickmaking, Tile
manufacture, Ceramics

Basalt (NI)

Basalt

construction minerals

Aggregate

Igneous & Metamorphic
Rock

Igneous Rock /
Metamorphic
Rock

construction minerals

Aggregate, Building Stone

Recycled Aggregates

Recycled
Aggregate

recycled aggregates

Aggregate, Fill, Sub-base

Peat

Peat

peat

Horticultural, Fuel

## 13. Document Control
Version

Date

Author

Changes

1.0

April 2, 2026

Xtrium Data Team

Initial release

1.1

June 4, 2026

Xtrium Data Team

Contractor clarifications incorporated
(all rulings confirmed by Project Lead):
• Q1 Secondary commodity: treated as
separate products_offered entry — same
site, new product_name (Sections 4.1,
5.3, Rule 2)
• Q2 Recycling facilities: site_type =
'recycling facility', supply_chain_tier = 2,
industry_sector = 'recycled aggregates'
(Sections 4.2, 5.2, 10)
• Q3 Ampersand in operator names:
convert & to 'and' in canonical_name
before all other processing (Section 7.2)
• Q4 Industry sector added for:
Clay/Shale (industrial minerals), Basalt NI
(construction minerals), Igneous &
Metamorphic Rock (construction
minerals), Recycled aggregates (recycled
aggregates), Peat (peat) — (Sections 4.3,
12)
• Q5 Graded sand & gravel: grade only,
not a separate product_name (Sections
5.3, 10)
• Q6 Extended site_type permitted list:
added pit, wharf, processing plant, spoil
heap, recycling facility, peat workings
(Sections 5.2, 10)
• Q7 Peat workings: industry_sector =
'peat', site_type = 'peat workings',
supply_chain_tier = 1 (Sections 4.2, 4.3,
10, 12)

For corrections or unresolved mapping questions, contact the Xtrium Data Team at raghu@xtrium.ai. All
amendments require Project Lead approval before taking effect.
— END OF DOCUMENT —
