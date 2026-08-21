import { randomUUID } from "node:crypto";
import { loadEnv } from "../env.js";
import { createDirectPrismaClient } from "../client.js";
import { SYSTEM_USER_ID, ensureSystemUser } from "../seed.js";

/**
 * Prisma connects as the table owner and BYPASSES RLS (PLAN-02-Data-Model.md §6.4) — RLS in this
 * schema only protects the browser's direct PostgREST access with the publishable key. For
 * server-side code (this package, the crawl workers, any future Express API) the real enforcement
 * boundary is `projectId` in every WHERE clause, by hand, in code review. This test proves that
 * boundary actually holds for a Prisma query shaped the way real code would write it, and — by
 * running the SAME query without the scope — proves the leak IS there if you forget it, which is
 * the whole point: RLS will not catch a missing scope on this connection.
 */
async function main(): Promise<void> {
  loadEnv();
  const prisma = createDirectPrismaClient();
  const tag = `tenant-scope-test-${randomUUID().slice(0, 8)}`;
  let failed = false;

  try {
    await ensureSystemUser(prisma);

    const projectA = await prisma.project.create({
      data: { ownerId: SYSTEM_USER_ID, name: tag + "-A", slug: tag + "-a" },
    });
    const projectB = await prisma.project.create({
      data: { ownerId: SYSTEM_USER_ID, name: tag + "-B", slug: tag + "-b" },
    });
    const siteA = await prisma.site.create({
      data: { projectId: projectA.id, label: "A", startUrl: "https://a.example/", host: "a.example" },
    });
    const siteB = await prisma.site.create({
      data: { projectId: projectB.id, label: "B", startUrl: "https://b.example/", host: "b.example" },
    });
    const crawlA = await prisma.crawl.create({
      data: {
        projectId: projectA.id,
        siteId: siteA.id,
        slug: "tenant-test",
        startUrl: "https://a.example/",
        config: {},
        configHash: "0".repeat(64),
        extractorVersion: "test",
      },
    });
    const crawlB = await prisma.crawl.create({
      data: {
        projectId: projectB.id,
        siteId: siteB.id,
        slug: "tenant-test",
        startUrl: "https://b.example/",
        config: {},
        configHash: "1".repeat(64),
        extractorVersion: "test",
      },
    });
    const pageA = await prisma.page.create({
      data: {
        crawlId: crawlA.id,
        projectId: projectA.id,
        pageKey: "aaaaaaaaaaaa",
        url: "https://a.example/secret-a",
        normalizedUrl: "https://a.example/secret-a",
        urlPath: "/secret-a",
        host: "a.example",
        urlLength: 20,
        fetchedAt: new Date(),
      },
    });
    const pageB = await prisma.page.create({
      data: {
        crawlId: crawlB.id,
        projectId: projectB.id,
        pageKey: "bbbbbbbbbbbb",
        url: "https://b.example/secret-b",
        normalizedUrl: "https://b.example/secret-b",
        urlPath: "/secret-b",
        host: "b.example",
        urlLength: 20,
        fetchedAt: new Date(),
      },
    });

    // Properly scoped, the way real server code must write it.
    const scopedToA = await prisma.page.findMany({ where: { projectId: projectA.id, pageKey: pageB.pageKey } });
    const positiveControl = await prisma.page.findMany({ where: { projectId: projectA.id, pageKey: pageA.pageKey } });

    // The same lookup WITHOUT the projectId scope — the exact mistake the brief warns about.
    const unscopedLeak = await prisma.page.findMany({ where: { pageKey: pageB.pageKey } });

    console.log(`Scoped query for project A, searching for project B's pageKey: ${scopedToA.length} rows (expect 0)`);
    console.log(`Positive control — project A's own page found under its own scope: ${positiveControl.length} rows (expect 1)`);
    console.log(`Unscoped query for the same pageKey (no projectId filter): ${unscopedLeak.length} rows (expect 1 — this is the leak a missing scope produces)`);

    if (scopedToA.length !== 0) {
      failed = true;
      console.error("FAIL: cross-tenant read leaked through a projectId-scoped query.");
    } else {
      console.log("PASS: cross-tenant read correctly returns nothing when projectId is scoped in code.");
    }
    if (positiveControl.length !== 1) {
      failed = true;
      console.error("FAIL: positive control did not find the tenant's own page — test setup is broken.");
    }
    if (unscopedLeak.length !== 1) {
      failed = true;
      console.error("FAIL: expected the unscoped query to demonstrate the leak (1 row) — got a different count.");
    } else {
      console.log("CONFIRMED: an unscoped query on this connection DOES cross tenants — projectId-in-code is the only boundary here.");
    }

    await prisma.project.delete({ where: { id: projectA.id } });
    await prisma.project.delete({ where: { id: projectB.id } });
    console.log("Test fixtures cleaned up.");
  } finally {
    await prisma.$disconnect();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
