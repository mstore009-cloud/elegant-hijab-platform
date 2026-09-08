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
  const selectedLabel = selectedSubcategory ? `${displayName(selectedPrimaryCategory ?? "")} ← ${displayName(selectedSubcategory)}` : selectedPrimaryCategory ? displayName(selectedPrimaryCategory) : "كل الأقسام";
  if (!primaryCategories.length && total === 0) return null;
  return <section className="rounded-3xl border border-[#e6ded0] bg-white p-4 shadow-[0_12px_28px_rgba(43,58,49,0.04)] sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-[#183d35]">تصفح حسب الأقسام</p><p className="mt-1 text-xs text-[#718078]">اختر قسمًا لتضييق القائمة. تظهر التصنيفات الفرعية فقط عند الحاجة.</p></div><ProductCategoryManager canCreate={canCreate} canEdit={canEdit} selectedProductId={selectedProductId} currentCategoryId={currentCategoryId} onUpdated={onUpdated} /></div>
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1"><button type="button" onClick={() => onSelectPrimary(null)} aria-pressed={!selectedPrimaryCategory} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold transition ${!selectedPrimaryCategory ? "bg-[#183d35] text-white" : "bg-[#f4f1ea] text-[#4c6157] hover:bg-[#e8f3ec]"}`}>كل الأقسام <span className="mr-1 text-xs opacity-80">{total}</span></button>{primaryCategories.map(category => <button type="button" key={category.name} onClick={() => onSelectPrimary(category.name)} aria-pressed={selectedPrimaryCategory === category.name} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold transition ${selectedPrimaryCategory === category.name ? "bg-[#e8f3ec] text-[#1d5945] ring-1 ring-[#b9d5c7]" : "bg-[#f8f6f0] text-[#53675c] hover:bg-[#edf6f0]"}`}>{displayName(category.name)} <span className="mr-1 text-xs opacity-70">{category.count}</span></button>)}</div>
    {selectedPrimaryCategory && subcategories.length > 0 && <div className="mt-3 border-t border-[#eee8dc] pt-3"><p className="mb-2 text-xs font-bold text-[#85735a]">تصنيفات {displayName(selectedPrimaryCategory)}</p><div className="flex gap-2 overflow-x-auto pb-1"><button type="button" onClick={() => onSelectSubcategory(null)} aria-pressed={!selectedSubcategory} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition ${!selectedSubcategory ? "bg-[#b28a4c] text-white" : "bg-[#faf3e6] text-[#80653a] hover:bg-[#f3e2c1]"}`}>كل {displayName(selectedPrimaryCategory)} <span className="mr-1 opacity-80">{primaryCategories.find(category => category.name === selectedPrimaryCategory)?.count ?? 0}</span></button>{subcategories.map(category => <button type="button" key={category.name} onClick={() => onSelectSubcategory(category.name)} aria-pressed={selectedSubcategory === category.name} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition ${selectedSubcategory === category.name ? "bg-[#b28a4c] text-white" : "bg-[#faf3e6] text-[#80653a] hover:bg-[#f3e2c1]"}`}>{category.name} <span className="mr-1 opacity-80">{category.count}</span></button>)}</div></div>}
    <p className="mt-3 text-xs text-[#5f7469]">يعرض الآن: <b>{selectedLabel}</b> · {matchingTotal} منتجًا في النطاق الحالي</p>
  </section>;
}
