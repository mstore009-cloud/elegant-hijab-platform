import type { Express } from "express";
import { consumeOAuthState, upsertCatalogConnection, upsertOneDriveConnection } from "./db";
import { exchangeOneDriveCode, getOneDriveAppFolder } from "./oauth";
import { encryptOneDriveToken } from "./tokenCipher";

/**
 * Registered with Microsoft before the token-exchange workflow is enabled.
 * It intentionally never exposes an authorization code or token in the page.
 */
export function registerOneDriveOAuthRoutes(app: Express) {
  app.get("/api/onedrive/callback", async (req, res) => {
    const providerError = typeof req.query.error === "string" ? req.query.error : null;

    if (providerError) {
      res.status(400).send("تم إلغاء أو رفض تفويض OneDrive. يمكنك إغلاق هذه الصفحة والعودة إلى المنصة.");
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
      res.status(400).send("استجابة OneDrive غير مكتملة. يمكنك إغلاق هذه الصفحة والبدء من المنصة مرة أخرى.");
      return;
    }
    try {
      const oauthState = await consumeOAuthState(state);
      if (!oauthState) {
        res.status(400).send("انتهت صلاحية جلسة الربط أو استُخدمت سابقًا. عد إلى المنصة وابدأ التفويض من جديد.");
        return;
      }
      if (!oauthState.storeId) {
        res.status(400).send("جلسة ربط OneDrive قديمة لا تحدد متجرًا. أغلق هذه الصفحة وابدأ الربط من إعدادات المتجر مرة أخرى.");
        return;
      }
      const token = await exchangeOneDriveCode({ code, codeVerifier: oauthState.codeVerifier });
      if (oauthState.flow === "catalog_read") {
        await upsertCatalogConnection({
          userId: oauthState.userId,
          storeId: oauthState.storeId,
          encryptedAccessToken: encryptOneDriveToken(token.accessToken),
          encryptedRefreshToken: encryptOneDriveToken(token.refreshToken),
          accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
          scope: token.scope,
        });
        res.status(200).send("تم تفويض قراءة OneDrive لتجربة اختيار Catalog. لم تُستورد أي ملفات ولم تُحفظ كلمة المرور. أغلق هذه الصفحة وعد إلى شاشة المنتجات لاختيار الجذر.");
        return;
      }
      const appFolder = await getOneDriveAppFolder(token.accessToken);
      await upsertOneDriveConnection({
        userId: oauthState.userId,
        storeId: oauthState.storeId,
        encryptedAccessToken: encryptOneDriveToken(token.accessToken),
        encryptedRefreshToken: encryptOneDriveToken(token.refreshToken),
        accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
        appFolderId: appFolder.id,
        appFolderUrl: appFolder.webUrl,
        scope: token.scope,
      });
      res.status(200).send("تم ربط OneDrive بنجاح. الوصول مقصور على مجلد التطبيق الخاص بالمنصة. يمكنك إغلاق هذه الصفحة والعودة إلى شاشة المنتجات.");
    } catch (error) {
      console.error("[OneDrive OAuth] Callback failed", error);
      res.status(500).send("تعذر إكمال ربط OneDrive. لم تُستورد أي ملفات. عد إلى المنصة وحاول مرة أخرى بعد مراجعة الإعدادات.");
    }
  });
}
