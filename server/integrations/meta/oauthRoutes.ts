import type { Express } from "express";
import { consumeMetaOAuthState, markMetaConnectionVerified, upsertDiscoveredMetaAssets, upsertMetaConnection } from "./db";
import { discoverMetaAssets, exchangeMetaCode, getMetaProfile, inspectMetaToken, metaConfigurationId } from "./oauth";

export function registerMetaOAuthRoutes(app: Express) {
  app.get("/api/meta/oauth/callback", async (req, res) => {
    const providerError = typeof req.query.error === "string" ? req.query.error : null;
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (providerError) return res.redirect("/meta-connections?meta=denied");
    if (!code || !state) return res.redirect("/meta-connections?meta=incomplete");
    let connectionId: number | null = null;
    try {
      const oauthState = await consumeMetaOAuthState(state);
      if (!oauthState) return res.redirect("/meta-connections?meta=expired");
      const exchanged = await exchangeMetaCode(code);
      const [inspection, profile] = await Promise.all([inspectMetaToken(exchanged.accessToken), getMetaProfile(exchanged.accessToken)]);
      const connection = await upsertMetaConnection({
        storeId: oauthState.storeId,
        purpose: oauthState.purpose,
        accessToken: exchanged.accessToken,
        tokenExpiresAt: inspection.expiresAt ?? (exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null),
        grantedScopes: inspection.scopes,
        metaUserId: inspection.userId ?? profile.id,
        metaUserName: profile.name,
        configurationId: metaConfigurationId(oauthState.purpose),
        connectedByUserId: oauthState.userId,
      });
      connectionId = connection.id;
      const discovered = await discoverMetaAssets(exchanged.accessToken, oauthState.purpose);
      await upsertDiscoveredMetaAssets({ storeId: oauthState.storeId, connectionId: connection.id, purpose: oauthState.purpose, assets: discovered.assets });
      await markMetaConnectionVerified(connection.id, discovered.failures.length ? discovered.failures.join(" | ").slice(0, 500) : null);
      const result = discovered.failures.length ? "partial" : "connected";
      return res.redirect(`/meta-connections?meta=${result}&purpose=${encodeURIComponent(oauthState.purpose)}`);
    } catch (error) {
      if (connectionId) await markMetaConnectionVerified(connectionId, error instanceof Error ? error.message : "فشل اتصال Meta.").catch(() => undefined);
      console.error("[Meta OAuth] Callback failed", error instanceof Error ? error.message : "unknown error");
      return res.redirect("/meta-connections?meta=failed");
    }
  });
}
