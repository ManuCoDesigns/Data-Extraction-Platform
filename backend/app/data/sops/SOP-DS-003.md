STANDARD OPERATING PROCEDURE
Universal Data Extraction Standard
Document Information
SOP Number: SOP-DS-003
Version: 1.0
Effective Date: July 6, 2026
Department: Data Operations
Prepared By: Xtrium Data Team
Applies To: Careerflow AI Contractors; Xtrium Data Operations
Target Deliverable: Schema-compliant JSON for Xtrium Knowledge Graph ingestion

Purpose of this Document
This Standard Operating Procedure establishes the universal extraction, normalization, validation, and
JSON transformation rules for external data sources used by Xtrium. It must be followed by all authorized
contractors and internal data operations personnel when processing company websites, supplier pages,
product pages, government databases, research papers, PDFs, material datasheets, and other public
internet sources into Xtrium supplier and material schemas.

Revision History
Version
1.0

Date
July 6, 2026

Author / Owner
Xtrium Data Team

Description
Initial universal data
extraction standard for
supplier, producer,
manufacturer, distributor,
certification, and material
extraction from public
sources.

Table of Contents
## 1. Purpose & Scope
## 2. Roles & Responsibilities
## 3. Non-Negotiable Operating Rules
## 4. Universal Data Extraction Workflow
## 5. Understanding the Xtrium Knowledge Graph
## 6. Supported Source Types
## 7. Source Authority Hierarchy
## 8. Schema Selection Decision Framework
## 9. Supplier, Producer, Manufacturer & Distributor Extraction
## 10. Material Extraction Standards
## 11. Product Extraction Standards
## 12. Certification, Standard & Compliance Extraction
## 13. Relationship Creation Rules
## 14. Naming & Normalization Standards
## 15. AI Usage Policy
## 16. Secondary Research Policy
## 17. Duplicate Detection & Entity Resolution
## 18. Edge Cases & Special Handling
## 19. Escalation Matrix
## 20. Quality Assurance Process
## 21. Common Mistakes & Rejection Criteria
## 22. Complete Worked Examples
## 23. Final Submission Checklist
## Appendix A - JSON Templates
## Appendix B - Contractor Quick Reference
## Appendix C - Glossary

## 1. Purpose & Scope
This Standard Operating Procedure (SOP) governs the complete workflow for extracting externally available
information and transforming it into Xtrium-compatible JSON records. It applies whenever Xtrium or
Careerflow AI contractors receive a URL, PDF, database entry, product page, supplier directory page,
research paper, government dataset, or related public source that may contain material, supplier, producer,
manufacturer, distributor, certification, product, or application data.
The SOP is intentionally source-agnostic. Unlike source-specific procedures such as a NASA-only or BGSonly mapping document, this standard defines how contractors must think, decide, extract, normalize,
validate, and escalate across any future source. It is the baseline operating manual for all data acquisition
work that feeds Xtrium supplier and materials knowledge graph workflows.
The immediate deliverable for the team is JSON. Every completed extraction must produce one or more
schema-compliant JSON files. Each JSON file must be ready for review by the Xtrium Data Operations team
and eventual ingestion into downstream graph infrastructure, including but not limited to Neo4j-based
loading pipelines.

### 1.1 Objectives
• Create accurate supplier, producer, manufacturer, distributor, material, product, certification, and standard
records from publicly available external sources.
• Produce one JSON object per distinct supplier or material entity unless the schema or project instructions
explicitly require a different batching approach.
• Preserve source traceability by recording URLs and relevant evidence for every extracted object.
• Prevent hallucinated, estimated, or unverifiable data from entering Xtrium schemas.
• Teach contractors how to choose the correct schema when a page contains both company-level and materiallevel information.
• Standardize naming, canonicalization, duplicate detection, product splitting, source ranking, and escalation
behavior across all future projects.
• Enable QA reviewers to validate JSON consistently using repeatable, documented criteria.

### 1.2 Deliverables
Deliverable
Supplier record

Required Format
One JSON file per supplier or producer

Material record

One JSON file per material where
applicable

Linked supplier-material records

Separate JSON objects with
relationship-ready fields

Escalation note

Plain text comment or issue tracker
entry

QA-ready batch

Folder of JSON files plus source list

Notes
Used when the source primarily
describes a company, mine operator,
producer, manufacturer, distributor,
processor, or supplier.
Used when the source primarily
describes material identity, properties,
grades, standards, applications,
composition, or performance.
Required when a company page
describes both a supplier entity and
specific materials or products.
Required when duplicates, confidential
sources, ownership ambiguity, schema
uncertainty, or conflicting sources are
encountered.
Each file must pass syntax validation
and contractor checklist before
submission.

### 1.3 Intended Audience
This SOP is written for both Careerflow AI contractors and internal Xtrium Data Operations personnel.
Contractors must use it as their daily extraction guide. Internal Xtrium reviewers must use it as a QA

reference for approving, rejecting, or returning submitted batches. Project leads may extend it with sourcespecific addenda when a source requires unique extraction logic.

### 1.4 Scope Boundaries
This SOP covers public and authorized data extraction only. Contractors must not attempt to access
restricted, confidential, proprietary, or otherwise unauthorized information. If a website requires login,
payment, manual approval, a customer account, or access to confidential files, contractors must stop and
escalate before proceeding.
IMPORTANT - PUBLIC DATA ONLY
When in doubt, do not extract. Escalate to Raghu or Sirisha before using login-only, confidential, restricted, or
ownership-ambiguous information.

## 2. Roles & Responsibilities
The table below defines the operating roles for universal extraction projects. A single person may perform
more than one role in small batches; however, the responsibilities remain distinct and must be completed
before submission.
Role
Data Extraction Contractor

Data Transformation Specialist

QA Reviewer

Project Lead

Raghu / Sirisha

Xtrium Data Engineering Team

Primary Responsibility
Receives source links, opens each source, identifies entity
type, extracts public information, performs secondary
research when allowed, fills the appropriate schema, and
submits JSON files.
Normalizes extracted information into schema-compliant
JSON, applies naming conventions, handles field-level
mapping, and ensures no schema fields are modified.
Runs validation checks, confirms source traceability, rejects
hallucinated data, verifies duplicate checks, and returns
non-compliant files for correction.
Resolves ambiguous cases, approves duplicate merges,
defines source-specific exceptions, and accepts final
deliverables.
Final escalation points for duplicate suppliers, unclear
ownership, confidential/logged-in sources, and schema
uncertainties.
Maintains schemas, ingestion requirements, ID assignment,
relationship logic, and downstream loading tools.

### 2.1 Contractor Responsibility Standard
A contractor is not responsible for knowing every material science detail. A contractor is responsible for
being precise, source-faithful, cautious, and transparent. The correct behavior is to record what is supported,
infer only within the allowed inference rules, and escalate uncertainty rather than force a decision.

### 2.2 QA Responsibility Standard
QA reviewers must evaluate the submitted JSON against this SOP, not against personal preference. If a file
is rejected, the reviewer should identify the exact rule violated: missing source URL, duplicate risk, schema
modification, invented value, unsupported certification, wrong entity type, invalid JSON, or incomplete
extraction.

## 3. Non-Negotiable Operating Rules
All rules below must be observed at all times. Violation of any rule is grounds for rejecting an individual file
or an entire batch depending on severity.

Rule 1

NO HALLUCINATIONS
Every extracted fact must be supported by a source.
Contractors may not invent company locations, product
names, certifications, lead times, standards, material
grades, or manufacturing sites.

Rule 2

NO SCHEMA MODIFICATION
Do not rename fields, remove required fields, add ad hoc
fields, or restructure the Xtrium schema. If a needed field
does not exist, place the information in the permitted raw,
notes, or source metadata location, or escalate.

Rule 3

NULL OVER GUESSING
If information cannot be found after the allowed research
steps, set the field to null or [] as appropriate. A null
value is acceptable; a guessed value is not.

Rule 4

SOURCE TRACEABILITY
Every object must include source URLs. Important fields
such as company identity, product names, certifications,
material properties, and manufacturing sites must be
traceable to a source.

Rule 5

AI IS ASSISTIVE, NOT AUTHORITATIVE
Gemini and Perplexity may help locate, summarize, or
navigate sources. Their answers must never be copied
as facts unless verified against an underlying public
source.

Rule 6

DUPLICATE PREVENTION
Before creating a new supplier or material record, check
whether the entity already exists in the working batch or
known reference set. Uncertain duplicates must be
escalated.

Rule 7

PUBLIC INFORMATION ONLY
Use publicly available or explicitly authorized data. Do
not extract confidential, customer-only, paywalled,
restricted, or proprietary information without Xtrium
approval.

Rule 8

PRESERVE SOURCE MEANING
Do not over-clean, over-summarize, or change the
meaning of source text. Normalize fields for schema
consistency, but preserve raw evidence where required.

Rule 9

CERTIFICATIONS MUST BE EXPLICIT
Never infer certifications from logos, industry claims, or
product categories. Certifications must be explicitly
stated by a source or left null/empty.

Rule 10

ONE PRODUCT PER DISTINCT PRODUCT
If a company lists Titanium Billet, Titanium Sheet,
Titanium Plate, and Titanium Powder, create four product

entries, not one combined entry.

Rule 11

ESCALATE AMBIGUITY
If an issue affects identity, ownership, duplicate status,
confidential access, schema selection, or source conflict,
escalate before submitting the record.

## 4. Universal Data Extraction Workflow
Every source must be processed using the workflow below. Do not extract and transform at random. A
repeatable sequence prevents duplicate entities, incorrect schemas, and unsupported claims.
RECEIVE URL OR SOURCE FILE
|
v
OPEN SOURCE
|
v
CLASSIFY SOURCE TYPE
|
v
IDENTIFY PRIMARY ENTITY
|
v
SELECT SCHEMA(S)
|
v
EXTRACT PUBLIC DATA
|
v
RUN SECONDARY RESEARCH IF ALLOWED
|
v
NORMALIZE AND CANONICALIZE
|
v
CHECK DUPLICATES
|
v
VALIDATE JSON
|
v
SUBMIT FOR QA

### 4.1 Step-by-Step Workflow
Step

Name
Receive source

Classify source type

Identify primary entity

Required Action
Open the assigned URL, PDF, database
result, paper, or product page. Record
the original source URL before extracting
anything.
Determine whether the source is an
official website, product page, supplier
directory, government database,
research paper, PDF, distributor page,
LinkedIn/Wikipedia page, or AI-assisted
discovery result.
Determine whether the page primarily

Select schema(s)

Extract fields

Research missing data

Normalize

Check duplicates

Generate JSON

Validate

Submit

describes a company, material, product,
facility, certification, standard, application,
or publication.
Use the decision tree in Section 8. If both
company and material data are present,
create both Supplier and Material records
and prepare linking fields.
Capture all supported fields directly from
the source. Preserve exact product
names and certification names.
If allowed, search official website,
Google, LinkedIn, Tier 1, or Tier 2
sources. Stop when reliable evidence is
unavailable.
Apply canonical naming, URL formatting,
product splitting, and field-level cleanup
rules.
Search current batch and known
supplier/material lists for similar names,
aliases, parent/subsidiary entities, and
acquired company names.
Create schema-compliant JSON. Do not
modify schema fields.
Run syntax validation and the QA
checklist. Ensure all sources are
attached.
Submit JSON files using the required
folder/file naming convention. Include
escalation notes for unresolved issues.

IMPORTANT - DUPLICATE CHECK FIRST
Complete the duplicate check before creating new entity files. Most avoidable QA failures come from creating a new
supplier record when a related or identical company already exists.

## 5. Understanding the Xtrium Knowledge Graph
Xtrium does not collect data for the sake of building flat lists. Extracted records feed a connected knowledge
graph. Every supplier, material, product, certification, standard, application, and manufacturing site should
be treated as an entity or relationship candidate. Contractors must understand this graph mindset to avoid
placing all information into one object when it should be represented as linked records.

### 5.1 Core Entity Types
Entity Type
Supplier

Producer

Distributor
Material

Product

Manufacturing Site

Certification / Standard

Application

Meaning
A company or organization that supplies,
produces, manufactures, processes,
distributes, or sells materials or products.
A supplier that creates, extracts,
manufactures, or transforms a material at
source.
A supplier that sells or distributes
materials made by others.
A substance, alloy, polymer, ceramic,
composite, mineral, or material family
with identity and properties.
A commercially listed offering such as
sheet, billet, plate, powder, resin grade,
compound, or fabricated part.
A mine, plant, quarry, mill, production
facility, laboratory, warehouse, or
processing location.
A formal certification, quality system,
regulatory reference, or technical
standard.
A use case or industry application such
as aerospace, additive manufacturing,
medical, battery, defense,
semiconductor, or construction.

Typical Source Evidence
Company website, supplier directory,
distributor profile, government mine
database.
Mine operator page, plant page,
manufacturer website, government
registry.
Distributor catalog, Thomasnet listing,
sales page.
Datasheet, research paper, NASA/USGS
database, product specification.
Product page, catalog, product table,
manufacturer datasheet.
Company locations page, mine database,
plant certification page.
ISO certificate page, UL listing, product
datasheet, standards reference.
Product page, application note, research
paper, catalog.

### 5.2 Graph Mindset
The most important decision is whether information belongs inside one object or should create a
relationship. For example, a supplier that manufactures titanium plate is not itself the material titanium. The
supplier should be represented as a supplier entity. Titanium Plate should be represented as a product entry
or material-linked product. The relationship is Supplier -> offers -> Titanium Plate. The same principle
applies to certifications, manufacturing sites, standards, and applications.
• If a company makes a material, create or update the supplier and link it to the product/material.
• If a source primarily describes a material property, create or update the material record and cite the property
source.
• If a source lists many products, create separate product entries for each distinct product.
• If a page lists certifications, attach them to the supplier or product only when explicitly supported.
• If a source names a facility, create a manufacturing_sites entry only when the facility is relevant to the
extracted supplier or product.

## 6. Supported Source Types
Contractors may encounter many source types. The table below defines what to look for, what to avoid, and
how reliable each source type generally is. Source authority is formally ranked in Section 7.
Source Type
Official company website

What to Extract
Company identity, headquarters,
products, manufacturing sites,
certifications, industries served,
datasheets, contact pages.

Common Pitfalls
Marketing language may be
broad. Do not infer certifications or
facilities unless explicitly stated.

Reliability
High

Supplier page

Supplier identity, product
offerings, capabilities, locations,
industries, catalog links.

Product page

Exact product name, grade, form
factor, datasheet URL,
applications, standards, available
sizes, material family.
Producer/operator, site name,
material/commodity,
country/region, extraction or
processing status.
Official
company/material/site/certification
data, regulations, production
statistics, source citations.
Material properties, composition,
test method, applications,
processing notes, standards
referenced.
Properties, standards, grades,
product IDs, applications, supplier
context, safety notes.
Supplier identity, categories,
capabilities, certifications,
locations, company descriptions.

Mine / producer database

Government database

Research paper

PDF / Datasheet

Thomasnet

Distributor website

Product availability, product
categories, datasheets,
manufacturer names, product
links.
Company name, approximate
headquarters, industry, employee
count, website link.

LinkedIn

Wikipedia

Background, aliases, history,
parent/subsidiary clues,
acquisition names.

Gemini / Perplexity

Discovery assistance,
summarization, locating source
links, identifying possible
subsidiaries.

May combine distributor and
manufacturer roles. Confirm
whether the supplier makes or
only sells the product.
Do not collapse several listed
products into one. Do not infer
exact material properties unless
stated.
Operator names may repeat
across sites. Deduplicate by legal
entity.

Medium to High

Fields may be outdated; record
date when visible.

Very High

Do not treat authors as suppliers.
Do not generalize lab results into
commercial availability.

High for properties

PDF tables may extract poorly.
Verify units and row alignment
manually.
May include distributor listings and
broad capability claims. Verify
important facts elsewhere if
possible.
Distributor may not be producer.
Supplier tier must reflect
distribution role unless
manufacturing is confirmed.
Do not use for certifications,
detailed products, or
manufacturing claims unless no
better source exists.
Use only for context or secondary
confirmation. Do not use as
primary evidence for technical
fields.
AI output itself is not authoritative.
Verify against linked sources
before extraction.

High

High

High

Medium

Medium

Low to Medium

Low

Assistive only

### 6.1 Link Type Instructions
• Company websites: Start with About, Products, Capabilities, Certifications, Locations, News, and Contact
pages. Extract the company only once; add products as product entries.
• Supplier pages: Determine whether the entity is a producer, manufacturer, processor, distributor, or reseller.
Do not assume all suppliers manufacture products.
• Product pages: Capture each distinct product, form, grade, datasheet URL, application, and material family. If
the page also names the producer, create relationship-ready supplier context.
• Mine databases: Treat operators/producers as suppliers, sites as manufacturing_sites, and commodities as
products/materials.
• Government databases: Prefer official field values over third-party summaries. Preserve dataset title,
publication date, and URL.
• Research papers: Extract properties, composition, test conditions, standards, and applications only when
explicitly stated. Do not infer commercial availability.
• PDFs: Use PDF text extraction when possible, but manually verify tables, units, and headings before final
JSON.
• Anything else on the internet: Apply source hierarchy, public-data boundaries, schema decision rules, and
escalation procedures.

## 7. Source Authority Hierarchy
When multiple sources disagree, the higher-authority source should generally control. Do not select the
most convenient source; select the most authoritative source for the specific field. For example, a company
website is authoritative for its own product offerings, while a government database is authoritative for
regulatory or official mine/site data.
Tier
Tier 1

Source Type
Official company website

Use For
Company identity, products,
capabilities, certifications,
facilities, datasheets.
Official registrations,
site/operator data, regulations,
public statistics, official
certifications.
Official scientific or government
material and mineral data.
Material properties, methods,
composition, experimental data.
Supplier discovery, capabilities,
categories, some certifications.
Product availability, datasheet
links, manufacturer references.

Tier 1

Government databases

Tier 1

NASA / USGS

Tier 1

Peer-reviewed journal papers

Tier 2

Thomasnet

Tier 2

Distributor websites

Tier 2

Manufacturer catalogs

Products, grades, datasheets,
technical notes.

Tier 3

LinkedIn

Company context, website link,
broad industry, location hints.

Tier 3

Wikipedia

Tier 3

Gemini / Perplexity

Aliases, history,
parent/subsidiary clues,
background.
Search assistance,
summarization, source
discovery.

Limitations
Marketing claims still require
caution; do not infer technical
details beyond what is written.
May lag current commercial
reality; record publication date
when available.
May not reflect commercial
supplier availability.
Not usually authoritative for
company product availability.
Verify critical facts against
company or official sources.
Distributor role must not be
confused with manufacturer
role.
Catalogs may contain legacy
products; confirm currency
when possible.
Not sufficient for certifications,
technical properties, or products
unless no alternative exists.
Context only; avoid primary
reliance for extraction.
Not a source of record. Must be
verified against linked pages.

IMPORTANT - CONFLICTING SOURCES
If two sources conflict and both appear credible, do not force a decision. Record the conflict in an escalation note and
ask the Project Lead.

## 8. Schema Selection Decision Framework
Choosing the correct schema is the most important transformation decision. A page may describe a
company, a material, a product, or several of these at once. The extractor must identify the primary entity
first, then decide whether one or more JSON objects are needed.
START
|
v
Does the source primarily describe a company, supplier, producer, manufacturer, distributor, mine operator,
or facility owner?
YES -> Create Supplier JSON
|
v
Does the same source also describe specific materials or products?
YES -> Create Material/Product entries and link to Supplier
NO -> Supplier only
NO
|
v
Does the source primarily describe a material, grade, alloy, mineral, polymer, ceramic, composite, or
property dataset?
YES -> Create Material JSON
|
v
Does it name a supplier/manufacturer?
YES -> Add supplier_context or relationship-ready supplier link
NO -> Material only
If neither company nor material is clear -> ESCALATE

### 8.1 Schema Decision Table
Source Content
Company homepage with products listed

Required Output
Supplier JSON + product entries

Company product page for one alloy grade

Supplier JSON if supplier not existing +
Material/Product JSON
Material JSON

Material datasheet with properties
Research paper about ceramic composite
properties
Government mine directory
Thomasnet supplier profile
Distributor catalog page
Certification database entry
Broken or empty page

Material JSON
Supplier/Producer JSON +
manufacturing_sites + products
Supplier JSON
Supplier JSON as distributor + product
entries
Supplier or product certification update
No JSON unless alternate source confirms
data

Notes
Create one supplier object and one product
entry per distinct product.
Link supplier to material/product.
Use supplier_context if the datasheet is
from a supplier.
Do not create supplier from university
authors.
Operator is supplier/producer; each site
becomes site/product data.
Confirm manufacturer vs distributor if
possible.
Do not mark supply_chain_tier as producer
unless manufacturing is explicit.
Attach certification only to the named entity.
Escalate or mark source unavailable.

## 9. Supplier, Producer, Manufacturer & Distributor Extraction
Supplier extraction applies to companies and organizations involved in making, processing, extracting,
distributing, or selling materials and products. A supplier may be a raw material producer, manufacturer,
processor, distributor, reseller, or mixed-role entity.

### 9.1 Supplier Field Extraction Reference
Schema Field
company_name

Preferred Source
Official company page or authoritative
directory

canonical_name

Derived

website

Official company site

headquarters_location
company_description

Company contact/about page; LinkedIn if
needed
Official website, supplier directory

industry_sector

Inferred from products/applications/source

supply_chain_tier

Inferred from role

manufacturing_sites

Locations/facilities page; government site
data
Product pages, catalogs, supplier listings

products_offered
certifications

Certification page, certificate PDF, trusted
directory
All supporting sources

sources

Extraction Rule
Copy the legal or public company name
exactly as written. Do not expand acronyms
unless the source does.
Lowercase, replace & with and, remove
punctuation, collapse spaces, and use
hyphens. See Section 14.
Use the clean root website or page URL as
appropriate. Do not invent if not available.
Record city/state/country where supported.
If not found, null.
Write a brief source-faithful summary. Do
not add marketing claims that are not
supported.
Allowed inference when the source clearly
states products or industries, e.g.,
aerospace-grade titanium forgings ->
aerospace/materials manufacturing.
Producer/manufacturer usually tier 1 or 2
depending on project schema;
distributor/reseller usually later tier. Escalate
if unclear.
Add only relevant sites that are explicitly
associated with the supplier.
One entry per distinct product. Preserve
product names.
Only explicit certifications. Never infer from
logos or industry claims.
Include source URLs used to support the
object.

### 9.2 Producer vs Manufacturer vs Distributor
Role
Producer

How to Identify
Extracts or creates raw material at source;
operates mine, quarry, mill, chemical plant,
resin plant, etc.
Transforms material into product form such
as sheet, billet, powder, compound,
component, or finished intermediate.
Performs heat treatment, recycling,
purification, compounding, coating, or
finishing.
Sells or distributes products made by
others.

Manufacturer

Processor

Distributor

Marketplace / Directory

Lists many companies but is not itself the
supplier.

Required Treatment
Treat as supplier/producer. Add sites and
products if supported.
Treat as supplier/manufacturer. Extract
products and relevant manufacturing sites.
Treat as supplier/processor. Record
processing capability when schema permits.
Treat as distributor. Do not mark as
manufacturer unless source explicitly
confirms manufacturing.
Extract listed companies as suppliers only if
the page provides enough supporting detail.

IMPORTANT - SUPPLIER ROLE
A company that sells titanium sheet is not automatically the manufacturer of titanium sheet. Look for language such
as manufactures, produces, mills, casts, extrudes, processes, operates, or owns facility. Otherwise treat it as
distributor or escalate.

## 10. Material Extraction Standards
Material extraction applies when a source describes a substance, grade, alloy, polymer, ceramic, composite,
mineral, property dataset, or technical datasheet. The material object should represent the material identity
and attributes, not the supplier as a company.
Schema Field
material_name

Preferred Source
Datasheet title, database material name,
product specification

Extraction Rule
Copy exact name. Preserve grade or
designation when part of name.

canonical_name

Derived

material_type

Source category or inferred family

grade

Material name or datasheet

chemical_formula

Composition field or paper

properties
standards_referenced

Datasheet, research paper, material
database
Datasheet or paper

applications_mentioned

Product page, paper, application note

supplier_context

Datasheet supplier or product page

sources

Original material source

Lowercase and normalize consistently. Use
hyphens unless schema requires
snake_case.
Allowed values depend on schema. Map
alloy to metal, resin to polymer, ceramic
matrix to ceramic/composite as appropriate.
Escalate unclear cases.
Extract explicit grade such as 6061-T6,
Grade 5, 450G. Do not invent grade.
Extract only when clear. Do not force prose
into formula fields.
Capture value, units, condition, source, and
raw evidence. Preserve units.
Extract explicit ASTM, ISO, SAE, AMS, UL,
NASA, or other standards.
Allowed inference when supported by
source language.
Link material to supplier/manufacturer if
named.
Every material must include at least one
source URL.

### 10.1 Material Property Extraction Rules
• Keep numeric values and units together. A value without units is incomplete unless the source explicitly states
dimensionless.
• Preserve test conditions such as temperature, pressure, orientation, heat treatment, sample state, or standard
test method when available.
• If a property is expressed as a range, keep the range as a string and do not collapse it to an average.
• If a table is complex, verify row and column alignment manually before entering values.
• If the source is a research paper, record experimental context. Do not generalize a lab sample into all
commercial versions of the material.

## 11. Product Extraction Standards
Products are the commercially or operationally listed forms that a supplier offers. A material such as titanium
may appear in many product forms. Each distinct product must be captured separately when the source lists
it separately.
Rule P1

ONE PRODUCT PER DISTINCT PRODUCT
If a company lists Titanium Billet, Titanium Sheet,
Titanium Plate, and Titanium Powder, create four
separate product entries. Do not collapse them into one
Titanium product.

Product Listing
Titanium Billet; Titanium Sheet; Titanium
Plate; Titanium Powder
Aluminum 6061-T6 Sheet in multiple
thicknesses

Required Product Entries

Nickel Alloy Bar, Rod, Wire

Aerospace-grade titanium forgings

Various minerals

1 with product_name = Various Minerals
only if no detailed list exists

1 or more depending on schema

Notes
Each is a separate commercially meaningful
product form.
If thickness is a variant field, keep one
product with variants. If each is listed as
separate SKU and schema supports SKU,
separate entries may be needed.
Separate forms imply distinct product
offerings.
Product = Titanium Forgings; material =
Titanium; application/industry = Aerospace.
If a detailed list exists, split by
material/product.

### 11.1 Product Field Guidance
Field

Rule

product_name
grade
category
product_id
source_url
datasheet_url
cross_graph_material_id

Copy source product name in clear Title Case where
appropriate. Do not over-normalize trade names.
Use explicit grade, alloy, polymer grade, particle size, purity, or
end-use variant when stated.
Use material or product family category from the source.
Use source product ID/SKU when available. If not available, null
unless project-specific rules define an ID.
Use the exact URL supporting the product listing.
Use product datasheet URL when available; otherwise null.
Usually null during extraction unless an existing material ID is
supplied by Xtrium.

## 12. Certification, Standard & Compliance Extraction
Certifications and standards are high-risk fields because they can affect downstream trust. Extract them only
when explicitly supported by the source. Marketing claims such as quality, compliant, aerospace-grade,
medical-grade, or certified quality are not enough unless a named certification or standard is stated.
Evidence Type
ISO 9001:2015 certificate PDF naming the
company
Website footer shows ISO logo but no text
or certificate
Product datasheet says ASTM B209

Can Extract?
Yes

Product page says aerospace grade

No certification

UL listing database entry

Yes

Distributor says product meets RoHS
AI says company has AS9100

Yes if specific and source is credible
No

No / Escalate
Yes

Action
Add ISO 9001:2015 to certifications and cite
certificate/source URL.
Do not extract unless source explicitly
states certification.
Add ASTM B209 as standard referenced for
the product/material.
May infer aerospace application/industry if
supported, but do not create a certification.
Extract UL reference and cite database
URL.
Record compliance reference with source.
Verify against
company/certificate/authoritative listing first.

IMPORTANT - CERTIFICATION SAFETY
Never infer certifications from product category, industry, or customer base. A supplier serving aerospace is not
automatically AS9100 certified.

## 13. Relationship Creation Rules
Relationship-ready data is what makes Xtrium useful. Contractors must create records in a way that
downstream graph loading can connect entities. When two entities are clearly related, the relevant
relationship fields, source evidence, or supplier_context must be populated according to the schema.
Relationship
Supplier -> offers -> Product

When to Create / Preserve
A company page or catalog lists a product.

Supplier -> produces -> Material

Material -> has_property -> Property

Source explicitly states
production/manufacturing/extraction of
material.
Source identifies facility, plant, mine, quarry,
or site associated with supplier.
Product name or datasheet identifies
material family or composition.
Datasheet or paper states property value.

Supplier -> holds -> Certification

Certification explicitly names supplier.

Material/Product -> references -> Standard

Source names ASTM, ISO, SAE, AMS, UL,
NASA, or other standard.
Source states use case or industry.

Supplier -> operates -> Manufacturing Site
Product -> is made of -> Material

Material/Product -> used_in -> Application

Evidence Required
Product page, catalog, supplier profile, or
datasheet.
Company page, government database,
product page.
Locations page, government mine
database, facility page.
Product page, datasheet, paper.
Datasheet, research paper, material
database.
Certificate PDF, certification registry, official
company page.
Datasheet, standard reference, paper.
Application page, product page, paper.

### 13.1 Link Rather Than Duplicate
If a supplier appears in multiple material records, do not duplicate the full supplier description inside every
material object unless the schema requires supplier_context. Instead, preserve supplier canonical name and
source evidence so downstream systems can connect records. Duplicate text creates inconsistency and
increases QA burden.

## 14. Naming & Normalization Standards
Naming conventions make duplicate detection and graph ingestion possible. Apply the standards below
consistently unless a source-specific SOP overrides them.

### 14.1 Supplier canonical_name
1. Convert the full company name to lowercase.
2. Convert & to and before removing punctuation.
3. Remove commas, periods, parentheses, apostrophes, slashes, and non-essential punctuation.
4. Replace one or more spaces with a single hyphen.
5. Keep common suffixes such as inc, ltd, plc, llc, llp, corp, corporation, company, group, uk, usa, and gmbh
unless project rules say otherwise.
6. Do not silently merge abbreviations or historical names. Escalate uncertain aliases.
company_name
ATI Inc.
ATI Specialty Materials
A & D Sutherland
CEMEX UK Operations Ltd
Hanson Quarry Products Europe Ltd
Röchling Industrial
3M Advanced Materials

canonical_name
ati-inc
ati-specialty-materials
a-and-d-sutherland
cemex-uk-operations-ltd
hanson-quarry-products-europe-ltd
rochling-industrial
3m-advanced-materials

### 14.2 Material canonical_name
• Use lowercase and hyphens for material identity fields unless the target schema specifies snake_case.
• Preserve grade tokens that are part of the material identity, such as 6061-t6 or ti-6al-4v.
• Do not convert trade names into chemical names unless the source explicitly provides both.
• Do not remove meaningful alloy or grade punctuation if removal would make the name ambiguous; normalize
consistently while preserving meaning in material_name.

### 14.3 URL Normalization
• Use exact source URLs for evidence fields.
• Use clean official root website only for the supplier website field.
• Do not use Google result URLs or AI citation redirect URLs as sources.
• Remove tracking parameters when they are not necessary for page access, but preserve the canonical page
path.
• If a PDF is the source, cite the PDF URL and page number in raw/source notes when page number is
available.

## 15. AI Usage Policy
Gemini and Perplexity are permitted tools for this workflow. They may be used to accelerate reading, locate
relevant pages, summarize long documents, and identify possible relationships. They may not be used as
unverified factual sources.
Allowed AI Use
Summarize long PDFs

Locate missing pages
Identify possible subsidiaries
Clarify technical terms

Examples
Ask AI to identify sections containing
product tables, certifications, material
properties, or supplier names.
Ask AI to find official product pages or
datasheets for a company.
Ask AI for acquisition/alias clues.
Ask what billet, forging, resin, or ceramic
matrix means.
Use AI to convert verified notes into schema
wording.

Draft extraction notes

Required Verification
Open the source PDF and verify extracted
facts before JSON entry.
Use the actual page URL as source, not the
AI answer.
Confirm through official company pages,
government filings, or credible sources.
Do not treat explanation as source
evidence.
Check every field against source before
submission.

### 15.1 Prohibited AI Uses
• Generating certifications that are not explicitly found in a source.
• Inventing headquarters, facilities, product lists, or lead times.
• Creating supplier descriptions from AI memory without checking a source.
• Replacing source URLs with AI answer links.
• Merging duplicate companies solely because AI says they are the same.
• Using AI to bypass confidential or login-protected information.
IMPORTANT - AI VERIFICATION
AI can help you find the evidence. AI is not the evidence.

## 16. Secondary Research Policy
Secondary research is allowed but must be controlled. The purpose is to fill publicly available fields that are
missing from the assigned source, not to create speculative enrichments. If a fact cannot be found using
reasonable public searches, set the value to null.
Priority

Action
Search the assigned source and linked
official pages.
Search the official company website.

Use Google search for the exact
company/product/material.
Check LinkedIn if available for broad
company identity/location only.

Check Tier 1 or Tier 2 databases relevant to
the field.
If still unavailable, set null or [] and submit.

When to Stop
Stop if the required information is clearly
present or absent.
Stop if company-controlled evidence
answers the question.
Stop after checking credible results; do not
scrape random blogs.
Do not use LinkedIn for technical properties
or certifications unless no alternative exists
and field is low-risk.
Use official or credible directories to
confirm.
Do not continue searching indefinitely or
guess.

### 16.1 Missing Information Defaults
Missing Field
headquarters_location
website
certifications
products

Default Action
Search official website and LinkedIn if available; otherwise null.
Search Google official site; otherwise null.
Do not infer. Search official/certification sources; otherwise [].
If no products listed, set products_offered to [] or null per
schema. Do not invent likely products.

lead time
manufacturing site

Usually null unless explicitly stated. Do not estimate.
Null/empty unless a site is explicitly named or linked to source.

## 17. Duplicate Detection & Entity Resolution
Duplicate detection protects the graph from fragmentation. Contractors must check for existing entities
before creating a new record. This is especially important for large industrial companies, subsidiaries,
acquired brands, renamed companies, and companies that appear in multiple directories.

### 17.1 Duplicate Decision Tree
NEW COMPANY OR MATERIAL ENCOUNTERED
|
v
Exact canonical_name already exists?
YES -> Use existing entity / update record
NO
|
v
Similar name, same website, same address, or known alias?
YES -> ESCALATE TO RAGHU / SIRISHA
NO
|
v
Parent/subsidiary relationship suspected?
YES -> ESCALATE BEFORE MERGE
NO
|
v
Create new entity with source evidence

### 17.2 Duplicate Handling Examples
Observed Names
ATI; ATI Inc.

Action
Escalate if existing record unclear

ATI Specialty Materials; ATI Metals

Escalate

Allegheny Technologies; ATI Inc.

Escalate

CEMEX UK Operations Ltd; CEMEX UK
Tarmac Ltd repeated across product pages

Escalate or keep separate until confirmed
Same supplier if exact match

Company with same name but different
country

Escalate

Reason
Likely same parent identity but must confirm
canonical entity.
May be division, product group, or legal
entity. Do not auto-merge.
Historical/acquisition/renaming relationship
requires confirmation.
Legal entity and brand may differ.
Add products/sites to existing supplier
object.
May be unrelated company or regional
subsidiary.

IMPORTANT - ENTITY RESOLUTION
Never merge companies because names are similar. Merging is more dangerous than leaving a flagged duplicate
unresolved.

## 18. Edge Cases & Special Handling
The following table defines required action for common difficult sources. Contractors must follow these rules
rather than improvising.
Situation
Coming Soon page

Required Action
Do not create full record unless other public sources provide
enough evidence. Record source unavailable or escalate.
Do not extract confidential content. Escalate immediately.
Extract only public product/category information visible on page. Do
not invent specifications.
Download and inspect if public. Extract source URL and page
references where possible.
Manually verify row/column alignment. Do not rely blindly on copied
table text.
Extract visible public site data. If data requires login or hidden API
access, escalate.
Use translation tools for comprehension. Preserve original names
and cite original URL.
Search official alternate source. If unavailable, escalate or mark
unavailable.
Use visible page content. Do not bypass access controls. Escalate
if information cannot be accessed normally.
Create separate entities only when the source clearly distinguishes
them. Otherwise escalate.
Extract all feasible products or request batching strategy. Do not
cherry-pick without project approval.
Prefer higher authority source or escalate if conflict affects identity,
certifications, sites, or products.
Use only when current public source is unavailable. Record
archive/source date and escalate if data may be outdated.
Use abstract/public metadata only unless Xtrium provides
authorized access. Do not use unauthorized copies.
Manually transcribe only clearly visible public information. If
uncertain, leave null or escalate.

Confidential page or confidential label
Contact Sales only
Download-only PDFs
Embedded tables
Interactive maps
Multiple languages
Broken links
JavaScript-heavy websites
Multiple subsidiaries on one page
Companies with hundreds of products
Conflicting sources
Old archived pages
Paywalled papers
Images containing text

## 19. Escalation Matrix
Escalation is not a failure. It is the correct response when a decision could create duplicate entities, misuse
confidential information, introduce false data, or break schema consistency.
Situation
Duplicate supplier or material uncertainty

Escalate To
Raghu / Sirisha

Unknown material classification

Project Lead

Ambiguous ownership or subsidiary
relationship
Conflicting authoritative sources

Raghu / Sirisha

Confidential or login-only content

Raghu / Sirisha

Unable to determine schema

Project Lead

Hundreds of products or excessive
extraction scope
Potential schema field missing

Project Lead

Possible legal/compliance concern

Raghu / Sirisha

Project Lead

Data Engineering Team

Required Note
List observed names, URLs, suspected
relationship, and recommendation.
Provide material name, source context, and
candidate categories.
Provide parent/subsidiary clues and URLs.
Quote conflicting values and cite source
URLs.
State access requirement and whether
credentials were provided.
Explain whether source seems company,
material, product, certification, or other.
Request batching or sampling instructions
before proceeding.
Describe data type and proposed location;
do not edit schema.
Stop extraction until guidance is received.

### 19.1 Escalation Note Template
Escalation Type: Duplicate Supplier / Material Classification / Confidential Source / Other
Source URL(s):

Entity Name(s):
Issue Summary:
Evidence Observed:
Recommended Action:
Submitted By:
Date:

## 20. Quality Assurance Process
QA confirms whether the submitted JSON is accurate, schema-compliant, source-traceable, and safe for
downstream ingestion. Contractors must perform self-QA before submission. QA reviewers must document
rejections using the criteria below.

### 20.1 Contractor Pre-Submission Checklist
☐ JSON syntax is valid.
☐ Required schema fields are present.
☐ No schema fields were renamed or removed.
☐ company_name and/or material_name match source evidence.
☐ canonical_name follows naming rules.
☐ Every product entry corresponds to a distinct source product.
☐ All certifications and standards are explicitly supported.
☐ All source URLs open or are documented as unavailable.
☐ Duplicate check completed.
☐ Missing values are null or [] rather than guessed.
☐ AI-assisted facts were verified against original sources.
☐ Escalation notes are included for unresolved ambiguity.

### 20.2 QA Reviewer Checklist
Review Area
Schema validity

Pass Criteria
File parses and matches required structure.

Source traceability
Entity identity

Object includes source URLs and key facts
are supported.
Supplier/material/product identity is clear.

Products
Certifications
Material properties

Distinct products are split correctly.
Only explicit certifications are included.
Values, units, and conditions match source.

Research policy

Missing fields handled correctly.

Escalation

Ambiguities flagged.

Reject If
Invalid JSON, missing required fields,
schema modified.
Facts without sources or Google/AI links
used as evidence.
Wrong company, duplicate entity, unverified
alias merge.
Products collapsed, invented, or missing.
Inferred or hallucinated certifications.
Units missing, values altered, ranges
averaged.
Estimated lead times, invented locations,
over-research from weak sources.
Unresolved ambiguity silently decided.

## 21. Common Mistakes & Rejection Criteria
The following mistakes frequently cause batch rejection. Contractors must review this section before each
submission.
Mistake
Inventing certifications

Incorrect Behavior
Adding AS9100 because company serves
aerospace.
Creating ATI Inc. and ATI as separate
records without review.
Putting material properties into supplier
description.
Combining titanium sheet, plate, billet,
powder into one product.
Using Perplexity answer as source_url.

Creating duplicates
Wrong schema
Collapsing products
AI as source
Estimating values
Over-merging subsidiaries
Missing URLs

Adding 30 day lead time because industry
typical.
Merging parent and subsidiary
automatically.
Submitting JSON with no source links.

Correct Behavior
Only add AS9100 if source explicitly states
it.
Check duplicates and escalate uncertain
aliases.
Create Material JSON and link to supplier.
Create four product entries.
Open and cite the underlying
webpage/PDF.
Set lead time to null unless stated.
Escalate ownership questions.
Include source URLs in sources and
relevant fields.

Confidential extraction

Using login-only or restricted data without
approval.
Adding new field not in schema.

Stop and escalate before proceeding.

Bad Extraction
certifications: ["AS9100"] from aerospace
claim

Why It Fails
Certification inferred, not stated.

products_offered: ["Titanium Products"]

Too vague; source listed distinct products.

headquarters_location: "Pittsburgh" from
memory
source_url: Perplexity answer link

Unsupported fact.

Good Extraction
applications_mentioned: ["Aerospace"] if
source supports it; certifications: [] unless
AS9100 is explicit.
products_offered: Titanium Billet, Titanium
Sheet, Titanium Plate, Titanium Powder.
Search source; if not supported, null.

ATI Metals merged with ATI Inc. without
note

Unapproved merge.

Schema edits

Use raw/notes if allowed or escalate.

### 21.1 Good vs Bad Examples

AI is not source of record.

Use official company/product/database
URL.
Escalate duplicate/alias relationship.

## 22. Complete Worked Examples
The examples below demonstrate expected reasoning and JSON structure. They are illustrative templates.
Actual field names must always follow the current approved Xtrium schema.

### 22.1 Company Website -> Supplier JSON
Scenario: A contractor receives a company website for a manufacturer that states it produces aerospacegrade titanium forgings and lists a headquarters, product page, and ISO 9001 certification.
Observed Evidence
Company page names Apex Titanium Works Inc.
Products page lists Titanium Forgings and Titanium Billet.
Markets page says aerospace and defense applications.
Certification page states ISO 9001:2015.
No lead time stated.

Extraction Decision
Create supplier object with company_name copied exactly.
Create two product entries.
Applications/industry may include aerospace and defense.
Add certification with source URL.
typical_lead_time_days = null.

{
"supplier_id": null,
"company_name": "Apex Titanium Works Inc.",
"canonical_name": "apex-titanium-works-inc",
"website": "https://www.example-apex-titanium.com",
"headquarters_location": "Dayton, Ohio, United States",
"company_description": "Manufacturer of titanium forgings and billet for aerospace and defense
applications.",
"industry_sector": "aerospace materials manufacturing",
"supply_chain_tier": 1,
"typical_lead_time_days": null,
"certifications": ["ISO 9001:2015"],
"products_offered": [
{"product_name": "Titanium Forgings", "grade": "Aerospace-grade", "source_url":
"https://www.example-apex-titanium.com/products/forgings"},
{"product_name": "Titanium Billet", "grade": null, "source_url": "https://www.example-apextitanium.com/products/billet"}
],
"is_verified": false,
"sources": [
{"source_name": "Apex Titanium Works official website", "source_url": "https://www.example-apextitanium.com", "tier": "tier1"}
]
}

### 22.2 Product Page -> Supplier + Product Entries
Scenario: A product page lists Titanium Sheet, Titanium Plate, Titanium Billet, and Titanium Powder. The
page belongs to a supplier website and includes datasheet links for sheet and plate only.
• Create one supplier object for the company if it does not already exist.
• Create four product entries because the source lists four distinct products.
• Use datasheet_url only where a datasheet link exists; use null for billet and powder if no datasheet is listed.
• Do not create a single Titanium product that hides the distinct commercial forms.
"products_offered": [
{"product_name": "Titanium Sheet", "grade": null, "datasheet_url": "https://example.com/titaniumsheet.pdf", "source_url": "https://example.com/titanium-products"},
{"product_name": "Titanium Plate", "grade": null, "datasheet_url": "https://example.com/titaniumplate.pdf", "source_url": "https://example.com/titanium-products"},
{"product_name": "Titanium Billet", "grade": null, "datasheet_url": null, "source_url":
"https://example.com/titanium-products"},
{"product_name": "Titanium Powder", "grade": null, "datasheet_url": null, "source_url":
"https://example.com/titanium-products"}
]

### 22.3 Material Datasheet -> Material JSON
Scenario: A public datasheet describes Aluminum 6061-T6 with density, tensile strength, applications, and
ASTM B209 reference. The datasheet is hosted by a manufacturer.
{
"material_id": null,
"material_name": "Aluminum 6061-T6",
"canonical_name": "aluminum-6061-t6",
"material_type": "metal",
"grade": "T6",
"supplier_context": {
"supplier_canonical_name": "example-metals-inc",
"supplier_product_id": null,
"supplier_grade_name": "6061-T6",
"datasheet_url": "https://example.com/datasheets/aluminum-6061-t6.pdf"
},
"properties": [
{"name": "Density", "value": "2.70", "numeric_value": 2.70, "unit": "g/cm3", "condition": null,
"source": {"source_url": "https://example.com/datasheets/aluminum-6061-t6.pdf", "tier": "tier2"}},
{"name": "Tensile Strength", "value": "310", "numeric_value": 310, "unit": "MPa", "condition": "T6
temper", "source": {"source_url": "https://example.com/datasheets/aluminum-6061-t6.pdf", "tier":
"tier2"}}
],
"standards_referenced": ["ASTM B209"],
"applications_mentioned": ["Aerospace", "Structural components"],
"sources": [{"source_name": "Example Metals datasheet", "source_url":
"https://example.com/datasheets/aluminum-6061-t6.pdf", "tier": "tier2"}]
}

### 22.4 Research Paper -> Material Property Extraction
Scenario: A journal paper reports thermal conductivity of a ceramic composite at 25 C and 800 C. The
authors are university researchers. The paper does not imply commercial availability.
Decision
Create Material JSON
Do not create Supplier JSON for the university authors
Capture conditions separately
Use the paper DOI or URL as source

Reason
The source describes material properties.
Authors are not suppliers of the material.
25 C and 800 C are distinct measurement conditions.
Journal paper is the property evidence.

"properties": [
{"name": "Thermal Conductivity", "value": "12.4", "numeric_value": 12.4, "unit": "W/m-K",
"condition": "25 C", "source": {"source_name": "Journal paper", "source_url":
"https://doi.org/example", "tier": "tier1"}},
{"name": "Thermal Conductivity", "value": "18.9", "numeric_value": 18.9, "unit": "W/m-K",
"condition": "800 C", "source": {"source_name": "Journal paper", "source_url":
"https://doi.org/example", "tier": "tier1"}}
]

### 22.5 Government Database -> Producer/Supplier Extraction
Scenario: A government mineral database lists a mine site, operator, commodity, region, and production
status. The operator should become the supplier/producer, the mine should become a manufacturing site,
and the commodity should become a product/material reference.
{
"company_name": "Example Minerals Ltd",
"canonical_name": "example-minerals-ltd",

"industry_sector": "industrial minerals",
"supply_chain_tier": 1,
"manufacturing_sites": [
{"location": "North Ridge Quarry", "country": "United States", "site_type": "quarry", "raw":
"Government database entry: North Ridge Quarry; Operator: Example Minerals Ltd; Commodity: Limestone"}
],
"products_offered": [
{"product_name": "Limestone", "category": "Industrial Minerals", "source_url":
"https://government.example/mines/north-ridge"}
],
"sources": [{"source_name": "Government mine database", "source_url":
"https://government.example/mines/north-ridge", "tier": "tier1"}]
}

### 22.6 Company + Products Page -> Create Both and Link
Scenario: A manufacturer page states that the company manufactures PEEK 450G resin and provides a
product datasheet with material properties. The source contains both supplier and material information.
• Create Supplier JSON for the manufacturer.
• Create Material JSON for PEEK 450G.
• In Material JSON, populate supplier_context with the supplier canonical name.
• In Supplier JSON, include PEEK 450G as a product offered.
• Use the product page and datasheet URL as source evidence.
Supplier relationship-ready product entry:
{
"product_name": "PEEK 450G",
"grade": "450G",
"category": "Polymer Resin",
"cross_graph_material_id": null,
"source_url": "https://example.com/products/peek-450g"
}
Material supplier_context:
{
"supplier_canonical_name": "example-polymers-inc",
"supplier_product_id": null,
"supplier_grade_name": "PEEK 450G",
"datasheet_url": "https://example.com/datasheets/peek-450g.pdf"
}

### 22.7 Multi-Material Producer -> Multiple Products
Scenario: A supplier catalog lists copper powder, nickel powder, stainless steel powder, and titanium
powder. Each is a separate product. If the source also provides separate datasheets, each datasheet may
support separate material records.
Catalog Item
Copper Powder
Nickel Powder
Stainless Steel Powder
Titanium Powder

Product Entry
Copper Powder
Nickel Powder
Stainless Steel Powder
Titanium Powder

Material Link Candidate
Copper
Nickel
Stainless Steel
Titanium

### 22.8 Parent Company vs Subsidiary
Scenario: A website footer shows the brand name Delta Alloys, while the legal page says Delta Alloys is a
division of Global Metals Group. The product page does not clearly state whether the product is sold by the
division or parent company.

Observed Evidence
Brand name appears on product pages.
Parent company appears in legal footer.
Ownership unclear.
Both entities have separate official websites.

Action
Use brand/company name only if it is the operating supplier named
by the source.
Do not merge automatically.
Escalate to Raghu/Sirisha before deciding whether separate
supplier objects are needed.
Likely separate records, but still confirm if product ownership
matters.

### 22.9 Missing Information
Scenario: A product page lists zirconia ceramic rods but does not state headquarters, lead time,
certifications, or manufacturing site.
Field
product_name
material
headquarters_location
typical_lead_time_days
certifications
manufacturing_sites

Action
Extract Zirconia Ceramic Rods.
Infer Zirconia Ceramic from product name if supported.
Search official site and LinkedIn if available; otherwise null.
null. Do not estimate.
[] unless explicitly stated elsewhere.
[] or null unless a site is explicitly named.

### 22.10 Duplicate Company Detection
Scenario: The batch contains records for ATI Inc., ATI Metals, and Allegheny Technologies. The contractor
suspects they may be related.
Exact same canonical name?
NO
|
v
Similar names or historical/acquisition relationship suspected?
YES
|
v
DO NOT MERGE
|
v
ESCALATE TO RAGHU / SIRISHA WITH URLS AND EVIDENCE

Escalation note:
Observed entities: ATI Inc.; ATI Metals; Allegheny Technologies
Issue: Possible parent/subsidiary or historical name relationship.
Action requested: Confirm whether to merge, link as aliases, or keep separate supplier records.
Submitted evidence: [official website URL], [supplier listing URL], [company history URL].

## 23. Final Submission Checklist
Use this checklist before every delivery batch. Files that fail these checks should not be submitted.
☐ All assigned URLs processed or marked unavailable.
☐ One JSON file created per required supplier/material entity.
☐ File names follow canonical naming convention.
☐ Each JSON file parses successfully.
☐ Required fields are present.
☐ No schema fields were modified.

☐ Source URLs included for every object.
☐ Products split correctly.
☐ Certifications and standards are explicitly supported.
☐ Duplicate check completed.
☐ Escalation notes included where needed.
☐ No confidential or unauthorized information used.
☐ AI assistance, if used, was verified against original sources.
☐ Batch folder organized and ready for QA.

## Appendix A - JSON Templates
A.1 Supplier JSON Skeleton
{
"supplier_id": null,
"duns_number": null,
"company_name": "...",
"canonical_name": "...",
"headquarters_location": null,
"website": null,
"company_description": null,
"industry_sector": null,
"supply_chain_tier": null,
"typical_lead_time_days": null,
"manufacturing_sites": [],
"certifications": [],
"certifications_raw": null,
"regulation_references": [],
"products_offered": [],
"is_verified": false,
"sources": []
}

A.2 Material JSON Skeleton
{
"material_id": null,
"material_name": "...",
"canonical_name": "...",
"cas_number": null,
"uns_number": null,
"chemical_formula": null,
"material_type": null,
"material_subtype": null,
"grade": null,
"trade_names": [],
"supplier_context": null,
"properties": [],
"standards_referenced": [],
"compliance_references": [],
"applications_mentioned": [],
"processing_notes": null,
"hazard_flags": [],
"availability_notes": null,
"images": [],
"sources": []
}

## Appendix B - Contractor Quick Reference
Question
What do I submit?
What if data is missing?
Can I use Gemini or Perplexity?
Can I infer material/product/industry from clear source text?
Can I infer certifications?
Who do I ask about duplicates?
Should product forms be separate?
Can I modify schema fields?

Answer
JSON files.
Search allowed sources; otherwise null or [].
Yes, for assistance only. Verify facts against sources.
Yes, within allowed inference rules.
No. Certifications must be explicit.
Raghu or Sirisha.
Yes, one entry per distinct product.
No. Escalate schema gaps.

Can I use confidential/login-only info?
What source URL should I use?

Only with explicit authorization; otherwise escalate.
The page or PDF that directly supports the extracted fact.

## Appendix C - Glossary
Term
Canonical Name
Supplier
Producer
Distributor
Material
Product
Manufacturing Site
Certification
Standard
Source Traceability
Escalation
Hallucination

Definition
A normalized lowercase identifier used for matching and
duplicate detection.
Any company that supplies, produces, manufactures,
processes, distributes, or sells materials/products.
A supplier that creates or extracts material at source.
A supplier that sells products made by others.
A substance, alloy, polymer, ceramic, composite, mineral, or
material family.
A commercially listed offering such as sheet, billet, plate,
powder, resin, compound, or part.
A facility, mine, quarry, plant, mill, or processing site linked to a
supplier.
A formal quality, regulatory, compliance, or management
system credential.
A named technical standard such as ASTM, ISO, SAE, AMS,
UL, or NASA reference.
The ability to trace every extracted fact back to a URL, PDF,
database, or publication.
A request for project lead guidance when a contractor cannot
safely decide.
Any fact entered without source evidence.

## Appendix D - Detailed Source Playbooks
This appendix gives contractors page-by-page guidance for common source types. Use these playbooks
when a source is unfamiliar or when the assigned URL contains multiple entity types.

D.1 Official Company Website Playbook
Step

Action
Open homepage and record root URL.

Review About / Company / Who We Are.

Review Products / Materials / Capabilities.

Review Quality / Certifications.

Review Locations / Facilities / Contact.

Review Datasheets / Downloads.
Check duplicate names.

Evidence to Capture
Company website URL and visible company
name.
Legal or operating name, headquarters,
ownership hints, industry focus.
Distinct products, materials, grades, product
forms, applications.
Only named certifications and standards
with direct URL evidence.
Headquarters and manufacturing sites;
distinguish sales offices from production
sites.
Datasheet URLs and material properties.
Parent company, subsidiary, former name,
division, or brand ambiguity.

IMPORTANT - MARKETING LANGUAGE
A company website may contain marketing claims. Extract supported facts, not promotional tone. For example, global
leader can be ignored unless the schema has a source-faithful description field.

D.2 Supplier Directory Playbook
Directory Field
Company name

Extraction Rule
Copy exactly; verify against company
website if possible.
Extract only as products/services if clearly
listed.
Extract if named; verify if high importance.
Use as headquarters only if directory states
headquarters.
Use to confirm official source.

Capabilities
Certifications
Location
Website link
Categories

Use for industry/material inference with
caution.

Risk
Directory names may abbreviate legal
entities.
Capability categories may be broad and
non-specific.
Directory may be outdated.
May be sales office or directory location.
Do not treat directory as final if official site
contradicts it.
Directories may over-classify suppliers.

D.3 Product Page Playbook
Item to Check
Page title
Product table
Datasheet button
Applications
Standards
Related products

What to Extract
Exact product name and grade if stated.
Each distinct product or SKU family.
datasheet_url and source evidence.
Applications and industries mentioned.
ASTM/ISO/SAE/AMS/UL standards.
Create separate entries only if in scope.

What Not to Do
Do not rewrite trade names.
Do not merge rows with different forms.
Do not use broken links without note.
Do not over-generalize beyond listed use.
Do not infer standards from material family.
Do not expand endlessly without batch
guidance.

Extract
Material studied, high-level application,
source DOI.
Composition, processing, test conditions,
sample prep.
Properties with values, units, uncertainty,
conditions.
Applications and limitations if explicitly

Do Not Extract
Do not extract properties unless values are
stated.
Do not treat lab supplier as commercial
producer unless stated.
Do not average ranges or remove
conditions.
Do not turn hypotheses into facts.

D.4 Research Paper Playbook
Paper Section
Abstract
Materials and Methods
Results tables
Discussion

stated.
Standards and technical sources when
cited.

References

Do not cite inaccessible references as if
directly read.

D.5 Government Database Playbook
Database Type
Mine / quarry directory

Primary Entity
Producer/operator + site

Certification registry
Material safety or regulatory database

Certified company/product
Material/compliance

Trade or customs database
Public company filing

Commodity/product
Company/supplier

Extraction Guidance
Operator is supplier; site is
manufacturing_sites; commodity is
product/material.
Attach certification only to named entity.
Extract compliance references and hazards
if schema supports.
Use cautiously; may not identify producers.
Useful for legal name, subsidiaries,
business segments, and facilities.

## Appendix E - Field-Level Evidence Standards
Not all fields require the same level of evidence. Company identity and product listings may be supported by
a company page. Certifications, material properties, and manufacturing sites require stronger evidence
because errors in those fields can create downstream trust issues.
Field Type
Company name

Material property

Minimum Evidence
Visible source page names the
company.
Search result or directory links to
official site.
Contact/about page or LinkedIn.
Product page or catalog lists
product.
Explicit grade in
product/datasheet.
Value and unit in source.

Certification

Named certification in source.

Manufacturing site

Facility/site explicitly named.

Application

Source states use or industry.

Website
Headquarters
Product name
Material grade

Preferred Evidence
Official company website or
government/company registry.
Official root domain verified by
company page.
Official company contact page.
Official product page or datasheet.
Datasheet or product
specification.
Datasheet, material database, or
peer-reviewed paper.
Certificate PDF, official registry, or
company certification page.
Company facilities page or
government database.
Product page, application note, or
paper.

Escalate If
Multiple similar names appear.
Multiple domains or acquired
brands conflict.
Only sales offices are listed.
Product appears only in generic
directory category.
Grade may be part of trade name
rather than material grade.
Units/conditions are unclear.
Only logo or vague quality claim
appears.
Address may be office, distributor,
or warehouse only.
Application is implied only by
customer logo.

E.1 Evidence Notes
• A source URL alone is not enough if it does not visibly support the field. The URL must contain the relevant
statement, table, product listing, or data.
• If the relevant evidence is inside a PDF, record the PDF URL and, where practical, the page number or section
title in raw or notes.
• When extracting from tables, confirm that the field and value belong to the same row or column.
• When a source uses a brand name and legal name together, preserve the source wording and escalate if
identity affects duplicate handling.

## Appendix F - QA Scoring Rubric
QA reviewers may use the rubric below to score submitted batches. The score is not a replacement for
acceptance criteria; any critical defect such as hallucinated certifications or confidential data use may cause
immediate rejection regardless of score.
Category
Schema Compliance

Weight
20%

Source Traceability

20%

Entity Accuracy

15%

Field Accuracy

15%

Product Handling

10%

Certification/Standard Handling

10%

Escalation Behavior

5%

Formatting and File Organization

5%

Full Credit
All required fields present; JSON
valid; no schema modifications.
Every object and high-risk field
supported by source URLs.
Correct supplier/material/product
identity; duplicates checked.
Values copied or inferred only
under SOP rules.
Distinct products split correctly
and linked to sources.
Only explicit
certifications/standards extracted.
Ambiguities documented and
escalated.
Files named and organized
consistently.

Common Deduction
Invalid JSON, missing fields,
renamed keys.
Missing URLs, AI links as sources,
weak evidence.
Duplicate suppliers, wrong
parent/subsidiary, alias confusion.
Estimated lead times,
unsupported headquarters, altered
property values.
Collapsed products, missing
products, invented products.
Inferred certification or missing
standard source.
Silent decisions on unclear
duplicate or confidential source.
Messy batch folder, unclear
filenames, missing notes.

IMPORTANT - CRITICAL DEFECTS
A batch with any hallucinated certification, invented manufacturing site, unauthorized confidential data, or schema
modification should be rejected even if other fields are strong.

## Appendix G - Contractor Prompt Recipes for Gemini and Perplexity
The following prompts are approved for AI assistance. Contractors must still verify all extracted facts against
the original sources before entering data into JSON.

G.1 PDF Summarization Prompt
You are helping me locate information inside a public source document for data extraction.
Do not invent any facts. Identify the pages or sections that mention:
1. company names,
2. materials or products,
3. certifications or standards,
4. manufacturing sites,
5. material properties with units.
Return a concise list of where the information appears. Do not create JSON.

G.2 Duplicate Discovery Prompt
Check whether the following company names may refer to the same legal entity, brand, division,
subsidiary, or historical name:
[PASTE NAMES]
Only return likely relationships and the public sources that support them.
Do not conclude they are the same unless the source evidence is strong.

G.3 Source Discovery Prompt
Find official or authoritative public sources for the following supplier/material:
[ENTITY NAME]
Prioritize company website, government database, NASA/USGS, certification registry, journal paper, or

manufacturer catalog.
Do not use AI-generated facts as final evidence. Return URLs only with short descriptions.

G.4 Long Product Page Triage Prompt
From this public product page text, identify distinct product names exactly as written.
Do not merge product forms. Do not infer certifications. Return only a list of distinct products and
any visible datasheet URLs.
Text:
[PASTE PUBLIC PAGE TEXT]

G.5 Source Verification Prompt
I have extracted the following fields from a public source.
Check only whether the source text supports each field. Do not add new facts.
Return: Supported / Not Supported / Ambiguous for each field.
Source text:
[PASTE SOURCE TEXT]
Extracted fields:
[PASTE FIELD LIST]

G.6 Prohibited AI Prompt Patterns
Do Not Ask AI To
Tell me all certifications this company has.
Create a complete supplier JSON from
memory.
Estimate lead time for this supplier.
Merge these companies if they look similar.

Why It Is Prohibited
AI may hallucinate certifications or rely on
outdated memory.
Bypasses source verification and schema
discipline.
Estimated values are not allowed.
Duplicate merging requires human approval.

Find hidden data behind this login page.

May violate access boundaries.

Allowed Alternative
Ask AI to find official certification pages or
registry URLs, then verify manually.
Ask AI to organize verified notes into draft
JSON, then check every field.
Set lead time to null unless source states it.
Ask AI for evidence links, then escalate to
Raghu/Sirisha.
Escalate login-only or confidential sources
before proceeding.

## Appendix H - Batch Folder and File Naming Standard
A clean folder structure reduces QA time. Unless project-specific instructions override this section, use the
following organization for submitted batches.
batch_YYYYMMDD_source-or-project-name/
suppliers/
supplier-canonical-name.json
materials/
material-canonical-name.json
evidence/
source_index.csv
escalation_notes.txt
qa/
contractor_checklist.txt
validation_log.txt

File Type
Supplier JSON
Material JSON
Source index
Escalation notes
Validation log

Naming Rule
canonical supplier name + .json
canonical material name + .json
source_index.csv
escalation_notes.txt
validation_log.txt

Example
ati-inc.json
aluminum-6061-t6.json
source_index.csv
escalation_notes.txt
validation_log.txt

H.1 Source Index Template
record_filename,entity_type,entity_name,source_url,source_tier,notes
ati-inc.json,supplier,ATI Inc.,https://www.example.com,tier1,official website
aluminum-6061-t6.json,material,Aluminum 6061-T6,https://www.example.com/6061.pdf,tier2,datasheet

## Appendix I - Data Completeness and Confidence Notes
Some projects may request completeness flags or confidence notes. These are not substitutes for source
evidence. They help downstream reviewers understand whether missing fields are absent from the source
or simply not researched.
Confidence Level
High

Low

Meaning
Directly supported by Tier 1 or official
source.
Supported by credible Tier 2 source or
multiple consistent public sources.
Supported only by Tier 3 context source.

Null

No reliable source found.

Medium

Allowed Use
Company names, product names,
certifications, sites, properties.
Supplier discovery, broad categories,
distributor products.
Background notes only; avoid high-risk
fields.
Preferred over guessing.

I.1 Completeness Notes Examples
Field
certifications
lead_time
manufacturing_sites
duns_number
properties

Completeness Note
No certifications stated on official website or product page;
certifications = [].
Lead time not stated in public sources; typical_lead_time_days
= null.
Only headquarters/contact address found; no manufacturing
site extracted.
Not available from assigned public source; null.
Datasheet did not include thermal properties; do not infer from
similar materials.

## Appendix J - Final Contractor Self-Audit Form
Contractors should copy this form into the batch notes before delivery and complete it honestly. The form is
intended to make QA faster and to surface ambiguity early.
Batch Name:
Contractor Name:
Date:
Number of URLs Assigned:
Number of URLs Processed:
Number of Supplier JSON Files:
Number of Material JSON Files:
Number of Escalations:
Self-Audit Questions:
[ ] I validated every JSON file.
[ ] I included source URLs for every object.
[ ] I checked for duplicate suppliers and materials.
[ ] I did not infer certifications.
[ ] I did not estimate missing values.
[ ] I used null or [] for unavailable information.
[ ] I verified any AI-assisted facts against public sources.
[ ] I avoided confidential or unauthorized information.
[ ] I included escalation notes for unresolved ambiguity.
Known Issues / Notes:
