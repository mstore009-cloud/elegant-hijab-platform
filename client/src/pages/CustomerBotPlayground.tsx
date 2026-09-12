import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerBotNav, SafetyNotice } from "@/components/customerBot/CustomerBotNav";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { BookPlus, Bot, Check, CircleAlert, FileWarning, Loader2, MessageSquareText, Pencil, Play, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const modeLabels: Record<string, string> = { live_read_only: "بيانات حية للقراءة فقط", conversation_context: "سياق محادثة موجود", new_test_customer: "عميلة تجريبية جديدة", existing_customer_read_only: "عميلة حالية للقراءة فقط", order_simulation: "محاكاة مسودة طلب" };
const channelLabels: Record<string, string> = { internal: "داخلي", whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" };
const categoryLabels: Record<string, string> = { dialect_style: "تحسين اللهجة والنبرة", reply_example: "مثال رد معتمد", knowledge: "بطاقة معرفة", sales_playbook: "إجراء بيع", test_case: "حالة اختبار", guardrail: "حاجز أو مثال سلبي", knowledge_gap: "فجوة معرفة" };

export default function CustomerBotPlayground() {
  const profile = trpc.access.myProfile.useQuery();
  const canManage = profile.data?.permissions.includes("bot.manage") ?? false;
  const sessions = trpc.customerBot.playgroundSessions.useQuery(undefined, { enabled: canManage });
  const [sessionId, setSessionId] = useState<number | null>(null);
  const session = trpc.customerBot.playgroundSession.useQuery({ sessionId: sessionId ?? 0 }, { enabled: canManage && sessionId !== null });
  const [mode, setMode] = useState<"live_read_only" | "conversation_context" | "new_test_customer" | "existing_customer_read_only" | "order_simulation">("live_read_only");
  const [channel, setChannel] = useState<"internal" | "whatsapp" | "instagram" | "messenger">("internal");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: number; original: string } | null>(null);
  const [editedReply, setEditedReply] = useState("");
  const [category, setCategory] = useState<keyof typeof categoryLabels>("dialect_style");
  const utils = trpc.useUtils();

  useEffect(() => { if (!sessionId && sessions.data?.[0]) setSessionId(sessions.data[0].id); }, [sessionId, sessions.data]);
  const createSession = trpc.customerBot.createPlaygroundSession.useMutation({ onSuccess: async created => { await utils.customerBot.playgroundSessions.invalidate(); setSessionId(created.id); toast.success("بدأت جلسة اختبار داخلية آمنة."); }, onError: error => toast.error(error.message) });
  const send = trpc.customerBot.sendPlaygroundMessage.useMutation({ onSuccess: async () => { setBody(""); await session.refetch(); }, onError: error => toast.error(error.message) });
  const close = trpc.customerBot.closePlaygroundSession.useMutation({ onSuccess: async () => { await Promise.all([session.refetch(), utils.customerBot.playgroundSessions.invalidate()]); toast.success("أُغلقت الجلسة. بقي سجلها للمراجعة."); }, onError: error => toast.error(error.message) });
  const proposal = trpc.customerBot.createLearningProposal.useMutation({ onSuccess: async () => { setEditing(null); await utils.customerBot.learningProposals.invalidate(); toast.success("حُفظ التعديل كمسودة تعليمية؛ لم يتغير رد البوت الحي."); }, onError: error => toast.error(error.message) });
  const current = session.data?.session;
  const messages = useMemo(() => session.data?.messages ?? [], [session.data?.messages]);

  if (profile.isLoading || (canManage && sessions.isLoading)) return <div className="p-8 text-sm text-muted-foreground">جارٍ فتح المختبر…</div>;
  if (!canManage) return <div className="p-8 text-center">لا توجد صلاحية لإدارة المختبر.</div>;

  return <main dir="rtl" className="mx-auto max-w-6xl space-y-5 pb-10">
    <CustomerBotNav title="مختبر المحادثة" description="اكتبي كما تكتب الزبونة، اختبري الرد بالبيانات الحية للقراءة فقط، وعدّلي أفضل صياغة لتصبح مسودة تعليمية قابلة للمراجعة." />
    <SafetyNotice />
    <section className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-2xl border border-[#e4e8e4] bg-white p-4 shadow-[0_8px_20px_rgba(41,63,53,0.04)]">
        <div><h2 className="font-bold text-[#30473d]">جلسة جديدة</h2><p className="mt-1 text-xs leading-5 text-[#74817a]">اختاري السياق قبل البدء. لا يملك المختبر مسار إرسال خارجي.</p></div>
        <div className="space-y-2"><Label>وضع البيانات</Label><Select value={mode} onValueChange={value => setMode(value as typeof mode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(modeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>قناة التجربة</Label><Select value={channel} onValueChange={value => setChannel(value as typeof channel)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(channelLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <Button className="w-full rounded-xl bg-[#1d5a4d] hover:bg-[#153f36]" disabled={createSession.isPending} onClick={() => createSession.mutate({ mode, channel })}>{createSession.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Play className="ml-2 h-4 w-4" />}بدء جلسة جديدة</Button>
        <div className="border-t pt-4"><p className="mb-2 text-xs font-bold text-[#56675d]">الجلسات السابقة</p><div className="max-h-64 space-y-1 overflow-auto">{sessions.data?.map(item => <button key={item.id} type="button" onClick={() => setSessionId(item.id)} className={`w-full rounded-lg px-3 py-2 text-right text-xs transition ${sessionId === item.id ? "bg-[#edf5f1] font-bold text-[#1d5a4d]" : "hover:bg-muted"}`}><span className="block">{modeLabels[item.mode]} · {channelLabels[item.channel]}</span><span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">{new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</span></button>)}</div></div>
      </aside>
      <section className="min-h-[620px] overflow-hidden rounded-2xl border border-[#e1e7e1] bg-white shadow-[0_12px_30px_rgba(41,63,53,0.055)]">
        <div className="flex flex-col gap-3 border-b border-[#edf0ec] bg-[#fcfdfb] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf5f1] text-[#1d5a4d]"><MessageSquareText className="h-5 w-5" /></span><div><h2 className="font-bold text-[#30473d]">{current ? `${modeLabels[current.mode]} · ${channelLabels[current.channel]}` : "اختاري أو أنشئي جلسة"}</h2><p className="mt-0.5 text-xs text-[#78867e]">لا إرسال إلى Meta · لا إنشاء طلب نهائي · لا تعديل CRM أو مخزون</p></div></div>{current && <div className="flex items-center gap-2"><Badge className={current.status === "open" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}>{current.status === "open" ? "مفتوحة" : "مغلقة"}</Badge>{current.status === "open" && <Button variant="outline" size="sm" onClick={() => close.mutate({ sessionId: current.id })} disabled={close.isPending} className="rounded-lg text-xs">إنهاء الجلسة</Button>}</div>}</div>
        {!current ? <div className="grid min-h-[480px] place-items-center p-8 text-center"><div><Sparkles className="mx-auto h-10 w-10 text-[#a18c63]" /><h3 className="mt-4 font-bold">ابدئي تجربة آمنة</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">اختاري وضع البيانات وقناة التجربة من اللوحة الجانبية، ثم ابدئي محادثة لا تلمس أي عملية تشغيلية.</p></div></div> : <>
          <div className="h-[420px] space-y-4 overflow-y-auto bg-[#fbfcfa] p-5">{messages.length ? messages.map(message => <MessageBubble key={message.id} message={message} onEdit={() => { setEditing({ id: message.id, original: message.body }); setEditedReply(message.body); setCategory("dialect_style"); }} />) : <div className="grid h-full place-items-center text-center"><div><Bot className="mx-auto h-9 w-9 text-[#9aafa1]" /><p className="mt-3 text-sm font-bold text-[#53655b]">اكتبي أول رسالة كأنك الزبونة</p><p className="mt-1 text-xs text-[#87938c]">يمكنك تجربة سؤال عن السعر أو الألوان أو التأكيد أو حالة معقدة.</p></div></div>}</div>
          <div className="border-t bg-white p-4"><div className="flex gap-2"><Textarea value={body} onChange={event => setBody(event.target.value)} disabled={current.status !== "open" || send.isPending} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (body.trim()) send.mutate({ sessionId: current.id, body }); } }} placeholder="اكتبي رسالة الزبونة… مثال: هذا الكود HJ-123 شكد سعره وأكو ألوان؟" className="min-h-12 resize-none rounded-xl" /><Button disabled={!body.trim() || current.status !== "open" || send.isPending} onClick={() => send.mutate({ sessionId: current.id, body })} className="h-auto rounded-xl bg-[#1d5a4d] px-4 hover:bg-[#153f36]">{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div><p className="mt-2 text-[11px] text-[#839087]">Enter للإرسال داخل المختبر، وShift + Enter لسطر جديد.</p></div>
        </>}
      </section>
    </section>
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent dir="rtl" className="max-w-2xl"><DialogHeader><DialogTitle>تحويل تعديل الرد إلى تعلم قابل للمراجعة</DialogTitle><DialogDescription>احتفظنا بالرد الأصلي. اختاري أين سيُحفظ التعلم؛ لن يُنشر أو يغير الرد الحي الآن.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>الرد الأصلي</Label><p className="mt-2 rounded-xl bg-muted p-3 text-sm leading-6">{editing?.original}</p></div><div><Label>الرد بعد التعديل</Label><Textarea value={editedReply} onChange={event => setEditedReply(event.target.value)} className="mt-2 min-h-28" /></div><div><Label>نوع التعلم</Label><Select value={category} onValueChange={value => setCategory(value as typeof category)}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-[11px] leading-5 text-muted-foreground">لا تحفظي السعر أو المخزون أو حالة الطلب كبطاقة معرفة؛ تبقى هذه من البيانات الحية.</p></div></div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button><Button className="bg-[#1d5a4d] hover:bg-[#153f36]" disabled={!editing || !editedReply.trim() || proposal.isPending} onClick={() => editing && proposal.mutate({ sessionId: sessionId!, sourceMessageId: editing.id, category: category as "dialect_style" | "reply_example" | "knowledge" | "sales_playbook" | "test_case" | "guardrail" | "knowledge_gap", editedReply })}>{proposal.isPending ? "جارٍ التحليل…" : <><BookPlus className="ml-2 h-4 w-4" />حفظ كمسودة</>}</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}

function MessageBubble({ message, onEdit }: { message: { id: number; role: string; body: string; confidence: number | null; actionJson: string | null }; onEdit: () => void }) {
  const assistant = message.role === "assistant";
  let action: any = null;
  try { action = message.actionJson ? JSON.parse(message.actionJson) : null; } catch { action = null; }
  return <div className={`flex ${assistant ? "justify-start" : "justify-end"}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-7 ${assistant ? "border border-[#dfe8e1] bg-white text-[#31483d]" : "bg-[#1d5a4d] text-white"}`}><div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold opacity-75">{assistant ? <><Bot className="h-3.5 w-3.5" />رد البوت</> : "رسالة الزبونة"}{assistant && message.confidence !== null ? <span>· ثقة {message.confidence}%</span> : null}</div><p className="whitespace-pre-wrap">{message.body}</p>{assistant && action?.type && action.type !== "none" ? <p className="mt-2 rounded-lg bg-[#f0f6f1] px-2 py-1 text-[10px] text-[#40634e]">قرار تجريبي: {action.type}{action.productCode ? ` · ${action.productCode}` : ""}</p> : null}{assistant ? <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={onEdit} className="h-7 rounded-lg border-[#d6e2d8] bg-white text-[11px] text-[#315c45]"><Pencil className="ml-1 h-3 w-3" />تعديل وتعليم</Button><span className="inline-flex items-center gap-1 text-[10px] text-[#75867b]"><Check className="h-3 w-3" />داخلي فقط</span></div> : null}</div></div>;
}
