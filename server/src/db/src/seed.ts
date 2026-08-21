import type { PrismaClient } from "../generated/client/index.js";

/** Deterministic system user — no real auth flow exists yet; imported/synced runs need an owner. */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
export const SYSTEM_USER_EMAIL = "system@seo-platform.local";

export async function ensureSystemUser(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: {},
    create: { id: SYSTEM_USER_ID, email: SYSTEM_USER_EMAIL, displayName: "System (crawler sync)" },
  });
}

/** One Project+Site per host, upserted idempotently. Used by both the sync adapter and importer. */
export async function ensureProjectAndSite(
  prisma: PrismaClient,
  host: string,
  label: string,
): Promise<{ projectId: string; siteId: string }> {
  await ensureSystemUser(prisma);
  const slug = host.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 100);

  const project = await prisma.project.upsert({
    where: { ownerId_slug: { ownerId: SYSTEM_USER_ID, slug } },
    update: {},
    create: { ownerId: SYSTEM_USER_ID, name: label, slug },
  });

  const site = await prisma.site.upsert({
    where: { projectId_host_role: { projectId: project.id, host, role: "PRIMARY" } },
    update: {},
    create: { projectId: project.id, role: "PRIMARY", label, startUrl: `https://${host}/`, host },
  });

  return { projectId: project.id, siteId: site.id };
}
