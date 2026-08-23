import { getCatalogConnection, refreshCatalogConnectionTokens } from "./db";
import { refreshOneDriveToken } from "./oauth";
import { decryptOneDriveToken, encryptOneDriveToken } from "./tokenCipher";

const REFRESH_WINDOW_MS = 2 * 60 * 1000;

/** Returns a Catalog connection with a usable encrypted access token; selected root fields are preserved. */
export async function getUsableCatalogConnection(userId: number) {
  const connection = await getCatalogConnection(userId);
  if (!connection) return null;
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + REFRESH_WINDOW_MS) return connection;

  const refreshed = await refreshOneDriveToken({
    refreshToken: decryptOneDriveToken(connection.encryptedRefreshToken),
  });
  const encryptedAccessToken = encryptOneDriveToken(refreshed.accessToken);
  const encryptedRefreshToken = encryptOneDriveToken(refreshed.refreshToken);
  const accessTokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
  await refreshCatalogConnectionTokens({
    userId,
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
