import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ArrowDown, ArrowUp, Check, FolderPlus, Pencil, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Category = {
  id: number;
  parentId: number | null;
  label: string;
  displayPath: string;
  depth: number;
  source: "onedrive" | "manual";
};

export function ProductCategoryManager({ canCreate, canEdit, selectedProductId, currentCategoryId, onUpdated }: { canCreate: boolean; canEdit: boolean; selectedProductId?: number | null; currentCategoryId?: number | null; onUpdated?: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState<string>("root");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [assignedCategoryId, setAssignedCategoryId] = useState("none");
  const utils = trpc.useUtils();
  const categories = trpc.products.categories.list.useQuery(undefined, { enabled: open });
  const refresh = async () => { await utils.products.categories.list.invalidate(); await onUpdated?.(); };
  const createCategory = trpc.products.categories.create.useMutation({ onSuccess: async () => { setNewName(""); setParentId("root"); await refresh(); } });
  const renameCategory = trpc.products.categories.rename.useMutation({ onSuccess: async () => { setEditingId(null); setEditingName(""); await refresh(); } });
  const assignCategory = trpc.products.categories.assign.useMutation({ onSuccess: refresh });
  const reorderCategories = trpc.products.categories.reorder.useMutation({ onSuccess: refresh });
  const orderedCategories = useMemo(() => (categories.data ?? []) as Category[], [categories.data]);
  const moveCategory = (categoryId: number, direction: -1 | 1) => {
    const category = orderedCategories.find(item => item.id === categoryId);
    if (!category) return;
    const siblings = orderedCategories.filter(item => (item.parentId ?? null) === (category.parentId ?? null));
    const index = siblings.findIndex(item => item.id === categoryId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
    const next = [...siblings];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    reorderCategories.mutate({ categoryIds: next.map(item => item.id) });
  };
  useEffect(() => { setAssignedCategoryId(currentCategoryId ? String(currentCategoryId) : "none"); }, [currentCategoryId, selectedProductId]);

  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="h-8 shrink-0 rounded-lg border-[#d8c69f] bg-white px-2.5 text-xs text-[#765b2c] hover:bg-[#fffaf0]"><FolderPlus className="ml-1 h-3.5 w-3.5" />إدارة الأقسام</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent dir="rtl" className="max-h-[86vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>الأقسام والتصنيفات</DialogTitle>
          <DialogDescription>الأقسام التي تضيفها هنا تخص متجرك فقط. يمكن تعديل الاسم الظاهر لأي قسم مستورد من OneDrive من دون تغيير اسم المجلد الأصلي.</DialogDescription>
        </DialogHeader>
        {canCreate && <section className="rounded-2xl border border-[#dce7df] bg-[#f6fbf8] p-4">
          <p className="text-sm font-bold text-[#1c4b3d]">إضافة قسم أو تصنيف</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px_auto]">
            <Input value={newName} onChange={event => setNewName(event.target.value)} placeholder="مثال: حجابات جاهزة أو شيفون" />
            <select value={parentId} onChange={event => setParentId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="root">قسم أساسي</option>
              {orderedCategories.map(category => <option key={category.id} value={category.id}>{"— ".repeat(Math.min(category.depth, 3))}{category.displayPath}</option>)}
            </select>
            <Button onClick={() => createCategory.mutate({ name: newName.trim(), parentId: parentId === "root" ? null : Number(parentId) })} disabled={!newName.trim() || createCategory.isPending} className="bg-[#285f4e] hover:bg-[#1c4b3d]"><Plus className="ml-1 h-4 w-4" />إضافة</Button>
          </div>
          {createCategory.error && <p className="mt-2 text-xs text-[#a14724]">{createCategory.error.message}</p>}
        </section>}
        {selectedProductId && canEdit && <section className="rounded-2xl border border-[#eadcc2] bg-[#fffaf1] p-4">
          <p className="text-sm font-bold text-[#765b2c]">تصنيف المنتج المفتوح</p>
          <p className="mt-1 text-xs leading-5 text-[#806f56]">اختر قسمًا أو تصنيفًا للمنتج الحالي. يحفظ هذا كاختيار يدوي ولا تستبدله مزامنة OneDrive.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><select value={assignedCategoryId} onChange={event => setAssignedCategoryId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="none">غير مصنف</option>{orderedCategories.map(category => <option key={category.id} value={category.id}>{"— ".repeat(Math.min(category.depth, 3))}{category.displayPath}</option>)}</select><Button onClick={() => assignCategory.mutate({ productId: selectedProductId, categoryId: assignedCategoryId === "none" ? null : Number(assignedCategoryId) })} disabled={assignCategory.isPending} className="bg-[#285f4e] hover:bg-[#1c4b3d]"><Check className="ml-1 h-4 w-4" />حفظ التصنيف</Button></div>
          {assignCategory.error && <p className="mt-2 text-xs text-[#a14724]">{assignCategory.error.message}</p>}
        </section>}
        <section>
          <div className="flex items-center justify-between"><p className="text-sm font-bold text-[#183d35]">التصنيفات الحالية</p><span className="rounded-full bg-[#f2eee6] px-2.5 py-1 text-xs text-[#6b716c]">{orderedCategories.length}</span></div>
          {categories.isLoading ? <div className="mt-3 space-y-2"><div className="h-11 animate-pulse rounded-xl bg-[#f5f2eb]" /><div className="h-11 animate-pulse rounded-xl bg-[#f5f2eb]" /></div> : orderedCategories.length === 0 ? <p className="mt-3 rounded-2xl border border-dashed border-[#d8d0c3] bg-[#fcfaf6] p-4 text-sm text-[#738078]">لا توجد أقسام محفوظة بعد. أضف قسمًا من هنا أو استورد شجرة OneDrive من «مصدر المنتجات OneDrive».</p> : <div className="mt-3 space-y-2">{orderedCategories.map(category => <div key={category.id} className="flex items-center gap-2 rounded-xl border border-[#e9e3d8] bg-white p-2.5" style={{ marginRight: `${Math.min(category.depth, 4) * 16}px` }}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#b48a49]" />
            {editingId === category.id ? <Input autoFocus value={editingName} onChange={event => setEditingName(event.target.value)} aria-label={`تعديل ${category.label}`} className="h-9 flex-1" /> : <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#29443a]">{category.label}</p><p className="text-[11px] text-[#829087]">{category.source === "onedrive" ? "مستورد من OneDrive" : "أُضيف في المنصة"}</p></div>}
            {canEdit && <div className="flex items-center gap-0.5">{editingId === category.id ? <><Button size="icon" variant="ghost" onClick={() => renameCategory.mutate({ categoryId: category.id, name: editingName.trim() })} disabled={!editingName.trim() || renameCategory.isPending} aria-label="حفظ اسم التصنيف" className="h-9 w-9 text-[#21624d]"><Check className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => { setEditingId(null); setEditingName(""); }} aria-label="إلغاء تعديل التصنيف" className="h-9 w-9"><X className="h-4 w-4" /></Button></> : <><Button size="icon" variant="ghost" onClick={() => moveCategory(category.id, -1)} disabled={reorderCategories.isPending} aria-label={`رفع ${category.label}`} className="h-9 w-9 text-[#62786c]"><ArrowUp className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => moveCategory(category.id, 1)} disabled={reorderCategories.isPending} aria-label={`خفض ${category.label}`} className="h-9 w-9 text-[#62786c]"><ArrowDown className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => { setEditingId(category.id); setEditingName(category.label); }} aria-label={`تعديل ${category.label}`} className="h-9 w-9 text-[#62786c]"><Pencil className="h-4 w-4" /></Button></>}</div>}
          </div>)}</div>}
          {renameCategory.error && <p className="mt-2 text-xs text-[#a14724]">{renameCategory.error.message}</p>}{reorderCategories.error && <p className="mt-2 text-xs text-[#a14724]">{reorderCategories.error.message}</p>}
        </section>
      </DialogContent>
    </Dialog>
  </>;
}
