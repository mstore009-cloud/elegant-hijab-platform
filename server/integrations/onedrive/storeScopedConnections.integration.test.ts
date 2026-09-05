import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { oneDriveAppConfigs, oneDriveCatalogConnections, oneDriveConnections, stores, users } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getCatalogConnection, getOneDriveConnection, selectCatalogRoot, upsertCatalogConnection, upsertOneDriveConnection } from "./db";

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
let userId: number | undefined;
let storeIds: number[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (storeIds.length) {
    await db.delete(oneDriveCatalogConnections).where(inArray(oneDriveCatalogConnections.storeId, storeIds));
    await db.delete(oneDriveConnections).where(inArray(oneDriveConnections.storeId, storeIds));
    await db.delete(oneDriveAppConfigs).where(inArray(oneDriveAppConfigs.storeId, storeIds));
    await db.delete(stores).where(inArray(stores.id, storeIds));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
  userId = undefined;
  storeIds = [];
});

describe("عزل اتصال OneDrive حسب المتجر", () => {
  it("يحفظ تفويض كل متجر وجذر Catalog الخاص به دون مشاركة بين متجرين يملكان المستخدم نفسه", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار عزل OneDrive.");

    const userInsert = await db.insert(users).values({ openId: `onedrive-store-${suffix}`, name: "مدير اختبار OneDrive", role: "admin" });
    userId = Number(userInsert[0].insertId);
    const first = await db.insert(stores).values({ name: "متجر OneDrive الأول", slug: `onedrive-first-${suffix}`, status: "active", primaryOwnerUserId: userId });
    const second = await db.insert(stores).values({ name: "متجر OneDrive الثاني", slug: `onedrive-second-${suffix}`, status: "active", primaryOwnerUserId: userId });
    const firstStoreId = Number(first[0].insertId);
    const secondStoreId = Number(second[0].insertId);
    storeIds = [firstStoreId, secondStoreId];

    const firstConfig = await db.insert(oneDriveAppConfigs).values({
      storeId: firstStoreId,
      clientId: "11111111-2222-4333-8aaa-123456789abc",
      encryptedClientSecret: "encrypted-first-secret",
      authority: "consumers",
      publicBaseUrl: "https://first.example.com",
      redirectUri: "https://first.example.com/api/onedrive/callback",
      createdByUserId: userId,
      updatedByUserId: userId,
    });
    const secondConfig = await db.insert(oneDriveAppConfigs).values({
      storeId: secondStoreId,
      clientId: "22222222-3333-4444-8bbb-123456789abc",
      encryptedClientSecret: "encrypted-second-secret",
      authority: "organizations",
      publicBaseUrl: "https://second.example.com",
      redirectUri: "https://second.example.com/api/onedrive/callback",
      createdByUserId: userId,
      updatedByUserId: userId,
    });
    const firstConfigId = Number(firstConfig[0].insertId);
    const secondConfigId = Number(secondConfig[0].insertId);

    await upsertCatalogConnection({
      userId,
      storeId: firstStoreId,
      appConfigId: firstConfigId,
      encryptedAccessToken: "encrypted-first-access",
      encryptedRefreshToken: "encrypted-first-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scope: "Files.Read",
    });
    await upsertCatalogConnection({
      userId,
      storeId: secondStoreId,
      appConfigId: secondConfigId,
      encryptedAccessToken: "encrypted-second-access",
      encryptedRefreshToken: "encrypted-second-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scope: "Files.Read",
    });
    await selectCatalogRoot({ storeId: firstStoreId, driveId: "drive-first", folderId: "folder-first", folderName: "جذر المتجر الأول", folderPath: "OneDrive/منتجات/جذر المتجر الأول" });
    await upsertOneDriveConnection({
      userId,
      storeId: firstStoreId,
      appConfigId: firstConfigId,
      encryptedAccessToken: "encrypted-app-access",
      encryptedRefreshToken: "encrypted-app-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      appFolderId: "app-folder-first",
      appFolderUrl: "https://onedrive.example/app-folder-first",
      scope: "Files.ReadWrite.AppFolder",
    });

    const [firstCatalog, secondCatalog, firstAppFolder, secondAppFolder] = await Promise.all([
      getCatalogConnection(firstStoreId),
      getCatalogConnection(secondStoreId),
      getOneDriveConnection(firstStoreId),
      getOneDriveConnection(secondStoreId),
    ]);

    expect(firstCatalog).toMatchObject({ storeId: firstStoreId, appConfigId: firstConfigId, selectedFolderId: "folder-first", selectedFolderName: "جذر المتجر الأول", selectedFolderPath: "OneDrive/منتجات/جذر المتجر الأول" });
    expect(secondCatalog).toMatchObject({ storeId: secondStoreId, appConfigId: secondConfigId, selectedFolderId: null, selectedFolderName: null, status: "connected" });
    expect(firstAppFolder).toMatchObject({ storeId: firstStoreId, appFolderId: "app-folder-first" });
    expect(secondAppFolder).toBeNull();
    expect(firstCatalog?.encryptedAccessToken).not.toBe(secondCatalog?.encryptedAccessToken);
  }, 15_000);
});
