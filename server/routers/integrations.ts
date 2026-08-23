import { assertPermission } from "../access/authorization";
import { randomBytes } from "crypto";
import { createOAuthState, getOneDriveConnection } from "../integrations/onedrive/db";
import { createOneDriveAuthorizationUrl, createPkcePair } from "../integrations/onedrive/oauth";
import { protectedProcedure, router } from "../_core/trpc";

export const integrationsRouter = router({
  oneDriveStatus: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await getOneDriveConnection(ctx.user.id);
    return connection
      ? { configured: true, state: "ready" as const, message: "تم ربط مجلد التطبيق الخاص بالمنصة في OneDrive.", checkedAt: Date.now(), appFolderUrl: connection.appFolderUrl }
      : { configured: false, state: "not_configured" as const, message: "لم تمنح حسابك موافقة OneDrive بعد. سيُطلب الوصول إلى مجلد المنصة فقط.", checkedAt: Date.now(), appFolderUrl: null };
  }),
  beginOneDriveConnect: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const state = randomBytes(32).toString("base64url");
    const pkce = createPkcePair();
    await createOAuthState({ state, userId: ctx.user.id, codeVerifier: pkce.verifier, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    return { authorizationUrl: createOneDriveAuthorizationUrl({ state, codeChallenge: pkce.challenge }) };
  }),
});
