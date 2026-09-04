import type { ExternalChannel } from "./db";

export type DerivedChannelStatus = "ready" | "testing" | "needs_setup" | "error" | "disabled";

type Connection = {
  id: number;
  purpose: string;
  status: string;
  grantedScopes: string;
  lastVerifiedAt: Date | null;
  lastError: string | null;
};

type Asset = {
  id: number;
  connectionId: number;
  assetType: string;
  externalId: string;
  displayName: string | null;
  parentExternalId: string | null;
  isSelected: boolean;
  lastDiscoveredAt: Date;
};

type Capability = {
  connectionId: number;
  purpose: string;
  status: string;
  enabled: boolean;
  missingScopes: string | null;
  lastVerifiedAt: Date | null;
};

type StoredAccount = {
  id: number;
  channel: ExternalChannel;
  providerAccountId: string | null;
  providerDisplayName: string | null;
  connectionStatus: "disconnected" | "testing" | "connected" | "disabled";
  appSubscriptionStatus: "unknown" | "ready" | "error";
  assetSubscriptionStatus: "unknown" | "ready" | "error";
  subscriptionLastCheckedAt: Date | null;
  lastInboundAt: Date | null;
  lastError: string | null;
};

export type ChannelHealth = {
  channel: ExternalChannel;
  label: string;
  accountId: number | null;
  providerAccountId: string | null;
  providerDisplayName: string | null;
  selectedAssetId: number | null;
  selectedAssetType: string | null;
  metaConnectionStatus: string;
  capabilityStatus: string;
  capabilityEnabled: boolean;
  appSubscriptionStatus: StoredAccount["appSubscriptionStatus"];
  assetSubscriptionStatus: StoredAccount["assetSubscriptionStatus"];
  lastInboundAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  status: DerivedChannelStatus;
  statusLabel: string;
  sendReady: boolean;
  setupSource: "meta_selection" | "not_configured";
  reasons: string[];
};

const channelMeta: Record<ExternalChannel, { label: string; assetType: string }> = {
  whatsapp: { label: "WhatsApp Business", assetType: "whatsapp_phone" },
  instagram: { label: "Instagram Professional", assetType: "instagram" },
  messenger: { label: "Facebook Messenger", assetType: "page" },
};

function selectedAssetFor(channel: ExternalChannel, assets: Asset[]) {
  return assets.find(asset => asset.isSelected && asset.assetType === channelMeta[channel].assetType) ?? null;
}

function deriveStatus(input: {
  account: StoredAccount | null;
  connection: Connection | null;
  capability: Capability | null;
  asset: Asset | null;
  channel: ExternalChannel;
}) {
  const reasons: string[] = [];
  if (!input.connection || input.connection.status !== "connected") reasons.push("اتصال Meta الموحد غير متصل");
  if (!input.asset) reasons.push("لم يُحدد أصل Meta لهذه القناة");
  if (!input.capability || input.capability.status !== "ready" || !input.capability.enabled) reasons.push("قدرة المراسلة غير جاهزة أو معطلة");
  if (!input.account) reasons.push("لم تُنشأ هوية القناة من اختيار Meta");
  if (input.account && input.asset && input.account.providerAccountId !== input.asset.externalId) reasons.push("معرّف القناة مختلف عن أصل Meta المحدد");
  if (input.account?.appSubscriptionStatus === "error") reasons.push("اشتراك التطبيق يحتاج إصلاحاً");
  if (input.account?.assetSubscriptionStatus === "error") reasons.push("اشتراك الأصل يحتاج إصلاحاً");
  if (input.channel !== "whatsapp" && input.account?.appSubscriptionStatus !== "ready") reasons.push("لم يثبت اشتراك التطبيق بعد");
  if (input.channel !== "whatsapp" && input.account?.assetSubscriptionStatus !== "ready") reasons.push("لم يثبت اشتراك الأصل بعد");
  if (input.account?.lastError) reasons.push(input.account.lastError);

  const disabled = input.account?.connectionStatus === "disabled" || Boolean(input.account && !input.asset);
  if (disabled) return { status: "disabled" as const, reasons: reasons.length ? reasons : ["القناة معطلة من اختيار الأصول"] };
  if (input.account?.lastError || input.account?.appSubscriptionStatus === "error" || input.account?.assetSubscriptionStatus === "error" || input.connection?.status === "failed" || input.connection?.status === "revoked") {
    return { status: "error" as const, reasons };
  }
  const identityMatchesAsset = Boolean(input.account && input.asset && input.account.providerAccountId === input.asset.externalId);
  const ready = input.connection?.status === "connected" && input.asset && input.capability?.status === "ready" && input.capability.enabled && identityMatchesAsset && (input.channel === "whatsapp" || (input.account?.appSubscriptionStatus === "ready" && input.account?.assetSubscriptionStatus === "ready"));
  if (ready) return { status: "ready" as const, reasons: [] };
  if (input.connection || input.asset || input.account) return { status: "testing" as const, reasons };
  return { status: "needs_setup" as const, reasons };
}

export function deriveChannelHealth(input: {
  channel: ExternalChannel;
  account: StoredAccount | null;
  connections: Connection[];
  assets: Asset[];
  capabilities: Capability[];
}): ChannelHealth {
  const connection = input.connections.find(item => item.purpose === "unified") ?? null;
  const asset = selectedAssetFor(input.channel, input.assets.filter(item => !connection || item.connectionId === connection.id));
  const capability = connection ? input.capabilities.find(item => item.connectionId === connection.id && item.purpose === "messaging") ?? null : null;
  const result = deriveStatus({ account: input.account, connection, capability, asset, channel: input.channel });
  const lastCheckedAt = input.account?.subscriptionLastCheckedAt ?? capability?.lastVerifiedAt ?? connection?.lastVerifiedAt ?? null;
  const sendReady = result.status === "ready" && Boolean(input.account?.providerAccountId);
  return {
    channel: input.channel,
    label: channelMeta[input.channel].label,
    accountId: input.account?.id ?? null,
    providerAccountId: asset?.externalId ?? input.account?.providerAccountId ?? null,
    providerDisplayName: asset?.displayName ?? input.account?.providerDisplayName ?? null,
    selectedAssetId: asset?.id ?? null,
    selectedAssetType: asset?.assetType ?? null,
    metaConnectionStatus: connection?.status ?? "not_connected",
    capabilityStatus: capability?.status ?? "missing_asset",
    capabilityEnabled: Boolean(capability?.enabled),
    appSubscriptionStatus: input.account?.appSubscriptionStatus ?? "unknown",
    assetSubscriptionStatus: input.account?.assetSubscriptionStatus ?? "unknown",
    lastInboundAt: input.account?.lastInboundAt ?? null,
    lastCheckedAt,
    lastError: input.account?.lastError ?? connection?.lastError ?? null,
    status: result.status,
    statusLabel: result.status === "ready" ? "جاهزة" : result.status === "testing" ? "قيد التحقق" : result.status === "error" ? "تحتاج إصلاحاً" : result.status === "disabled" ? "معطلة" : "تحتاج إعداداً",
    sendReady,
    setupSource: asset ? "meta_selection" : "not_configured",
    reasons: result.reasons,
  };
}

export function deriveAllChannelHealth(input: { accounts: StoredAccount[]; connections: Connection[]; assets: Asset[]; capabilities: Capability[] }) {
  return (Object.keys(channelMeta) as ExternalChannel[]).map(channel => deriveChannelHealth({ channel, account: input.accounts.find(account => account.channel === channel) ?? null, connections: input.connections, assets: input.assets, capabilities: input.capabilities }));
}
