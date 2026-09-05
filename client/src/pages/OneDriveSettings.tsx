import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, CloudCog, FolderTree, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";

type TreeNode = {
  folderId: string;
  name: string;
  path: string;
  depth: number;
  kind: "category" | "product" | "needs_review";
  mediaFileCount: number;
  children: TreeNode[];
  warning: string | null;
};

function CatalogTreeNode({ node }: { node: TreeNode }) {
  const styles = node.kind === "product" ? "border-[#cce0d7] bg-[#f3faf5] text-[#245b4d]" : node.kind === "needs_review" ? "border-[#f0d6bc] bg-[#fff7ef] text-[#9c4b25]" : "border-[#e2e9e4] bg-white text-[#28463b]";
  const label = node.kind === "product" ? `منتج · ${node.mediaFileCount} وسائط` : node.kind === "needs_review" ? "يحتاج مراجعة" : "تصنيف";
  return <li className="space-y-2"><div className={`rounded-xl border p-3 ${styles}`}><div className="flex items-center justify-between gap-3"><span className="font-bold">{node.name}</span><span className="shrink-0 text-xs">{label}</span></div>{node.warning && <p className="mt-1 text-xs leading-5">{node.warning}</p>}</div>{node.children.length > 0 && <ul className="mr-4 space-y-2 border-r border-[#dce7df] pr-3"><>{node.children.map(child => <CatalogTreeNode key={child.folderId} node={child} />)}</></ul>}</li>;
}

export default function OneDriveSettings() {
  const utils = trpc.useUtils();
  const profile = trpc.access.myProfile.useQuery();
  const catalog = trpc.integrations.catalogSelectionStatus.useQuery(undefined, { enabled: profile.isSuccess });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [treePreviewOpen, setTreePreviewOpen] = useState(false);
  const roots = trpc.integrations.catalogRootFolders.useQuery(undefined, { enabled: pickerOpen && catalog.data?.status === "connected" });
  const treePreview = trpc.integrations.previewCatalogTree.useQuery(undefined, { enabled: treePreviewOpen && catalog.data?.status === "catalog_selected" });
  const savedCategories = trpc.integrations.productCategoryTree.useQuery(undefined, { enabled: catalog.data?.status === "catalog_selected" });
  const canConfigure = profile.data?.permissions.includes("products.create") ?? false;

  const connect = trpc.integrations.beginCatalogSelection.useMutation({
    onSuccess: result => window.location.assign(result.authorizationUrl),
  });
  const selectRoot = trpc.integrations.selectCatalogRoot.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.integrations.catalogSelectionStatus.invalidate(), utils.integrations.catalogRootFolders.invalidate()]);
      setPickerOpen(false);
    },
  });
  const syncTree = trpc.integrations.syncCatalogCategoryTree.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.integrations.productCategoryTree.invalidate(), utils.integrations.previewCatalogTree.invalidate()]);
    },
  });

  const isSelected = catalog.data?.status === "catalog_selected";
  const isConnected = catalog.data?.status === "connected";

  return <main dir="rtl" className="mx-auto max-w-5xl space-y-6 pb-12">
    <header className="rounded-3xl bg-[#173f38] px-6 py-8 text-white shadow-lg">
      <p className="text-sm font-bold text-[#ddc985]">مصادر المنتجات</p>
      <h1 className="mt-2 text-3xl font-black">OneDrive للمتجر</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#dce8e1]">يربط هذا الإعداد متجر التشغيل الحالي فقط. تُستخدم ملفات OneDrive كمصدر مرجعي لشجرة الأقسام والوسائط الأصلية، بينما تبقى النسخ المضغوطة داخل المنصة مخصصة للعرض السريع.</p>
    </header>

    <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <article className="rounded-3xl border border-[#e6ded0] bg-white p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#eaf5ee] text-[#245b4d]"><CloudCog className="h-5 w-5" /></div>
          <div><h2 className="font-black text-[#173f38]">اتصال OneDrive ومجلد الجذر</h2><p className="mt-1 text-sm leading-6 text-[#68756e]">يبدأ كل متجر بتفويض قراءة منفصل ثم اختيار مجلد واحد يكون أصل شجرة الأقسام والمنتجات.</p></div>
        </div>

        {catalog.isLoading ? <div className="mt-6 h-24 animate-pulse rounded-2xl bg-[#f7f4ed]" /> : <div className="mt-6 rounded-2xl border border-[#e4ede7] bg-[#f7fbf8] p-4">
          {isSelected ? <><div className="flex items-center gap-2 font-bold text-[#1d654b]"><CheckCircle2 className="h-5 w-5" />مجلد الجذر محدد لهذا المتجر</div><p className="mt-2 text-sm text-[#536d61]">{catalog.data?.selectedFolderName ?? "مجلد OneDrive محدد"}</p><div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => setPickerOpen(true)} disabled={!canConfigure} variant="outline" className="border-[#b9d3c6] text-[#245b4d]"><FolderTree className="ml-1.5 h-4 w-4" />تغيير المجلد</Button><Button onClick={() => window.location.assign("/products")} className="bg-[#173f38] text-white hover:bg-[#245b4d]">فتح المنتجات</Button></div></> : isConnected ? <><div className="flex items-center gap-2 font-bold text-[#7a5a25]"><FolderTree className="h-5 w-5" />تم التفويض؛ اختر جذر المنتجات</div><p className="mt-2 text-sm text-[#6f6554]">لن تُنشأ منتجات أو تُقرأ ملفات المنتج قبل اختيار المجلد.</p><Button onClick={() => setPickerOpen(true)} disabled={!canConfigure} className="mt-4 bg-[#173f38] text-white hover:bg-[#245b4d]">اختيار مجلد الجذر</Button></> : <><div className="font-bold text-[#7a5a25]">OneDrive غير مرتبط لهذا المتجر</div><p className="mt-2 text-sm text-[#6f6554]">افتح تفويض Microsoft بالحساب الذي يملك مجلد المنتجات. لا تُخزّن كلمة المرور في المنصة.</p><Button onClick={() => connect.mutate()} disabled={!canConfigure || connect.isPending} className="mt-4 bg-[#173f38] text-white hover:bg-[#245b4d]">{connect.isPending ? "جارٍ فتح التفويض" : "ربط OneDrive"}</Button></>}
          {catalog.data?.lastError && <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs leading-5 text-[#9c4b25]">{catalog.data.lastError}</p>}
          {(connect.error || selectRoot.error) && <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs leading-5 text-[#9c4b25]">{connect.error?.message ?? selectRoot.error?.message}</p>}
        </div>}
      </article>

      <aside className="rounded-3xl border border-[#e6ded0] bg-[#fcfaf5] p-6"><div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-[#a47d40]" /><div><h2 className="font-black text-[#173f38]">حدود الوصول</h2><p className="text-xs text-[#68756e]">مرتبطة بالمتجر لا بالمستخدم.</p></div></div><ul className="mt-5 space-y-3 text-sm leading-6 text-[#52645c]"><li>يُحفظ رمز التفويض مشفراً ولا يظهر في الواجهة.</li><li>لا يمكن لمتجر ثانٍ قراءة شجرة هذا المتجر أو وسائطه.</li><li>اختيار الجذر لا يغيّر ملفات OneDrive ولا يحذف المنتجات الحالية.</li><li>يُستخدم الأصل عالي الجودة عند النشر أو التصدير، لا لتثقيل واجهة المنصة.</li></ul></aside>
    </section>

    {isSelected && <section className="rounded-3xl border border-[#e6ded0] bg-white p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#a47d40]">شجرة OneDrive</p><h2 className="mt-1 text-xl font-black text-[#173f38]">معاينة الأقسام والمنتجات</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#68756e]">تتعرف المنصة على المنتج فقط عندما يجتمع ملف معلومات <span dir="ltr">product.txt</span> أو <span dir="ltr">product.docx</span> مع صورة أو فيديو. هذه المعاينة لا تستورد منتجاً ولا تنزّل وسائط.</p></div><Button onClick={() => setTreePreviewOpen(value => !value)} variant="outline" className="border-[#b9d3c6] text-[#245b4d]"><FolderTree className="ml-1.5 h-4 w-4" />{treePreviewOpen ? "إخفاء المعاينة" : "معاينة الشجرة"}</Button></div>{savedCategories.data?.length ? <p className="mt-4 text-xs text-[#536d61]">التصنيفات المحفوظة حالياً: {savedCategories.data.length} تصنيفاً. إعادة الاعتماد تحدثها وفق شجرة OneDrive ولا تحذف المنتجات.</p> : null}{treePreviewOpen && <div className="mt-5">{treePreview.isLoading && <p className="flex items-center gap-2 rounded-2xl bg-[#f7f4ed] p-4 text-sm text-[#68756e]"><RefreshCw className="h-4 w-4 animate-spin" />جارٍ قراءة أسماء المجلدات والملفات…</p>}{treePreview.error && <p className="rounded-2xl border border-[#f0d6bc] bg-[#fff7ef] p-4 text-sm text-[#9c4b25]">{treePreview.error.message}</p>}{treePreview.data && <><div className="flex flex-wrap gap-2 rounded-2xl bg-[#f7fbf8] p-3 text-xs text-[#536d61]"><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.categories} تصنيفات</span><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.products} مجلدات منتجات</span><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.needsReview} تحتاج مراجعة</span><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.scannedFolders} مجلدات مقروءة</span></div><ul className="mt-4 space-y-2"><CatalogTreeNode node={treePreview.data.root as TreeNode} /></ul><div className="mt-5 rounded-2xl border border-[#eadcbf] bg-[#fffaf0] p-4"><p className="text-sm font-bold text-[#6f5b35]">اعتماد التصنيفات فقط</p><p className="mt-1 text-xs leading-5 text-[#7a6951]">يحفظ هذا الزر مجلدات التصنيف فقط في المنصة، ولا ينشئ منتجات ولا يغير ملفات OneDrive. سيبقى استيراد المنتجات خطوة منفصلة بعد مراجعة هذه الشجرة.</p><Button onClick={() => syncTree.mutate()} disabled={!canConfigure || syncTree.isPending} className="mt-3 bg-[#173f38] text-white hover:bg-[#245b4d]">{syncTree.isPending ? "جارٍ حفظ التصنيفات" : "اعتماد شجرة التصنيفات"}</Button>{syncTree.data && <p className="mt-3 text-xs text-[#245b4d]">تم إنشاء {syncTree.data.created} وتحديث {syncTree.data.updated} تصنيفاً.</p>}{syncTree.error && <p className="mt-3 text-xs text-[#9c4b25]">{syncTree.error.message}</p>}</div></>}</div>}</section>}

    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}><DialogContent dir="rtl" className="max-w-lg"><DialogHeader><DialogTitle>اختيار جذر شجرة المنتجات</DialogTitle><DialogDescription>اختر المجلد الأعلى الذي يحتوي الأقسام الرئيسية. ستظهر مجلداته الداخلية في مرحلة المعاينة قبل أي استيراد.</DialogDescription></DialogHeader><div className="mt-2 max-h-[50vh] space-y-2 overflow-y-auto">{roots.isLoading && <p className="flex items-center gap-2 rounded-xl bg-[#f7f4ed] p-3 text-sm text-[#68756e]"><RefreshCw className="h-4 w-4 animate-spin" />جارٍ قراءة المجلدات…</p>}{roots.error && <p className="rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-sm text-[#9c4b25]">{roots.error.message}</p>}{roots.data?.map(folder => <button type="button" key={folder.id} onClick={() => selectRoot.mutate({ folderId: folder.id })} disabled={selectRoot.isPending} className="flex w-full items-center justify-between rounded-xl border border-[#e3e9e4] bg-white px-4 py-3 text-right transition hover:border-[#9bc7b1] hover:bg-[#f5fbf7]"><span className="font-semibold text-[#28463b]">{folder.name}</span><span className="text-xs text-[#64786e]">اختيار</span></button>)}{roots.data && !roots.data.length && <p className="rounded-xl bg-[#f7f4ed] p-3 text-sm text-[#68756e]">لا توجد مجلدات صالحة في جذر OneDrive.</p>}</div></DialogContent></Dialog>
  </main>;
}
