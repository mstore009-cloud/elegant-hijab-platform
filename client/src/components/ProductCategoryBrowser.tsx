import { ProductCategoryManager } from "@/components/ProductCategoryManager";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronLeft, FolderTree, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ProductCategoryNode = {
  id: number;
  parentId: number | null;
  label: string;
  displayPath: string;
  depth: number;
  source: "onedrive" | "manual";
};

type CategoryCounts = Record<number, number>;

function TreeNode({
  category,
  children,
  childrenByParent,
  counts,
  selectedCategoryId,
  expanded,
  expandedIds,
  toggleCategory,
  selectCategory,
}: {
  category: ProductCategoryNode;
  children: ProductCategoryNode[];
  childrenByParent: Map<number | null, ProductCategoryNode[]>;
  counts: CategoryCounts;
  selectedCategoryId: number | null;
  expanded: boolean;
  expandedIds: Set<number>;
  toggleCategory: (categoryId: number) => void;
  selectCategory: (categoryId: number) => void;
}) {
  const hasChildren = children.length > 0;
  return <div>
    <div className={`flex items-center gap-1 rounded-lg px-1 py-1 transition ${selectedCategoryId === category.id ? "bg-[#e4f3ea] text-[#1b5944]" : "hover:bg-[#f5f8f5]"}`}>
      {hasChildren ? <button type="button" onClick={() => toggleCategory(category.id)} aria-label={expanded ? `طي ${category.label}` : `توسيع ${category.label}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#6a8275] hover:bg-white"><span className={expanded ? "rotate-0 transition" : "rotate-90 transition"}><ChevronDown className="h-4 w-4" /></span></button> : <span className="h-7 w-7 shrink-0" />}
      <button type="button" onClick={() => selectCategory(category.id)} aria-current={selectedCategoryId === category.id ? "page" : undefined} className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-1.5 py-1 text-right text-xs font-bold">
        <span className="flex min-w-0 items-center gap-1.5"><FolderTree className="h-3.5 w-3.5 shrink-0 text-[#b18a4d]" /><span className="truncate">{category.label}</span></span>
        <span className="shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-[#718078]">{counts[category.id] ?? 0}</span>
      </button>
    </div>
    {hasChildren && expanded && <div className="mr-4 border-r border-[#e5ded2] pr-1">{children.map(child => <TreeNode key={child.id} category={child} children={childrenByParent.get(child.id) ?? []} childrenByParent={childrenByParent} counts={counts} selectedCategoryId={selectedCategoryId} expanded={expandedIds.has(child.id)} expandedIds={expandedIds} toggleCategory={toggleCategory} selectCategory={selectCategory} />)}</div>}
  </div>;
}

export function ProductCategoryBrowser({
  total, matchingTotal, categories, categoryCounts, uncategorizedCount, selectedCategoryId,
  onSelectCategory, search, onSearchChange, canCreate, canEdit, selectedProductId, currentCategoryId, onUpdated, children,
}: {
  total: number;
  matchingTotal: number;
  categories: ProductCategoryNode[];
  categoryCounts: CategoryCounts;
  uncategorizedCount: number;
  selectedCategoryId: number | null;
  onSelectCategory: (value: number | null) => void;
  search: string;
  onSearchChange: (value: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  selectedProductId?: number | null;
  currentCategoryId?: number | null;
  onUpdated?: () => Promise<void> | void;
  children?: ReactNode;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set(categories.filter(category => category.parentId === null).map(category => category.id)));
  const childrenByParent = useMemo(() => {
    const result = new Map<number | null, ProductCategoryNode[]>();
    for (const category of categories) result.set(category.parentId, [...(result.get(category.parentId) ?? []), category]);
    return result;
  }, [categories]);
  const roots = childrenByParent.get(null) ?? [];
  useEffect(() => {
    if (!roots.length) return;
    setExpandedIds(current => current.size ? current : new Set(roots.map(category => category.id)));
  }, [roots]);
  const toggle = (categoryId: number) => setExpandedIds(current => {
    const next = new Set(current);
    if (next.has(categoryId)) next.delete(categoryId); else next.add(categoryId);
    return next;
  });
  const displayCategory = (category: ProductCategoryNode) => <TreeNode key={category.id}
    category={category}
    children={childrenByParent.get(category.id) ?? []}
    childrenByParent={childrenByParent}
    counts={categoryCounts}
    selectedCategoryId={selectedCategoryId}
    expanded={expandedIds.has(category.id)}
    expandedIds={expandedIds}
    toggleCategory={toggle}
    selectCategory={onSelectCategory}
  />;

  return <div className="border-b border-[#eee9df] bg-[#fcfbf8] px-4 py-3 sm:px-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="relative min-w-[220px] flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a968f]" /><Input value={search} onChange={event => onSearchChange(event.target.value)}  aria-label="البحث في المنتجات" className="h-8 rounded-lg border-[#ded8cd] pr-8 text-xs" /></div>
      <ProductCategoryManager canCreate={canCreate} canEdit={canEdit} selectedProductId={selectedProductId} currentCategoryId={currentCategoryId} onUpdated={onUpdated} />
    </div>
    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(210px,260px)_minmax(0,1fr)]">
      <aside className="rounded-xl border border-[#e5ded2] bg-white p-2" aria-label="شجرة أقسام المنتجات">
        <div className="flex items-center justify-between border-b border-[#eee9df] px-2 pb-2"><span className="text-xs font-bold text-[#38594d]">شجرة الأقسام</span><span className="text-[10px] text-[#8a968f]">{total} منتج</span></div>
        <div className="mt-2 space-y-0.5">
          <button type="button" onClick={() => onSelectCategory(null)} aria-pressed={selectedCategoryId === null} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right text-xs font-bold transition ${selectedCategoryId === null ? "bg-[#183d35] text-white" : "text-[#526b5e] hover:bg-[#f5f8f5]"}`}><span>كل المنتجات</span><span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px]">{total}</span></button>
          {roots.map(displayCategory)}
          <button type="button" onClick={() => onSelectCategory(-1)} aria-pressed={selectedCategoryId === -1} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right text-xs font-bold transition ${selectedCategoryId === -1 ? "bg-[#fff2df] text-[#805b24]" : "text-[#806f56] hover:bg-[#fffaf1]"}`}><span>غير مصنف</span><span className="rounded-full bg-[#f6eee0] px-1.5 py-0.5 text-[10px]">{uncategorizedCount}</span></button>
        </div>
      </aside>
      <div className="min-w-0"><div className="rounded-xl border border-[#e5eee8] bg-[#f8fbf9] p-3"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-bold text-[#38594d]">مسار التصفح:</span><span className="rounded-full bg-[#e4f3ea] px-2.5 py-1 font-bold text-[#285f4e]">{selectedCategoryId === null ? "كل المنتجات" : selectedCategoryId === -1 ? "غير مصنف" : categories.find(category => category.id === selectedCategoryId)?.displayPath ?? "القسم المحدد"}</span>{(selectedCategoryId !== null || search.trim()) && <span className="text-[11px] text-[#728078]">{matchingTotal} نتيجة مطابقة</span>}</div></div>{children}</div>
    </div>
  </div>;
}
