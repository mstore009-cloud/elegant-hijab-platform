import { and, eq, gt, isNull } from "drizzle-orm";
import { oneDriveCatalogConnections, oneDriveConnections, oneDriveOAuthStates } from "../../../drizzle/schema";
import { getDb } from "../../db";

export async function createOAuthState(input: {
  state: string;
  userId: number;
  storeId: number;
  appConfigId: number;
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
  storeId: number;
  appConfigId: number;
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
      userId: input.userId,
      appConfigId: input.appConfigId,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      appFolderId: input.appFolderId,
      appFolderUrl: input.appFolderUrl,
      scope: input.scope,
    },
  });
}

export async function getOneDriveConnection(storeId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(oneDriveConnections).where(eq(oneDriveConnections.storeId, storeId)).limit(1);
  return result[0] ?? null;
}

export async function upsertCatalogConnection(input: {
  userId: number;
  storeId: number;
  appConfigId: number;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(oneDriveCatalogConnections).values({ ...input, status: "connected", lastError: null }).onDuplicateKeyUpdate({
    set: {
      userId: input.userId,
      appConfigId: input.appConfigId,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scope: input.scope,
      status: "connected",
      lastError: null,
      selectedDriveId: null,
      selectedFolderId: null,
      selectedFolderName: null,
      selectedFolderPath: null,
    },
  });
}

export async function refreshCatalogConnectionTokens(input: {
  storeId: number;
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
  }).where(eq(oneDriveCatalogConnections.storeId, input.storeId));
}

export async function markCatalogConnectionFailed(storeId: number, lastError: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(oneDriveCatalogConnections).set({ status: "failed", lastError }).where(eq(oneDriveCatalogConnections.storeId, storeId));
}

export async function requireCatalogReauthorization(storeId: number, reason = "تغير إعداد تطبيق Microsoft؛ أعد تفويض OneDrive بالتطبيق الحالي.") {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(oneDriveCatalogConnections).set({
    status: "failed",
    lastError: reason,
    selectedDriveId: null,
    selectedFolderId: null,
    selectedFolderName: null,
    selectedFolderPath: null,
  }).where(eq(oneDriveCatalogConnections.storeId, storeId));
}

export async function selectCatalogRoot(input: { storeId: number; driveId: string; folderId: string; folderName: string; folderPath: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(oneDriveCatalogConnections).set({
    status: "catalog_selected",
    lastError: null,
    selectedDriveId: input.driveId,
    selectedFolderId: input.folderId,
    selectedFolderName: input.folderName,
    selectedFolderPath: input.folderPath,
  }).where(eq(oneDriveCatalogConnections.storeId, input.storeId));
}

export async function getCatalogConnection(storeId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(oneDriveCatalogConnections).where(eq(oneDriveCatalogConnections.storeId, storeId)).limit(1);
  return result[0] ?? null;
}
