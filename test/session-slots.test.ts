import argon2 from "argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authRequest } from "./helpers/http.js";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

// Covers slot-inventory maintenance *after* the one-time import: an admin assigns a
// counsellor to a live project and has to give them availability, and removes slots
// uploaded in error. Kept out of sessions.test.ts, which is a single sequential
// booking narrative whose slot counts these writes would disturb.

const app = createApp();

const INSTITUTE = "Test Institute Slot Admin";

let instituteId: string;
let projectId: string;
let counsellorAId: string; // in the original import
let counsellorBId: string; // assigned to the project later
let counsellorOutsiderId: string; // never assigned to the project

async function cleanupInstitute(name: string): Promise<void> {
  const inst = await prisma.institute.findUnique({ where: { name } });
  if (!inst) return;
  const projects = await prisma.project.findMany({ where: { instituteId: inst.id } });
  const projectIds = projects.map((p) => p.id);
  const counsellors = await prisma.counsellor.findMany({ where: { instituteId: inst.id } });

  await prisma.counsellorSlot.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectCounsellor.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.counsellor.deleteMany({ where: { id: { in: counsellors.map((c) => c.id) } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: counsellors.map((c) => c.userId) } } });
  await prisma.institute.delete({ where: { id: inst.id } });
}

describe("Counsellor slot inventory maintenance", () => {
  beforeAll(async () => {
    await cleanupInstitute(INSTITUTE);

    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: INSTITUTE,
      address: "9 Slot Rd",
      contactNumber: "+919876571001",
      primaryEmail: "slots@test-institute.example",
    });
    instituteId = institute.body.id;

    const project = await prisma.project.create({
      data: {
        instituteId,
        name: "Test Project Slot Admin",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      },
    });
    projectId = project.id;

    const passwordHash = await argon2.hash("temp-password");
    const makeCounsellor = async (code: string, email: string, mobile: string) => {
      const user = await prisma.user.create({
        data: { email, passwordHash, role: "COUNSELLOR", firstName: "Slot", lastName: code },
      });
      const counsellor = await prisma.counsellor.create({
        data: { userId: user.id, counsellorCode: code, instituteId, mobile },
      });
      return counsellor.id;
    };

    counsellorAId = await makeCounsellor("CN-SLOT-A", "counsellor-slot-a@test.example", "+919876571002");
    counsellorBId = await makeCounsellor("CN-SLOT-B", "counsellor-slot-b@test.example", "+919876571003");
    counsellorOutsiderId = await makeCounsellor("CN-SLOT-X", "counsellor-slot-x@test.example", "+919876571004");

    await prisma.projectCounsellor.create({ data: { projectId, counsellorId: counsellorAId } });

    await authRequest(app)
      .post("/api/v1/sessions/slots/import")
      .send({
        projectId,
        slots: [{ counsellorId: counsellorAId, date: "2026-03-02", startTime: "10:00", endTime: "10:45" }],
      })
      .expect(201);
  });

  afterAll(async () => {
    await cleanupInstitute(INSTITUTE);
    await prisma.$disconnect();
  });

  it("lets an admin assign a counsellor to a live project and add their availability", async () => {
    const assign = await authRequest(app)
      .post(`/api/v1/counsellors/${counsellorBId}/projects`)
      .send({ projectId });
    expect(assign.status).toBe(200);

    const res = await authRequest(app)
      .post("/api/v1/sessions/slots")
      .send({
        projectId,
        counsellorId: counsellorBId,
        slots: [
          { date: "2026-03-03", startTime: "11:00", endTime: "11:45" },
          { date: "2026-03-04", startTime: "11:00", endTime: "11:45" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(2);

    const list = await authRequest(app).get("/api/v1/sessions/slots").query({ projectId, counsellorId: counsellorBId });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.every((slot: { status: string }) => slot.status === "OPEN")).toBe(true);
  });

  it("accepts the display date format the booking responses emit", async () => {
    const res = await authRequest(app)
      .post("/api/v1/sessions/slots")
      .send({ projectId, counsellorId: counsellorBId, slots: [{ date: "05 Mar 2026", startTime: "11:00", endTime: "11:45" }] });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(1);
  });

  it("rejects adding slots for a counsellor not assigned to the project", async () => {
    const res = await authRequest(app)
      .post("/api/v1/sessions/slots")
      .send({ projectId, counsellorId: counsellorOutsiderId, slots: [{ date: "2026-03-06", startTime: "09:00", endTime: "09:45" }] });
    expect(res.status).toBe(400);
  });

  it("reports which slots clash instead of silently skipping them", async () => {
    const res = await authRequest(app)
      .post("/api/v1/sessions/slots")
      .send({
        projectId,
        counsellorId: counsellorBId,
        slots: [
          { date: "2026-03-03", startTime: "11:00", endTime: "11:45" }, // already added above
          { date: "2026-03-07", startTime: "11:00", endTime: "11:45" }, // new
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.details.existingSlots).toEqual([{ date: "2026-03-03", startTime: "11:00" }]);

    // Nothing was written — the clash aborts the whole batch.
    const kept = await prisma.counsellorSlot.findFirst({
      where: { counsellorId: counsellorBId, slotDate: new Date("2026-03-07T00:00:00.000Z") },
    });
    expect(kept).toBeNull();
  });

  it("deletes an unbooked slot", async () => {
    const slot = await prisma.counsellorSlot.findFirstOrThrow({
      where: { counsellorId: counsellorBId, slotDate: new Date("2026-03-04T00:00:00.000Z") },
    });
    const res = await authRequest(app).delete(`/api/v1/sessions/slots/${slot.id}`);
    expect(res.status).toBe(204);
    expect(await prisma.counsellorSlot.findUnique({ where: { id: slot.id } })).toBeNull();
  });

  it("refuses to delete a booked slot", async () => {
    const slot = await prisma.counsellorSlot.findFirstOrThrow({ where: { counsellorId: counsellorAId } });
    await prisma.counsellorSlot.update({ where: { id: slot.id }, data: { status: "BOOKED" } });

    const res = await authRequest(app).delete(`/api/v1/sessions/slots/${slot.id}`);
    expect(res.status).toBe(409);
    expect(await prisma.counsellorSlot.findUnique({ where: { id: slot.id } })).not.toBeNull();

    await prisma.counsellorSlot.update({ where: { id: slot.id }, data: { status: "OPEN" } });
  });

  it("keeps slot writes admin-only", async () => {
    const add = await authRequest(app, "COUNSELLOR")
      .post("/api/v1/sessions/slots")
      .send({ projectId, counsellorId: counsellorBId, slots: [{ date: "2026-03-08", startTime: "12:00", endTime: "12:45" }] });
    expect(add.status).toBe(403);

    const slot = await prisma.counsellorSlot.findFirstOrThrow({ where: { counsellorId: counsellorBId } });
    const del = await authRequest(app, "COUNSELLOR").delete(`/api/v1/sessions/slots/${slot.id}`);
    expect(del.status).toBe(403);
  });
});
