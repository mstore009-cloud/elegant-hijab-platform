export type OperationalMediaReference = {
  id: number;
  variantId: number | null;
  source: "onedrive" | "manual" | "s3";
  mediaType: "image" | "video" | "document";
  originalFileName: string | null;
  storageKey: string | null;
};

/**
 * A derivative is safe to regenerate only from an existing, read-authorized
 * OneDrive image reference. No source URL or token is accepted by this helper.
 */
export function isEligibleForOperationalRegeneration(media: OperationalMediaReference) {
  return media.source === "onedrive" && media.mediaType === "image" && Boolean(media.originalFileName) && !media.storageKey;
}

export function selectOperationalRegenerationCandidates(media: OperationalMediaReference[]) {
  return media.filter(isEligibleForOperationalRegeneration);
}

export function selectForcedOperationalRegenerationCandidates(media: OperationalMediaReference[], mediaId?: number) {
  return media.filter(entry => (
    entry.source === "onedrive"
    && entry.mediaType === "image"
    && Boolean(entry.originalFileName)
    && (mediaId === undefined || entry.id === mediaId)
  ));
}

/**
 * Detaching a reference is intentionally limited to a OneDrive product image.
 * The result never exposes a storage key, so released copies cannot remain
 * discoverable through the audit trail.
 */
export function planOperationalReferenceDetach(media: OperationalMediaReference) {
  if (media.source !== "onedrive" || media.mediaType !== "image") {
    throw new Error("لا يمكن فصل هذا المرجع عبر دورة حياة صور OneDrive التشغيلية.");
  }
  return { mediaId: media.id, releasedOperationalCopy: Boolean(media.storageKey) };
}
