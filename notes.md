## Pending items

Server-side PDF rendering — the report is delivered as JSON; PDF is client-side for now. A backend PDF (puppeteer/pdfkit) is optional.
Parent / institution report variants — only the student assessment report is built.
Auto-generating the Swagger spec — it's hand-maintained (I just brought it up to date); a refactor to generate it from the routes would stop it drifting, but isn't required.

Reminder scheduler (cron)	The 41 email templates all work (you just previewed them), but nothing auto-fires the same-day / nudge reminders — every send is still a manual POST /email/send (or the booking/reschedule/cancel auto-triggers). Needs a scheduler + a decision on how it runs in this environment (node-cron in-process, an external cron hitting an endpoint, etc.).


No FKs — FormTemplate.cohort / AssessmentQuestion.cohort / AssessmentAttempt.cohort stay plain strings matching Cohort.code. The table is a decoupled source of truth; converting those columns to relations is deferred.
No Project↔Cohort link and no Student.cohort — that's the real multi-cohort work (students need to carry their cohort since forms/assessments are cohort-specific), deferred until you actually onboard a second cohort. Both the db-design doc and the schema comment record this decision so the next person knows why it's decoupled.
