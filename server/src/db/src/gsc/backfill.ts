/**
 * One-time / repeatable backfill: copies the dashboard's flat-JSON GSC state
 * (poc/seo-dashboard/storage/gsc/<userId>/<domain>/*.json) into Postgres.
 *
 * The DB is the intended store, but a server process that started before the DB
 * was ready (or before this package built) keeps serving from the JSON fallback
 * — and that JSON state (OAuth connection, linked property, metrics) was never
 * in the DB. Without this, flipping a fresh server to the DB backend would make
 * the dashboard look disconnected (empty connection/property tables) even though
 * the inspection data is there.
 *
 * Direction rules (safety):
 *  - connection / property / metrics: upsert/replace from JSON when the JSON
 *    file exists — JSON is the only copy of those.
 *  - inspections: only written when the JSON file has rows. When it's empty the
 *    DB keeps what it has (the reference export was imported straight into the
 *    DB, so the DB is the fuller copy for inspections).
 *
 * Usage:
 *   npm run gsc:backfill-json -- [gscRootDir]
 *   (default gscRoot: ../../poc/seo-dashboard/storage/gsc relative to packages/db)
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../env.js";
import { createPrismaClient } from "../client.js";
import {
  gscWriteConnection,
  gscWriteLinkedProperty,
  gscWriteMetrics,
  gscWriteInspections,
} from "./store.js";
import type {
  GscConnectionRow,
  GscLinkedPropertyRow,
  GscMetricsBundle,
  GscInspectionsBundle,
} from "./store.js";

export interface BackfillSummary {
  users: number;
  connections: number;
  properties: number;
  metrics: number;
  inspectionsWritten: number;
  inspectionsSkipped: string[];
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function backfillJsonGscState(gscRoot: string): Promise<BackfillSummary> {
  const prisma = createPrismaClient("importer");
  const summary: BackfillSummary = { users: 0, connections: 0, properties: 0, metrics: 0, inspectionsWritten: 0, inspectionsSkipped: [] };
  try {
    let userIds: string[];
    try {
      userIds = (await readdir(gscRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      throw new Error(`gsc root not found: ${gscRoot}`);
    }

    for (const userId of userIds) {
      const userRoot = path.join(gscRoot, userId);
      summary.users++;

      const connection = await readJson<GscConnectionRow>(path.join(userRoot, "connection.json"));
      if (connection) {
        await gscWriteConnection(prisma, connection);
        summary.connections++;
      }

      let domains: string[];
      try {
        domains = (await readdir(userRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        domains = [];
      }

      for (const domain of domains) {
        const domainRoot = path.join(userRoot, domain);

        const property = await readJson<GscLinkedPropertyRow>(path.join(domainRoot, "property.json"));
        if (property) {
          await gscWriteLinkedProperty(prisma, { ...property, userId });
          summary.properties++;
        }

        const metrics = await readJson<GscMetricsBundle>(path.join(domainRoot, "metrics.json"));
        if (metrics) {
          await gscWriteMetrics(prisma, userId, domain, metrics);
          summary.metrics++;
        }

        const inspections = await readJson<GscInspectionsBundle>(path.join(domainRoot, "inspections.json"));
        if (inspections && inspections.rows.length > 0) {
          await gscWriteInspections(prisma, userId, domain, inspections);
          summary.inspectionsWritten += inspections.rows.length;
        } else if (inspections) {
          summary.inspectionsSkipped.push(`${userId}/${domain}`);
        }
      }
    }
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
