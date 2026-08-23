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

async function graphFetch(url: string, accessToken: string) {
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
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

/** Downloads only a known selected product metadata text file. */
export async function readCatalogTextFile(input: {
  encryptedAccessToken: string;
  driveId: string;
  fileId: string;
}): Promise<string> {
  const accessToken = decryptOneDriveToken(input.encryptedAccessToken);
  const contentResponse = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(input.fileId)}/content`,
    accessToken,
  );
  if (!contentResponse.ok) {
    throw new Error(`تعذر قراءة محتوى ملف بيانات المنتج من Microsoft Graph (HTTP ${contentResponse.status}).`);
  }
  return contentResponse.text();
}
