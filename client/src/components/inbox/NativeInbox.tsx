import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ThreadMedia } from "@/components/inbox/ThreadMedia";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { useInboxLiveUpdates } from "@/hooks/useInboxLiveUpdates";
import { CheckCheck, ChevronRight, Filter, Inbox as InboxIcon, MessageCircleMore, MoreHorizontal, Paperclip, Phone, Search, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type InboxStatus = "open" | "waiting_customer" | "snoozed" | "closed";
type InboxChannel = "manual" | "whatsapp" | "instagram" | "messenger";
type MessageDirection = "outbound" | "internal_note";

const channelIcon: Record<InboxChannel, string> = { manual: "•", whatsapp: "W", instagram: "I", messenger: "M" };
const channelTone: Record<InboxChannel, string> = { manual: "bg-slate-200 text-slate-700", whatsapp: "bg-[#e3f5eb] text-[#147247]", instagram: "bg-[#fae8f2] text-[#a53d70]", messenger: "bg-[#e6f1fb] text-[#2874b2]" };
const channelLabel: Record<InboxChannel, string> = { manual: "يدوي", whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" };
const REALTIME_REFRESH_MS = 30_000;

function formatTime(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const isToday = date.toDateString() === new Date().toDateString();
  return date.toLocaleString("ar-IQ", isToday ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function initial(name?: string | null) { return (name || "ج").trim().slice(0, 1).toUpperCase(); }

export default function NativeInbox() {
  const profile = trpc.access.myProfile.useQuery();
  const canRead = profile.data?.permissions.includes("inbox.read") ?? false;
  const canReply = profile.data?.permissions.includes("inbox.reply") ?? false;
  const canManage = profile.data?.permissions.includes("inbox.manage") ?? false;
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<InboxChannel | "all">("all");
  const [readState, setReadState] = useState<"all" | "unread" | "read">("all");
  const [hasAttachments, setHasAttachments] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestedConversationId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const value = Number(new URLSearchParams(window.location.search).get("conversation"));
    return Number.isInteger(value) && value > 0 ? value : null;
  }, []);
  const [selectedId, setSelectedId] = useState<number | null>(requestedConversationId);
  const [showThreadMobile, setShowThreadMobile] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [composerMode, setComposerMode] = useState<MessageDirection>("outbound");

  const listInput = useMemo(() => ({ search: search.trim() || undefined, channel: channel === "all" ? undefined : channel, hasAttachments: hasAttachments || undefined, readState: readState === "all" ? undefined : readState }), [search, channel, hasAttachments, readState]);
  const conversations = trpc.inbox.list.useQuery(listInput, { enabled: canRead, refetchInterval: REALTIME_REFRESH_MS, refetchOnWindowFocus: true });
  const detailInput = useMemo(() => selectedId ? { conversationId: selectedId } : skipToken, [selectedId]);
  const detail = trpc.inbox.detail.useQuery(detailInput, { enabled: canRead && detailInput !== skipToken, refetchInterval: REALTIME_REFRESH_MS, refetchOnWindowFocus: true });
  const assignees = trpc.inbox.assignees.useQuery(undefined, { enabled: canRead && detailsOpen });
  const customers = trpc.inbox.customers.useQuery(undefined, { enabled: canRead && detailsOpen });
  const utils = trpc.useUtils();
  const refresh = useCallback(() => void Promise.all([utils.inbox.list.invalidate(), utils.inbox.detail.invalidate()]), [utils]);
  useInboxLiveUpdates({ enabled: canRead, onInboxMessage: refresh });

  useEffect(() => {
    const rows = conversations.data ?? [];
    if (requestedConversationId && rows.some(row => row.id === requestedConversationId)) {
      if (selectedId !== requestedConversationId) setSelectedId(requestedConversationId);
      setShowThreadMobile(true);
    }
    else if (!selectedId && rows[0]) setSelectedId(rows[0].id);
  }, [conversations.data, requestedConversationId, selectedId]);

  const send = trpc.inbox.sendManualMeta.useMutation({
    onSuccess: async () => { setComposerText(""); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const note = trpc.inbox.recordMessage.useMutation({
    onSuccess: async () => { setComposerText(""); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const assign = trpc.inbox.assign.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const changeStatus = trpc.inbox.changeStatus.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const linkCustomer = trpc.inbox.linkCustomer.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const linkOrder = trpc.inbox.linkOrder.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const analyzeImage = trpc.customerBot.analyzeImage.useMutation({
    onSuccess: () => { void utils.inbox.detail.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const current = detail.data;
  const conversation = current?.conversation;
  const channelReady = Boolean(conversation && conversation.channel !== "manual" && current?.channelHealth?.sendReady);

  const submit = () => {
    if (!conversation || !composerText.trim()) return;
    if (composerMode === "internal_note") {
      note.mutate({ conversationId: conversation.id, direction: "internal_note", body: composerText.trim() });
      return;
    }
    if (conversation.channel === "manual") {
      toast.error("هذه المحادثة لا ترتبط بقناة خارجية.");
      return;
    }
    if (!channelReady) {
      toast.error("القناة غير جاهزة للإرسال حالياً.");
      return;
    }
    send.mutate({ conversationId: conversation.id, body: composerText.trim(), idempotencyKey: crypto.randomUUID() });
  };

  if (profile.isLoading) return <InboxLoading />;
  if (!canRead) return <InboxDenied />;

  return <div dir="rtl" className="mx-auto max-w-[1600px] pb-8">
    <section className="overflow-hidden rounded-[1.5rem] border border-[#e8e1d7] bg-white shadow-[0_12px_32px_rgba(47,45,41,.06)]">
      <div className="flex min-h-[calc(100vh-10rem)] flex-col lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className={`${showThreadMobile ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-b border-[#eee8df] bg-[#fffefd] lg:border-b-0 lg:border-l`}>
          <div className="border-b border-[#eee8df] px-4 pb-3 pt-4">
            <div className="flex items-center justify-between"><div><h1 className="text-lg font-bold text-[#2e3f37]">المحادثات</h1><p className="mt-0.5 text-[11px] text-[#849087]">{(conversations.data ?? []).filter(row => row.unreadCount > 0).length} غير مقروءة</p></div><span className="grid h-9 w-9 place-items-center rounded-full bg-[#f4e9eb] text-[#8e5364]"><MessageCircleMore className="h-4 w-4" /></span></div>
            <div className="relative mt-3"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#909a94]" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="بحث" className="h-10 rounded-xl border-[#e2ddd5] bg-[#faf9f6] pr-9 shadow-none" /></div>
            <div className="mt-2 flex items-center gap-2"><Select value={channel} onValueChange={value => setChannel(value as InboxChannel | "all")}><SelectTrigger className="h-8 flex-1 rounded-lg border-[#e4ded5] bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="all">كل القنوات</SelectItem><SelectItem value="messenger">Messenger</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem></SelectContent></Select><Button variant="outline" size="icon" onClick={() => setFiltersOpen(open => !open)} className={`h-8 w-8 rounded-lg border-[#e4ded5] ${filtersOpen ? "bg-[#f4e9eb] text-[#864a5e]" : "bg-white text-[#63736a]"}`} aria-label="الفلاتر"><Filter className="h-3.5 w-3.5" /></Button></div>
            {filtersOpen && <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-[#f8f6f2] p-2"><Select value={readState} onValueChange={value => setReadState(value as "all" | "unread" | "read")}><SelectTrigger className="h-8 border-[#e4ded5] bg-white text-[11px]"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="all">كل الرسائل</SelectItem><SelectItem value="unread">غير مقروءة</SelectItem><SelectItem value="read">مقروءة</SelectItem></SelectContent></Select><button type="button" aria-pressed={hasAttachments} onClick={() => setHasAttachments(current => !current)} className={`rounded-lg border px-2 text-[11px] font-medium transition ${hasAttachments ? "border-[#d5a5b1] bg-[#f8e9ed] text-[#82495b]" : "border-[#e4ded5] bg-white text-[#65756c]"}`}><Paperclip className="ml-1 inline h-3 w-3" />وسائط</button></div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversations.isLoading ? <ConversationLoading /> : conversations.error ? <p className="p-6 text-center text-sm text-[#9c5438]">تعذر تحميل المحادثات.</p> : (conversations.data ?? []).length ? (conversations.data ?? []).map(item => <ConversationRow key={item.id} item={item} active={item.id === selectedId} onSelect={() => { setSelectedId(item.id); setShowThreadMobile(true); }} />) : <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center text-[#7c8981]"><InboxIcon className="h-8 w-8 text-[#bdc5bf]" /><p className="mt-3 text-sm">لا توجد محادثات مطابقة.</p></div>}
          </div>
        </aside>

        <main className={`${showThreadMobile ? "flex" : "hidden lg:flex"} min-h-0 flex-col bg-[#fbfaf8]`}>
          {detail.isLoading ? <ThreadLoading /> : conversation ? <>
            <header className="flex items-center gap-3 border-b border-[#ebe5dc] bg-white px-4 py-3.5 sm:px-5"><Button variant="ghost" size="icon" onClick={() => setShowThreadMobile(false)} className="h-9 w-9 shrink-0 rounded-full lg:hidden" aria-label="العودة إلى المحادثات"><ChevronRight className="h-5 w-5" /></Button><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e9eee9] text-sm font-bold text-[#50665a]">{initial(current?.customer?.displayName || conversation.contactNameSnapshot)}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-bold text-[#35483f]">{current?.customer?.displayName || conversation.contactNameSnapshot || "جهة اتصال"}</h2><span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold ${channelTone[conversation.channel as InboxChannel]}`} title={channelLabel[conversation.channel as InboxChannel]}>{channelIcon[conversation.channel as InboxChannel]}</span></div><p className="mt-0.5 text-[11px] text-[#8a958e]">{conversation.unreadCount > 0 ? `${conversation.unreadCount} رسائل غير مقروءة` : ""}</p></div><Button variant="outline" size="icon" onClick={() => setDetailsOpen(open => !open)} className={`h-9 w-9 rounded-full border-[#e8e1d8] ${detailsOpen ? "bg-[#f4e9eb] text-[#82495b]" : "bg-white text-[#63736a]"}`} aria-label="تفاصيل المحادثة"><MoreHorizontal className="h-5 w-5" /></Button></header>
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              <div className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7"><div className="mx-auto flex max-w-3xl flex-col gap-2.5">{current.messages.length ? current.messages.map(message => <MessageBubble key={message.id} message={message} media={(current.media ?? []).filter((item: any) => item.messageId === message.id)} reactions={(current.reactions ?? []).filter((item: any) => item.messageId === message.id)} canAnalyze={canReply} analyzingMediaId={analyzeImage.isPending ? analyzeImage.variables?.mediaId ?? null : null} onAnalyze={mediaId => analyzeImage.mutate({ mediaId })} />) : <p className="py-20 text-center text-sm text-[#849087]">لا توجد رسائل بعد.</p>}</div></div>
              {detailsOpen && <ConversationDetails current={current} canManage={canManage} assignees={assignees.data ?? []} customers={customers.data ?? []} onClose={() => setDetailsOpen(false)} onAssign={assigneeEmployeeId => assign.mutate({ conversationId: conversation.id, assigneeEmployeeId })} onChangeStatus={status => changeStatus.mutate({ conversationId: conversation.id, status })} onLinkCustomer={customerId => linkCustomer.mutate({ conversationId: conversation.id, customerId })} onLinkOrder={orderId => linkOrder.mutate({ conversationId: conversation.id, orderId })} />}
            </div>
            <footer className="border-t border-[#ebe5dc] bg-white px-4 py-3 sm:px-5"><div className="mx-auto max-w-3xl"><div className="mb-2 flex items-center justify-between"><button type="button" onClick={() => setComposerMode(mode => mode === "outbound" ? "internal_note" : "outbound")} disabled={!canManage} className="text-[11px] font-medium text-[#78877e] hover:text-[#4a5b51] disabled:cursor-not-allowed disabled:opacity-50">{composerMode === "internal_note" ? "ملاحظة داخلية" : "رد للعميل"}</button>{conversation.channel !== "manual" && !channelReady && <span className="text-[11px] text-[#a15b43]">الإرسال غير متاح للقناة حالياً</span>}</div><div className={`flex items-end gap-2 rounded-2xl border p-1.5 ${composerMode === "internal_note" ? "border-[#e7d9a5] bg-[#fffbed]" : "border-[#dfd9d0] bg-[#faf9f7]"}`}><Textarea value={composerText} onChange={event => setComposerText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder={composerMode === "internal_note" ? "اكتبي ملاحظة للفريق…" : "اكتبي رسالة…"} className="min-h-10 max-h-32 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0" /><Button disabled={!composerText.trim() || send.isPending || note.isPending || (composerMode === "outbound" && (!canReply || !channelReady)) || (composerMode === "internal_note" && !canManage)} onClick={submit} size="icon" className="h-10 w-10 shrink-0 rounded-xl bg-[#7b4b5a] hover:bg-[#633947]" aria-label="إرسال">{send.isPending || note.isPending ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />}</Button></div></div></footer>
          </> : <EmptyThread />}
        </main>
      </div>
    </section>
  </div>;
}

function ConversationRow({ item, active, onSelect }: { item: any; active: boolean; onSelect: () => void }) {
  const name = item.customer?.displayName || item.contactNameSnapshot || "جهة اتصال";
  const last = item.latestMessage?.body || item.subject || "";
  const itemChannel = item.channel as InboxChannel;
  return <button type="button" onClick={onSelect} className={`w-full border-b border-[#f0ece7] px-4 py-3.5 text-right transition ${active ? "bg-[#f7eff1]" : "bg-white hover:bg-[#fcfaf8]"}`}><div className="flex items-start gap-2.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e9eee9] text-sm font-bold text-[#4d6258]">{initial(name)}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b className={`truncate text-sm ${item.unreadCount > 0 ? "text-[#263b31]" : "text-[#4a5a52]"}`}>{name}</b><small className="shrink-0 text-[10px] text-[#949d96]">{formatTime(item.lastMessageAt || item.updatedAt)}</small></span><span className="mt-1 flex items-center gap-1.5"><span className="truncate text-xs text-[#77847c]">{last || " "}</span>{item.unreadCount > 0 && <i className="block h-2 w-2 shrink-0 rounded-full bg-[#c96d7c]" aria-label="غير مقروء" />}</span><span className="mt-1.5 flex items-center gap-1.5"><span className={`grid h-4 min-w-4 place-items-center rounded-full px-0.5 text-[8px] font-bold ${channelTone[itemChannel]}`}>{channelIcon[itemChannel]}</span>{item.hasAttachments && <Paperclip className="h-3 w-3 text-[#9b8472]" />}</span></span></div></button>;
}

function MessageBubble({ message, media, reactions, canAnalyze, analyzingMediaId, onAnalyze }: { message: any; media: any[]; reactions: any[]; canAnalyze: boolean; analyzingMediaId: number | null; onAnalyze: (id: number) => void }) {
  const outbound = message.direction === "outbound";
  const internal = message.direction === "internal_note";
  const totals = new Map<string, number>();
  for (const reaction of reactions) if (reaction.emoji) totals.set(reaction.emoji, Math.max(0, (totals.get(reaction.emoji) ?? 0) + (reaction.action === "added" ? 1 : -1)));
  if (internal) return <div className="my-2 flex justify-center"><p className="rounded-xl bg-[#fff7d9] px-3 py-1.5 text-[11px] text-[#856d29]">{message.body}</p></div>;
  return <div className={`flex ${outbound ? "justify-start" : "justify-end"}`}><div className={`max-w-[82%] sm:max-w-[68%] ${outbound ? "rounded-[1.25rem] rounded-tl-md bg-[#7b4b5a] text-white" : "rounded-[1.25rem] rounded-tr-md bg-white text-[#394b42] shadow-[0_2px_7px_rgba(43,48,45,.08)]"} px-3 py-2.5`}>
    {message.metadata?.replyToExternalMessageId && <div className={`mb-2 border-r-2 pr-2 text-[11px] ${outbound ? "border-white/50 text-white/75" : "border-[#b87d8a] text-[#7c686f]"}`}>{message.metadata.replyToBodyPreview || "رد على رسالة"}</div>}
    {message.body && <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>}
    <ThreadMedia items={media} outgoing={outbound} canAnalyze={canAnalyze && !outbound} analyzingMediaId={analyzingMediaId} onAnalyze={onAnalyze} />
    {Array.from(totals.entries()).filter(([, count]) => count > 0).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{Array.from(totals.entries()).filter(([, count]) => count > 0).map(([emoji, count]) => <span key={emoji} className={`rounded-full px-1.5 py-0.5 text-[11px] ${outbound ? "bg-white/15" : "bg-[#f4edef]"}`}>{emoji}{count > 1 ? ` ${count}` : ""}</span>)}</div>}
    <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${outbound ? "text-white/70" : "text-[#9aa49e]"}`}><span>{formatTime(message.occurredAt)}</span>{outbound && message.deliveryStatus && <span className="inline-flex items-center"><CheckCheck className={`h-3.5 w-3.5 ${message.deliveryStatus === "read" ? "text-[#c7e8f8]" : ""}`} aria-label={message.deliveryStatus === "read" ? "قُرئت" : "أُرسلت"} /></span>}</div>
  </div></div>;
}

function ConversationDetails({ current, canManage, assignees, customers, onClose, onAssign, onChangeStatus, onLinkCustomer, onLinkOrder }: { current: any; canManage: boolean; assignees: any[]; customers: any[]; onClose: () => void; onAssign: (id: number | null) => void; onChangeStatus: (status: InboxStatus) => void; onLinkCustomer: (id: number) => void; onLinkOrder: (id: number) => void }) {
  const conversation = current.conversation;
  const [selectedCustomerId, setSelectedCustomerId] = useState("none");
  const [selectedOrderId, setSelectedOrderId] = useState("none");
  return <aside className="absolute inset-y-0 left-0 z-10 w-[min(340px,92%)] overflow-y-auto border-r border-[#e9e2d8] bg-white p-4 shadow-[-14px_0_34px_rgba(37,39,37,.12)]"><div className="flex items-center justify-between"><h3 className="font-bold text-[#42554b]">تفاصيل المحادثة</h3><Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full" aria-label="إغلاق التفاصيل"><X className="h-4 w-4" /></Button></div><section className="mt-5 border-b border-[#eee9e2] pb-4"><p className="text-xs text-[#849087]">العميل</p><p className="mt-1 font-semibold text-[#3f5148]">{current.customer?.displayName || conversation.contactNameSnapshot || "جهة اتصال"}</p>{current.customer?.phoneDisplay && <p dir="ltr" className="mt-1.5 flex items-center gap-1 text-xs text-[#718077]"><Phone className="h-3.5 w-3.5" />{current.customer.phoneDisplay}</p>}{canManage && !current.customer && <div className="mt-3 flex gap-2"><Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}><SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="ربط بعميل" /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="none">ربط بعميل</SelectItem>{customers.map(customer => <SelectItem key={customer.id} value={String(customer.id)}>{customer.displayName}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={selectedCustomerId === "none"} onClick={() => onLinkCustomer(Number(selectedCustomerId))} className="h-8 text-xs">ربط</Button></div>}</section><section className="border-b border-[#eee9e2] py-4"><p className="text-xs text-[#849087]">الطلب</p>{current.linkedOrder ? <p className="mt-1 text-sm font-semibold text-[#3f5148]">{current.linkedOrder.orderNumber}</p> : <p className="mt-1 text-sm text-[#718077]">لا يوجد طلب مرتبط</p>}{canManage && current.customer && !current.linkedOrder && current.customerOrders?.length > 0 && <div className="mt-3 flex gap-2"><Select value={selectedOrderId} onValueChange={setSelectedOrderId}><SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="ربط بطلب" /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="none">ربط بطلب</SelectItem>{current.customerOrders.map((order: any) => <SelectItem key={order.id} value={String(order.id)}>{order.orderNumber}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={selectedOrderId === "none"} onClick={() => onLinkOrder(Number(selectedOrderId))} className="h-8 text-xs">ربط</Button></div>}</section><section className="py-4"><p className="text-xs text-[#849087]">المتابعة</p>{canManage ? <div className="mt-2 space-y-2"><Select value={conversation.status} onValueChange={value => onChangeStatus(value as InboxStatus)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="open">مفتوحة</SelectItem><SelectItem value="waiting_customer">بانتظار العميل</SelectItem><SelectItem value="snoozed">مؤجلة</SelectItem><SelectItem value="closed">مغلقة</SelectItem></SelectContent></Select><Select value={conversation.assignedEmployeeId ? String(conversation.assignedEmployeeId) : "unassigned"} onValueChange={value => onAssign(value === "unassigned" ? null : Number(value))}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="unassigned">غير معيّن</SelectItem>{assignees.map(employee => <SelectItem key={employee.id} value={String(employee.id)}>{employee.displayName}</SelectItem>)}</SelectContent></Select></div> : <p className="mt-1 text-sm text-[#3f5148]">{current.assignee?.displayName || "غير معيّن"}</p>}</section></aside>;
}

function InboxLoading() { return <div className="mx-auto h-[680px] max-w-[1600px] animate-pulse rounded-[1.5rem] bg-[#f3f0eb]" />; }
function ConversationLoading() { return <div className="space-y-3 p-4">{Array.from({ length: 7 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-[#f4f1ec]" />)}</div>; }
function ThreadLoading() { return <div className="space-y-5 p-7"><div className="h-10 w-1/3 animate-pulse rounded-xl bg-[#f2efea]" />{Array.from({ length: 5 }).map((_, index) => <div key={index} className={`h-16 w-2/3 animate-pulse rounded-2xl bg-[#f2efea] ${index % 2 ? "mr-auto" : ""}`} />)}</div>; }
function EmptyThread() { return <div className="flex flex-1 flex-col items-center justify-center text-center text-[#7d8a82]"><span className="grid h-14 w-14 place-items-center rounded-full bg-[#f1eef0] text-[#8a5566]"><MessageCircleMore className="h-6 w-6" /></span><h2 className="mt-4 text-sm font-bold text-[#52645a]">اختاري محادثة</h2><p className="mt-1 text-xs">ستظهر الرسائل هنا.</p></div>; }
function InboxDenied() { return <div dir="rtl" className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center rounded-3xl bg-white p-8 text-center shadow-sm"><InboxIcon className="h-9 w-9 text-[#b9c3bc]" /><h1 className="mt-4 font-bold text-[#41534a]">لا تملكين صلاحية Inbox</h1><p className="mt-2 text-sm text-[#77847d]">اطلبي من مدير المتجر منح صلاحية قراءة المحادثات.</p></div>; }
