import { afterAll, beforeAll, describe, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();
const D = "@zzprobe.example";
const NUL = String.fromCharCode(0);
let n = 0;

function base(): any {
  n++;
  const k = `${Date.now()}${n}`;
  const digits = (p: string) => p + String(k).padStart(9, "0").slice(-9);
  return {
    k,
    project: {
      code: `ZZP${k}`,
      name: `ZZ Probe ${k}`,
      address: "x",
      contactNumber: digits("9"),
      primaryEmail: `p${k}${D}`,
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    },
    students: [
      { firstName: "A", lastName: "B", email: `s${k}${D}`, mobile: digits("8"), studentCode: `ZS${k}`, className: "9", divisionName: "A" },
    ],
    counsellorSlots: [],
  };
}
const slot = (k: string, over: any = {}) => ({
  counsellorCode: `ZC${k}`,
  firstName: "C",
  lastName: "D",
  email: `c${k}${D}`,
  mobile: "7" + String(k).padStart(9, "0").slice(-9),
  date: "2026-03-01",
  startTime: "10:00",
  endTime: "10:30",
  ...over,
});

async function run(label: string, mk: (b: any) => any, raw?: string) {
  const b = base();
  const k = b.k;
  delete b.k;
  const payload = mk({ ...b, k });
  if (payload && typeof payload === "object") delete payload.k;
  const r =
    raw !== undefined
      ? await request(app)
          .post("/api/v1/projects/wizard")
          .set("Authorization", bearer("ADMIN"))
          .set("Content-Type", "application/json")
          .send(raw)
      : await authRequest(app).post("/api/v1/projects/wizard").send(payload);
  console.log(`PROBE ${r.status} ${label} :: ${JSON.stringify(r.body).slice(0, 170)}`);
}

describe("probe", () => {
  beforeAll(async () => {
    await prisma.language.upsert({
      where: { code: "en" },
      update: { isDefault: true, isActive: true },
      create: { code: "en", name: "English", isDefault: true, displayOrder: 1 },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: D } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "ZZ Probe" } } });
    await prisma.$disconnect();
  });

  it("cases", async () => {
    await run("baseline", (b) => ({ ...b, counsellorSlots: [slot(b.k)] }));
    await run("impossible slot date 2026-02-31", (b) => ({ ...b, counsellorSlots: [slot(b.k, { date: "2026-02-31" })] }));
    await run("slot date 2026-13-45", (b) => ({ ...b, counsellorSlots: [slot(b.k, { date: "2026-13-45" })] }));
    await run("slot date 0000-01-01", (b) => ({ ...b, counsellorSlots: [slot(b.k, { date: "0000-01-01" })] }));
    await run("slot '31 Feb 2026'", (b) => ({ ...b, counsellorSlots: [slot(b.k, { date: "31 Feb 2026" })] }));
    await run("project dates huge year", (b) => ({ ...b, project: { ...b.project, fromDate: "+275760-09-13", toDate: "+275760-09-13" } }));
    await run("project dates year 0001 / 10000", (b) => ({ ...b, project: { ...b.project, fromDate: "0001-01-01", toDate: "10000-01-01" } }));
    await run("counsellor email == student email", (b) => ({ ...b, counsellorSlots: [slot(b.k, { email: b.students[0].email })] }));
    await run("NUL in student firstName", (b) => ({ ...b, students: [{ ...b.students[0], firstName: "A" + NUL + "B" }] }));
    await run("NUL in project name", (b) => ({ ...b, project: { ...b.project, name: "ZZ Probe " + NUL + "x" } }));
    await run("malformed JSON", () => ({}), "{bad json");
    await run("empty students", (b) => ({ ...b, students: [] }));
    await run("students not array", (b) => ({ ...b, students: "x" }));
    await run("project null", (b) => ({ ...b, project: null }));
    await run("body is array", () => ({}), "[]");
    await run("2MB password", (b) => ({ ...b, students: [{ ...b.students[0], password: "p".repeat(2_000_000) }] }));
    await run("same student twice in request", (b) => ({ ...b, students: [b.students[0], { ...b.students[0] }] }));
    await run("two new counsellors same mobile", (b) => ({
      ...b,
      counsellorSlots: [slot(b.k), slot(b.k, { counsellorCode: `ZD${b.k}`, email: `d${b.k}${D}` })],
    }));
    await run("two new counsellors same email", (b) => ({
      ...b,
      counsellorSlots: [slot(b.k), slot(b.k, { counsellorCode: `ZD${b.k}`, mobile: "7000000001" })],
    }));
    await run("slot end<start", (b) => ({ ...b, counsellorSlots: [slot(b.k, { startTime: "11:00", endTime: "10:00" })] }));
    await run("400 students", (b) => ({
      ...b,
      students: Array.from({ length: 400 }, (_, i) => ({
        firstName: "A",
        lastName: "B",
        email: `m${i}-${b.k}${D}`,
        mobile: `6${String(i).padStart(4, "0")}${String(b.k).slice(-5)}`,
        studentCode: `ZM${i}-${b.k}`,
        className: "9",
        divisionName: "A",
      })),
    }));
  }, 300_000);
});
