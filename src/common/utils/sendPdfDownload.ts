import type { Response } from "express";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../errors/AppError.js";
import { fullName } from "./fullName.js";

// "<Student Name> - <label>.pdf" for a staff PDF download — also the 404 check that the
// student exists, run before any (slow) headless render starts.
export async function studentPdfFilename(studentId: string, label: string): Promise<string> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { user: { select: { firstName: true, lastName: true } } },
  });
  if (!student) {
    throw new NotFoundError("Student not found");
  }
  const safeName = fullName(student.user).replace(/[\\/:*?"<>|]+/g, "").trim() || "Student";
  return `${safeName} - ${label}.pdf`;
}

export function sendPdfDownload(res: Response, filename: string, pdf: Buffer): void {
  res
    .status(200)
    .set({
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      // filename* carries the UTF-8 name; the plain filename is an ASCII fallback.
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    })
    .send(pdf);
}
