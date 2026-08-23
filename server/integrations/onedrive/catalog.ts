import { decryptOneDriveToken } from "./tokenCipher";
import { formatOneDriveGraphError } from "./oauth";

export type CatalogRootFolder = {
  id: string;
  name: string;
  driveId: string;
  webUrl: string | null;
};

type GraphChildrenPayload = {
  value?: Array<{
    id?: string;
    name?: string;
    webUrl?: string;
    folder?: Record<string, unknown>;
    parentReference?: { driveId?: string };
  }>;
  error?: {
    code?: string;
    message?: string;
    innerError?: { code?: string; requestId?: string; [key: string]: unknown };
  };
};

/**
 * Lists only the first level of the owner's OneDrive for the approved, one-time
 * Catalog-root selection. Product contents remain unread until a later import step.
 */
export async function listCatalogRootFolders(encryptedAccessToken: string): Promise<CatalogRootFolder[]> {
  const accessToken = decryptOneDriveToken(encryptedAccessToken);
  const response = await fetch("https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,webUrl,folder,parentReference", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
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
