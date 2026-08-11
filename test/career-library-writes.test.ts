import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest, bearer } from "./helpers/http.js";

const app = createApp();

let counsellorId: string; // Counsellor.id
let counsellorToken: string; // Bearer for the counsellor's own user

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    cluster: "Test CL Cluster",
    industry: "Test CL Industry",
    domain: "Test CL Domain",
    jobRole: "Test CL Role Base",
    aiResilienceGrade: "HIGH",
    aiResilienceComment: "Resilient because reasons",
    oneLineDescription: "Does a thing",
    qualification10th12th: "Any stream",
    ...overrides,
  };
}

describe("Career Library writes + ratification", () => {
  beforeAll(async () => {
    const institute = await authRequest(app).post("/api/v1/institutes").send({
      name: "Test Institute CareerLib",
      address: "1 CL St",
      contactNumber: "+919876574001",
      primaryEmail: "careerlib@test-institute.example",
    });
    const counsellor = await authRequest(app).post("/api/v1/counsellors").send({
      firstName: "Cara",
      lastName: "Libra",
      email: "cara@test-careerlib.example",
      mobile: "+919876574002",
      counsellorCode: "CLCN1",
      instituteId: institute.body.id,
    });
    counsellorId = counsellor.body.counsellor.id;
    counsellorToken = bearer("COUNSELLOR", { userId: counsellor.body.counsellor.user.id });
  });

  afterAll(async () => {
    await prisma.careerLibraryRequest.deleteMany({ where: { jobTitle: { startsWith: "Test CL" } } });
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: { startsWith: "Test CL Role" } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@test-careerlib.example" } } });
    await prisma.institute.deleteMany({ where: { name: "Test Institute CareerLib" } });
    await prisma.$disconnect();
  });

  it("admin creates an entry that defaults to DRAFT", async () => {
    const res = await authRequest(app).post("/api/v1/career-library").send(entryBody({ jobRole: "Test CL Role Draft" }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.createdBy).toBeTypeOf("string");
  });

  it("403s a counsellor trying to create an entry (admin-only)", async () => {
    const res = await request(app)
      .post("/api/v1/career-library")
      .set("Authorization", counsellorToken)
      .send(entryBody({ jobRole: "Test CL Role Nope" }));
    expect(res.status).toBe(403);
  });

  it("publishes an entry via PATCH status ACTIVE, and hides DRAFTs from the default list", async () => {
    const created = await authRequest(app).post("/api/v1/career-library").send(entryBody({ jobRole: "Test CL Role Publish" }));
    const id = created.body.id;

    // Default list is ACTIVE-only -> the DRAFT isn't there yet.
    const draftList = await authRequest(app).get("/api/v1/career-library").query({ search: "Test CL Role Publish" });
    expect(draftList.body.data.some((e: { id: string }) => e.id === id)).toBe(false);

    const published = await authRequest(app).patch(`/api/v1/career-library/${id}`).send({ status: "ACTIVE" });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("ACTIVE");
    expect(published.body.updatedBy).toBeTypeOf("string");

    const activeList = await authRequest(app).get("/api/v1/career-library").query({ search: "Test CL Role Publish" });
    expect(activeList.body.data.some((e: { id: string }) => e.id === id)).toBe(true);
  });

  it("deletes an entry", async () => {
    const created = await authRequest(app).post("/api/v1/career-library").send(entryBody({ jobRole: "Test CL Role Delete" }));
    const id = created.body.id;
    const del = await authRequest(app).delete(`/api/v1/career-library/${id}`);
    expect(del.status).toBe(204);
    const got = await authRequest(app).get(`/api/v1/career-library/${id}`);
    expect(got.status).toBe(404);
  });

  it("lets a counsellor submit a ratification request (self, resolved from token)", async () => {
    const res = await request(app)
      .post("/api/v1/career-library/requests")
      .set("Authorization", counsellorToken)
      .send({
        jobTitle: "Test CL Prompt Engineer",
        suggestedCluster: "Technology",
        suggestedIndustry: "AI",
        oneLineDescription: "Designs prompts",
        justification: "Growing field",
        referenceLinks: ["https://example.com/role"],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.requestedById).toBe(counsellorId);
  });

  it("runs the approve flow: link a resulting entry, then can't re-review", async () => {
    const submitted = await request(app)
      .post("/api/v1/career-library/requests")
      .set("Authorization", counsellorToken)
      .send({
        jobTitle: "Test CL Robotics Tech",
        suggestedCluster: "Engineering",
        suggestedIndustry: "Robotics",
        oneLineDescription: "Builds robots",
        justification: "In demand",
      });
    const requestId = submitted.body.id;

    // Admin creates the real entry, then approves the request linked to it.
    const entry = await authRequest(app).post("/api/v1/career-library").send(entryBody({ jobRole: "Test CL Role Robotics", status: "ACTIVE" }));

    const approved = await authRequest(app)
      .post(`/api/v1/career-library/requests/${requestId}/approve`)
      .send({ resultingEntryId: entry.body.id });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
    expect(approved.body.reviewedBy).toBeTypeOf("string");
    expect(approved.body.resultingEntry.id).toBe(entry.body.id);

    // Already reviewed -> 409.
    const again = await authRequest(app).post(`/api/v1/career-library/requests/${requestId}/approve`).send({});
    expect(again.status).toBe(409);
  });

  it("rejects a request, and forbids a counsellor from reviewing", async () => {
    const submitted = await request(app)
      .post("/api/v1/career-library/requests")
      .set("Authorization", counsellorToken)
      .send({
        jobTitle: "Test CL Astrologer",
        suggestedCluster: "Misc",
        suggestedIndustry: "Misc",
        oneLineDescription: "Reads stars",
        justification: "Requested by parent",
      });
    const requestId = submitted.body.id;

    const asCounsellor = await request(app)
      .post(`/api/v1/career-library/requests/${requestId}/reject`)
      .set("Authorization", counsellorToken);
    expect(asCounsellor.status).toBe(403); // review is admin-only

    const rejected = await authRequest(app).post(`/api/v1/career-library/requests/${requestId}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");
  });

  it("lists requests filtered by status", async () => {
    const pending = await authRequest(app).get("/api/v1/career-library/requests").query({ status: "PENDING" });
    expect(pending.status).toBe(200);
    expect(pending.body.every((r: { status: string }) => r.status === "PENDING")).toBe(true);
  });
});
