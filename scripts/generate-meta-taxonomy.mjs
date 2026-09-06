import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "/home/ubuntu/Downloads/fb_product_categories_en_US.txt";
const destinationPath = "/home/ubuntu/elegant-hijab-platform/server/integrations/meta/fbProductTaxonomy.generated.ts";
const source = await readFile(sourcePath, "utf8");
const rows = source
  .replace(/^\uFEFF/, "")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .flatMap((line) => {
    const separator = line.indexOf(",");
    const categoryId = Number(line.slice(0, separator));
    const path = line.slice(separator + 1).trim().replace(/^"|"$/g, "").replace(/""/g, '"');
    if (!Number.isInteger(categoryId) || !path) return [];
    return [{ id: categoryId, path }];
  });

const output = `/**\n * Generated from Meta's published Facebook Product Categories file.\n * Source: https://www.facebook.com/products/categories/en_US.txt\n * Do not edit by hand; regenerate using scripts/generate-meta-taxonomy.mjs.\n */\nexport type MetaProductTaxonomyEntry = { readonly id: number; readonly path: string };\nexport const META_PRODUCT_TAXONOMY: readonly MetaProductTaxonomyEntry[] = ${JSON.stringify(rows)};\n`;
await writeFile(destinationPath, output, "utf8");
console.log(`Generated ${rows.length} Meta product categories.`);
