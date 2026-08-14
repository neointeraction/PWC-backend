# Career Library — normalization spec

**Status:** decisions confirmed (§7) — ready to build. **Goal:** let a counsellor/admin,
when adding a career (job role), **select existing** entrance exams / courses / colleges
from dropdowns **or add new** ones inline — instead of typing comma-separated free text.
That requires turning today's list-like columns into proper lookup + join tables.

## 1. What's fixed vs. what changes

The **taxonomy is fixed** — the client selects from existing values, doesn't invent new
ones:

- `cluster`, `industry`, `domain` — a fixed 3-level hierarchy. Dropdowns already have a
  source (`GET /career-library/filters` returns distinct values). **No new tables needed
  now** (a `Taxonomy` table is a possible future tidy-up, out of scope here).

The **job role is the new record**, and adding one may introduce new exams/courses/colleges
(or reuse existing ones). Those are what we normalize.

## 2. Current fields — classification

| Field on `CareerLibraryEntry` | Today | Proposed |
|---|---|---|
| `cluster`, `industry`, `domain` | String (fixed taxonomy) | **unchanged** (dropdown from existing distinct values) |
| `jobRole` | String | **unchanged** (the new record's label) |
| `aiResilienceGrade`, `aiResilienceComment`, `oneLineDescription` | scalar | **unchanged** |
| salary* / qualification* / `entranceExamsUGDescription` | scalar text | **unchanged** (free text) |
| `entranceExams` (UG), `entranceExamsPG` (PG) | `String[]` | **normalize** → `EntranceExam` lookup + join, with a UG/PG level |
| `topCourses` | `String[]` | **normalize** → `Course` lookup + join |
| *(colleges — none on the entry today; derived by `industry` value-match)* | *derived* | **new** → `Institution` lookup + join (curated per career) |
| `topCompanies` | `String[]` | **decision** — normalize to a `Company` lookup, or keep as free-text array |
| `certificationsStudent`, `certificationsUG` | `String[]` | **decision** — normalize to a `Certification` lookup (with stage), or keep free-text |

So the three the client explicitly named — **exams, courses, colleges** — are the core of
this change; companies and certifications are the fuzzy ones to decide on (§7).

## 3. What already exists (and why we can't just link to it as-is)

Imported source directories (matched by string value today, not FK-linked):

- `UgEntranceExam`, `PgEntranceExam` — exam directories, **split UG/PG**.
- `UgInstitution` (industry-scoped, **duplicated per industry**), `UgInstitutionUniversity`
  (a deduped general directory), `PgInstitution`.
- `UgCourse` — course directory (keyed by `careerCluster`).

These are messy source dumps (industry duplication, UG/PG split, many source-specific
columns). A dropdown wants a **clean, deduped, canonical list** — so the recommendation is
to introduce canonical lookup tables and seed them *from* these directories, keeping the
raw directories for the existing "related institutions/courses/exams" detail view.

## 4. Proposed schema (recommended shape)

### Canonical lookup tables (deduped, dropdown-friendly)

```prisma
enum QualificationLevel { UG PG }

model EntranceExam {
  id             String  @id @default(cuid())
  name           String  // e.g. "JEE Main"
  level          QualificationLevel
  fullForm       String?
  conductingBody String?
  officialWebsite String?
  // ...seeded from Ug/PgEntranceExam
  careerLinks    CareerEntranceExam[]
  @@unique([name, level])
}

model Institution {
  id       String  @id @default(cuid())
  name     String  @unique   // deduped college/university
  city     String?
  state    String?
  type     String?
  website  String?
  careerLinks CareerInstitution[]
}

model Course {
  id            String @id @default(cuid())
  name          String
  level         QualificationLevel
  fullForm      String?
  durationYears String?
  @@unique([name, level])
  careerLinks   CareerCourse[]
}
```

### Join tables (many-to-many: a career ↔ each lookup)

```prisma
model CareerEntranceExam {
  careerEntryId  String
  entranceExamId String
  careerEntry    CareerLibraryEntry @relation(fields: [careerEntryId], references: [id], onDelete: Cascade)
  entranceExam   EntranceExam       @relation(fields: [entranceExamId], references: [id], onDelete: Cascade)
  @@id([careerEntryId, entranceExamId])
}

model CareerInstitution {
  careerEntryId String
  institutionId String
  // ...relations, @@id([careerEntryId, institutionId])
}

model CareerCourse {
  careerEntryId String
  courseId      String
  kind          CourseLink? // optional: PRIMARY | ALTERNATE (source distinguishes these)
  // ...relations, @@id([careerEntryId, courseId])
}
```

`CareerLibraryEntry` gains the reverse relations (`entranceExams CareerEntranceExam[]`,
`institutions CareerInstitution[]`, `courses CareerCourse[]`) and, once backfilled, the old
`String[]` columns are dropped (see §6).

## 5. "Select existing or add new" — the API pattern

One entry create/update endpoint, no separate "create a college" call. Each normalized
field accepts a list where every item is **either an existing id or a new record**:

```jsonc
POST /api/v1/career-library
{
  "jobRole": "Robotics Engineer", "cluster": "...", "industry": "...", "domain": "...",
  "entranceExams": [ { "id": "exm_123" }, { "name": "New Exam", "level": "UG" } ],
  "institutions":  [ { "id": "ins_45" }, { "name": "New College", "city": "Pune" } ],
  "courses":       [ { "id": "crs_9" }, { "name": "B.Tech Robotics", "level": "UG" } ]
}
```

The service **find-or-creates** each `{name,...}` item (dedupe by name/level, case-
insensitive), then links via the join table. Plus new **typeahead endpoints** to feed the
dropdowns:

- `GET /api/v1/career-library/entrance-exams?search=&level=`
- `GET /api/v1/career-library/institutions?search=`
- `GET /api/v1/career-library/courses?search=&level=`

(Reads = any authenticated user; the create/link path stays admin.)

## 6. Migration & backfill plan

1. Add the new lookup + join tables (additive migration — safe).
2. **Seed canonical lookups** from the existing directories, deduped by name (+level):
   `EntranceExam` ← `Ug/PgEntranceExam`; `Institution` ← `UgInstitutionUniversity` +
   `PgInstitution`; `Course` ← `UgCourse`.
3. **Backfill joins** from each entry's existing arrays: split `entranceExams[]` /
   `entranceExamsPG[]` / `topCourses[]`, match (case-insensitive) or create the canonical
   row, create the join.
4. Colleges have no existing per-entry array — **seed each entry's institutions from its
   current industry value-match** (D3): for each career, take `UgInstitution` rows where
   `industry = career.industry`, map to the canonical `Institution` (find-or-create by
   name), and link. Entries then start with a full, editable college list.
5. Keep the old `String[]` columns for one transitional release (dual-read), then drop them
   in a follow-up migration once the join data is verified.

## 7. Decisions (confirmed)

- **D1 — Canonical tables.** ✅ New clean canonical `EntranceExam` / `Institution` /
  `Course` tables (seeded from the `Ug*`/`Pg*` directories); joins + dropdowns point at
  these. Raw directories kept for the existing detail view.
- **D2 — Scope.** ✅ Normalize **exams + courses + colleges** now. `topCompanies` and
  `certificationsStudent`/`certificationsUG` **stay free-text arrays** for now.
- **D3 — Colleges backfill.** ✅ **Seed each career's institutions from its industry
  value-match** (then editable), per §6-4.
- **D4 — UG/PG.** ✅ One lookup table per type with a `level` (`QualificationLevel`) field.
- **D5 — Old columns.** ✅ Keep the `String[]` columns through one transitional release,
  drop in a follow-up migration once verified.
```
