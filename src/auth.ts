import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.AUTH_DB_PATH
  ? resolve(process.env.AUTH_DB_PATH)
  : resolve(__dirname, "..", "data", "auth.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

if (!process.env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "BETTER_AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 32",
  );
}

const authConfig = {
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 4010}`,
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-please-32chars",
  database: {
    dialect: new LibsqlDialect({ url: `file:${DB_PATH}` }),
    type: "sqlite" as const,
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "http://localhost:5173,http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export const auth = betterAuth(authConfig);

export async function runAuthMigrations(): Promise<void> {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authConfig);
  if (toBeCreated.length === 0 && toBeAdded.length === 0) return;
  await runMigrations();
  console.log(
    `auth: applied migrations (created ${toBeCreated.length} table(s), added ${toBeAdded.length} field(s))`,
  );
}

export async function getCurrentUser(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

export type AuthUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
