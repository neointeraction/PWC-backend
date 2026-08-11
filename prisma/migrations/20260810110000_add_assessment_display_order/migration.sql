-- Add the questionnaire presentation order (displayOrder) to assessment_questions.
-- Backfills the existing seeded 73 questions by questionCode, then enforces NOT NULL.
ALTER TABLE "assessment_questions" ADD COLUMN "displayOrder" INTEGER;

UPDATE "assessment_questions" SET "displayOrder" = CASE "questionCode"
    WHEN 'Q1' THEN 6
    WHEN 'Q2' THEN 16
    WHEN 'Q3' THEN 26
    WHEN 'Q4' THEN 48
    WHEN 'Q5' THEN 2
    WHEN 'Q6' THEN 12
    WHEN 'Q7' THEN 22
    WHEN 'Q8' THEN 46
    WHEN 'Q9' THEN 8
    WHEN 'Q10' THEN 18
    WHEN 'Q11' THEN 28
    WHEN 'Q12' THEN 62
    WHEN 'Q13' THEN 1
    WHEN 'Q14' THEN 11
    WHEN 'Q15' THEN 21
    WHEN 'Q16' THEN 41
    WHEN 'Q17' THEN 4
    WHEN 'Q18' THEN 14
    WHEN 'Q19' THEN 24
    WHEN 'Q20' THEN 63
    WHEN 'Q21' THEN 9
    WHEN 'Q22' THEN 29
    WHEN 'Q23' THEN 44
    WHEN 'Q24' THEN 19
    WHEN 'Q25' THEN 3
    WHEN 'Q26' THEN 13
    WHEN 'Q27' THEN 23
    WHEN 'Q28' THEN 42
    WHEN 'Q29' THEN 5
    WHEN 'Q30' THEN 15
    WHEN 'Q31' THEN 25
    WHEN 'Q32' THEN 45
    WHEN 'Q33' THEN 30
    WHEN 'Q34' THEN 43
    WHEN 'Q35' THEN 49
    WHEN 'Q36' THEN 64
    WHEN 'Q37' THEN 7
    WHEN 'Q38' THEN 17
    WHEN 'Q39' THEN 27
    WHEN 'Q40' THEN 50
    WHEN 'Q41' THEN 10
    WHEN 'Q42' THEN 20
    WHEN 'Q43' THEN 47
    WHEN 'Q44' THEN 61
    WHEN 'Q45' THEN 31
    WHEN 'Q46' THEN 35
    WHEN 'Q47' THEN 39
    WHEN 'Q48' THEN 53
    WHEN 'Q49' THEN 57
    WHEN 'Q50' THEN 32
    WHEN 'Q51' THEN 36
    WHEN 'Q52' THEN 40
    WHEN 'Q53' THEN 54
    WHEN 'Q54' THEN 58
    WHEN 'Q55' THEN 33
    WHEN 'Q56' THEN 37
    WHEN 'Q57' THEN 51
    WHEN 'Q58' THEN 55
    WHEN 'Q59' THEN 59
    WHEN 'Q60' THEN 34
    WHEN 'Q61' THEN 38
    WHEN 'Q62' THEN 52
    WHEN 'Q63' THEN 56
    WHEN 'Q64' THEN 60
    WHEN 'Q65' THEN 65
    WHEN 'Q66' THEN 68
    WHEN 'Q67' THEN 71
    WHEN 'Q68' THEN 66
    WHEN 'Q69' THEN 69
    WHEN 'Q70' THEN 72
    WHEN 'Q71' THEN 67
    WHEN 'Q72' THEN 70
    WHEN 'Q73' THEN 73
END
WHERE "cohort" = 'CLASS_9_10';

ALTER TABLE "assessment_questions" ALTER COLUMN "displayOrder" SET NOT NULL;

CREATE UNIQUE INDEX "assessment_questions_cohort_displayOrder_key" ON "assessment_questions"("cohort", "displayOrder");
