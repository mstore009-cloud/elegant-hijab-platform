import { and, eq, gt, isNull } from "drizzle-orm";
import { oneDriveCatalogConnections, oneDriveConnections, oneDriveOAuthStates } from "../../../drizzle/schema";
import { getDb } from "../../db";

export async function createOAuthState(input: {
  state: string;
  userId: number;
  codeVerifier: string;
  flow?: "app_folder" | "catalog_read";
  expiresAt: Date;
}) {
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

export async function upsertCatalogConnection(input: {
  userId: number;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(oneDriveCatalogConnections).values({ ...input, status: "connected", lastError: null }).onDuplicateKeyUpdate({
    set: {
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scope: input.scope,
      status: "connected",
      lastError: null,
      selectedDriveId: null,
      selectedFolderId: null,
      selectedFolderName: null,
    },
  });
}

export async function refreshCatalogConnectionTokens(input: {
  userId: number;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(oneDriveCatalogConnections).set({
    encryptedAccessToken: input.encryptedAccessToken,
    encryptedRefreshToken: input.encryptedRefreshToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    scope: input.scope,
    lastError: null,
  }).where(eq(oneDriveCatalogConnections.userId, input.userId));
}

export async function markCatalogConnectionFailed(userId: number, lastError: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(oneDriveCatalogConnections).set({ status: "failed", lastError }).where(eq(oneDriveCatalogConnections.userId, userId));
}

export async function selectCatalogRoot(input: { userId: number; driveId: string; folderId: string; folderName: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(oneDriveCatalogConnections).set({
    status: "catalog_selected",
    lastError: null,
    selectedDriveId: input.driveId,
    selectedFolderId: input.folderId,
    selectedFolderName: input.folderName,
  }).where(eq(oneDriveCatalogConnections.userId, input.userId));
}

export async function getCatalogConnection(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(oneDriveCatalogConnections).where(eq(oneDriveCatalogConnections.userId, userId)).limit(1);
  return result[0] ?? null;
}
