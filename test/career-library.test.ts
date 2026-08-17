import request from "supertest";
import { authRequest } from "./helpers/http.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("Career Library API", () => {
  it("lists entries with pagination metadata", async () => {
    const res = await authRequest(app).get("/api/v1/career-library");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 20 });
    expect(res.body.pagination.total).toBeGreaterThan(1000); // full seeded set is 1,317
  });

  it("searches by free text across jobRole/cluster/industry/domain/description", async () => {
    const res = await authRequest(app).get("/api/v1/career-library").query({ search: "Data Scientist" });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((e: { jobRole: string }) => e.jobRole === "Data Scientist")).toBe(true);
  });

  it("filters by clusterId (taxonomy), returning only entries under that cluster", async () => {
    const filters = await authRequest(app).get("/api/v1/career-library/filters");
    const cluster = filters.body.clusters.find(
      (c: { name: string }) => c.name === "Information Technology & Digital"
    );
    expect(cluster).toBeDefined();

    const res = await authRequest(app).get("/api/v1/career-library").query({ clusterId: cluster.id });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.every(
        (e: { domain: { industry: { cluster: { name: string } } } }) =>
          e.domain.industry.cluster.name === "Information Technology & Digital"
      )
    ).toBe(true);
  });

  it("respects pagination params", async () => {
    const res = await authRequest(app).get("/api/v1/career-library").query({ page: 2, pageSize: 5 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination).toMatchObject({ page: 2, pageSize: 5 });
  });

  it("rejects an out-of-range pageSize with 400", async () => {
    const res = await authRequest(app).get("/api/v1/career-library").query({ pageSize: 1000 });

    expect(res.status).toBe(400);
  });

  it("returns taxonomy-backed filter option lists ({id,name} per level)", async () => {
    const res = await authRequest(app).get("/api/v1/career-library/filters");

    expect(res.status).toBe(200);
    expect(
      res.body.clusters.some((c: { name: string }) => c.name === "Information Technology & Digital")
    ).toBe(true);
    expect(
      res.body.industries.some(
        (i: { name: string; clusterId: string }) =>
          i.name === "Data Science & Artificial Intelligence" && typeof i.clusterId === "string"
      )
    ).toBe(true);
    expect(res.body.aiResilienceGrades).toEqual(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);
  });

  it("gets a single entry by id with related UG institutions/courses/entrance exams", async () => {
    const list = await authRequest(app).get("/api/v1/career-library").query({ search: "Data Scientist" });
    const id = list.body.data.find((e: { jobRole: string }) => e.jobRole === "Data Scientist").id;

    const res = await authRequest(app).get(`/api/v1/career-library/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.jobRole).toBe("Data Scientist");
    // Classification is now the nested taxonomy chain, not flat strings.
    expect(res.body.domain.industry.cluster.name).toBeTruthy();
    expect(Array.isArray(res.body.relatedInstitutions)).toBe(true);
    expect(res.body.relatedInstitutions.length).toBeGreaterThan(0);
    expect(
      res.body.relatedInstitutions.every(
        (i: { industry: string }) => i.industry === res.body.domain.industry.name
      )
    ).toBe(true);
    expect(Array.isArray(res.body.relatedCourses)).toBe(true);
    expect(res.body.relatedCourses.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.relatedEntranceExams)).toBe(true);
    expect(res.body.relatedEntranceExams.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await authRequest(app).get("/api/v1/career-library/cknownid0000000000000000");

    expect(res.status).toBe(404);
  });
});
