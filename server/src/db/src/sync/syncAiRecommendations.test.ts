import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncAiRecommendations } from "./syncAiRecommendations.js";

const CRAWL_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const PAGE_ID = "33333333-3333-3333-3333-333333333333";
const ISSUE_TITLE = "44444444-4444-4444-4444-444444444444";
const ISSUE_IMG = "55555555-5555-5555-5555-555555555555";

interface UpsertCall {
  where: { issueId_instanceKey: { issueId: string; instanceKey: string } };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}

function makeMockPrisma() {
  const upsert = vi.fn(async (args: UpsertCall) => ({ id: "rec-id" }));
  const prisma = {
    crawl: {
      findFirst: vi.fn(async () => ({
        id: CRAWL_ID,
        projectId: PROJECT_ID,
        slug: "example.com-20260817-120000",
      })),
      // Stamps the aiRecsGeneratedAt "generation ran" marker at the end of a successful sync.
      update: vi.fn(async () => ({ id: CRAWL_ID })),
    },
    page: {
      findMany: vi.fn(async () => [{ id: PAGE_ID, pageKey: "abc123def456" }]),
    },
    issue: {
      findMany: vi.fn(async () => [
        {
          id: ISSUE_TITLE,
          ruleSlug: "title-too-long",
          pageId: PAGE_ID,
          evidencePaths: [],
        },
        {
          id: ISSUE_IMG,
          ruleSlug: "image-missing-alt",
          pageId: PAGE_ID,
          evidencePaths: ["images[3].alt", "images[7].alt"],
        },
      ]),
    },
    aiRecommendation: { count: vi.fn(async () => 0), upsert },
  };
  return { prisma: prisma as any, upsert };
}

async function writeReport(runDir: string, recommendations: unknown[]): Promise<string> {
  await writeFile(
    path.join(runDir, "ai-recommendations.json"),
    JSON.stringify({ runId: "example.com-20260817-120000", recommendations }),
  );
  return path.join(runDir, "ai-recommendations.json");
}

describe("syncAiRecommendations", () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "ai-sync-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("upserts a single-instance recommendation linked via ruleSlug+pageKey", async () => {
    const { prisma, upsert } = makeMockPrisma();
    await writeReport(runDir, [
      {
        issueRuleId: "title-too-long",
        category: "title",
        url: "https://example.com/",
        pageId: "abc123def456",
        instanceKey: null,
        model: "gemini-2.0-flash",
        promptVersion: "v2",
        whatIsWrong: "Title is 72 chars.",
        currentValue: "Old title",
        recommendedValue: "New title",
        recommendedValuePlain: "New title",
        whyThisValue: "Shorter.",
        basedOn: [{ field: "title", value: "Old title" }],
        howToApply: "Replace the <title>.",
        confidence: 0.9,
        selfReportedConfidence: 0.95,
        needsHumanInput: false,
        needsHumanInputReason: null,
        validation: { lengthOk: true, pixelWidthOk: true, noInventedFacts: true, schemaValid: true, bannedPatternHit: null },
        contentHash: "c0ffee",
        evidenceSig: "b0b",
      },
    ]);

    const result = await syncAiRecommendations(prisma, runDir, "example.com-20260817-120000");

    expect(result.crawlId).toBe(CRAWL_ID);
    expect(result.totalInFile).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.unlinked).toBe(0);
    expect(upsert).toHaveBeenCalledTimes(1);

    const call = upsert.mock.calls[0]![0] as UpsertCall;
    expect(call.where.issueId_instanceKey).toEqual({ issueId: ISSUE_TITLE, instanceKey: "" });
    expect(call.create).toMatchObject({
      crawlId: CRAWL_ID,
      projectId: PROJECT_ID,
      issueId: ISSUE_TITLE,
      instanceKey: "",
      ruleSlug: "title-too-long",
      pageId: PAGE_ID,
      contentHash: "c0ffee",
      evidenceSig: "b0b",
    });
  });

  it("links a multi-instance recommendation to the issue whose evidencePaths match the instanceKey", async () => {
    const { prisma, upsert } = makeMockPrisma();
    await writeReport(runDir, [
      {
        issueRuleId: "image-missing-alt",
        category: "image-alt",
        url: "https://example.com/",
        pageId: "abc123def456",
        instanceKey: "images[3]",
        model: "gemini-2.0-flash",
        promptVersion: "v2",
        whatIsWrong: "",
        currentValue: null,
        recommendedValue: "<img src=\"/a.jpg\" alt=\"Red shoes\">",
        recommendedValuePlain: "Red shoes",
        whyThisValue: "",
        basedOn: [],
        howToApply: "",
        confidence: 0.8,
        selfReportedConfidence: null,
        needsHumanInput: false,
        needsHumanInputReason: null,
        validation: {},
      },
    ]);

    const result = await syncAiRecommendations(prisma, runDir, "example.com-20260817-120000");

    expect(result.unlinked).toBe(0);
    const call = upsert.mock.calls[0]![0] as UpsertCall;
    expect(call.where.issueId_instanceKey).toEqual({ issueId: ISSUE_IMG, instanceKey: "images[3]" });
  });

  it("reports unlinked recommendations without upserting them", async () => {
    const { prisma, upsert } = makeMockPrisma();
    await writeReport(runDir, [
      {
        issueRuleId: "title-too-long",
        category: "title",
        url: "https://example.com/",
        pageId: "nope0000nope0",
        instanceKey: null,
        model: "m",
        promptVersion: "v2",
        whatIsWrong: "",
        currentValue: null,
        recommendedValue: "x",
        recommendedValuePlain: "x",
        whyThisValue: "",
        basedOn: [],
        howToApply: "",
        confidence: 0.5,
        selfReportedConfidence: null,
        needsHumanInput: false,
        needsHumanInputReason: null,
        validation: {},
      },
    ]);

    const result = await syncAiRecommendations(prisma, runDir, "example.com-20260817-120000");

    expect(result.unlinked).toBe(1);
    expect(result.inserted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    expect(result.unlinkedReasons[0]!.pageKey).toBe("nope0000nope0");
  });

  it("returns crawlId null when the crawl was never synced to Postgres", async () => {
    const { prisma } = makeMockPrisma();
    prisma.crawl.findFirst.mockResolvedValueOnce(null);
    await writeReport(runDir, [
      {
        issueRuleId: "title-too-long",
        category: "title",
        url: null,
        pageId: null,
        instanceKey: null,
        model: "m",
        promptVersion: "v2",
        whatIsWrong: "",
        currentValue: null,
        recommendedValue: "x",
        recommendedValuePlain: "x",
        whyThisValue: "",
        basedOn: [],
        howToApply: "",
        confidence: 0.5,
        selfReportedConfidence: null,
        needsHumanInput: false,
        needsHumanInputReason: null,
        validation: {},
      },
    ]);

    const result = await syncAiRecommendations(prisma, runDir, "example.com-20260817-120000");

    expect(result.crawlId).toBeNull();
    expect(result.unlinked).toBe(1);
    expect(result.unlinkedReasons[0]!.reason).toContain("not in Postgres");
  });

  it("returns a zero result when the report file is absent", async () => {
    const { prisma, upsert } = makeMockPrisma();
    const result = await syncAiRecommendations(prisma, runDir, "example.com-20260817-120000");
    expect(result.totalInFile).toBe(0);
    expect(result.unlinked).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
