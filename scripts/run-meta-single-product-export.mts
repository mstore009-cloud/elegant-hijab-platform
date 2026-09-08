import { runMetaCatalogExport } from "../server/integrations/meta/catalogExportDb";

const result = await runMetaCatalogExport({
  storeId: 1,
  catalogAssetId: 510040,
  productIds: [1380001],
  createdByUserId: 1,
});

console.log(JSON.stringify({
  jobId: result.job.id,
  status: result.job.status,
  handle: result.job.handle,
  validation: result.job.validationJson,
  reused: result.reused,
  itemCount: result.snapshot.itemCount,
}, null, 2));
