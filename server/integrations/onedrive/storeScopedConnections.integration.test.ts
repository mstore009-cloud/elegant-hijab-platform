import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { oneDriveCatalogConnections, oneDriveConnections, stores, users } from "../../../drizzle/schema";
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

    await upsertCatalogConnection({
      userId,
      storeId: firstStoreId,
      encryptedAccessToken: "encrypted-first-access",
      encryptedRefreshToken: "encrypted-first-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scope: "Files.Read",
    });
    await upsertCatalogConnection({
      userId,
      storeId: secondStoreId,
      encryptedAccessToken: "encrypted-second-access",
      encryptedRefreshToken: "encrypted-second-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scope: "Files.Read",
    });
    await selectCatalogRoot({ storeId: firstStoreId, driveId: "drive-first", folderId: "folder-first", folderName: "جذر المتجر الأول" });
    await upsertOneDriveConnection({
      userId,
      storeId: firstStoreId,
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

    expect(firstCatalog).toMatchObject({ storeId: firstStoreId, selectedFolderId: "folder-first", selectedFolderName: "جذر المتجر الأول" });
    expect(secondCatalog).toMatchObject({ storeId: secondStoreId, selectedFolderId: null, selectedFolderName: null, status: "connected" });
    expect(firstAppFolder).toMatchObject({ storeId: firstStoreId, appFolderId: "app-folder-first" });
    expect(secondAppFolder).toBeNull();
    expect(firstCatalog?.encryptedAccessToken).not.toBe(secondCatalog?.encryptedAccessToken);
  }, 15_000);
});
