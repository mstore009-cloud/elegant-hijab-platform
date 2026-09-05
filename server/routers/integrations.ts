import { assertPermission } from "../access/authorization";
import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createOAuthState,
  getCatalogConnection,
  getOneDriveConnection,
  requireCatalogReauthorization,
  selectCatalogRoot,
} from "../integrations/onedrive/db";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { listCatalogChildren, listCatalogFolderChildren, listCatalogRootFolders, readCatalogFileBytes, readCatalogImageDataUrl, readCatalogTextFile } from "../integrations/onedrive/catalog";
import { createSelectedCatalogDrafts, previewCatalogGroupProducts } from "../integrations/onedrive/catalogMultiDraft";
import { createOneDriveAuthorizationUrl, createPkcePair } from "../integrations/onedrive/oauth";
import { getMaskedOneDriveAppSettings, getStoreOneDriveAppSettings, oneDriveAuthorities, saveOneDriveAppSettings, testOneDriveAppSettings } from "../integrations/onedrive/appSettings";
import { flattenCategoryNodes, inspectCatalogTree } from "../integrations/onedrive/catalogTree";
import { parseCatalogProductMetadata, parseCatalogProductMetadataDocx, parseCatalogProductMetadataLenientDocx, validateApprovedImageColorLinks } from "../integrations/onedrive/productMetadata";
import { attachApprovedCatalogImageReferences, createApprovedCatalogColorVariants, createCatalogDraftProduct, listProducts } from "../products/db";
import { listProductCategories, syncOneDriveCategoryTree } from "../products/categories";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM, listLLMModels } from "../_core/llm";

async function requireSelectedCatalog(storeId: number) {
  const connection = await getUsableCatalogConnection(storeId);
  if (!connection || connection.status !== "catalog_selected" || !connection.selectedDriveId || !connection.selectedFolderId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لم يُعتمد جذر Catalog بعد." });
  }
  return connection;
}

async function readSelectedCatalogProduct(storeId: number, input: { groupId: string; productFolderId: string }) {
  const connection = await requireSelectedCatalog(storeId);
  const groups = await listCatalogChildren({
    encryptedAccessToken: connection.encryptedAccessToken,
    driveId: connection.selectedDriveId!,
    folderId: connection.selectedFolderId!,
  });
  const group = groups.find(item => item.id === input.groupId && item.kind === "folder");
  if (!group) throw new TRPCError({ code: "BAD_REQUEST", message: "المجموعة المختارة ليست ضمن جذر Catalog المعتمد." });
  const products = await listCatalogChildren({
    encryptedAccessToken: connection.encryptedAccessToken,
    driveId: connection.selectedDriveId!,
    folderId: group.id,
  });
  const productFolder = products.find(item => item.id === input.productFolderId && item.kind === "folder");
  if (!productFolder) throw new TRPCError({ code: "BAD_REQUEST", message: "مجلد المنتج المختار ليس ضمن المجموعة المحددة." });
  const contents = await listCatalogChildren({
    encryptedAccessToken: connection.encryptedAccessToken,
    driveId: connection.selectedDriveId!,
    folderId: productFolder.id,
  });
  const metadataFile = contents.find(item => item.kind === "file" && ["product.txt", "product.docx"].includes(item.name.toLowerCase()));
  let metadataText: string | null = null;
  let metadataDocxBytes: Buffer | null = null;
  if (metadataFile?.name.toLowerCase() === "product.txt") {
    metadataText = await readCatalogTextFile({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId!, fileId: metadataFile.id });
  } else if (metadataFile?.name.toLowerCase() === "product.docx") {
    metadataDocxBytes = await readCatalogFileBytes({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId!, fileId: metadataFile.id, maxBytes: 5 * 1024 * 1024 });
    const preview = await parseCatalogProductMetadataLenientDocx(metadataDocxBytes);
    metadataText = JSON.stringify({ name: preview.name, sellingPrice: preview.sellingPrice, previousPrice: preview.previousPrice ?? null, description: preview.description, sizes: preview.sizes, problems: preview.problems });
  }
  const images = contents.filter(item => item.kind === "file" && /\.(jpg|jpeg|png|webp)$/i.test(item.name));
  const documents = contents.filter(item => item.kind === "file" && !images.some(image => image.id === item.id));
  return { group, productFolder, metadataFile, metadataText, metadataDocxBytes, images, documents };
}

function requireOperationalStoreId(storeId: number | null | undefined) {
  if (!storeId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يوجد متجر تشغيلي نشط لحسابك." });
  return storeId;
}

async function previewSelectedCatalogGroup(storeId: number, groupId: string) {
  const connection = await requireSelectedCatalog(storeId);
  const groups = await listCatalogChildren({
    encryptedAccessToken: connection.encryptedAccessToken,
    driveId: connection.selectedDriveId!,
    folderId: connection.selectedFolderId!,
  });
  const group = groups.find(item => item.id === groupId && item.kind === "folder");
  if (!group) throw new TRPCError({ code: "BAD_REQUEST", message: "المجموعة المختارة ليست ضمن جذر Catalog المعتمد." });
  const [items, knownProducts] = await Promise.all([
    listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId!, folderId: group.id }),
    listProducts(storeId),
  ]);
  const entries = await previewCatalogGroupProducts({
    groupName: group.name,
    productFolders: items.filter(item => item.kind === "folder"),
    existingProductCodes: new Set(knownProducts.map(product => product.productCode)),
    readFolderContents: folderId => listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId!, folderId }),
    readMetadataText: fileId => readCatalogTextFile({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId!, fileId }),
    readMetadataDocx: async fileId => parseCatalogProductMetadataDocx(await readCatalogFileBytes({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId!, fileId, maxBytes: 5 * 1024 * 1024 })),
  });
  return { group: { id: group.id, name: group.name }, entries };
}

async function inspectSelectedCatalogTree(storeId: number) {
  const connection = await requireSelectedCatalog(storeId);
  return inspectCatalogTree({
    rootFolderId: connection.selectedFolderId!,
    rootFolderName: connection.selectedFolderName ?? "جذر المنتجات",
    listChildren: folderId => listCatalogChildren({
      encryptedAccessToken: connection.encryptedAccessToken,
      driveId: connection.selectedDriveId!,
      folderId,
    }),
  });
}

const colorAnalysisSchema = z.object({
  colorGroups: z.array(z.object({
    colorNameArabic: z.string().min(1).max(80),
    confidence: z.number().min(0).max(1),
    imageFileNames: z.array(z.string().min(1)).min(1),
    reviewNote: z.string().max(300),
  })).max(20),
  uncertainImageFileNames: z.array(z.string().min(1)).max(50),
  overallReviewNote: z.string().max(400),
});

export const integrationsRouter = router({
  oneDriveAppSettings: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return getMaskedOneDriveAppSettings(requireOperationalStoreId(ctx.operationalStore?.id));
  }),
  saveOneDriveAppSettings: protectedProcedure.input(z.object({
    clientId: z.string().min(1).max(255),
    clientSecret: z.string().max(1000).optional(),
    authority: z.enum(oneDriveAuthorities),
    publicBaseUrl: z.string().min(1).max(2048),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    return saveOneDriveAppSettings({
      storeId: requireOperationalStoreId(ctx.operationalStore?.id),
      actorUserId: ctx.user.id,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      authority: input.authority,
      publicBaseUrl: input.publicBaseUrl,
    });
  }),
  testOneDriveAppSettings: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return testOneDriveAppSettings(requireOperationalStoreId(ctx.operationalStore?.id));
  }),
  oneDriveStatus: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const connection = await getOneDriveConnection(storeId);
    return connection
      ? { configured: true, state: "ready" as const, message: "تم ربط مجلد التطبيق الخاص بالمنصة في OneDrive.", checkedAt: Date.now(), appFolderUrl: connection.appFolderUrl }
      : { configured: false, state: "not_configured" as const, message: "لم تمنح حسابك موافقة OneDrive بعد. سيُطلب الوصول إلى مجلد المنصة فقط.", checkedAt: Date.now(), appFolderUrl: null };
  }),
  beginOneDriveConnect: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const application = await getStoreOneDriveAppSettings(storeId);
    const state = randomBytes(32).toString("base64url");
    const pkce = createPkcePair();
    await createOAuthState({ state, userId: ctx.user.id, storeId, appConfigId: application.id, codeVerifier: pkce.verifier, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    return { authorizationUrl: createOneDriveAuthorizationUrl({ state, codeChallenge: pkce.challenge, application }) };
  }),
  catalogSelectionStatus: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const connection = await getCatalogConnection(storeId);
    return connection
      ? {
        connected: true,
        status: connection.status,
        requiresAppConfig: !connection.appConfigId,
        selectedFolderName: connection.selectedFolderName,
        selectedFolderPath: connection.selectedFolderPath,
        lastError: connection.lastError,
      }
      : { connected: false, status: "not_connected" as const, requiresAppConfig: false, selectedFolderName: null, selectedFolderPath: null, lastError: null };
  }),
  reauthorizeCatalog: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const application = await getStoreOneDriveAppSettings(storeId);
    await requireCatalogReauthorization(storeId);
    const state = randomBytes(32).toString("base64url");
    const pkce = createPkcePair();
    await createOAuthState({ state, userId: ctx.user.id, storeId, appConfigId: application.id, codeVerifier: pkce.verifier, flow: "catalog_read", expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    return { authorizationUrl: createOneDriveAuthorizationUrl({ state, codeChallenge: pkce.challenge, application, flow: "catalog_read" }) };
  }),
  beginCatalogSelection: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const application = await getStoreOneDriveAppSettings(storeId);
    const state = randomBytes(32).toString("base64url");
    const pkce = createPkcePair();
    await createOAuthState({
      state,
      userId: ctx.user.id,
      storeId,
      appConfigId: application.id,
      codeVerifier: pkce.verifier,
      flow: "catalog_read",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return {
      authorizationUrl: createOneDriveAuthorizationUrl({ state, codeChallenge: pkce.challenge, application, flow: "catalog_read" }),
    };
  }),
  catalogRootFolders: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const connection = await getUsableCatalogConnection(storeId);
    if (!connection) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لم يبدأ تفويض قراءة Catalog بعد." });
    if (connection.status === "failed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: connection.lastError ?? "فشل تفويض Catalog." });
    return listCatalogRootFolders(connection.encryptedAccessToken);
  }),
  catalogFolderChildren: protectedProcedure.input(z.object({ driveId: z.string().min(1), folderId: z.string().min(1) })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await getUsableCatalogConnection(requireOperationalStoreId(ctx.operationalStore?.id));
    if (!connection) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لم يبدأ تفويض قراءة Catalog بعد." });
    return listCatalogFolderChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: input.driveId, folderId: input.folderId });
  }),
  selectCatalogRoot: protectedProcedure.input(z.object({
    driveId: z.string().min(1),
    folderId: z.string().min(1),
    folderName: z.string().min(1).max(255),
    folderPath: z.string().min(1).max(2048),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const connection = await getUsableCatalogConnection(storeId);
    if (!connection) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لم يبدأ تفويض قراءة Catalog بعد." });
    await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: input.driveId, folderId: input.folderId });
    await selectCatalogRoot({
      storeId,
      driveId: input.driveId,
      folderId: input.folderId,
      folderName: input.folderName,
      folderPath: input.folderPath,
    });
    return { selectedFolderName: input.folderName, selectedFolderPath: input.folderPath };
  }),
  previewCatalogTree: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return inspectSelectedCatalogTree(requireOperationalStoreId(ctx.operationalStore?.id));
  }),
  syncCatalogCategoryTree: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const preview = await inspectSelectedCatalogTree(storeId);
    const categories = flattenCategoryNodes(preview.root);
    const result = await syncOneDriveCategoryTree(storeId, categories);
    return { ...result, previewSummary: preview.summary, productFoldersDetected: preview.summary.products };
  }),
  productCategoryTree: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return listProductCategories(requireOperationalStoreId(ctx.operationalStore?.id));
  }),
  catalogGroups: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await requireSelectedCatalog(requireOperationalStoreId(ctx.operationalStore?.id));
    const items = await listCatalogChildren({
      encryptedAccessToken: connection.encryptedAccessToken,
      driveId: connection.selectedDriveId!,
      folderId: connection.selectedFolderId!,
    });
    return items.filter(item => item.kind === "folder");
  }),
  catalogProductFolders: protectedProcedure.input(z.object({ groupId: z.string().min(1) })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await requireSelectedCatalog(requireOperationalStoreId(ctx.operationalStore?.id));
    const groups = await listCatalogChildren({
      encryptedAccessToken: connection.encryptedAccessToken,
      driveId: connection.selectedDriveId!,
      folderId: connection.selectedFolderId!,
    });
    const group = groups.find(item => item.id === input.groupId && item.kind === "folder");
    if (!group) throw new TRPCError({ code: "BAD_REQUEST", message: "المجموعة المختارة ليست ضمن جذر Catalog المعتمد." });
    const items = await listCatalogChildren({
      encryptedAccessToken: connection.encryptedAccessToken,
      driveId: connection.selectedDriveId!,
      folderId: group.id,
    });
    return { group, products: items.filter(item => item.kind === "folder") };
  }),
  previewCatalogGroupProducts: protectedProcedure.input(z.object({ groupId: z.string().min(1) })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    return { mode: "group_preview" as const, ...(await previewSelectedCatalogGroup(requireOperationalStoreId(ctx.operationalStore?.id), input.groupId)) };
  }),
  previewCatalogProduct: protectedProcedure.input(z.object({
    groupId: z.string().min(1),
    productFolderId: z.string().min(1),
  })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const { group, productFolder, metadataFile, metadataText, images, documents } = await readSelectedCatalogProduct(requireOperationalStoreId(ctx.operationalStore?.id), input);
    return {
      mode: "preview" as const,
      group: { id: group.id, name: group.name },
      product: { id: productFolder.id, productCode: productFolder.name },
      metadata: metadataFile ? { fileName: metadataFile.name, content: metadataText } : null,
      images,
      documents,
    };
  }),
  createCatalogDraft: protectedProcedure.input(z.object({
    groupId: z.string().min(1),
    productFolderId: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const { group, productFolder, metadataFile, metadataText, metadataDocxBytes, images } = await readSelectedCatalogProduct(storeId, input);
    if (!metadataFile || (!metadataText && !metadataDocxBytes)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إنشاء المسودة من دون product.txt أو product.docx." });
    }
    let metadata;
    try {
      metadata = metadataDocxBytes ? await parseCatalogProductMetadataDocx(metadataDocxBytes) : parseCatalogProductMetadata(metadataText!);
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "ملف بيانات المنتج غير صالح." });
    }
    const result = await createCatalogDraftProduct({
      storeId,
      productCode: productFolder.name,
      name: metadata.name,
      category: group.name,
      description: metadata.description,
      sellingPrice: metadata.sellingPrice,
      previousPrice: metadata.previousPrice ?? null,
      sourceReference: `Catalog/${group.name}/${productFolder.name}`,
      createdByUserId: ctx.user.id,
    });
    return {
      ...result,
      productCode: productFolder.name,
      imageCount: images.length,
      variantCount: 0,
      mediaCount: 0,
      status: "draft" as const,
    };
  }),
  createSelectedCatalogDrafts: protectedProcedure.input(z.object({
    groupId: z.string().min(1),
    productFolderIds: z.array(z.string().min(1)).min(1).max(50).refine(ids => new Set(ids).size === ids.length, "لا تكرر المنتج نفسه ضمن الاختيار."),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const preview = await previewSelectedCatalogGroup(storeId, input.groupId);
    const results = await createSelectedCatalogDrafts({
      entries: preview.entries,
      selectedFolderIds: input.productFolderIds,
      createDraft: entry => createCatalogDraftProduct({
          storeId,
          productCode: entry.productCode,
          name: entry.metadata.name,
          category: preview.group.name,
          description: entry.metadata.description,
          sellingPrice: entry.metadata.sellingPrice,
          previousPrice: entry.metadata.previousPrice ?? null,
          sourceReference: entry.sourceReference,
          createdByUserId: ctx.user.id,
      }),
    });
    return { group: preview.group, results, autoPublished: false as const, autoCreatedVariants: false as const, autoCreatedInventory: false as const, autoAttachedMedia: false as const };
  }),
  createApprovedCatalogColorVariants: protectedProcedure.input(z.object({
    groupId: z.string().min(1),
    productFolderId: z.string().min(1),
    colorNames: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const { productFolder } = await readSelectedCatalogProduct(requireOperationalStoreId(ctx.operationalStore?.id), input);
    return createApprovedCatalogColorVariants({
      productCode: productFolder.name,
      colorNames: input.colorNames,
    });
  }),
  attachApprovedCatalogImageReferences: protectedProcedure.input(z.object({
    groupId: z.string().min(1),
    productFolderId: z.string().min(1),
    links: z.array(z.object({ colorName: z.string().trim().min(1).max(80), imageFileName: z.string().trim().min(1).max(255) })).min(1).max(20),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const { productFolder, images } = await readSelectedCatalogProduct(requireOperationalStoreId(ctx.operationalStore?.id), input);
    validateApprovedImageColorLinks({
      approvedColorNames: input.links.map(link => link.colorName),
      availableImageFileNames: images.map(image => image.name),
      links: input.links,
    });
    const imageByName = new Map(images.map(image => [image.name, image]));
    return attachApprovedCatalogImageReferences({
      productCode: productFolder.name,
      links: input.links.map(link => ({
        ...link,
        originalUrl: imageByName.get(link.imageFileName)?.webUrl ?? null,
      })),
    });
  }),
  previewCatalogProductImages: protectedProcedure.input(z.object({
    groupId: z.string().min(1),
    productFolderId: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const connection = await requireSelectedCatalog(storeId);
    const { images, productFolder } = await readSelectedCatalogProduct(storeId, input);
    const previewImages = await Promise.all(images.slice(0, 12).map(async image => ({
      sourceFileId: image.id,
      sourceFileName: image.name,
      sourceWebUrl: image.webUrl,
      rendition: "onedrive_thumbnail_c300x400" as const,
      dataUrl: await readCatalogImageDataUrl({
        encryptedAccessToken: connection.encryptedAccessToken,
        driveId: connection.selectedDriveId!,
        fileId: image.id,
      }),
    })));
    return {
      productCode: productFolder.name,
      imageCount: images.length,
      previewedCount: previewImages.length,
      originalPreserved: true as const,
      images: previewImages,
    };
  }),
  analyzeCatalogProductColors: protectedProcedure.input(z.object({
    groupId: z.string().min(1),
    productFolderId: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const connection = await requireSelectedCatalog(storeId);
    const { images, productFolder } = await readSelectedCatalogProduct(storeId, input);
    if (images.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد صور صالحة لتحليل اللون في مجلد المنتج." });
    const imageDataUrls = await Promise.all(images.map(async image => ({
      name: image.name,
      dataUrl: await readCatalogImageDataUrl({
        encryptedAccessToken: connection.encryptedAccessToken,
        driveId: connection.selectedDriveId!,
        fileId: image.id,
      }),
    })));
    const models = await listLLMModels();
    const visionModel = models.data.find(model => model.id === "gemini-3-flash-preview")?.id
      ?? models.data.find(model => model.id.startsWith("gemini-"))?.id;
    if (!visionModel) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يتوفر نموذج بصري لتحليل الصور حاليًا." });
    const response = await invokeLLM({
      model: visionModel,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content: "أنت محلل كتالوج أزياء حذر. اقترح فقط لون القماش الرئيسي للمنتج الظاهر، وتجاهل الخلفية والبشرة والإضاءة والظلال. اجمع الصور التي تمثل اللون نفسه من زوايا مختلفة. لا تعتمد لونًا؛ هذه نتيجة مراجعة بشرية فقط. عند الشك ضع اسم الصورة في uncertainImageFileNames ولا تخمّن.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `حلل صور المنتج ${productFolder.name}. أسماء الصور بالترتيب: ${imageDataUrls.map(image => image.name).join("، ")}. أرجع أسماء الألوان بالعربية.` },
            ...imageDataUrls.map(image => ({ type: "image_url" as const, image_url: { url: image.dataUrl, detail: "low" as const } })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "catalog_color_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              colorGroups: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    colorNameArabic: { type: "string" },
                    confidence: { type: "number" },
                    imageFileNames: { type: "array", items: { type: "string" } },
                    reviewNote: { type: "string" },
                  },
                  required: ["colorNameArabic", "confidence", "imageFileNames", "reviewNote"],
                  additionalProperties: false,
                },
              },
              uncertainImageFileNames: { type: "array", items: { type: "string" } },
              overallReviewNote: { type: "string" },
            },
            required: ["colorGroups", "uncertainImageFileNames", "overallReviewNote"],
            additionalProperties: false,
          },
        },
      },
    });
    const rawContent = response.choices[0]?.message.content;
    if (typeof rawContent !== "string") throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "لم يرجع محلل الصور نتيجة قابلة للقراءة." });
    let analysis;
    try {
      analysis = colorAnalysisSchema.parse(JSON.parse(rawContent));
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "نتيجة محلل الصور لم تطابق صيغة المراجعة المطلوبة." });
    }
    const knownFileNames = new Set(images.map(image => image.name));
    if ([...analysis.colorGroups.flatMap(group => group.imageFileNames), ...analysis.uncertainImageFileNames].some(fileName => !knownFileNames.has(fileName))) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "نتيجة محلل الصور أشارت إلى ملف غير موجود في المنتج." });
    }
    return { productCode: productFolder.name, imageCount: images.length, ...analysis };
  }),
  previewDirectCatalogProduct: protectedProcedure.input(z.object({ productFolderId: z.string().min(1) })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const connection = await requireSelectedCatalog(requireOperationalStoreId(ctx.operationalStore?.id));
    const rootItems = await listCatalogChildren({
      encryptedAccessToken: connection.encryptedAccessToken,
      driveId: connection.selectedDriveId!,
      folderId: connection.selectedFolderId!,
    });
    const productFolder = rootItems.find(item => item.id === input.productFolderId && item.kind === "folder");
    if (!productFolder) throw new TRPCError({ code: "BAD_REQUEST", message: "مجلد المنتج ليس ضمن جذر Catalog المعتمد." });
    const contents = await listCatalogChildren({
      encryptedAccessToken: connection.encryptedAccessToken,
      driveId: connection.selectedDriveId!,
      folderId: productFolder.id,
    });
    const metadataFile = contents.find(item => item.kind === "file" && item.name.toLowerCase() === "product.txt");
    const metadataText = metadataFile
      ? await readCatalogTextFile({
        encryptedAccessToken: connection.encryptedAccessToken,
        driveId: connection.selectedDriveId!,
        fileId: metadataFile.id,
      })
      : null;
    const images = contents.filter(item => item.kind === "file" && /\.(jpg|jpeg|png|webp)$/i.test(item.name));
    const documents = contents.filter(item => item.kind === "file" && !images.some(image => image.id === item.id));
    return {
      mode: "direct_root_preview" as const,
      structureWarning: "هذا المجلد يقع مباشرة تحت Catalog، خلاف شجرة المجموعة المعتمدة. المعاينة تشخيصية ولا تعتمد البنية.",
      group: null,
      product: { id: productFolder.id, productCode: productFolder.name },
      metadata: metadataFile ? { fileName: metadataFile.name, content: metadataText } : null,
      images,
      documents,
    };
  }),
});
