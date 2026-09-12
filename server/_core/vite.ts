import express, { type Express, type Response } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  const assetsRoot = path.resolve(distPath, "assets");
  const setAssetHeaders = (res: Response, filePath: string) => {
    const isHashedAsset = filePath.startsWith(`${assetsRoot}${path.sep}`) && /\.(js|css)$/.test(filePath);
    res.setHeader("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");
  };

  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || !req.headers["accept-encoding"]?.includes("br")) return next();
    const relativePath = decodeURIComponent(req.path).replace(/^\/+/, "");
    const sourcePath = path.resolve(distPath, relativePath);
    if (!sourcePath.startsWith(`${assetsRoot}${path.sep}`) || !/\.(js|css)$/.test(sourcePath)) return next();
    const brotliPath = `${sourcePath}.br`;
    if (!fs.existsSync(brotliPath)) return next();
    res.setHeader("Content-Encoding", "br");
    res.setHeader("Vary", "Accept-Encoding");
    setAssetHeaders(res, sourcePath);
    return res.sendFile(brotliPath);
  });

  app.use(express.static(distPath, { setHeaders: setAssetHeaders }));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
