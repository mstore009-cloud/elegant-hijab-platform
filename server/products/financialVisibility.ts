export type ProductWithFinancials = {
  id: number;
  productCode: string;
  name: string;
  category: string | null;
  status: string;
  sellingPrice: string;
  costPrice: string | null;
  targetMarginPercent: string | null;
};

export function presentProductForViewer(product: ProductWithFinancials, canViewFinancials: boolean) {
  const { costPrice, targetMarginPercent, ...operationalProduct } = product;
  if (!canViewFinancials) return operationalProduct;
  return { ...operationalProduct, costPrice, targetMarginPercent };
}
