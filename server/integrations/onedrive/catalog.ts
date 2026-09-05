import { decryptOneDriveToken } from "./tokenCipher";
import { formatOneDriveGraphError } from "./oauth";

export type CatalogRootFolder = {
  id: string;
  name: string;
  driveId: string;
  webUrl: string | null;
};

export type CatalogDriveItem = {
  id: string;
  name: string;
  kind: "folder" | "file";
  webUrl: string | null;
  size: number | null;
};

type GraphChildrenPayload = {
  value?: Array<{
    id?: string;
    name?: string;
    webUrl?: string;
    size?: number;
    folder?: Record<string, unknown>;
    file?: { mimeType?: string };
    parentReference?: { driveId?: string };
  }>;
  error?: {
    code?: string;
    message?: string;
    innerError?: { code?: string; requestId?: string; [key: string]: unknown };
  };
};

function graphError(response: Response, payload: { error?: GraphChildrenPayload["error"] }, fallback: string) {
  return new Error(formatOneDriveGraphError({
    status: response.status,
    code: payload.error?.code,
    message: payload.error?.message ?? fallback,
    innerCode: payload.error?.innerError?.code,
    requestId: payload.error?.innerError?.requestId,
  }));
}

async function graphFetch(url: string, accessToken: string, timeoutMs = 20_000) {
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("انتهت مهلة Microsoft Graph أثناء قراءة Catalog. لم يُنشأ أو يُعدل أي منتج.");
    }
    throw error;
  }
}

/**
 * Lists only the first level of the owner's OneDrive for the approved, one-time
 * Catalog-root selection. Product contents remain unread until a later import step.
 */
export async function listCatalogRootFolders(encryptedAccessToken: string): Promise<CatalogRootFolder[]> {
  const accessToken = decryptOneDriveToken(encryptedAccessToken);
  const response = await graphFetch("https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,webUrl,folder,parentReference", accessToken);
  const payload = await response.json() as GraphChildrenPayload;
  if (!response.ok || !payload.value) {
    throw new Error(formatOneDriveGraphError({
      status: response.status,
      code: payload.error?.code,
      message: payload.error?.message ?? "تعذر عرض مجلدات OneDrive لاختيار Catalog.",
      innerCode: payload.error?.innerError?.code,
      requestId: payload.error?.innerError?.requestId,
    }));
  }
  return payload.value
    .filter((item): item is Required<Pick<CatalogRootFolder, "id" | "name">> & { webUrl?: string; parentReference?: { driveId?: string } } => Boolean(item.id && item.name && item.folder))
    .map(item => ({
      id: item.id,
      name: item.name,
      driveId: item.parentReference?.driveId ?? "",
      webUrl: item.webUrl ?? null,
    }));
}

/** Lists only direct subfolders of a user-selected branch during root selection. */
export async function listCatalogFolderChildren(input: {
  encryptedAccessToken: string;
  driveId: string;
  folderId: string;
}): Promise<CatalogRootFolder[]> {
  const children = await listCatalogChildren(input);
  return children
    .filter((item): item is CatalogDriveItem & { kind: "folder" } => item.kind === "folder")
    .map(item => ({ id: item.id, name: item.name, driveId: input.driveId, webUrl: item.webUrl }));
}

/** Lists direct children of the already selected Catalog path; no write API is used. */
export async function listCatalogChildren(input: {
  encryptedAccessToken: string;
  driveId: string;
  folderId: string;
}): Promise<CatalogDriveItem[]> {
  const accessToken = decryptOneDriveToken(input.encryptedAccessToken);
  const response = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(input.folderId)}/children?$select=id,name,webUrl,size,folder,file`,
    accessToken,
  );
  const payload = await response.json() as GraphChildrenPayload;
  if (!response.ok || !payload.value) throw graphError(response, payload, "تعذر قراءة محتوى مجلد Catalog.");
  return payload.value
    .filter((item): item is Required<Pick<CatalogDriveItem, "id" | "name">> & { folder?: Record<string, unknown>; webUrl?: string; size?: number } => Boolean(item.id && item.name))
    .map(item => ({
      id: item.id,
      name: item.name,
      kind: item.folder ? "folder" : "file",
      webUrl: item.webUrl ?? null,
      size: typeof item.size === "number" ? item.size : null,
    }));
}

/** Downloads only a known selected product metadata file, with a small bounded payload. */
export async function readCatalogFileBytes(input: {
  encryptedAccessToken: string;
  driveId: string;
  fileId: string;
  maxBytes?: number;
}): Promise<Buffer> {
  const accessToken = decryptOneDriveToken(input.encryptedAccessToken);
  const contentResponse = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(input.fileId)}/content`,
    accessToken,
  );
  if (!contentResponse.ok) {
    throw new Error(`تعذر قراءة محتوى ملف بيانات المنتج من Microsoft Graph (HTTP ${contentResponse.status}).`);
  }
  const bytes = Buffer.from(await contentResponse.arrayBuffer());
  const maxBytes = input.maxBytes ?? 5 * 1024 * 1024;
  if (bytes.length > maxBytes) throw new Error("ملف بيانات المنتج أكبر من الحد المسموح (5 ميغابايت).");
  return bytes;
}

export async function readCatalogTextFile(input: {
  encryptedAccessToken: string;
  driveId: string;
  fileId: string;
}): Promise<string> {
  return (await readCatalogFileBytes(input)).toString("utf8");
}

/** Downloads a known approved source image only when generating a separate operational copy. It never writes to OneDrive. */
export async function readCatalogOriginalImageBytes(input: {
  encryptedAccessToken: string;
  driveId: string;
  fileId: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const accessToken = decryptOneDriveToken(input.encryptedAccessToken);
  const contentResponse = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(input.fileId)}/content`,
    accessToken,
    60_000,
  );
  if (!contentResponse.ok) {
    throw new Error(`تعذر قراءة أصل صورة المنتج من Microsoft Graph (HTTP ${contentResponse.status}).`);
  }
  const mimeType = contentResponse.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  if (!mimeType.startsWith("image/")) throw new Error("ملف OneDrive المحدد ليس صورة صالحة لنسخة تشغيلية.");
  const bytes = Buffer.from(await contentResponse.arrayBuffer());
  if (bytes.length > 25 * 1024 * 1024) throw new Error("حجم الصورة الأصلية أكبر من حد النسخة التشغيلية (25 ميغابايت).");
  return { bytes, mimeType };
}

/** Downloads a known approved source video only to create a separate operational playback copy. It never writes to OneDrive. */
export async function readCatalogOriginalVideoBytes(input: {
  encryptedAccessToken: string;
  driveId: string;
  fileId: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const accessToken = decryptOneDriveToken(input.encryptedAccessToken);
  const contentResponse = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(input.fileId)}/content`,
    accessToken,
    120_000,
  );
  if (!contentResponse.ok) throw new Error(`تعذر قراءة فيديو المنتج من Microsoft Graph (HTTP ${contentResponse.status}).`);
  const mimeType = contentResponse.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  if (!mimeType.startsWith("video/")) throw new Error("الملف المحدد ليس فيديو صالحًا للنسخة التشغيلية.");
  const bytes = Buffer.from(await contentResponse.arrayBuffer());
  if (bytes.length > 100 * 1024 * 1024) throw new Error("فيديو المنتج أكبر من الحد التشغيلي الحالي (100 ميغابايت).");
  return { bytes, mimeType };
}

/** Opens a read-only OneDrive video response for a server-side playback proxy. No bytes, token, or URL are exposed to the browser. */
export async function openCatalogVideoStream(input: {
  encryptedAccessToken: string;
  driveId: string;
  fileId: string;
  range?: string;
}) {
  const accessToken = decryptOneDriveToken(input.encryptedAccessToken);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(input.fileId)}/content`,
      { headers: { Authorization: `Bearer ${accessToken}`, ...(input.range ? { Range: input.range } : {}) }, signal: controller.signal },
    );
    if (!response.ok) throw new Error(`تعذر بدء تشغيل فيديو المنتج من Microsoft Graph (HTTP ${response.status}).`);
    const mimeType = response.headers.get("content-type")?.split(";")[0] || "video/mp4";
    if (!mimeType.startsWith("video/")) throw new Error("الملف المحدد ليس فيديو صالحًا للتشغيل.");
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/** Reads one Microsoft Graph thumbnail transiently for visual analysis; it never stores or publishes the bytes. */
export async function readCatalogImageDataUrl(input: {
  encryptedAccessToken: string;
  driveId: string;
  fileId: string;
}): Promise<string> {
  const accessToken = decryptOneDriveToken(input.encryptedAccessToken);
  const metadataResponse = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(input.fileId)}/thumbnails?$select=c300x400`,
    accessToken,
  );
  const metadata = await metadataResponse.json() as { value?: Array<{ c300x400?: { url?: string } }>; error?: GraphChildrenPayload["error"] };
  if (!metadataResponse.ok || !metadata.value?.[0]?.c300x400?.url) {
    throw graphError(metadataResponse, metadata, "تعذر تحضير مصغرة صورة المنتج لتحليل اللون.");
  }
  const contentResponse = await fetch(metadata.value[0].c300x400.url, { signal: AbortSignal.timeout(20_000) });
  if (!contentResponse.ok) {
    throw new Error(`تعذر قراءة مصغرة صورة المنتج من Microsoft Graph (HTTP ${contentResponse.status}).`);
  }
  const bytes = Buffer.from(await contentResponse.arrayBuffer());
  const maxBytes = 2 * 1024 * 1024;
  if (bytes.length > maxBytes) throw new Error("مصغرة صورة المنتج أكبر من الحد المسموح لتحليل اللون (2 ميغابايت).");
  const mimeType = contentResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error("الملف المحدد ليس صورة صالحة لتحليل اللون.");
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
