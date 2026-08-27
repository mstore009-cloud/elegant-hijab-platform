import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Box, Check, CheckCircle2, CircleAlert, ClipboardCheck, ClipboardList, PackageCheck, PackageOpen, PhoneCall, ReceiptText, Truck, X } from "lucide-react";
import { useMemo, useState } from "react";

const labels = { new: "جديد", needs_contact: "تحتاج تواصل", confirmed: "مؤكد", preparing: "قيد التجهيز", out_for_delivery: "خرج للتوصيل", completed: "مكتمل", cancelled: "ملغي" } as const;
const stageLabels = { unstarted: "لم يبدأ", picking: "التقاط القطع", packing: "تغليف القطع", ready: "جاهز للتوصيل", dispatched: "خرج للتوصيل", delivered: "تم التسليم", blocked: "توقف بانتظار معالجة" } as const;
const channels = { storefront: "المتجر", whatsapp: "واتساب", instagram: "Instagram", messenger: "Messenger", manual: "يدوي" } as const;
const outcomes = [{ value: "attempted", label: "تمت المحاولة" }, { value: "no_answer", label: "لا رد" }, { value: "customer_confirmed", label: "أكد العميل" }, { value: "customer_requested_change", label: "طلب تعديل" }, { value: "cancelled", label: "ألغى العميل" }] as const;
type Status = keyof typeof labels;
type FulfillmentStage = keyof typeof stageLabels;
const money = (value: string | number) => `${new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 0 }).format(Number(value) || 0)} د.ع`;
const icon = (s: Status) => s === "confirmed" ? <Check className="ml-1 h-4 w-4" /> : s === "needs_contact" ? <PhoneCall className="ml-1 h-4 w-4" /> : s === "preparing" ? <PackageCheck className="ml-1 h-4 w-4" /> : s === "out_for_delivery" ? <Truck className="ml-1 h-4 w-4" /> : <X className="ml-1 h-4 w-4" />;

function FulfillmentPanel({ orderId, canFulfill, canDispatch }: { orderId: number; canFulfill: boolean; canDispatch: boolean }) {
  const utils = trpc.useUtils();
  const detail = trpc.orders.fulfillmentDetail.useQuery({ orderId });
  const assignees = trpc.orders.fulfillmentAssignees.useQuery(undefined, { enabled: canFulfill });
  const [exceptionNote, setExceptionNote] = useState("");
  const [eventNote, setEventNote] = useState("");
  const refresh = async () => {
    await Promise.all([utils.orders.fulfillmentDetail.invalidate({ orderId }), utils.orders.fulfillmentQueue.invalidate(), utils.orders.byId.invalidate({ orderId }), utils.orders.list.invalidate()]);
  };
  const start = trpc.orders.startFulfillment.useMutation({ onSuccess: refresh });
  const assign = trpc.orders.assignFulfillment.useMutation({ onSuccess: refresh });
  const pick = trpc.orders.startPicking.useMutation({ onSuccess: refresh });
  const check = trpc.orders.setFulfillmentItemCheck.useMutation({ onSuccess: refresh });
  const ready = trpc.orders.markFulfillmentReady.useMutation({ onSuccess: refresh });
  const dispatch = trpc.orders.dispatchFulfillment.useMutation({ onSuccess: refresh });
  const deliver = trpc.orders.deliverFulfillment.useMutation({ onSuccess: refresh });
  const exception = trpc.orders.recordFulfillmentException.useMutation({ onSuccess: async () => { setExceptionNote(""); await refresh(); } });
  const addNote = trpc.orders.addFulfillmentNote.useMutation({ onSuccess: async () => { setEventNote(""); await refresh(); } });
  const isBusy = start.isPending || assign.isPending || pick.isPending || check.isPending || ready.isPending || dispatch.isPending || deliver.isPending || exception.isPending || addNote.isPending;
  const fulfillment = detail.data?.fulfillment;
  const stage = fulfillment?.stage as FulfillmentStage | undefined;
  const allPacked = Boolean(detail.data?.items.length) && detail.data!.items.every(item => item.check?.pickedAt && item.check?.packedAt);

  if (detail.isLoading) return <section className="mt-6 rounded-3xl border border-[#e6ded0] bg-white p-5"><p className="animate-pulse text-sm text-[#68756e]">يجري تحميل سجل التجهيز…</p></section>;
  if (detail.error) return <section className="mt-6 rounded-3xl border border-[#f2d1c7] bg-[#fff7f3] p-5 text-sm text-[#a14724]">تعذر تحميل تجهيز الطلب: {detail.error.message}</section>;

  return <section className="mt-6 rounded-3xl border border-[#dce9df] bg-[#fbfdfb] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-3"><div className="rounded-2xl bg-[#e6f3ea] p-3 text-[#285f4e]"><PackageOpen className="h-5 w-5" /></div><div><h3 className="font-black">رحلة التجهيز اليدوي</h3><p className="mt-1 text-xs text-[#68756e]">لا تغير هذه الرحلة السعر أو القسيمة أو الكمية المخزنية. الكمية خُصمت عند تأكيد الطلب فقط.</p></div></div>
      <span className={`rounded-full px-3 py-1 text-xs font-black ${stage === "blocked" ? "bg-[#fff0e9] text-[#a14724]" : stage === "delivered" ? "bg-[#edf8f1] text-[#285f4e]" : "bg-[#f2eddf] text-[#7b6230]"}`}>{stage ? stageLabels[stage] : "لم يُفتح سجل التجهيز"}</span>
    </div>

    {!fulfillment && <div className="mt-5 rounded-2xl border border-dashed border-[#c9d9ce] bg-white p-4"><p className="text-sm text-[#68756e]">افتح سجل التجهيز عندما يبدأ تجهيز هذا الطلب المؤكد. لا يعد هذا انتقالًا إلى التوصيل ولا إشعارًا خارجيًا.</p>{canFulfill && <Button className="mt-3 bg-[#285f4e]" disabled={isBusy} onClick={() => start.mutate({ orderId })}><ClipboardCheck className="ml-1 h-4 w-4" />فتح سجل التجهيز</Button>}</div>}

    {fulfillment && <>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_.9fr]">
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between gap-2"><b className="text-sm">مسؤول التجهيز</b><span className="text-xs text-[#68756e]">يمكن تغيير المسؤول قبل التسليم</span></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <select aria-label="مسؤول التجهيز" disabled={!canFulfill || isBusy} className="min-w-[220px] flex-1 rounded-xl border border-[#d9dfda] bg-white px-3 py-2 text-sm" value={fulfillment.assignedEmployeeId ?? ""} onChange={event => { const employeeId = Number(event.target.value); if (employeeId) assign.mutate({ orderId, employeeId }); }}>
              <option value="">اختاري موظف تجهيز</option>
              {(assignees.data ?? []).map(member => <option key={member.employeeId} value={member.employeeId}>{member.displayName}{member.jobTitle ? ` — ${member.jobTitle}` : ""}</option>)}
            </select>
          </div>
          {assignees.error && <p className="mt-2 text-xs text-[#a14724]">لا يمكن تحميل قائمة التعيين بصلاحيتك الحالية.</p>}
        </div>
        <div className="rounded-2xl border bg-white p-4"><b className="text-sm">مراحل العمل</b><div className="mt-3 flex flex-wrap gap-2 text-xs">{["picking", "packing", "ready", "dispatched", "delivered"].map(value => <span key={value} className={`rounded-full px-2.5 py-1 ${stage === value ? "bg-[#285f4e] text-white" : "bg-[#f2f0ea] text-[#68756e]"}`}>{stageLabels[value as FulfillmentStage]}</span>)}</div>{fulfillment.exceptionNote && <p className="mt-3 rounded-xl bg-[#fff0e9] p-2 text-xs text-[#a14724]">التعذر: {fulfillment.exceptionNote}</p>}</div>
      </div>

      {(stage === "unstarted" || stage === "blocked") && canFulfill && <div className="mt-4 flex flex-wrap gap-2"><Button disabled={isBusy} className="bg-[#285f4e]" onClick={() => pick.mutate({ orderId })}><Box className="ml-1 h-4 w-4" />{stage === "blocked" ? "استئناف الالتقاط" : "بدء التقاط القطع"}</Button></div>}

      {["picking", "packing"].includes(stage ?? "") && <div className="mt-5 space-y-3"><div className="flex items-center justify-between"><b className="text-sm">فحص قطع التجهيز</b><span className="text-xs text-[#68756e]">يجب التقاط ثم تغليف كل قطعة قبل الجاهزية</span></div>{detail.data?.items.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-3"><div className="h-14 w-12 overflow-hidden rounded-xl bg-[#f2f0ea]">{item.imageStorageKeySnapshot && <img src={`/manus-storage/${item.imageStorageKeySnapshot}`} alt={item.colorNameSnapshot} className="h-full w-full object-cover" />}</div><div className="min-w-[145px] flex-1"><b className="text-sm">{item.productNameSnapshot}</b><p className="mt-1 text-xs text-[#68756e]">{item.colorNameSnapshot} · {item.quantity} قطعة</p></div><Button size="sm" variant={item.check?.pickedAt ? "secondary" : "outline"} disabled={!canFulfill || isBusy} onClick={() => check.mutate({ orderId, orderItemId: item.id, field: "picked", checked: !item.check?.pickedAt })}><Check className="ml-1 h-3.5 w-3.5" />{item.check?.pickedAt ? "تم الالتقاط" : "تأكيد الالتقاط"}</Button><Button size="sm" variant={item.check?.packedAt ? "secondary" : "outline"} disabled={!canFulfill || isBusy || !item.check?.pickedAt} onClick={() => check.mutate({ orderId, orderItemId: item.id, field: "packed", checked: !item.check?.packedAt })}><PackageCheck className="ml-1 h-3.5 w-3.5" />{item.check?.packedAt ? "تم التغليف" : "تأكيد التغليف"}</Button></div>)}</div>}

      {stage === "packing" && canFulfill && <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={isBusy || !allPacked} className="bg-[#285f4e]" onClick={() => ready.mutate({ orderId, note: eventNote || undefined })}><CheckCircle2 className="ml-1 h-4 w-4" />اعتماد الجاهزية</Button>{!allPacked && <span className="text-xs text-[#a14724]">أكملي تأكيد جميع القطع أولاً.</span>}</div>}
      {stage === "ready" && canDispatch && <div className="mt-4"><Button disabled={isBusy} className="bg-[#285f4e]" onClick={() => dispatch.mutate({ orderId, note: eventNote || undefined })}><Truck className="ml-1 h-4 w-4" />سجل الخروج للتوصيل</Button></div>}
      {stage === "dispatched" && canDispatch && <div className="mt-4"><Button disabled={isBusy} className="bg-[#285f4e]" onClick={() => deliver.mutate({ orderId, note: eventNote || undefined })}><CheckCircle2 className="ml-1 h-4 w-4" />تأكيد التسليم</Button></div>}

      {stage !== "delivered" && canFulfill && <div className="mt-5 grid gap-3 border-t pt-5 lg:grid-cols-2"><div className="rounded-2xl border bg-white p-3"><b className="text-sm">ملاحظة تجهيز داخلية</b><div className="mt-2 flex gap-2"><input value={eventNote} onChange={event => setEventNote(event.target.value)} className="min-w-0 flex-1 rounded-xl border p-2 text-sm" placeholder="مثلاً: التغليف يحتاج شريطاً إضافياً" /><Button size="sm" variant="outline" disabled={isBusy || !eventNote.trim()} onClick={() => addNote.mutate({ orderId, note: eventNote })}>حفظ</Button></div></div><div className="rounded-2xl border border-[#f0d4c9] bg-[#fffaf7] p-3"><b className="flex items-center gap-1 text-sm text-[#a14724]"><CircleAlert className="h-4 w-4" />تسجيل تعذر</b><div className="mt-2 flex gap-2"><input value={exceptionNote} onChange={event => setExceptionNote(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-[#efd7cd] bg-white p-2 text-sm" placeholder="سبب يحتاج معالجة" /><Button size="sm" variant="outline" className="border-[#c96e50] text-[#a14724]" disabled={isBusy || !exceptionNote.trim()} onClick={() => exception.mutate({ orderId, note: exceptionNote })}>إيقاف مؤقت</Button></div></div></div>}

      <div className="mt-5 border-t pt-4"><b className="text-sm">سجل التجهيز</b><div className="mt-3 space-y-2">{(detail.data?.events ?? []).slice(0, 8).map(event => <div key={event.id} className="flex gap-3 text-xs"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#a47d40]" /><div><b>{event.type.replaceAll("_", " ")}</b>{event.note && <span className="text-[#68756e]"> — {event.note}</span>}<p className="mt-1 text-[#9aa49e]">{new Date(event.createdAt).toLocaleString("ar-IQ")}</p></div></div>)}</div></div>
    </>}
  </section>;
}

export default function Orders() {
  const profile = trpc.access.myProfile.useQuery();
  const list = trpc.orders.list.useQuery(undefined, { enabled: profile.isSuccess });
  const [id, setId] = useState<number | null>(null);
  const detail = trpc.orders.byId.useQuery({ orderId: id ?? 0 }, { enabled: Boolean(id) });
  const utils = trpc.useUtils();
  const [contact, setContact] = useState({ outcome: "attempted" as (typeof outcomes)[number]["value"], note: "" });
  const refresh = () => Promise.all([utils.orders.list.invalidate(), utils.orders.byId.invalidate()]);
  const transition = trpc.orders.transition.useMutation({ onSuccess: refresh });
  const addContact = trpc.orders.addContactEvent.useMutation({ onSuccess: async () => { setContact(value => ({ ...value, note: "" })); await refresh(); } });
  const incoming = useMemo(() => (list.data ?? []).filter(order => order.status === "new" || order.status === "needs_contact"), [list.data]);
  const actions = useMemo(() => { const status = detail.data?.order.status as Status | undefined; if (status === "new") return ["confirmed", "needs_contact", "cancelled"] as Status[]; if (status === "needs_contact") return ["confirmed", "cancelled"] as Status[]; if (status === "confirmed") return ["preparing", "cancelled"] as Status[]; if (status === "preparing") return ["out_for_delivery", "cancelled"] as Status[]; if (status === "out_for_delivery") return ["completed", "cancelled"] as Status[]; return []; }, [detail.data?.order.status]);
  const order = detail.data?.order;
  const permissions = profile.data?.permissions ?? [];
  const canFulfill = permissions.includes("orders.fulfill");
  const canDispatch = permissions.includes("orders.delivery.submit");
  const canUseFulfillment = Boolean(order && ["confirmed", "preparing", "out_for_delivery", "completed"].includes(order.status));

  return <main dir="rtl" className="mx-auto max-w-[1440px] space-y-6 pb-12"><header className="rounded-3xl bg-[#173f38] px-6 py-8 text-white"><div className="flex justify-between"><div><p className="text-sm font-bold text-[#ddc985]">تشغيل المبيعات</p><h1 className="mt-2 text-3xl font-black">الطلبات</h1><p className="mt-3 text-sm text-[#dce8e1]">الأجرة والخصم والقناة لقطات تلقائية عند إنشاء الطلب، ولا تخصم الكمية إلا بعد التأكيد.</p></div><ClipboardList className="h-8 w-8 text-[#ddc985]" /></div></header>
    <section className="rounded-3xl border border-[#e6ded0] bg-white p-5"><div className="flex justify-between"><div><h2 className="text-xl font-black">طلبات جديدة</h2><p className="mt-1 text-sm text-[#68756e]">الطلبات التي تتطلب اتصالًا أو تأكيدًا.</p></div><b className="rounded-full bg-[#edf8f1] px-3 py-1 text-[#285f4e]">{incoming.length} بانتظار الإجراء</b></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{incoming.map(item => <button key={item.id} onClick={() => setId(item.id)} className={`rounded-2xl border p-4 text-right ${id === item.id ? "border-[#285f4e] bg-[#edf8f1]" : "border-[#e7e0d5]"}`}><div className="flex justify-between"><b>{item.orderNumber}</b><span className="text-xs">{labels[item.status]}</span></div><p className="mt-3 font-bold">{item.customerName}</p><p className="mt-1 text-xs text-[#68756e]">{item.governorate} · {item.items.reduce((total, line) => total + line.quantity, 0)} قطعة</p><p className="mt-3 border-t pt-3 font-black text-[#285f4e]">{money(item.total)}</p></button>)}</div>{!incoming.length && <p className="mt-4 rounded-2xl bg-[#fcfaf5] p-4 text-sm text-[#68756e]">لا توجد طلبات جديدة حاليًا.</p>}</section>
    <section className="grid gap-5 xl:grid-cols-[.72fr_1.28fr]"><aside className="overflow-hidden rounded-3xl border border-[#e6ded0] bg-white"><h2 className="border-b p-5 font-black">كل الطلبات</h2>{(list.data ?? []).map(item => <button key={item.id} onClick={() => setId(item.id)} className={`w-full border-b px-5 py-4 text-right ${id === item.id ? "bg-[#edf8f1]" : "hover:bg-[#fcfaf5]"}`}><div className="flex justify-between"><b>{item.orderNumber}</b><span className="text-xs">{labels[item.status]}</span></div><p className="mt-1 text-xs text-[#68756e]">{item.customerName} · {item.items.map(line => `${line.colorNameSnapshot} × ${line.quantity}`).join("، ")}</p></button>)}</aside>
      <article className="min-h-[520px] rounded-3xl border border-[#e6ded0] bg-white p-6">{!order ? <div className="grid min-h-[400px] place-items-center text-center"><div><ReceiptText className="mx-auto h-8 w-8 text-[#a47d40]" /><p className="mt-3 font-bold">اختاري طلبًا لرؤية ورقة التجهيز</p></div></div> : <><div className="flex justify-between border-b pb-5"><div><p className="font-bold text-[#a47d40]">{order.orderNumber}</p><h2 className="mt-1 text-2xl font-black">{order.customerName}</h2><p className="mt-2 text-sm text-[#68756e]">{order.customerPhone} · القناة تلقائيًا: {channels[order.customerChannel]}</p></div><b>{labels[order.status]}</b></div><div className="mt-5 grid gap-4 lg:grid-cols-2"><section className="rounded-2xl bg-[#f8f6f0] p-4"><b>عنوان التسليم</b><p className="mt-2 font-bold">{order.governorate}</p><p className="mt-1 text-sm text-[#68756e]">{order.address}</p>{order.customerNote && <p className="mt-3 border-t pt-3 text-sm">ملاحظة العميل: {order.customerNote}</p>}</section><section className="rounded-2xl border p-4"><b>ملخص مالي ثابت</b><div className="mt-3 space-y-2 text-sm"><p className="flex justify-between"><span>المنتجات</span><b>{money(order.subtotal)}</b></p><p className="flex justify-between"><span>خصم القسيمة</span><b>− {money(order.manualDiscount)}</b></p><p className="flex justify-between"><span>التوصيل</span><b>{money(order.deliveryFee)}</b></p><p className="flex justify-between border-t pt-2 font-black text-[#285f4e]"><span>الإجمالي</span><span>{money(order.total)}</span></p></div></section></div><section className="mt-6"><div className="flex gap-2"><ReceiptText className="h-5 w-5 text-[#a47d40]" /><h3 className="font-black">ورقة التجهيز البصرية</h3></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{detail.data!.items.map(item => <article key={item.id} className="flex gap-3 rounded-2xl border-2 border-[#e7e0d5] p-3">{item.imageStorageKeySnapshot ? <img src={`/manus-storage/${item.imageStorageKeySnapshot}`} alt={item.colorNameSnapshot} className="h-28 w-24 rounded-xl object-cover" /> : <div className="h-28 w-24 rounded-xl bg-[#ece8dd]" />}<div><b>{item.productNameSnapshot}</b><p className="mt-2 font-bold text-[#a47d40]">اللون: {item.colorNameSnapshot}</p><p className="mt-2 rounded-lg bg-[#edf8f1] px-2 py-1 font-black text-[#285f4e]">العدد: {item.quantity}</p></div></article>)}</div></section>
        {canUseFulfillment && <FulfillmentPanel orderId={order.id} canFulfill={canFulfill} canDispatch={canDispatch} />}
        <section className="mt-6 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border p-4"><b>متابعة التواصل</b><p className="mt-1 text-xs text-[#68756e]">القناة مسجلة تلقائيًا: {channels[order.customerChannel]}</p><div className="mt-3 flex gap-2"><select className="flex-1 rounded-lg border p-2 text-sm" value={contact.outcome} onChange={event => setContact(value => ({ ...value, outcome: event.target.value as typeof value.outcome }))}>{outcomes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><input className="flex-1 rounded-lg border p-2 text-sm" placeholder="ملاحظة" value={contact.note} onChange={event => setContact(value => ({ ...value, note: event.target.value }))} /></div><button onClick={() => addContact.mutate({ orderId: order.id, channel: order.customerChannel, outcome: contact.outcome, note: contact.note || undefined })} className="mt-3 rounded-lg border border-[#285f4e] px-3 py-2 text-sm font-bold text-[#285f4e]">سجل المتابعة</button></div><div className="rounded-2xl border p-4"><b>الإجراء التالي</b><div className="mt-3 flex flex-wrap gap-2">{actions.map(status => <Button key={status} onClick={() => transition.mutate({ orderId: order.id, nextStatus: status })} disabled={transition.isPending} variant={status === "cancelled" ? "outline" : "default"} className={status === "cancelled" ? "text-[#a14724]" : "bg-[#285f4e]"}>{icon(status)}{labels[status]}</Button>)}</div></div></section></>}</article></section></main>;
}
