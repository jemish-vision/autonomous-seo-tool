/**
 * Single shared PrismaClient for the whole API process, on the "api" pool profile (10 connections
 * over the 6543 transaction pooler — see db/src/client.ts for the budget rationale).
 *
 * Every read module imports `prisma` from here rather than creating its own client, so the
 * connection pool is never multiplied across modules.
 */
import { createPrismaClient } from "./src/client.js";

export const prisma = createPrismaClient("api");
