import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, ClipboardCheck, Clock3, Edit3, FileText, LoaderCircle, MapPin, MessageSquareText, Phone, Plus, Save, Search, ShoppingBag, Tags, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Stage = "new" | "active" | "repeat" | "needs_followup" | "inactive";

const stageMeta: Record<Stage, { label: string; tone: string }> = {
  new: { label: "جديد", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  active: { label: "نشط", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  repeat: { label: "متكرر", tone: "bg-violet-50 text-violet-800 ring-violet-200" },
  needs_followup: { label: "يحتاج متابعة", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  inactive: { label: "غير نشط", tone: "bg-slate-100 text-slate-700 ring-slate-200" },
};

const taskMeta = {
  open: { label: "مفتوحة", tone: "bg-amber-50 text-amber-800" },
  completed: { label: "مكتملة", tone: "bg-emerald-50 text-emerald-800" },
  cancelled: { label: "ملغاة", tone: "bg-slate-100 text-slate-700" },
} as const;

function formatMoney(value: string) {
  return `${new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 0 }).format(Number(value))} د.ع`;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" });
}

function StageBadge({ stage }: { stage: Stage }) {
  const meta = stageMeta[stage];
  return <Badge className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${meta.tone} hover:${meta.tone}`}>{meta.label}</Badge>;
}

export default function CRM() {
  const profile = trpc.access.myProfile.useQuery();
  const canView = profile.data?.permissions.includes("crm.view") ?? false;
  const canManage = profile.data?.permissions.includes("crm.manage") ?? false;
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<Stage | "all">("all");
  const [tagId, setTagId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const listInput = useMemo(() => ({ search: search.trim() || undefined, stage: stage === "all" ? undefined : stage, tagId: tagId ?? undefined }), [search, stage, tagId]);
  const detailInput = useMemo(() => selectedCustomerId ? { customerId: selectedCustomerId } : skipToken, [selectedCustomerId]);
  const customers = trpc.crm.list.useQuery(listInput, { enabled: canView });
  const tags = trpc.crm.tags.useQuery(undefined, { enabled: canView });
  const detail = trpc.crm.detail.useQuery(detailInput, { enabled: canView && detailInput !== skipToken });
  const assignees = trpc.crm.taskAssignees.useQuery(undefined, { enabled: canManage });
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!selectedCustomerId && customers.data?.[0]) setSelectedCustomerId(customers.data[0].id);
  }, [customers.data, selectedCustomerId]);

  const refreshSelected = async () => {
    await Promise.all([utils.crm.list.invalidate(), utils.crm.detail.invalidate(), utils.crm.tags.invalidate()]);
  };

  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [address, setAddress] = useState("");
  const [editStage, setEditStage] = useState<Stage>("new");
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNote, setTaskNote] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("unassigned");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("slate");

  useEffect(() => {
    const customer = detail.data?.customer;
    if (!customer) return;
    setName(customer.displayName);
    setPhone(customer.phoneDisplay);
    setGovernorate(customer.governorate ?? "");
    setAddress(customer.lastAddress ?? "");
    setEditStage(customer.relationshipStage as Stage);
    setEditMode(false);
  }, [detail.data?.customer?.id]);

  const updateProfile = trpc.crm.updateProfile.useMutation({ onSuccess: async () => { await refreshSelected(); setEditMode(false); toast.success("تم حفظ ملف العميل."); }, onError: error => toast.error(error.message) });
  const addNote = trpc.crm.addNote.useMutation({ onSuccess: async () => { await refreshSelected(); setNote(""); toast.success("أُضيفت الملاحظة إلى التسلسل الزمني."); }, onError: error => toast.error(error.message) });
  const assignTag = trpc.crm.assignTag.useMutation({ onSuccess: async () => { await refreshSelected(); toast.success("تمت إضافة الوسم."); }, onError: error => toast.error(error.message) });
  const removeTag = trpc.crm.removeTag.useMutation({ onSuccess: async () => { await refreshSelected(); toast.success("تمت إزالة الوسم."); }, onError: error => toast.error(error.message) });
  const createTag = trpc.crm.createTag.useMutation({ onSuccess: async () => { await refreshSelected(); setNewTagName(""); toast.success("تم إنشاء الوسم."); }, onError: error => toast.error(error.message) });
  const createTask = trpc.crm.createTask.useMutation({ onSuccess: async () => { await refreshSelected(); setTaskTitle(""); setTaskNote(""); setTaskAssignee("unassigned"); toast.success("تمت إضافة مهمة متابعة."); }, onError: error => toast.error(error.message) });
  const changeTaskStatus = trpc.crm.changeTaskStatus.useMutation({ onSuccess: async () => { await refreshSelected(); toast.success("تم تحديث حالة المهمة."); }, onError: error => toast.error(error.message) });

  const current = detail.data?.customer;
  const usedTagIds = new Set(detail.data?.tags.map(tag => tag.id) ?? []);
  const availableTags = (tags.data ?? []).filter(tag => !usedTagIds.has(tag.id));

  if (profile.isLoading) return <CRMPageSkeleton />;
  if (!canView) return <CRMForbidden />;

  return (
    <div dir="rtl" className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <header className="overflow-hidden rounded-[2rem] border border-[#e8e2d5] bg-[radial-gradient(circle_at_88%_8%,#f8eed8,transparent_34%),linear-gradient(135deg,#ffffff_0%,#fbfaf6_100%)] px-6 py-7 shadow-[0_12px_30px_rgba(45,57,48,0.06)] sm:px-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-[#9a7b3e]">إدارة العملاء — CRM</p>
            <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold text-[#243a34]"><UsersRound className="h-7 w-7 text-[#1f5b4f]" />ملفات العملاء والمتابعة</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6a746e]">ملف واحد لكل رقم هاتف داخل المتجر، مع الطلبات الفعلية والوسوم والملاحظات ومهام المتابعة في مكان واحد.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Metric label="العملاء المعروضون" value={String(customers.data?.length ?? 0)} />
            <Metric label="مهام مفتوحة" value={String((customers.data ?? []).reduce((total, item) => total + item.openTaskCount, 0))} />
          </div>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.55fr)]">
        <aside className="overflow-hidden rounded-2xl border border-[#e8e2d5] bg-white shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div className="border-b border-[#eee8da] p-4">
            <div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829087]" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحثي بالاسم أو الهاتف" className="h-10 rounded-xl border-[#ded7c8] pr-9 text-right" /></div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Select value={stage} onValueChange={value => setStage(value as Stage | "all")}><SelectTrigger className="h-9 rounded-lg border-[#ded7c8] text-xs"><SelectValue placeholder="كل المراحل" /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="all">كل المراحل</SelectItem>{Object.entries(stageMeta).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}</SelectContent></Select>
              <Select value={tagId ? String(tagId) : "all"} onValueChange={value => setTagId(value === "all" ? null : Number(value))}><SelectTrigger className="h-9 rounded-lg border-[#ded7c8] text-xs"><SelectValue placeholder="كل الوسوم" /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="all">كل الوسوم</SelectItem>{(tags.data ?? []).map(tag => <SelectItem key={tag.id} value={String(tag.id)}>{tag.name}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <div className="max-h-[650px] divide-y divide-[#f0ece1] overflow-y-auto">
            {customers.isLoading ? <CustomerListSkeleton /> : customers.error ? <InlineError message="تعذر تحميل العملاء. لن تتغير البيانات بسبب هذا الخطأ، يمكنك إعادة المحاولة." onRetry={() => customers.refetch()} /> : customers.data?.length ? customers.data.map(customer => <button key={customer.id} onClick={() => setSelectedCustomerId(customer.id)} className={`w-full px-4 py-4 text-right transition-colors ${selectedCustomerId === customer.id ? "bg-[#edf5f1]" : "hover:bg-[#fbfaf6]"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-[#33463e]">{customer.displayName}</p><p dir="ltr" className="mt-1 text-right text-xs text-[#74817a]">{customer.phoneDisplay}</p></div><StageBadge stage={customer.relationshipStage as Stage} /></div><div className="mt-3 flex flex-wrap items-center gap-1.5">{customer.tags.slice(0, 2).map(tag => <TagPill key={tag.id} name={tag.name} color={tag.color} />)}{customer.tags.length > 2 && <span className="text-xs text-[#7a877f]">+{customer.tags.length - 2}</span>}<span className="mr-auto text-xs text-[#617068]">{customer.orderCount} طلب</span></div>{customer.openTaskCount > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#a4651f]"><ClipboardCheck className="h-3.5 w-3.5" />{customer.openTaskCount} متابعة مفتوحة</p>}</button>) : <EmptyCustomers />}
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-[#e8e2d5] bg-white shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          {detail.isLoading || (selectedCustomerId !== null && !current) ? <CustomerDetailSkeleton /> : detail.error ? <div className="p-6"><InlineError message="تعذر فتح ملف العميل. يمكنك العودة إلى القائمة واختيار ملف آخر." onRetry={() => detail.refetch()} /></div> : current ? <>
            <div className="border-b border-[#eee8da] p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="flex min-w-0 items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#dff0e9] text-lg font-bold text-[#1f5b4f]">{current.displayName.slice(0, 1)}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-bold text-[#243a34]">{current.displayName}</h2><StageBadge stage={current.relationshipStage as Stage} /></div><p dir="ltr" className="mt-1 text-right text-sm text-[#617068]">{current.phoneDisplay}</p><p className="mt-2 flex items-center gap-1.5 text-xs text-[#78867d]"><Clock3 className="h-3.5 w-3.5" />آخر طلب: {formatDate(current.lastOrderAt)}</p></div></div>
                {canManage && <Button variant={editMode ? "outline" : "default"} onClick={() => setEditMode(value => !value)} className="rounded-xl bg-[#1f5b4f] hover:bg-[#153d35]"><Edit3 className="ml-2 h-4 w-4" />{editMode ? "إلغاء التعديل" : "تعديل الملف"}</Button>}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">{(detail.data?.tags ?? []).map(tag => <span key={tag.id} className="group flex items-center gap-1"><TagPill name={tag.name} color={tag.color} />{canManage && <button onClick={() => removeTag.mutate({ customerId: current.id, tagId: tag.id })} className="-mr-1 rounded-full p-1 text-[#8a958d] hover:bg-[#f5e9e5] hover:text-[#a84f34]" aria-label={`إزالة وسم ${tag.name}`}><X className="h-3 w-3" /></button>}</span>)}{canManage && availableTags.map(tag => <button key={tag.id} disabled={assignTag.isPending} onClick={() => assignTag.mutate({ customerId: current.id, tagId: tag.id })} className="rounded-full border border-dashed border-[#cfc8bb] px-2.5 py-1 text-xs text-[#69756d] hover:border-[#85af9e] hover:bg-[#f2f8f5]">+ {tag.name}</button>)}</div>
            </div>

            {editMode && <div className="border-b border-[#eee8da] bg-[#fbfaf6] p-5 sm:p-6"><div className="grid gap-3 md:grid-cols-2"><FormField label="الاسم الظاهر"><Input value={name} onChange={event => setName(event.target.value)} /></FormField><FormField label="رقم الهاتف"><Input dir="ltr" value={phone} onChange={event => setPhone(event.target.value)} /></FormField><FormField label="المحافظة"><Input value={governorate} onChange={event => setGovernorate(event.target.value)} /></FormField><FormField label="مرحلة العلاقة"><Select value={editStage} onValueChange={value => setEditStage(value as Stage)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent dir="rtl">{Object.entries(stageMeta).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}</SelectContent></Select></FormField><div className="md:col-span-2"><FormField label="آخر عنوان معروف"><Textarea value={address} onChange={event => setAddress(event.target.value)} className="min-h-20" /></FormField></div></div><Button disabled={updateProfile.isPending || !name.trim() || !phone.trim()} onClick={() => updateProfile.mutate({ customerId: current.id, displayName: name.trim(), phoneDisplay: phone.trim(), governorate: governorate.trim() || null, lastAddress: address.trim() || null, relationshipStage: editStage })} className="mt-4 rounded-xl bg-[#1f5b4f] hover:bg-[#153d35]"><Save className="ml-2 h-4 w-4" />{updateProfile.isPending ? "جارٍ الحفظ..." : "حفظ بيانات العميل"}</Button></div>}

            <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.18fr)_minmax(260px,0.82fr)]">
              <div className="space-y-5"><section><SectionTitle icon={<ShoppingBag />} title="الطلبات الفعلية" subtitle="لقطات الطلب تبقى كما أُرسلت حتى عند تعديل ملف العميل." /><div className="mt-3 overflow-hidden rounded-xl border border-[#eee8da]">{detail.data?.orders.length ? detail.data.orders.map(order => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0ece1] px-4 py-3 last:border-0"><div><p className="font-mono text-xs font-bold text-[#315f51]">{order.orderNumber}</p><p className="mt-1 text-xs text-[#758279]">{formatDate(order.createdAt)}</p></div><div className="text-left"><p className="text-sm font-bold text-[#33463e]">{formatMoney(order.total)}</p><p className="mt-1 text-xs text-[#6f7c74]">{order.status}</p></div></div>) : <SmallEmpty text="لا توجد طلبات مرتبطة بهذا الملف حتى الآن." />}</div></section>
                <section><SectionTitle icon={<Clock3 />} title="التسلسل الزمني" subtitle="أحداث قابلة للمراجعة للملف والطلبات والمتابعة." /><div className="mt-3 space-y-0">{detail.data?.activities.length ? detail.data.activities.map((activity, index) => <div key={activity.id} className="relative flex gap-3 pb-5 last:pb-0"><div className="relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#edf5f1] text-[#1f5b4f]"><ActivityIcon type={activity.type} /></div>{index < (detail.data?.activities.length ?? 0) - 1 && <span className="absolute right-3.5 top-7 h-[calc(100%-12px)] w-px bg-[#e3e9e4]" />}<div className="min-w-0 flex-1 rounded-xl bg-[#fbfaf6] px-3.5 py-3"><p className="text-sm font-semibold text-[#3c4c44]">{activity.title}</p>{activity.body && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[#68756d]">{activity.body}</p>}<p className="mt-2 text-xs text-[#8a958d]">{formatDate(activity.occurredAt)}</p></div></div>) : <SmallEmpty text="سيظهر سجل الأنشطة هنا عند وصول أول طلب أو إضافة متابعة." />}</div></section>
              </div>

              <aside className="space-y-5"><section className="rounded-2xl bg-[#153d35] p-4 text-white"><p className="text-xs text-[#b9d8cd]">ملخص العميل</p><div className="mt-4 grid grid-cols-2 gap-3"><SummaryItem label="عدد الطلبات" value={String(detail.data?.orders.length ?? 0)} /><SummaryItem label="إجمالي الطلبات" value={formatMoney(detail.data?.orders.reduce((sum, order) => sum + Number(order.total), 0).toFixed(2) ?? "0.00")} /></div><div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-xs text-[#d7e7e0]"><p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-[#f0d492]" />{current.phoneDisplay}</p>{current.governorate && <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-[#f0d492]" />{current.governorate}</p>}{current.lastAddress && <p className="leading-5">{current.lastAddress}</p>}</div></section>
                {canManage && <section className="rounded-2xl border border-[#eee8da] p-4"><SectionTitle icon={<MessageSquareText />} title="ملاحظة داخلية" /><Textarea value={note} onChange={event => setNote(event.target.value)} placeholder="تظهر للفريق فقط، وليست رسالة للعميل." className="mt-3 min-h-24 resize-y" /><Button disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate({ customerId: current.id, body: note.trim() })} className="mt-3 w-full rounded-xl bg-[#1f5b4f] hover:bg-[#153d35]"><FileText className="ml-2 h-4 w-4" />{addNote.isPending ? "جارٍ الإضافة..." : "إضافة ملاحظة"}</Button></section>}
                <section className="rounded-2xl border border-[#eee8da] p-4"><SectionTitle icon={<ClipboardCheck />} title="مهام المتابعة" subtitle="تربط المتابعة بعميل محدد، لا بحالة الطلب." /><div className="mt-3 space-y-2">{detail.data?.tasks.length ? detail.data.tasks.map(task => <div key={task.id} className="rounded-xl bg-[#fbfaf6] p-3"><div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-[#425148]">{task.title}</p><Badge className={`rounded-full text-[11px] ${taskMeta[task.status].tone}`}>{taskMeta[task.status].label}</Badge></div>{task.note && <p className="mt-1.5 text-xs leading-5 text-[#718077]">{task.note}</p>}{canManage && task.status === "open" && <Button variant="ghost" size="sm" disabled={changeTaskStatus.isPending} onClick={() => changeTaskStatus.mutate({ customerId: current.id, taskId: task.id, status: "completed" })} className="mt-2 h-7 px-2 text-xs text-[#276a56] hover:bg-[#e7f3ed] hover:text-[#1f5b4f]"><CheckCircle2 className="ml-1 h-3.5 w-3.5" />إنجاز</Button>}</div>) : <SmallEmpty text="لا توجد متابعة مجدولة." />}</div>{canManage && <div className="mt-3 border-t border-[#eee8da] pt-3"><Input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="عنوان مهمة متابعة" /><Textarea value={taskNote} onChange={event => setTaskNote(event.target.value)} placeholder="تفاصيل اختيارية" className="mt-2 min-h-16" /><Select value={taskAssignee} onValueChange={setTaskAssignee}><SelectTrigger className="mt-2"><SelectValue placeholder="إسناد اختياري" /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="unassigned">من دون إسناد</SelectItem>{(assignees.data ?? []).map(person => <SelectItem key={person.id} value={String(person.id)}>{person.displayName}{person.jobTitle ? ` — ${person.jobTitle}` : ""}</SelectItem>)}</SelectContent></Select><Button disabled={!taskTitle.trim() || createTask.isPending} onClick={() => createTask.mutate({ customerId: current.id, title: taskTitle.trim(), note: taskNote.trim() || null, assigneeEmployeeId: taskAssignee === "unassigned" ? null : Number(taskAssignee) })} className="mt-2 w-full rounded-xl bg-[#1f5b4f] hover:bg-[#153d35]"><Plus className="ml-2 h-4 w-4" />{createTask.isPending ? "جارٍ الإضافة..." : "إضافة متابعة"}</Button></div>}</section>
                {canManage && <section className="rounded-2xl border border-[#eee8da] p-4"><SectionTitle icon={<Tags />} title="وسم جديد" subtitle="الوسم متاح داخل المتجر الحالي فقط." /><div className="mt-3 flex gap-2"><Input value={newTagName} onChange={event => setNewTagName(event.target.value)} placeholder="مثال: تفضّل الأسود" /><Select value={newTagColor} onValueChange={setNewTagColor}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="slate">رمادي</SelectItem><SelectItem value="emerald">أخضر</SelectItem><SelectItem value="violet">بنفسجي</SelectItem><SelectItem value="amber">ذهبي</SelectItem></SelectContent></Select></div><Button disabled={!newTagName.trim() || createTag.isPending} onClick={() => createTag.mutate({ name: newTagName.trim(), color: newTagColor })} variant="outline" className="mt-2 w-full rounded-xl border-[#b9d8cd] text-[#1f5b4f] hover:bg-[#edf5f1]"><Tags className="ml-2 h-4 w-4" />إنشاء وسم</Button></section>}
              </aside>
            </div>
          </> : <EmptyCustomers />}
        </section>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-[#e9dfc9] bg-white/80 px-4 py-3 text-right"><p className="text-xl font-bold text-[#243a34]">{value}</p><p className="mt-0.5 text-xs text-[#78867d]">{label}</p></div>; }
function TagPill({ name, color }: { name: string; color: string }) { const tones: Record<string, string> = { emerald: "bg-emerald-50 text-emerald-800", violet: "bg-violet-50 text-violet-800", amber: "bg-amber-50 text-amber-800", slate: "bg-slate-100 text-slate-700" }; return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[color] ?? tones.slate}`}>{name}</span>; }
function FormField({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-[#617068]"><span className="mb-1.5 block">{label}</span>{children}</label>; }
function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) { return <div className="flex items-start gap-2"><span className="mt-0.5 text-[#1f5b4f] [&>svg]:h-4 [&>svg]:w-4">{icon}</span><div><h3 className="text-sm font-bold text-[#33463e]">{title}</h3>{subtitle && <p className="mt-0.5 text-xs leading-5 text-[#78867d]">{subtitle}</p>}</div></div>; }
function SummaryItem({ label, value }: { label: string; value: string }) { return <div><p className="text-lg font-bold text-[#f9edd4]">{value}</p><p className="mt-0.5 text-[11px] text-[#b9d8cd]">{label}</p></div>; }
function ActivityIcon({ type }: { type: string }) { if (type.includes("order")) return <ShoppingBag className="h-3.5 w-3.5" />; if (type.includes("task")) return <ClipboardCheck className="h-3.5 w-3.5" />; if (type.includes("tag")) return <Tags className="h-3.5 w-3.5" />; if (type === "note") return <MessageSquareText className="h-3.5 w-3.5" />; return <UserRound className="h-3.5 w-3.5" />; }
function SmallEmpty({ text }: { text: string }) { return <p className="rounded-xl bg-[#fbfaf6] px-3 py-4 text-center text-xs leading-5 text-[#78867d]">{text}</p>; }
function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="rounded-xl bg-[#fff4ed] p-4 text-sm leading-6 text-[#9c4b25]"><p>{message}</p><Button variant="outline" size="sm" onClick={onRetry} className="mt-3 border-[#e8c3ad] bg-white text-[#874324]">إعادة المحاولة</Button></div>; }
function EmptyCustomers() { return <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf5f1] text-[#1f5b4f]"><UsersRound className="h-6 w-6" /></div><h2 className="mt-4 font-bold text-[#33463e]">لا توجد ملفات عملاء مطابقة</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[#74817a]">تُنشأ الملفات تلقائياً عند وصول طلب جديد بالهاتف المسجل، ثم تظهر هنا ضمن متجر التشغيل الحالي.</p></div>; }
function CustomerListSkeleton() { return <div className="space-y-4 p-4">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-[#f6f5f0]" />)}</div>; }
function CustomerDetailSkeleton() { return <div className="space-y-5 p-6"><div className="h-20 animate-pulse rounded-2xl bg-[#f6f5f0]" /><div className="grid gap-4 lg:grid-cols-2"><div className="h-64 animate-pulse rounded-2xl bg-[#f6f5f0]" /><div className="h-64 animate-pulse rounded-2xl bg-[#f6f5f0]" /></div></div>; }
function CRMPageSkeleton() { return <div className="mx-auto max-w-[1600px] space-y-5"><div className="h-40 animate-pulse rounded-[2rem] bg-[#f6f5f0]" /><div className="grid gap-5 xl:grid-cols-[0.78fr_1.55fr]"><div className="h-[550px] animate-pulse rounded-2xl bg-[#f6f5f0]" /><div className="h-[550px] animate-pulse rounded-2xl bg-[#f6f5f0]" /></div></div>; }
function CRMForbidden() { return <div dir="rtl" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center rounded-[2rem] border border-[#e8e2d5] bg-white p-8 text-center shadow-[0_12px_30px_rgba(45,57,48,0.06)]"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff4ed] text-[#a85a31]"><Circle className="h-7 w-7" /></div><h1 className="mt-5 text-xl font-bold text-[#33463e]">لا تملكين صلاحية عرض CRM</h1><p className="mt-2 text-sm leading-6 text-[#718077]">يمكن لمدير المتجر منح تصريح «عرض ملفات العملاء وسجلهم» من صفحة الصلاحيات. تبقى بيانات العملاء غير مرئية حتى يُمنح التصريح.</p></div>; }
