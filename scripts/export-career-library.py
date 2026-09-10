#!/usr/bin/env python3
"""
One-off export: reads the "Career Library" workbook(s) and writes clean JSON per tab into
prisma/seed-data/career-library/, for prisma/seed.ts to load.

The reference tabs (UG/PG institutions, courses, entrance exams) are sourced from
"docs/Career Library_Updated_1808.xlsx" and unchanged since that workbook. The "CL" tab
(CareerLibraryEntry rows) is now sourced separately from "docs/Career Library_CL_2609.xlsx"
(2026-09-10), a CL-only sheet with a narrower 20-column layout than 1808's 24 — it merged
the separate plain/"DEFINED" Graduation and PG qualification columns into one combined
column each ("<degree list>, Focus Electives: <electives>", consistent across all rows),
dropped the UG entrance-exam description column, and dropped "Top Courses" entirely. Per
product decision on that re-import: each combined column is split on the "Focus Electives:"
marker (split_qualification()) — the degree-list half feeds the plain
qualificationGraduation/qualificationPG columns, the electives half feeds the paired
"Defined" columns (which prisma/seed-education-path.ts reads only as descriptive prose, not
mined for programme names — see its updated header comment). entranceExamsUGDescription is
exported as null and topCourses as [] for every row, since this sheet has no such columns.
If a future sheet restores those columns, add them back here.

Ignores the "Post-12_Entrance_Exams__India__" tab per instruction (out of scope).
Not part of the app's runtime — rerun manually if a source workbook changes.
"""
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "Career Library_Updated_1808.xlsx"
SRC_CL = ROOT / "docs" / "Career Library_CL_2609.xlsx"
OUT_DIR = ROOT / "prisma" / "seed-data" / "career-library"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def s(v):
    """Normalize a cell value to a trimmed string, or None."""
    if v is None:
        return None
    v = str(v).strip()
    return v if v else None


# Known source-data spelling/naming variants that would otherwise silently break the
# join between tables (verified against the actual workbook content — see
# docs/db-design.md "Cross-table mapping"). CL is treated as the authoritative
# vocabulary; the other tabs' values are normalized to match it.
INDUSTRY_ALIASES = {"Defense": "Defence"}  # UG Institutions_IND -> CL spelling
EXAM_ALIASES = {"CUET": "CUET UG"}  # CL's extracted list -> UG Entrance_IND's exam name

FOCUS_ELECTIVES_RE = re.compile(r",?\s*Focus Electives:\s*", re.I)


def split_qualification(value):
    """'BTech / BSc, Focus Electives: CS/IT.' -> ('BTech / BSc', 'CS/IT.').

    Every row's combined Grad/PG column follows "<degree list>, Focus Electives:
    <electives>" (verified across all 1317 rows of the 2609 CL sheet). The degree-list half
    becomes the plain qualification field; the electives half becomes the paired "Defined"
    field, which downstream (prisma/seed-education-path.ts) is read as descriptive prose,
    not mined for programme names.
    """
    v = s(value)
    if not v:
        return None, None
    parts = FOCUS_ELECTIVES_RE.split(v, maxsplit=1)
    if len(parts) != 2:
        return v, None
    qualification, electives = s(parts[0]), s(parts[1])
    return qualification, electives


def split_list(v, sep=","):
    if not v:
        return []
    return [p.strip() for p in str(v).split(sep) if p.strip()]


def parse_india_salary(text):
    """'10–25 LPA' -> (10.0, 25.0); non-numeric bounds (e.g. 'Limitless') -> None."""
    if not text:
        return None, None
    t = text.replace("₹", "").replace("LPA", "").strip()
    parts = re.split(r"[–‒\-]", t, maxsplit=1)
    if len(parts) != 2:
        return None, None

    def num(s_):
        s_ = s_.strip()
        return float(s_) if re.match(r"^\d+(\.\d+)?$", s_) else None

    return num(parts[0]), num(parts[1])


def parse_global_salary(text):
    """'$70k–$160k' -> (70000.0, 160000.0); '$0–Millions' -> (0.0, None)."""
    if not text:
        return None, None
    t = text.replace("$", "").strip()
    parts = re.split(r"[–‒\-]", t, maxsplit=1)
    if len(parts) != 2:
        return None, None

    def num(s_):
        s_ = s_.strip().rstrip("+")
        m = re.match(r"^(\d+(?:\.\d+)?)k$", s_, re.I)
        if m:
            return float(m.group(1)) * 1_000
        m = re.match(r"^(\d+(?:\.\d+)?)m$", s_, re.I)
        if m:
            return float(m.group(1)) * 1_000_000
        if re.match(r"^\d+(\.\d+)?$", s_):
            return float(s_)
        return None

    return num(parts[0]), num(parts[1])


AI_GRADE_MAP = {"low": "LOW", "medium": "MEDIUM", "high": "HIGH", "very high": "VERY_HIGH"}


def export_career_library(wb):
    # Column layout of the 2609 CL-only sheet (0-based, 20 columns). Narrower than the old
    # 1808 workbook's CL tab: no plain Graduation/PG qualification columns (only the
    # "DEFINED" combined ones), no UG entrance-exam description column, no Top Courses
    # column at all — see the module docstring for how those are exported here.
    ws = wb["CL"]
    out = []
    skipped = 0
    for r in ws.iter_rows(min_row=2, values_only=True):
        cluster, industry, domain, job_role = s(r[0]), s(r[1]), s(r[2]), s(r[3])
        ai_grade_raw = s(r[4])
        qual_10_12 = s(r[10])
        if not (cluster and industry and domain and job_role and ai_grade_raw and qual_10_12):
            skipped += 1
            continue

        india_min, india_max = parse_india_salary(r[8])
        global_min, global_max = parse_global_salary(r[9])

        grad_qualification, grad_electives = split_qualification(r[12])
        pg_qualification, pg_electives = split_qualification(r[14])

        out.append(
            {
                "cluster": cluster,
                "industry": industry,
                "domain": domain,
                "jobRole": job_role,
                "aiResilienceGrade": AI_GRADE_MAP.get(ai_grade_raw.lower(), "MEDIUM"),
                "aiResilienceComment": s(r[5]) or "",
                "oneLineDescription": s(r[6]) or "",
                "roleOverview": s(r[18]),  # Role Overview & Scope
                "keySkills": split_list(r[19]),  # Key Skill Requirements (comma-separated)
                "topCompanies": split_list(r[7]),
                "salaryIndiaRangeText": s(r[8]),
                "salaryIndiaMinLPA": india_min,
                "salaryIndiaMaxLPA": india_max,
                "salaryGlobalRangeText": s(r[9]),
                "salaryGlobalMinUSD": global_min,
                "salaryGlobalMaxUSD": global_max,
                "qualification10th12th": qual_10_12,
                "qualification10th12thExplanation": s(r[11]),  # 10+2 Explanation - Electives
                # Grad + Focus Subjects DEFINED (col 12) split on "Focus Electives:" —
                # degree list before, electives after (see split_qualification()).
                "qualificationGraduation": grad_qualification,
                "qualificationGraduationDefined": grad_electives,
                "entranceExamsUGDescription": None,  # dropped from this sheet
                "entranceExams": [EXAM_ALIASES.get(t, t) for t in split_list(r[13])],  # UG extracted
                # PG + Focus Subjects (col 14), same split.
                "qualificationPG": pg_qualification,
                "qualificationPGDefined": pg_electives,
                "entranceExamsPG": split_list(r[15]),
                "certificationsStudent": split_list(r[16], ";"),
                "certificationsUG": split_list(r[17], ";"),
                "topCourses": [],  # dropped from this sheet
            }
        )
    print(f"CL: {len(out)} rows exported, {skipped} skipped (missing required field)")
    return out


def export_ug_institutions(wb):
    # 1808 layout (14 cols). The 0508 columns "Programmes Offered After Class 12" and
    # "Key Programmes Offered" were removed, shifting the tail left; those two model
    # fields are now left null.
    ws = wb["UG Institutions_IND"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        industry, name = s(r[0]), s(r[2])
        if not (industry and name):
            continue
        industry = INDUSTRY_ALIASES.get(industry, industry)
        out.append(
            {
                "industry": industry,
                "shortName": s(r[1]),
                "name": name,
                "city": s(r[3]),
                "state": s(r[4]),
                "type": s(r[5]),
                "category": s(r[6]),
                "programmesOffered": s(r[7]),
                "programmesOfferedAfterClass12": None,  # column removed in 1808 workbook
                "keyProgrammesOffered": None,  # column removed in 1808 workbook
                "primaryEntranceExams": s(r[8]),
                "nirfRanking": s(r[9]),
                "otherRankings": s(r[10]),
                "approxAnnualFee": s(r[11]),
                "approxPlacementCtc": s(r[12]),
                "website": s(r[13]),
            }
        )
    print(f"UG Institutions_IND: {len(out)} rows exported")
    return out


def export_ug_inst_uty(wb):
    ws = wb["UG Inst+Uty_IND"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        name = s(r[1])
        if not name:
            continue
        out.append(
            {
                "shortName": s(r[0]),
                "name": name,
                "city": s(r[2]),
                "state": s(r[3]),
                "type": s(r[4]),
                "category": s(r[5]),
                "keyProgrammesOffered": s(r[6]),
                "primaryEntranceExams": s(r[7]),
                "nirfRanking": s(r[8]),
                "otherRankings": s(r[9]),
                "approxAnnualFee": s(r[10]),
                "approxPlacementCtc": s(r[11]),
                "website": s(r[12]),
            }
        )
    print(f"UG Inst+Uty_IND: {len(out)} rows exported")
    return out


def export_ug_entrance(wb):
    ws = wb["UG Entrance_IND"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        exam_name = s(r[0])
        if not exam_name:
            continue
        out.append(
            {
                "examName": exam_name,
                "fullForm": s(r[1]),
                "conductingBody": s(r[2]),
                "level": s(r[3]),
                "applicableFor": s(r[4]),
                "subjectRequirements12th": s(r[5]),
                "applicationWindow": s(r[6]),
                "examMonth": s(r[7]),
                "resultMonth": s(r[8]),
                "examMode": s(r[9]),
                "frequency": s(r[10]),
                "approxAttemptsAllowed": s(r[11]),
                "officialWebsite": s(r[12]),
            }
        )
    print(f"UG Entrance_IND: {len(out)} rows exported")
    return out


def export_ug_courses(wb):
    ws = wb["UG Courses_IND"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        course_name, cluster = s(r[0]), s(r[4])
        if not (course_name and cluster):
            continue
        out.append(
            {
                "courseName": course_name,
                "fullForm": s(r[1]),
                "level": s(r[2]),
                "durationYears": s(r[3]) if r[3] is None or isinstance(r[3], str) else str(r[3]),
                "careerCluster": cluster,
                "stream12thRequirements": s(r[5]),
                "minimumEligibility": s(r[6]),
                "entranceExamsPrimary": s(r[7]),
                "entranceExamsAlternate": s(r[8]),
                "topSpecialisations": s(r[9]),
                "topGovtColleges": s(r[10]),
                "topPrivateColleges": s(r[11]),
                "approxAnnualFeeRange": s(r[12]),
                "furtherStudyOptions": s(r[13]),
            }
        )
    print(f"UG Courses_IND: {len(out)} rows exported")
    return out


def export_pg_institutions(wb):
    ws = wb["PG Institutions_IND"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        institution = s(r[1])
        if not institution:
            continue
        out.append(
            {
                "industry": s(r[0]),
                "institution": institution,
                "state": s(r[2]),
                "city": s(r[3]),
                "programTypes": s(r[4]),
                "website": s(r[5]),
            }
        )
    print(f"PG Institutions_IND: {len(out)} rows exported")
    return out


def export_pg_entrance(wb):
    ws = wb["PG Entrance_IND"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        exam_name = s(r[0])
        if not exam_name:
            continue
        out.append({"examName": exam_name, "coursesForExam": s(r[1]), "officialWebsite": s(r[2])})
    print(f"PG Entrance_IND: {len(out)} rows exported")
    return out


def main():
    # Only the CL tab is re-exported here, from the 2609 CL-only sheet — the reference
    # tabs (UG/PG institutions, courses, entrance exams) are unchanged since the 1808
    # workbook, so their JSON files are left as-is rather than regenerated from SRC.
    wb_cl = openpyxl.load_workbook(SRC_CL, data_only=True)

    exports = {
        "career-library.json": export_career_library(wb_cl),
    }

    for filename, data in exports.items():
        path = OUT_DIR / filename
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print(f"Wrote {path} ({len(data)} rows)")


if __name__ == "__main__":
    main()
