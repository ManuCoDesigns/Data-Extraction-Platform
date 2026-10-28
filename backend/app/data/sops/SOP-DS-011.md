# SOP-DS-011 | Computational Materials & Crystal Structure Database
Extraction
## 1. Purpose & Scope
This SOP governs extraction from computational materials databases, crystal-structure databases, high-throughput
materials discovery platforms, and materials data repositories. These sources are valuable to Xtrium because they
provide computed properties, crystal structures, thermodynamic stability, electronic properties, DFT provenance,
structure files, experimental structure references, and machine-readable materials identifiers.
This SOP applies to Materials Project, AFLOW, NOMAD, ICSD, OQMD, and similar computational or crystallographic
platforms. It requires strict provenance rules so computed, predicted, modeled, and experimental values are never
treated as interchangeable.

### 1.1 Sources Covered
Source
Materials Project

Type
Computed materials properties
database

AFLOW

High-throughput computational
materials platform

NOMAD

Materials science data
repository and archive

ICSD

Inorganic crystal structure
database

OQMD

DFT thermodynamic and
structural database

Typical Data Available
mp-id, formula, structure,
symmetry, formation energy,
band gap, density, elasticity,
stability, battery/electrode data,
API-derived properties.
AUID/AURL, composition,
prototype, symmetry,
electronic/thermodynamic/mech
anical properties, calculation
metadata.
Uploaded
computational/experimental
files, structured metadata,
methods, code information, DOI,
normalized data.
Experimental crystal structures,
unit cell, space group, atomic
positions, formula, mineral
group, references.
Formation energies, phase
stability, structures,
compositions, database IDs.

Special Handling
Computed values must be
labeled computed/DFT unless
explicitly experimental. Preserve
mp-id and calculation metadata.
Preserve AUID/AURL and
AFLOW method/provenance
context.

Record upload/archive
metadata. Distinguish repository
metadata from computed result.

Usually experimental
crystallographic data. Respect
commercial access and capture
ICSD collection code/reference.
Label values computed/DFT;
preserve database ID and
stability context.

### 1.2 Objectives






Extract material identity, formula, database IDs, structure metadata, computed properties, crystallographic properties,
stability metrics, electronic properties, calculation method, source references, and structure-file links.
Clearly distinguish computed/DFT, predicted/ML, experimental crystallographic, literature-derived, and repositorysubmitted values.
Prevent computed values from being merged into measured engineering-property records without method labels and
provenance.
Represent polymorphs and phases separately when a single formula has multiple structures or database IDs.
Capture enough calculation/source context for QA and downstream confidence scoring.

## 2. Non-Negotiable Operating Rules
Rule 1

COMPUTED IS NOT MEASURED

Computed, DFT, predicted, or modeled
values must never be stored as
measured experimental values.

Rule 2

ONE STRUCTURE PER STRUCTURE
ID

Do not merge different crystal
structures solely because they share
the same formula. Polymorphs,
phases, prototypes, and space groups
must remain distinct.

Rule 3

DATABASE ID REQUIRED

Every extracted record must preserve
the source database ID: mp-id,
AUID/AURL, NOMAD upload/archive
identifier, ICSD collection code, OQMD
ID, or equivalent.

Rule 4

METHOD PROVENANCE REQUIRED

Capture method, functional, code,
calculation type, dataset/release,
source reference, or repository
metadata where visible.

Rule 5

STABILITY CONTEXT REQUIRED

Formation energy, energy above hull,
decomposition energy, or stability
labels must retain units, reference
state, and database context.

Rule 6

NO COMMERCIAL CLAIMS

Do not infer that a computed or
crystallographic material is
commercially available,
manufacturable, safe, certified, or
supplied by a company.

Rule 7

ACCESS LIMITS APPLY

Do not bypass API keys, licensing
limits, bulk download restrictions, or
commercial database access
restrictions.

## 3. Data Extraction Model
Computational and crystal-structure sources should produce material/structure records with property objects linked to a
computation or reference context. Contractors must not flatten everything into a generic materials datasheet. The
structure, source database ID, and calculation/reference provenance are part of the data.
Source Concept
Database material ID

Xtrium Destination
external_id / source_record_id

Formula / reduced formula

chemical_formula

Crystal structure

structure object / additional_properties

Structure file

files array or source attachments

Formation energy / energy above hull

properties array

Band gap / electronic properties

properties array

Density / volume

properties array

Reference publication
Calculation method

sources array / references array
computation_context / raw

Transformation Rule
Preserve exactly. Examples: mp-149, AUID,
ICSD code, OQMD entry ID.
Copy formula exactly as shown; capture
reduced and full formula separately if
provided.
Capture space group, crystal system, lattice
parameters, cell volume, atomic sites if
schema supports.
Capture CIF/POSCAR/JSON URL if visible
and authorized. Do not download restricted
bulk files unless assigned.
Store as computed thermodynamic property
with unit, reference, method, and source.
Store as computed electronic property.
Preserve method and whether direct/indirect
if stated.
Label computed or crystallographic
depending on source. Do not mix with
handbook measured density.
Capture DOI, title, authors if visible.
Capture DFT code, functional,
pseudopotential, workflow, repository
metadata if visible.

## 4. Provenance Classification
data_source_type
computed_dft

Use When
Property is calculated using density
functional theory or high-throughput firstprinciples workflow.
Property is calculated using another
computational method, simulation,
molecular dynamics, GW, etc.
Property is predicted by machine learning or
model screening.
Structure is experimentally determined and
curated, e.g., ICSD entry.
Data is uploaded by a contributor/research
group into a repository.
Database record derives from a publication.

Xtrium Handling Rule
Do not combine with measured property
without method label.

Metadata Field
source_record_id

Required When Available
Always

chemical_formula

Always if shown

crystal_system

When visible

space_group_symbol

When visible

space_group_number
lattice_parameters

When visible
When visible

cell_volume

When visible

atomic_sites
structure_file_url

Only when schema supports or batch
assigns
When visible and authorized

reference

When visible

Notes
Database-specific ID is mandatory for
record traceability.
Preserve source formula; do not rewrite
unless canonical field requires separate
normalized value.
Examples: cubic, tetragonal, orthorhombic,
hexagonal.
Preserve Hermann-Mauguin symbol
exactly.
Numeric space group, if provided.
Capture a, b, c, alpha, beta, gamma with
units.
Capture unit and whether
conventional/primitive if stated.
Can be large; otherwise capture structure
file URL instead.
CIF, POSCAR, JSON, or repository
download link.
Publication DOI/title/authors or database
source reference.

computed_other

predicted_ml
experimental_crystal_structure
repository_submitted
literature_derived

Preserve method and code if available.

Mark as predicted; do not treat as validated.
Capture reference and crystallographic
metadata.
Capture uploader, DOI, dataset metadata,
and method.
Capture reference metadata and database
interpretation separately.

## 5. Required Structure Metadata

## 6. Source-Specific Guidance
### 6.1 Materials Project






Preserve mp-id or other Materials Project identifier for every record.
Label precomputed properties as computed_dft or computed according to visible documentation/context.
Capture formula, structure, symmetry, energy/stability metrics, band gap, density, and available calculation metadata only
when visible or API-authorized.
Do not treat Materials Project data as supplier data or measured engineering datasheet data.
If using API output, include API endpoint/version or dataset/release metadata when available.

### 6.2 AFLOW





Capture AFLOW identifiers such as AUID/AURL when visible.
Preserve composition, prototype, symmetry, computed properties, and calculation metadata.
Record the property namespace/label as shown to avoid misinterpreting AFLOW-specific fields.
Do not merge AFLOW records with other database records unless a controlled crosswalk is assigned.

### 6.3 NOMAD





Treat NOMAD as a repository/archive platform. Capture upload/dataset metadata, DOI, authors, methods, and file
provenance where visible.
Distinguish parsed/normalized repository metadata from the original uploaded calculation or experimental result.
Record whether the result is computational, experimental, workflow-derived, or repository-submitted.
Do not assume consistency across NOMAD records; record method and code-specific details.

### 6.4 ICSD





Treat ICSD primarily as experimental inorganic crystal structure data unless a specific record indicates otherwise.
Capture ICSD collection code, formula, unit cell, space group, atomic parameters if assigned, mineral group, and
publication reference when visible.
Respect commercial access restrictions. Do not bulk extract beyond authorization.
If a structure also appears in Materials Project/OQMD, do not merge automatically; create cross-reference only when IDs
or references support it.

### 6.5 OQMD





Capture OQMD entry ID, formula, structure metadata, formation energy, thermodynamic stability, and source reference
when visible.
Label values computed_dft unless the record explicitly distinguishes another source type.
Preserve stability context and units; do not infer phase stability outside the database context.
Do not combine OQMD formation energies with Materials Project formation energies without method/source separation.

## 7. Step-by-Step Workflow
19. Open the assigned computational or crystal-structure record and confirm the source platform.
20. Record source database name, source record ID, URL, access date, and source tier.
21. Extract identity fields: formula, reduced formula, material name if given, database ID, aliases, and structure label.
22. Extract structure metadata: crystal system, space group, lattice parameters, cell volume, atomic sites or structure-file URL
if assigned.

23. Extract properties only with method/provenance context: formation energy, energy above hull, band gap, density, elastic
constants, magnetic properties, etc.

24. Assign data_source_type for every property and source value.
25. Capture computation context or reference context. Include DFT method/workflow/code if visible.
26. Check for polymorphs or duplicate formula records. Do not merge without matching structure IDs or assigned rules.
27. Validate JSON and submit with review log for ambiguous method, missing units, access limitations, and
duplicate/crosswalk questions.

## 8. Edge Cases & Required Handling
Situation
Same formula has multiple structures
Computed band gap differs between databases
Experimental and computed density both exist
No method visible
API requires key/login
Structure file available
Repository record has incomplete metadata
Material appears commercially useful

Required Action
Create separate structure/material-variant records; do not merge
solely by formula.
Preserve both values with their source and method. Do not choose
one as truth unless assigned.
Store as separate properties with data_source_type and source
context.
Record method as null and flag for review; do not assume DFT
settings.
Use only Xtrium-authorized access. Escalate if access is
unavailable.
Capture URL and file type. Download only if assigned and allowed.
Extract available metadata and flag missing method/source fields.
Do not create supplier/product availability unless a supplier source
supports it.

## 9. QA Checklist
QA Item
Database ID
Formula and structure
Computed/experimental distinction
Method provenance
Units and references
No commercial inference
Access compliance
JSON validity

Pass Criteria
Every record has source_record_id and source URL.
Formula captured; structure metadata captured where visible;
polymorphs not collapsed.
Every property has correct data_source_type.
DFT/workflow/code/reference metadata captured where available.
Units, reference states, and source labels preserved.
No supplier, availability, certification, or manufacturability claim
added from computed data alone.
No unauthorized extraction from restricted/commercial platform
sections.
Output validates and raw/additional_properties preserve unmapped
source data.

## 10. Complete Worked Example - Computed Materials Record
{
"material_name": "Si",
"canonical_name": "si_computed_structure_<source_id>",
"chemical_formula": "Si",
"external_ids": [{"type": "materials_project_id", "value": "mp-<id>"}],
"structure": {
"crystal_system": "cubic",
"space_group_symbol": "<symbol>",
"space_group_number": "<number>",
"lattice_parameters": {"a": "<value>", "b": "<value>", "c": "<value>", "unit": "angstrom"},
"structure_file_url": "<CIF/POSCAR/JSON URL if assigned>"
},
"properties": [
{
"name": "Band Gap",
"canonical_name": "band_gap",
"value": "<value>",
"numeric_value": "<numeric if parseable>",
"unit": "eV",
"property_category": "electronic",
"data_source_type": "computed_dft",
"condition": "<method/workflow if visible>",
"raw": {"source_label": "band_gap", "method": "<visible method metadata>"},
"source": {"source_name": "<database>", "source_url": "<record URL>", "tier": "tier1"}
}
],
"sources": [{"source_name": "<database>", "source_url": "<record URL>", "tier": "tier1"}],
"qa_notes": "Computed values must not be treated as measured engineering datasheet values."
}

## 11. Submission Package
Deliverable
Material/structure JSON
Computation provenance log
Crosswalk log

Source list
QA checklist

Required Contents
One JSON per material structure or
assigned batch.
Method, code, functional/workflow, missing
metadata, uncertainty notes, source ID.
Potential matches across
MP/AFLOW/OQMD/ICSD/NOMAD, with no
auto-merge unless approved.
URLs, IDs, dataset/release details, access
dates, source tier.
Completed acceptance checklist for the
batch.

Filename Guidance
{source_slug}_{record_id}.json
{source_slug}
_computation_provenance.xlsx/json
{source_slug}_crosswalk_review.xlsx

{source_slug}_sources.csv/json
{source_slug}_qa_checklist.pdf/xlsx
