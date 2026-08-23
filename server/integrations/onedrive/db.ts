import { and, eq, gt, isNull } from "drizzle-orm";
import { oneDriveConnections, oneDriveOAuthStates } from "../../../drizzle/schema";
import { getDb } from "../../db";

export async function createOAuthState(input: { state: string; userId: number; codeVerifier: string; expiresAt: Date }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(oneDriveOAuthStates).values(input);
}

export async function consumeOAuthState(state: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const result = await db
    .select()
    .from(oneDriveOAuthStates)
    .where(and(eq(oneDriveOAuthStates.state, state), isNull(oneDriveOAuthStates.usedAt), gt(oneDriveOAuthStates.expiresAt, new Date())))
    .limit(1);
  const item = result[0];
  if (!item) return null;
  await db.update(oneDriveOAuthStates).set({ usedAt: new Date() }).where(eq(oneDriveOAuthStates.id, item.id));
  return item;
}

export async function upsertOneDriveConnection(input: {
  userId: number;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: Date;
  appFolderId: string;
  appFolderUrl: string | null;
  scope: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(oneDriveConnections).values(input).onDuplicateKeyUpdate({
    set: {
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      appFolderId: input.appFolderId,
      appFolderUrl: input.appFolderUrl,
      scope: input.scope,
    },
  });
}

export async function getOneDriveConnection(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(oneDriveConnections).where(eq(oneDriveConnections.userId, userId)).limit(1);
  return result[0] ?? null;
}
