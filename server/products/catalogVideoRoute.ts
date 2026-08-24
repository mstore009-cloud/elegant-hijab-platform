import type { Express, Request, Response } from "express";
import { Readable } from "stream";
import { assertPermission } from "../access/authorization";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { listCatalogChildren, openCatalogVideoStream } from "../integrations/onedrive/catalog";
import { sdk } from "../_core/sdk";
import { getProductMedia, getProductWithVariants } from "./db";

function positiveId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerCatalogVideoPlaybackRoute(app: Express) {
  app.get("/api/products/:productId/media/:mediaId/video", async (req: Request, res: Response) => {
    try {
      const productId = positiveId(req.params.productId);
      const mediaId = positiveId(req.params.mediaId);
      if (!productId || !mediaId) return res.status(400).json({ error: "معرف الفيديو غير صالح." });
      const product = await getProductWithVariants(productId);
      if (!product) return res.status(404).json({ error: "المنتج غير موجود." });
      const user = await sdk.authenticateRequest(req);
      if (product.product.status !== "active") {
        if (!user) return res.status(401).json({ error: "يجب تسجيل الدخول لتشغيل فيديو المنتج." });
        await assertPermission(user, "products.inventory.update");
      }
      const media = (await getProductMedia(productId)).find(item => item.id === mediaId && item.source === "onedrive" && item.mediaType === "video" && Boolean(item.originalFileName));
      if (!media) return res.status(404).json({ error: "فيديو Catalog غير موجود لهذا المنتج." });
      const ownerUserId = user?.id ?? product.product.createdByUserId;
      const connection = await getUsableCatalogConnection(ownerUserId);
      if (!connection?.selectedDriveId || !connection.selectedFolderId) return res.status(412).json({ error: "مرجع Catalog غير متاح لتشغيل الفيديو." });
      const groups = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: connection.selectedFolderId });
      const group = groups.find(item => item.kind === "folder" && item.name === product.product.category);
      if (!group) return res.status(404).json({ error: "لم توجد مجموعة المنتج في Catalog." });
      const folders = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: group.id });
      const folder = folders.find(item => item.kind === "folder" && item.name === product.product.productCode);
      if (!folder) return res.status(404).json({ error: "لم يوجد مجلد المنتج في Catalog." });
      const files = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: folder.id });
      const source = files.find(item => item.kind === "file" && item.name === media.originalFileName);
      if (!source) return res.status(404).json({ error: "لم يوجد ملف الفيديو في Catalog." });
      const upstream = await openCatalogVideoStream({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, fileId: source.id, range: typeof req.headers.range === "string" ? req.headers.range : undefined });
      res.status(upstream.status);
      for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body as never).pipe(res);
    } catch (error) {
      if (!res.headersSent) res.status(502).json({ error: error instanceof Error ? error.message : "تعذر تشغيل فيديو المنتج." });
    }
  });
}
