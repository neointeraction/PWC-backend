#!/usr/bin/env python3
"""
One-off export: reads the "Career Library" workbook and writes clean JSON per tab into
prisma/seed-data/career-library/, for prisma/seed.ts to load.

Source: "docs/Career Library_Updated_1809.xlsx" (2026-09-18) — a single workbook with
all seven tabs (CL + the six UG/PG reference tabs), replacing the previous two-workbook
setup (1808 for reference tabs, CL_2609 for the CL tab). Columns are looked up by header
name (row 1 of each tab), not position, since this workbook reordered and dropped several
columns relative to 1808/2609 — see HEADER-NAME NOTES below for what's missing and how
it's handled.

HEADER-NAME NOTES (workbook columns dropped or merged vs. the previous imports):
- CL tab: Grad/PG qualification are separate columns again (not the 2609 combined
  "<degrees>, Focus Electives: <electives>" format) — no split_qualification() needed.
  No "Top Courses" column (as with 2609) -> topCourses is always []. PG entrance exams
  now has both a full description and an "Extracted" short-list column, like UG.
- UG Institutions_IND: "NIRF Ranking" + "Other Rankings" collapsed into one "Ranking"
  column (-> nirfRanking; otherRankings left null) and "Approx Annual Fee" was dropped
  (-> null). "Category" was also dropped (-> null).
- UG Entrance_IND: dropped Level, Application Window, Exam Month, Result Month, Approx
  Attempts Allowed columns entirely -> those model fields are left null for every row.
- UG Courses_IND: dropped Duration and Minimum Eligibility (-> null). "Entrance Exams
  (Primary)" / "(Alternate)" collapsed into one "Entrance Exams" column (->
  entranceExamsPrimary; entranceExamsAlternate left null). "Top Govt Colleges" / "Top
  Private Colleges" collapsed into one "Top Colleges" column (-> topGovtColleges; keep
  topPrivateColleges null rather than guess the govt/private split). Dropped Approx
  Annual Fee Range (-> null).
- UG Inst+Uty_IND, PG Institutions_IND, PG Entrance_IND: unchanged from 1808.

Ignores the "Post-12_Entrance_Exams__India__" tab per instruction (out of scope).
Not part of the app's runtime — rerun manually if a source workbook changes.
"""
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "Career Library_Updated_1809.xlsx"
OUT_DIR = ROOT / "prisma" / "seed-data" / "career-library"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def s(v):
    """Normalize a cell value to a trimmed string, or None."""
    if v is None:
        return None
    v = str(v).strip()
    return v if v else None


def rows_by_header(ws):
    """Yield each data row (from row 2) as a dict keyed by row 1's header text."""
    headers = [s(h) for h in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    for r in ws.iter_rows(min_row=2, values_only=True):
        yield dict(zip(headers, r))


# Known source-data spelling/naming variants that would otherwise silently break the
# join between tables (verified against the actual workbook content — see
# docs/db-design.md "Cross-table mapping"). CL is treated as the authoritative
# vocabulary; the other tabs' values are normalized to match it.
INDUSTRY_ALIASES = {"Defense": "Defence"}  # UG Institutions_IND -> CL spelling
EXAM_ALIASES = {"CUET": "CUET UG"}  # CL's extracted list -> UG Entrance_IND's exam name


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
    ws = wb["CL"]
    out = []
    skipped = 0
    for row in rows_by_header(ws):
        cluster, industry, domain, job_role = (
            s(row["Career Cluster"]),
            s(row["Industry"]),
            s(row["Domain"]),
            s(row["Job Role"]),
        )
        ai_grade_raw = s(row["AI Resilience Grading"])
        qual_10_12 = s(row["Minimum Qualification (10+2)"])
        if not (cluster and industry and domain and job_role and ai_grade_raw and qual_10_12):
            skipped += 1
            continue

        india_min, india_max = parse_india_salary(row["Approx Salary Range (India)"])
        global_min, global_max = parse_global_salary(row["Global Salary Range"])

        out.append(
            {
                "cluster": cluster,
                "industry": industry,
                "domain": domain,
                "jobRole": job_role,
                "aiResilienceGrade": AI_GRADE_MAP.get(ai_grade_raw.lower(), "MEDIUM"),
                "aiResilienceComment": s(row["AI Resilience Comment"]) or "",
                "oneLineDescription": s(row["One-line Description"]) or "",
                "roleOverview": s(row["Role Overview & Scope"]),
                "keySkills": split_list(row["Key Skill Requirements"]),
                "topCompanies": split_list(row["Top Companies Recruiting"]),
                "salaryIndiaRangeText": s(row["Approx Salary Range (India)"]),
                "salaryIndiaMinLPA": india_min,
                "salaryIndiaMaxLPA": india_max,
                "salaryGlobalRangeText": s(row["Global Salary Range"]),
                "salaryGlobalMinUSD": global_min,
                "salaryGlobalMaxUSD": global_max,
                "qualification10th12th": qual_10_12,
                "qualification10th12thExplanation": s(row["10+2 Explanation - Electives"]),
                "qualificationGraduation": s(row["Minimum Qualification (Grad)"]),
                "qualificationGraduationDefined": s(row["Grad Focus Electives"]),
                "entranceExamsUGDescription": s(row["Entrance Exams (UG Level)"]),
                "entranceExams": [
                    EXAM_ALIASES.get(t, t) for t in split_list(row["Entrance Exams (UG Level) Extracted"])
                ],
                "qualificationPG": s(row["Minimum Qualification (PG)"]),
                "qualificationPGDefined": s(row["Focus Electives - PG"]),
                "entranceExamsPG": split_list(row["Entrance Exams (PG Level) Extracted"]),
                "certificationsStudent": split_list(row["Certifications - Students"], ";"),
                "certificationsUG": split_list(row["Certifications - UG"], ";"),
                "topCourses": [],  # no "Top Courses" column in this workbook
            }
        )
    print(f"CL: {len(out)} rows exported, {skipped} skipped (missing required field)")
    return out


def export_ug_institutions(wb):
    # "NIRF Ranking" / "Other Rankings" collapsed into one "Ranking" column here, and
    # "Approx Annual Fee" / "Category" were dropped entirely -> left null.
    ws = wb["UG Institutions_IND"]
    out = []
    for row in rows_by_header(ws):
        industry, name = s(row["Industry"]), s(row["College / Institution / University Name"])
        if not (industry and name):
            continue
        industry = INDUSTRY_ALIASES.get(industry, industry)
        out.append(
            {
                "industry": industry,
                "shortName": s(row["Short Name / Abbreviation"]),
                "name": name,
                "city": s(row["City"]),
                "state": s(row["State"]),
                "type": s(row["Type\n(Govt/Private/Deemed/Autonomous)"]),
                "category": None,  # dropped from this workbook
                "programmesOffered": s(row["Programmes Offered"]),
                "programmesOfferedAfterClass12": None,  # dropped from this workbook
                "keyProgrammesOffered": None,  # dropped from this workbook
                "primaryEntranceExams": s(row["Primary Entrance Exam(s)"]),
                "nirfRanking": s(row["Ranking"]),
                "otherRankings": None,  # merged into "Ranking" in this workbook
                "approxAnnualFee": None,  # dropped from this workbook
                "approxPlacementCtc": s(row["Approx Placement CTC\n(Median / Top, LPA)"]),
                "website": s(row["Website"]),
            }
        )
    print(f"UG Institutions_IND: {len(out)} rows exported")
    return out


def export_ug_inst_uty(wb):
    ws = wb["UG Inst+Uty_IND"]
    out = []
    for row in rows_by_header(ws):
        name = s(row["College / University Name"])
        if not name:
            continue
        out.append(
            {
                "shortName": s(row["Short Name / Abbreviation"]),
                "name": name,
                "city": s(row["City"]),
                "state": s(row["State"]),
                "type": s(row["Type\n(Govt/Private/Deemed/Autonomous)"]),
                "category": s(row["Category\n(IIT/NIT/IIM/NLU/Central Univ/Deemed/Private)"]),
                "keyProgrammesOffered": s(row["Key Programmes Offered"]),
                "primaryEntranceExams": s(row["Primary Entrance Exam(s)"]),
                "nirfRanking": s(row["NIRF Ranking\n(Overall / Domain)"]),
                "otherRankings": s(row["Other Rankings\n(QS / THE / Outlook etc.)"]),
                "approxAnnualFee": s(row["Approx Annual Fee\n(₹)"]),
                "approxPlacementCtc": s(row["Approx Placement CTC\n(Median / Top, LPA)"]),
                "website": s(row["Contact / Admission Website"]),
            }
        )
    print(f"UG Inst+Uty_IND: {len(out)} rows exported")
    return out


def export_ug_entrance(wb):
    # Level, Application Window, Exam Month, Result Month, Approx Attempts Allowed were
    # dropped from this workbook entirely -> left null.
    ws = wb["UG Entrance_IND"]
    out = []
    for row in rows_by_header(ws):
        exam_name = s(row["Exam Name"])
        if not exam_name:
            continue
        out.append(
            {
                "examName": exam_name,
                "fullForm": s(row["Full Form"]),
                "conductingBody": s(row["Conducting Body"]),
                "level": None,  # dropped from this workbook
                "applicableFor": s(row["Applicable For\n(Degree/Programme)"]),
                "subjectRequirements12th": s(row["Subject Requirements\n(12th)"]),
                "applicationWindow": None,  # dropped from this workbook
                "examMonth": None,  # dropped from this workbook
                "resultMonth": None,  # dropped from this workbook
                "examMode": s(row["Exam Mode\n(Online/Offline)"]),
                "frequency": s(row["Frequency\n(Annual/Twice)"]),
                "approxAttemptsAllowed": None,  # dropped from this workbook
                "officialWebsite": s(row["Official Website"]),
            }
        )
    print(f"UG Entrance_IND: {len(out)} rows exported")
    return out


def export_ug_courses(wb):
    # Duration and Minimum Eligibility were dropped entirely -> null. "Entrance Exams
    # (Primary)"/"(Alternate)" collapsed into one "Entrance Exams" column -> mapped to
    # entranceExamsPrimary, entranceExamsAlternate left null. "Top Govt Colleges"/"Top
    # Private Colleges" collapsed into one "Top Colleges" column -> mapped to
    # topGovtColleges, topPrivateColleges left null (no reliable way to re-split).
    # Approx Annual Fee Range was dropped entirely -> null.
    ws = wb["UG Courses_IND"]
    out = []
    for row in rows_by_header(ws):
        course_name, cluster = s(row["Course Name\n(Short)"]), s(row["Career Cluster"])
        if not (course_name and cluster):
            continue
        out.append(
            {
                "courseName": course_name,
                "fullForm": s(row["Full Form"]),
                "level": s(row["Level\n(UG/PG/Diploma/Certificate)"]),
                "durationYears": None,  # dropped from this workbook
                "careerCluster": cluster,
                "stream12thRequirements": s(row["12th  Stream with Subject Requirements"]),
                "minimumEligibility": None,  # dropped from this workbook
                "entranceExamsPrimary": s(row["Entrance Exams"]),
                "entranceExamsAlternate": None,  # merged into "Entrance Exams" in this workbook
                "topSpecialisations": s(row["Top Specialisations / Branches"]),
                "topGovtColleges": s(row["Top Colleges"]),
                "topPrivateColleges": None,  # merged into "Top Colleges" in this workbook
                "approxAnnualFeeRange": None,  # dropped from this workbook
                "furtherStudyOptions": s(row["Further Study Options\n(PG / PhD)"]),
            }
        )
    print(f"UG Courses_IND: {len(out)} rows exported")
    return out


def export_pg_institutions(wb):
    ws = wb["PG Institutions_IND"]
    out = []
    for row in rows_by_header(ws):
        institution = s(row["Institution"])
        if not institution:
            continue
        out.append(
            {
                "industry": s(row["Industry"]),
                "institution": institution,
                "state": s(row["State"]),
                "city": s(row["City"]),
                "programTypes": s(row["Program Types (after Graduation)"]),
                "website": s(row["Website"]),
            }
        )
    print(f"PG Institutions_IND: {len(out)} rows exported")
    return out


def export_pg_entrance(wb):
    ws = wb["PG Entrance_IND"]
    out = []
    for row in rows_by_header(ws):
        exam_name = s(row["Entrance Exam"])
        if not exam_name:
            continue
        out.append(
            {
                "examName": exam_name,
                "coursesForExam": s(row["Courses for which the exam is meant (PG)"]),
                "officialWebsite": s(row["Official Website"]),
            }
        )
    print(f"PG Entrance_IND: {len(out)} rows exported")
    return out


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)

    exports = {
        "career-library.json": export_career_library(wb),
        "ug-institutions.json": export_ug_institutions(wb),
        "ug-institutions-universities.json": export_ug_inst_uty(wb),
        "ug-entrance-exams.json": export_ug_entrance(wb),
        "ug-courses.json": export_ug_courses(wb),
        "pg-institutions.json": export_pg_institutions(wb),
        "pg-entrance-exams.json": export_pg_entrance(wb),
    }

    for filename, data in exports.items():
        path = OUT_DIR / filename
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print(f"Wrote {path} ({len(data)} rows)")


if __name__ == "__main__":
    main()
