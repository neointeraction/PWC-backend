-- CreateIndex
CREATE UNIQUE INDEX "assessment_questions_cohort_order_key" ON "assessment_questions"("cohort", "order");

-- CreateIndex
CREATE UNIQUE INDEX "form_questions_formTemplateId_order_key" ON "form_questions"("formTemplateId", "order");

