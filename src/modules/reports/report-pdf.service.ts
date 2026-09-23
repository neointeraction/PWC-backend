/// <reference lib="dom" />
// The reference above only adds `document`/DOM types for typechecking the
// page.waitForFunction callback below, which Puppeteer serializes and runs inside the
// browser page, not in this Node process — it has no runtime effect on the rest of this
// (or any other) backend file.
import puppeteer from "puppeteer";
import { env } from "../../config/env.js";
import { signReportPdfToken } from "../../common/utils/reportPdfToken.js";

const READY_TIMEOUT_MS = 30_000;

// Headless-renders the kREATE report PDF for one student, by navigating Puppeteer to the
// frontend's print-only route (no login — see reportPdfToken.ts / PrintReportOnlyPage) and
// capturing it. A fresh browser per call: this only runs once per student (on the
// feedback-pair completing — see forms.service.ts), so the simplicity of not managing a
// shared browser's lifecycle/crash-recovery outweighs the cold-launch cost.
export async function renderStudentReportPdf(studentId: string): Promise<Buffer> {
  const token = signReportPdfToken(studentId);
  const url = `${env.APP_WEB_URL}/print/report/${studentId}?token=${token}`;

  const browser = await puppeteer.launch({
    headless: true,
    // Required to run Chrome as root inside the Docker container (see Dockerfile) —
    // Chrome's sandbox needs a user namespace setup that isn't available there.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });

    // PrintReportOnlyPage sets body[data-pdf-ready="true"] once pagination measurement
    // finishes, or a [data-pdf-error] element if the report/chart/band-guidance fetch
    // failed (bad or expired token, student not found, etc.) — page.pdf() never fires
    // beforeprint the way a real print dialog does, so this DOM marker is the substitute
    // readiness signal (see PrintReportContent's autoMeasureOnMount).
    const outcome = await page.waitForFunction(
      () => {
        if (document.body.dataset.pdfReady === "true") return "ready";
        const errorEl = document.querySelector("[data-pdf-error]");
        return errorEl ? "error" : false;
      },
      { timeout: READY_TIMEOUT_MS }
    );
    const result = await outcome.jsonValue();
    if (result === "error") {
      const message = await page.$eval("[data-pdf-error]", (el) => el.getAttribute("data-pdf-error"));
      throw new Error(`Report print page reported an error: ${message}`);
    }

    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
