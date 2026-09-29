/// <reference lib="dom" />
// The reference above only adds `document`/DOM types for typechecking the
// page.waitForFunction callback below, which Puppeteer serializes and runs inside the
// browser page, not in this Node process — it has no runtime effect on the rest of this
// (or any other) backend file.
import puppeteer, { type Page } from "puppeteer";
import { env } from "../../config/env.js";
import { signReportPdfToken } from "../../common/utils/reportPdfToken.js";

const READY_TIMEOUT_MS = 30_000;

// Headless-renders one of the frontend's print-only routes to a PDF. A fresh browser per
// call: renders are infrequent (the parent email once per student, plus staff clicking
// "Download" on Project Students), so the simplicity of not managing a shared browser's
// lifecycle/crash-recovery outweighs the cold-launch cost.
async function renderPrintPagePdf(
  url: string,
  pdfOptions: Parameters<Page["pdf"]>[0],
  viewport?: Parameters<Page["setViewport"]>[0]
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    // Required to run Chrome as root inside the Docker container (see Dockerfile) —
    // Chrome's sandbox needs a user namespace setup that isn't available there.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    if (viewport) await page.setViewport(viewport);
    await page.goto(url, { waitUntil: "networkidle0" });

    // The print-only pages set body[data-pdf-ready="true"] once their content has
    // finished rendering, or a [data-pdf-error] element if a data fetch failed (bad or
    // expired token, student not found, etc.) — page.pdf() never fires beforeprint the
    // way a real print dialog does, so this DOM marker is the substitute readiness
    // signal (see PrintReportContent's autoMeasureOnMount / PrintChartOnlyPage).
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
      throw new Error(`Print page reported an error: ${message}`);
    }

    const pdf = await page.pdf(pdfOptions);
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// The kREATE Compass report PDF for one student, via the frontend's print-only report
// route (no login — see reportPdfToken.ts / PrintReportOnlyPage).
export async function renderStudentReportPdf(studentId: string): Promise<Buffer> {
  const token = signReportPdfToken(studentId);
  const url = `${env.APP_WEB_URL}/print/report/${studentId}?token=${token}`;
  return renderPrintPagePdf(url, { format: "A4", printBackground: true });
}

// The Counsellor Chart PDF for one student, via the frontend's print-only chart route.
// Unlike the report, this is only ever rendered on behalf of a logged-in staff member, and
// its Section C step calls staff-only APIs (career library, stream weights) the report-pdf
// token doesn't unlock — so the render reuses that staff member's own access token rather
// than widening the report-pdf token. It travels in the URL fragment, which the browser
// never sends to any server. Page size/orientation come from the page's own @page rule.
export async function renderCounsellorChartPdf(studentId: string, accessToken: string): Promise<Buffer> {
  const url = `${env.APP_WEB_URL}/print/chart/${studentId}#token=${encodeURIComponent(accessToken)}`;
  // Desktop-width viewport so on-screen measurements (e.g. auto-sizing text areas) match
  // the desktop layout the chart's print CSS keeps.
  return renderPrintPagePdf(
    url,
    { preferCSSPageSize: true, printBackground: true },
    { width: 1400, height: 900 }
  );
}
