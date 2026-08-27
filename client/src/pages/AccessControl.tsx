import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { EyeOff, LockKeyhole, ScrollText, ShieldCheck, UserCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type CatalogPermission = { code: string; group: string; label: string };

export default function AccessControl() {
  const profile = trpc.access.myProfile.useQuery();
  const canManageStaff = profile.data?.permissions.includes("staff.manage") ?? false;
  const catalog = trpc.access.catalog.useQuery(undefined, { enabled: canManageStaff });
  const staff = trpc.access.listStaff.useQuery(undefined, { enabled: canManageStaff });
  const assignableUsers = trpc.access.listAssignableUsers.useQuery(undefined, { enabled: canManageStaff });
  const recentAudit = trpc.access.recentAudit.useQuery(undefined, { enabled: canManageStaff });
  const utils = trpc.useUtils();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [draftDisplayName, setDraftDisplayName] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftActive, setDraftActive] = useState(true);

  const catalogItems = (catalog.data ?? []) as CatalogPermission[];
  const grouped = useMemo(() => catalogItems.reduce<Record<string, CatalogPermission[]>>((acc, permission) => {
    acc[permission.group] = [...(acc[permission.group] ?? []), permission];
    return acc;
  }, {}), [catalogItems]);
  const members = useMemo(() => [
    ...(staff.data ?? []),
    ...(assignableUsers.data ?? []).map(user => ({
      employeeId: null,
      storeId: null,
      storeName: null,
      userId: user.userId,
      name: user.name,
      displayName: null,
      jobTitle: null,
      isActive: true,
      email: user.email,
      role: user.role,
      permissions: [] as string[],
    })),
  ], [staff.data, assignableUsers.data]);
  const selectedMember = useMemo(
    () => members.find(member => member.userId === selectedUserId) ?? null,
    [members, selectedUserId],
  );
  const saveAccess = trpc.access.saveStaffAccess.useMutation({
    onSuccess: async () => {
      await utils.access.listStaff.invalidate();
      await utils.access.myProfile.invalidate();
      await utils.access.recentAudit.invalidate();
    },
  });

  useEffect(() => {
    if (selectedUserId === null && members[0]) setSelectedUserId(members[0].userId);
  }, [members, selectedUserId]);

  useEffect(() => {
    if (!selectedMember) return;
    setDraftPermissions(selectedMember.permissions);
    setDraftDisplayName(selectedMember.displayName ?? selectedMember.name ?? selectedMember.email ?? "موظف");
    setDraftTitle(selectedMember.jobTitle ?? "");
    setDraftActive(selectedMember.isActive ?? true);
  }, [selectedMember]);

  const togglePermission = (code: string) => {
    setDraftPermissions(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]);
  };

  const saveSelectedMember = () => {
    if (!selectedMember || draftDisplayName.trim().length < 2) return;
    saveAccess.mutate({
      userId: selectedMember.userId,
      displayName: draftDisplayName.trim(),
      jobTitle: draftTitle.trim() || undefined,
      isActive: draftActive,
      permissionCodes: draftPermissions as never,
    });
  };

  return (
    <div dir="rtl" className="mx-auto w-full min-w-0 max-w-7xl space-y-6 pb-10">
      <header className="flex flex-col justify-between gap-4 rounded-[2rem] border border-[#e8e2d5] bg-white px-6 py-7 shadow-[0_12px_30px_rgba(45,57,48,0.06)] sm:flex-row sm:items-end sm:px-8">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-[#9a7b3e]">نواة التشغيل — AC-001</p>
          <h1 className="mt-2 text-2xl font-bold text-[#243a34]">الصلاحيات الدقيقة وحماية البيانات</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6a746e]">تُمنح العملية، لا الوصول الشامل. ويُعامل سعر التكلفة والهامش كبيانات مالية حساسة لا تمر إلى غير المخول.</p>
        </div>
        <Badge className="w-fit bg-[#e7f3ed] text-[#1f5b4f] hover:bg-[#e7f3ed]">{profile.data?.store?.store.name ?? "جارٍ تحديد المتجر"}</Badge>
      </header>

      <section className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
        <article className="rounded-2xl bg-[#153d35] p-6 text-white shadow-[0_18px_40px_rgba(18,59,51,0.18)]">
          <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-[#f0d492]" /><h2 className="font-bold">القاعدة المالية</h2></div>
          <p className="mt-4 text-sm leading-7 text-[#dceae5]">إخفاء الحقل في الشاشة وحده لا يكفي. قبل إعادة أي تكلفة أو هامش أو ربح، تتحقق الواجهة الخلفية من التصريح المالي أو من حساب المدير.</p>
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.08] p-4 text-sm"><div className="flex items-center justify-between"><span>حالة وصولك</span><span className="font-bold text-[#f0d492]">{profile.data?.canViewSensitiveFinancialData ? "مخوّل" : "محجوب"}</span></div></div>
        </article>
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div className="flex items-center gap-3"><UserCog className="h-5 w-5 text-[#1f5b4f]" /><div><h2 className="font-bold text-[#243a34]">كتالوج العمليات</h2><p className="text-xs text-[#74817a]">المدير يحدد لكل موظف ما يستطيع فعله داخل كل قسم.</p></div></div>
          {profile.isLoading ? <div className="mt-5 h-40 animate-pulse rounded-xl bg-[#f6f5f0]" /> : !canManageStaff ? <p className="mt-5 rounded-xl bg-[#f6f5f0] p-4 text-sm leading-6 text-[#6a746e]">يعرض هذا القسم صلاحياتك الشخصية وحالة وصولك فقط. تحتاج إلى تصريح «إدارة موظفي المتجر وصلاحياتهم» لعرض أعضاء الفريق أو تعديل منحهم.</p> : catalog.isLoading ? <div className="mt-5 h-40 animate-pulse rounded-xl bg-[#f6f5f0]" /> : catalog.error ? <p className="mt-5 rounded-xl bg-[#fff4ed] p-4 text-sm text-[#9c4b25]">تعذر تحميل كتالوج العمليات الآن. تظل صلاحياتك الشخصية محمية ولا تتغير بسبب هذا العرض.</p> : <div className="mt-5 grid gap-3 md:grid-cols-2">{Object.entries(grouped).map(([group, permissions]) => <div key={group} className="rounded-xl border border-[#eee8da] p-4"><h3 className="text-sm font-bold text-[#425148]">{group}</h3><ul className="mt-3 space-y-2">{permissions.map(permission => <li key={permission.code} className="flex items-center gap-2 text-xs text-[#69756d]"><span className="h-1.5 w-1.5 rounded-full bg-[#c49e54]" />{permission.label}</li>)}</ul></div>)}</div>}
        </article>
      </section>

      {canManageStaff && <section className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-5 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div className="flex items-center justify-between"><div><h2 className="font-bold text-[#243a34]">أعضاء الفريق</h2><p className="mt-1 text-xs text-[#74817a]">اختر حساباً مسجلاً لربطه بالمتجر الحالي وتعيين عملياته.</p></div><UserCog className="h-5 w-5 text-[#1f5b4f]" /></div>
          <div className="mt-4 space-y-2">
            {staff.isLoading && <div className="h-16 animate-pulse rounded-xl bg-[#f6f5f0]" />}
            {members.map(member => <button key={member.userId} onClick={() => setSelectedUserId(member.userId)} className={`w-full rounded-xl border p-3 text-right transition-colors ${selectedMember?.userId === member.userId ? "border-[#78aa99] bg-[#edf5f1]" : "border-[#eee8da] hover:bg-[#faf8f2]"}`}><span className="block text-sm font-bold text-[#33463e]">{member.displayName ?? member.name ?? member.email ?? "موظف جديد"}</span><span className="mt-1 block text-xs text-[#74817a]">{member.jobTitle ?? (member.employeeId ? "لم يحدد الدور التشغيلي بعد" : "حساب غير مربوط — جاهز للإضافة")}</span></button>)}
            {!staff.isLoading && !assignableUsers.isLoading && members.length === 0 && <p className="rounded-xl bg-[#f6f5f0] p-4 text-sm text-[#6a746e]">لا توجد حسابات مسجلة بعد. يسجل الموظف دخوله أولًا، ثم يظهر هنا لتمنح صلاحياته.</p>}
          </div>
        </article>
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div><h2 className="font-bold text-[#243a34]">تخصيص العمليات</h2><p className="mt-1 text-xs text-[#74817a]">منح محدد لكل عملية، مع بقاء البيانات المالية منفصلة عن بقية عمليات المنتج.</p></div>
          {selectedMember ? <>
            {!selectedMember.employeeId && <p className="mt-4 rounded-xl border border-[#cfe4d9] bg-[#f1f8f4] p-3 text-sm text-[#315f51]">سيُربط هذا الحساب بمتجر {profile.data?.store?.store.name ?? "التشغيل الحالي"} عند الحفظ.</p>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-sm text-[#516058]">الاسم الظاهر<input value={draftDisplayName} onChange={event => setDraftDisplayName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#ded7c8] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#5b9984]" /></label><label className="text-sm text-[#516058]">المسمى التشغيلي<input value={draftTitle} onChange={event => setDraftTitle(event.target.value)} placeholder="مثال: موظف منتجات" className="mt-1.5 w-full rounded-xl border border-[#ded7c8] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#5b9984]" /></label></div>
            <button onClick={() => setDraftActive(value => !value)} className="mt-4 flex items-center gap-2 text-sm text-[#4f5f57]"><span className={`h-5 w-9 rounded-full p-0.5 transition-colors ${draftActive ? "bg-[#3c9076]" : "bg-[#cfc8bb]"}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${draftActive ? "translate-x-0" : "-translate-x-4"}`} /></span>{draftActive ? "الحساب التشغيلي فعّال" : "الحساب التشغيلي موقوف"}</button>
            <div className="mt-5 grid gap-3 md:grid-cols-2">{Object.entries(grouped).map(([group, permissions]) => <div key={group} className="rounded-xl bg-[#fbfaf6] p-4"><h3 className="text-sm font-bold text-[#425148]">{group}</h3><div className="mt-3 space-y-2">{permissions.map(permission => <label key={permission.code} className="flex items-center gap-2 text-xs text-[#617068]"><input checked={draftPermissions.includes(permission.code)} onChange={() => togglePermission(permission.code)} type="checkbox" className="h-4 w-4 accent-[#1f5b4f]" />{permission.label}</label>)}</div></div>)}</div>
            {saveAccess.error && <p className="mt-4 rounded-xl bg-[#fff4ed] p-3 text-sm text-[#9c4b25]">{saveAccess.error.message}</p>}
            <Button onClick={saveSelectedMember} disabled={saveAccess.isPending || draftDisplayName.trim().length < 2} className="mt-5 bg-[#1f5b4f] hover:bg-[#153d35]">{saveAccess.isPending ? "جارٍ الحفظ..." : "حفظ الصلاحيات"}</Button>
          </> : <p className="mt-5 rounded-xl bg-[#f6f5f0] p-4 text-sm text-[#6a746e]">اختر موظفًا مسجلًا لبدء تعيين العمليات المسموحة له.</p>}
        </article>
      </section>}

      {canManageStaff && <section className="rounded-2xl border border-[#e8e2d5] bg-white p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
        <div className="flex items-center gap-3"><ScrollText className="h-5 w-5 text-[#1f5b4f]" /><div><h2 className="font-bold text-[#243a34]">آخر تغييرات الصلاحيات</h2><p className="text-xs text-[#74817a]">سجل قابل للمراجعة ضمن المتجر التشغيلي الحالي فقط.</p></div></div>
        {recentAudit.isLoading ? <div className="mt-4 h-20 animate-pulse rounded-xl bg-[#f6f5f0]" /> : recentAudit.data?.length ? <div className="mt-4 divide-y divide-[#eee8da] rounded-xl border border-[#eee8da]">{recentAudit.data.map(event => <div key={event.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-medium text-[#425148]">{event.summary}</p><span className="text-xs text-[#74817a]">{new Date(event.createdAt).toLocaleString("ar-IQ")}</span></div>)}</div> : <p className="mt-4 rounded-xl bg-[#f6f5f0] p-4 text-sm text-[#6a746e]">لم تسجل تغييرات صلاحيات في هذا المتجر بعد.</p>}
      </section>}

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-5"><LockKeyhole className="h-5 w-5 text-[#8a6a2d]" /><h2 className="mt-4 font-bold text-[#243a34]">منع على مستوى الخادم</h2><p className="mt-2 text-sm leading-6 text-[#6a746e]">يُرفض الوصول غير المصرح به حتى لو أُرسلت الطلبات خارج الواجهة.</p></article>
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-5"><EyeOff className="h-5 w-5 text-[#8a6a2d]" /><h2 className="mt-4 font-bold text-[#243a34]">تقارير بمستويين</h2><p className="mt-2 text-sm leading-6 text-[#6a746e]">الموظف يرى ما يحتاجه للعمل؛ المدير يرى التكلفة والهامش والنتيجة المالية.</p></article>
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-5"><ShieldCheck className="h-5 w-5 text-[#8a6a2d]" /><h2 className="mt-4 font-bold text-[#243a34]">تدقيق قابل للقياس</h2><p className="mt-2 text-sm leading-6 text-[#6a746e]">يرتبط هذا الفرع باختبار قبول يمنع إغلاقه قبل فحص الحالات المسموحة والمرفوضة.</p></article>
      </section>
    </div>
  );
}
