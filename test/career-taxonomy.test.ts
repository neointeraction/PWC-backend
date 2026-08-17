import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authRequest } from "./helpers/http.js";

const app = createApp();
const admin = authRequest(app);

// All test nodes use this prefix so cleanup is a simple startsWith sweep.
const P = "Test Tax ";

describe("Career Taxonomy API", () => {
  afterAll(async () => {
    await prisma.careerLibraryEntry.deleteMany({ where: { jobRole: { startsWith: P } } });
    await prisma.careerDomain.deleteMany({ where: { name: { startsWith: P } } });
    await prisma.careerIndustry.deleteMany({ where: { name: { startsWith: P } } });
    await prisma.careerCluster.deleteMany({ where: { name: { startsWith: P } } });
    await prisma.$disconnect();
  });

  it("creates the cluster → industry → domain hierarchy", async () => {
    const cluster = await admin.post("/api/v1/career-taxonomy/clusters").send({ name: `${P}Cluster A` });
    expect(cluster.status).toBe(201);

    const industry = await admin
      .post("/api/v1/career-taxonomy/industries")
      .send({ clusterId: cluster.body.id, name: `${P}Industry A` });
    expect(industry.status).toBe(201);
    expect(industry.body.cluster.id).toBe(cluster.body.id);

    const domain = await admin
      .post("/api/v1/career-taxonomy/domains")
      .send({ industryId: industry.body.id, name: `${P}Domain A` });
    expect(domain.status).toBe(201);
    expect(domain.body.industry.cluster.id).toBe(cluster.body.id);
  });

  it("409s on a duplicate live name within the same parent", async () => {
    const dup = await admin.post("/api/v1/career-taxonomy/clusters").send({ name: `${P}Cluster A` });
    expect(dup.status).toBe(409);
  });

  it("rejects an industry under an unknown cluster with 404", async () => {
    const res = await admin
      .post("/api/v1/career-taxonomy/industries")
      .send({ clusterId: "does-not-exist", name: `${P}Orphan` });
    expect(res.status).toBe(404);
  });

  it("soft-deletes a cluster (hidden from default list, visible with includeDeleted)", async () => {
    const created = await admin.post("/api/v1/career-taxonomy/clusters").send({ name: `${P}Cluster Del` });
    const id = created.body.id;

    const del = await admin.delete(`/api/v1/career-taxonomy/clusters/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.deletedAt).toBeTruthy();

    const def = await admin.get("/api/v1/career-taxonomy/clusters");
    expect(def.body.some((c: { id: string }) => c.id === id)).toBe(false);

    const withDeleted = await admin.get("/api/v1/career-taxonomy/clusters").query({ includeDeleted: "true" });
    expect(withDeleted.body.some((c: { id: string }) => c.id === id)).toBe(true);
  });

  it("allows reusing a soft-deleted name, then 409s restoring the old node", async () => {
    const first = await admin.post("/api/v1/career-taxonomy/clusters").send({ name: `${P}Reuse` });
    await admin.delete(`/api/v1/career-taxonomy/clusters/${first.body.id}`);

    // The name is free again for a new live node.
    const second = await admin.post("/api/v1/career-taxonomy/clusters").send({ name: `${P}Reuse` });
    expect(second.status).toBe(201);

    // Restoring the original would collide with the new live node → 409.
    const restore = await admin.post(`/api/v1/career-taxonomy/clusters/${first.body.id}/restore`);
    expect(restore.status).toBe(409);
  });

  it("exposes the live hierarchy via GET /tree", async () => {
    const res = await admin.get("/api/v1/career-taxonomy/tree");
    expect(res.status).toBe(200);
    const clusterA = res.body.find((c: { name: string }) => c.name === `${P}Cluster A`);
    expect(clusterA).toBeDefined();
    const industryA = clusterA.industries.find((i: { name: string }) => i.name === `${P}Industry A`);
    expect(industryA).toBeDefined();
    expect(industryA.domains.some((d: { name: string }) => d.name === `${P}Domain A`)).toBe(true);
  });

  it("gates writes: 401 without a token, 403 for a student", async () => {
    const noToken = await request(app).post("/api/v1/career-taxonomy/clusters").send({ name: `${P}Nope` });
    expect(noToken.status).toBe(401);

    const student = await authRequest(app, "STUDENT")
      .post("/api/v1/career-taxonomy/clusters")
      .send({ name: `${P}Nope` });
    expect(student.status).toBe(403);
  });

  it("validates domainId when creating a career entry", async () => {
    // Fresh live leaf for this test.
    const cluster = await admin.post("/api/v1/career-taxonomy/clusters").send({ name: `${P}Cluster E` });
    const industry = await admin
      .post("/api/v1/career-taxonomy/industries")
      .send({ clusterId: cluster.body.id, name: `${P}Industry E` });
    const domain = await admin
      .post("/api/v1/career-taxonomy/domains")
      .send({ industryId: industry.body.id, name: `${P}Domain E` });

    const base = {
      jobRole: `${P}Role E`,
      aiResilienceGrade: "HIGH",
      aiResilienceComment: "x",
      oneLineDescription: "x",
      qualification10th12th: "Any",
    };

    // Unknown domainId → 400.
    const bad = await admin.post("/api/v1/career-library").send({ ...base, domainId: "no-such-domain" });
    expect(bad.status).toBe(400);

    // Valid live domainId → 201, and the entry resolves back up to the cluster.
    const ok = await admin.post("/api/v1/career-library").send({ ...base, domainId: domain.body.id });
    expect(ok.status).toBe(201);
    expect(ok.body.domain.industry.cluster.name).toBe(`${P}Cluster E`);

    // Soft-deleted domain is rejected on create.
    await admin.delete(`/api/v1/career-taxonomy/domains/${domain.body.id}`);
    const afterDelete = await admin
      .post("/api/v1/career-library")
      .send({ ...base, jobRole: `${P}Role E2`, domainId: domain.body.id });
    expect(afterDelete.status).toBe(400);
  });
});
