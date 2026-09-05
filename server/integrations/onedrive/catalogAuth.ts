import { getCatalogConnection, markCatalogConnectionFailed, refreshCatalogConnectionTokens } from "./db";
import { refreshOneDriveToken } from "./oauth";
import { getStoreOneDriveAppSettings } from "./appSettings";
import { decryptOneDriveToken, encryptOneDriveToken } from "./tokenCipher";

const REFRESH_WINDOW_MS = 2 * 60 * 1000;

export function oneDriveRefreshFailureMessage(detail: string) {
  return /different client id|AADSTS70000|refresh_token.*not valid/i.test(detail)
    ? "رمز OneDrive مرتبط بتطبيق Microsoft سابق. احفظ إعداد التطبيق الحالي ثم أعد تفويض OneDrive."
    : "تعذر تجديد اتصال OneDrive. أعد تفويض OneDrive ثم حاول مرة أخرى.";
}

/** Returns a store-scoped Catalog connection with a usable encrypted access token; selected root fields are preserved. */
export async function getUsableCatalogConnection(storeId: number) {
  const connection = await getCatalogConnection(storeId);
  if (!connection) return null;
  if (!connection.appConfigId) throw new Error("اتصال OneDrive قديم لا يرتبط بإعداد Microsoft لهذا المتجر. احفظ الإعداد وأعد التفويض.");
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + REFRESH_WINDOW_MS) return connection;
  const application = await getStoreOneDriveAppSettings(storeId, connection.appConfigId);

  let refreshed: Awaited<ReturnType<typeof refreshOneDriveToken>>;
  try {
    refreshed = await refreshOneDriveToken({
      refreshToken: decryptOneDriveToken(connection.encryptedRefreshToken),
      application,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const message = oneDriveRefreshFailureMessage(detail);
    await markCatalogConnectionFailed(storeId, message);
    throw new Error(message);
  }
  const encryptedAccessToken = encryptOneDriveToken(refreshed.accessToken);
  const encryptedRefreshToken = encryptOneDriveToken(refreshed.refreshToken);
  const accessTokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
  await refreshCatalogConnectionTokens({
    storeId,
    encryptedAccessToken,
    encryptedRefreshToken,
    accessTokenExpiresAt,
    scope: refreshed.scope || connection.scope,
  });
  return {
    ...connection,
    encryptedAccessToken,
    encryptedRefreshToken,
    accessTokenExpiresAt,
    scope: refreshed.scope || connection.scope,
  };
}
