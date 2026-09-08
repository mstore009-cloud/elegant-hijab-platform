import { ProductCategoryManager } from "@/components/ProductCategoryManager";

const UNCATEGORIZED = "__uncategorized__";
type CategoryCount = { name: string; count: number };

export function ProductCategoryBrowser({
  total,
  matchingTotal,
  primaryCategories,
  subcategories,
  selectedPrimaryCategory,
  selectedSubcategory,
  onSelectPrimary,
  onSelectSubcategory,
  canCreate,
  canEdit,
  selectedProductId,
  currentCategoryId,
  onUpdated,
}: {
  total: number;
  matchingTotal: number;
  primaryCategories: CategoryCount[];
  subcategories: CategoryCount[];
  selectedPrimaryCategory: string | null;
  selectedSubcategory: string | null;
  onSelectPrimary: (value: string | null) => void;
  onSelectSubcategory: (value: string | null) => void;
  canCreate: boolean;
  canEdit: boolean;
  selectedProductId?: number | null;
  currentCategoryId?: number | null;
  onUpdated?: () => Promise<void> | void;
}) {
  const displayName = (name: string) => name === UNCATEGORIZED ? "غير مصنف" : name;
  return <div className="border-b border-[#eee9df] bg-[#fcfbf8] px-4 py-3 sm:px-5">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="أقسام المنتجات">
        <button type="button" onClick={() => onSelectPrimary(null)} aria-pressed={!selectedPrimaryCategory} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${!selectedPrimaryCategory ? "bg-[#183d35] text-white" : "bg-white text-[#526b5e] ring-1 ring-[#e4ded2] hover:bg-[#eef7f2]"}`}>كل المنتجات <span className="mr-1 opacity-75">{total}</span></button>
        {primaryCategories.map(category => <button type="button" key={category.name} onClick={() => onSelectPrimary(category.name)} aria-pressed={selectedPrimaryCategory === category.name} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${selectedPrimaryCategory === category.name ? "bg-[#e4f1ea] text-[#1b5944] ring-1 ring-[#b8d4c6]" : "bg-white text-[#526b5e] ring-1 ring-[#e4ded2] hover:bg-[#eef7f2]"}`}>{displayName(category.name)} <span className="mr-1 opacity-70">{category.count}</span></button>)}
      </div>
      <ProductCategoryManager canCreate={canCreate} canEdit={canEdit} selectedProductId={selectedProductId} currentCategoryId={currentCategoryId} onUpdated={onUpdated} />
    </div>
    {selectedPrimaryCategory && subcategories.length > 0 && <div className="mt-2 flex gap-1.5 overflow-x-auto border-t border-[#eee9df] pt-2"><button type="button" onClick={() => onSelectSubcategory(null)} aria-pressed={!selectedSubcategory} className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold transition ${!selectedSubcategory ? "bg-[#b28a4c] text-white" : "bg-[#f6eee0] text-[#80643a] hover:bg-[#efdfbf]"}`}>كل {displayName(selectedPrimaryCategory)}</button>{subcategories.map(category => <button type="button" key={category.name} onClick={() => onSelectSubcategory(category.name)} aria-pressed={selectedSubcategory === category.name} className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold transition ${selectedSubcategory === category.name ? "bg-[#b28a4c] text-white" : "bg-[#f6eee0] text-[#80643a] hover:bg-[#efdfbf]"}`}>{category.name} <span className="mr-1 opacity-70">{category.count}</span></button>)}</div>}
    {(selectedPrimaryCategory || selectedSubcategory) && <p className="mt-2 text-[11px] text-[#728078]">{matchingTotal} نتيجة مطابقة</p>}
  </div>;
}
