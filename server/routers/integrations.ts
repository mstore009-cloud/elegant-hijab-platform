import { assertPermission } from "../access/authorization";
import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createOAuthState,
  getCatalogConnection,
  getOneDriveConnection,
  selectCatalogRoot,
} from "../integrations/onedrive/db";
import { listCatalogRootFolders } from "../integrations/onedrive/catalog";
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
  catalogSelectionStatus: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await getCatalogConnection(ctx.user.id);
    return connection
      ? {
        connected: true,
        status: connection.status,
        selectedFolderName: connection.selectedFolderName,
        lastError: connection.lastError,
      }
      : { connected: false, status: "not_connected" as const, selectedFolderName: null, lastError: null };
  }),
  beginCatalogSelection: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const state = randomBytes(32).toString("base64url");
    const pkce = createPkcePair();
    await createOAuthState({
      state,
      userId: ctx.user.id,
      codeVerifier: pkce.verifier,
      flow: "catalog_read",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return {
      authorizationUrl: createOneDriveAuthorizationUrl({ state, codeChallenge: pkce.challenge, flow: "catalog_read" }),
    };
  }),
  catalogRootFolders: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await getCatalogConnection(ctx.user.id);
    if (!connection) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لم يبدأ تفويض قراءة Catalog بعد." });
    if (connection.status === "failed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: connection.lastError ?? "فشل تفويض Catalog." });
    return listCatalogRootFolders(connection.encryptedAccessToken);
  }),
  selectCatalogRoot: protectedProcedure.input(z.object({ folderId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await getCatalogConnection(ctx.user.id);
    if (!connection) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لم يبدأ تفويض قراءة Catalog بعد." });
    const folders = await listCatalogRootFolders(connection.encryptedAccessToken);
    const catalogFolder = folders.find(folder => folder.id === input.folderId && folder.name === "Catalog");
    if (!catalogFolder || !catalogFolder.driveId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "اختر مجلد الجذر المسمى Catalog فقط لهذه التجربة." });
    }
    await selectCatalogRoot({
      userId: ctx.user.id,
      driveId: catalogFolder.driveId,
      folderId: catalogFolder.id,
      folderName: catalogFolder.name,
    });
    return { selectedFolderName: catalogFolder.name };
  }),
});
