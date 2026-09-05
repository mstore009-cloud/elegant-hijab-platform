import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import {
  Award,
  Banknote,
  BarChart3,
  Bell,
  Bot,
  Cable,
  Boxes,
  CloudCog,
  ChevronLeft,
  ClipboardList,
  ExternalLink,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircleMore,
  PanelLeft,
  Settings2,
  ShoppingBag,
  UserCog,
  UsersRound,
} from "lucide-react";
import { type ComponentType, type CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

type MenuItem = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  path: string;
};

type MenuGroup = {
  label: string;
  items: MenuItem[];
};

const menuGroups: MenuGroup[] = [
  {
    label: "المتابعة",
    items: [
      { icon: LayoutDashboard, label: "نظرة التشغيل", path: "/" },
      { icon: Bell, label: "مركز التنبيهات", path: "/notifications" },
      { icon: BarChart3, label: "التحليلات", path: "/analytics" },
    ],
  },
  {
    label: "العمل اليومي",
    items: [
      { icon: Boxes, label: "المنتجات", path: "/products" },
      { icon: ClipboardList, label: "الطلبات", path: "/orders" },
      { icon: UsersRound, label: "إدارة العملاء", path: "/crm" },
      { icon: MessageCircleMore, label: "Inbox المحادثات", path: "/inbox" },
    ],
  },
  {
    label: "النمو والتواصل",
    items: [
      { icon: ImagePlus, label: "مسودات المحتوى", path: "/content-posts" },
      { icon: Megaphone, label: "الحملات التسويقية", path: "/marketing" },
      { icon: Award, label: "برنامج الولاء", path: "/loyalty" },
      { icon: Bot, label: "مركز البوت", path: "/customer-bot" },
      { icon: UserCog, label: "مساعد الموظفين", path: "/employee-bot" },
    ],
  },
  {
    label: "الإدارة",
    items: [
      { icon: Banknote, label: "التكلفة والهامش", path: "/financials" },
      { icon: KeyRound, label: "الصلاحيات", path: "/permissions" },
      { icon: Settings2, label: "إعدادات المتجر", path: "/settings/store" },
      { icon: CloudCog, label: "مصدر المنتجات OneDrive", path: "/settings/onedrive" },
      { icon: KeyRound, label: "إعداد تطبيق Meta", path: "/settings/meta-app" },
      { icon: Cable, label: "ربط Meta", path: "/meta-connections" },
    ],
  },
];

const menuItems = menuGroups.flatMap(group => group.items);

const pageDescriptions: Record<string, string> = {
  "/": "ملخص موحّد لحالة التشغيل والوصول",
  "/notifications": "تنبيهات العمل الداخلية الموجهة إليك",
  "/analytics": "قراءة تشغيلية من بيانات المتجر الفعلية",
  "/products": "إدارة الكتالوج والوسائط والألوان والكميات",
  "/orders": "متابعة الطلبات والتجهيز والتسليم اليدوي",
  "/crm": "ملفات العميلات والمهام وسجل العلاقة",
  "/inbox": "المحادثات والتعيين وسياق العميل والطلب",
  "/content-posts": "مسودات المحتوى والتقويم والمراجعة",
  "/marketing": "التخطيط الداخلي للحملات والجمهور",
  "/loyalty": "العضويات ودفتر النقاط والمكافآت",
  "/customer-bot": "المسودات الهجينة والمعرفة والمراجعة",
  "/employee-bot": "أوامر الموظفين المنظمة قبل التنفيذ",
  "/financials": "تكلفة المنتج والهامش داخل مساحة محمية",
  "/permissions": "صلاحيات دقيقة حسب العملية والمتجر",
  "/settings/store": "اللغة والعملة والتوصيل والقسائم",
  "/settings/onedrive": "ربط مصدر المنتجات وشجرة الأقسام لهذا المتجر",
  "/settings/delivery": "إعدادات التوصيل وقواعده",
  "/settings/meta-app": "إعداد التطبيق المركزي والأسرار المشفرة وروابط OAuth وWebhook",
  "/meta-connections": "قنوات Meta والأصول والصلاحيات لكل متجر",
};

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 292;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="grid min-h-screen place-items-center px-5">
        <div dir="rtl" className="w-full max-w-md overflow-hidden rounded-3xl border bg-card shadow-[0_28px_80px_-38px_oklch(0.35_0.05_350_/_0.65)]">
          <div className="bg-accent px-8 py-9 text-accent-foreground">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-xl font-black text-primary-foreground">ع</span>
            <h1 className="mt-6 text-2xl font-bold tracking-tight">سجّل دخولك للمتابعة</h1>
            <p className="mt-2 text-sm leading-6 text-accent-foreground/70">هذه منصة تشغيل داخلية. يتطلب الدخول التحقق من الهوية قبل إظهار أي بيانات أو صلاحيات.</p>
          </div>
          <div className="p-6">
            <Button onClick={() => startLogin()} size="lg" className="w-full rounded-xl shadow-md">تسجيل الدخول</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      className="platform-shell"
      dir="ltr"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({ children, setSidebarWidth }: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location)
    ?? (location === "/settings/delivery" ? menuItems.find(item => item.path === "/settings/store") : undefined);
  const isMobile = useIsMobile();
  const { data: notificationSummary } = trpc.notifications.summary.useQuery(undefined, { retry: false });
  const unreadNotifications = notificationSummary?.unreadCount ?? 0;

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = event.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="min-h-20 justify-center border-b border-sidebar-border/70 px-3 py-4" dir="rtl">
            <div className="flex w-full items-center gap-3 transition-all">
              <button onClick={toggleSidebar} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 text-sidebar-foreground/80 transition-colors hover:bg-white/14 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring" aria-label="طي قائمة التنقل">
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed ? (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-black text-primary-foreground shadow-lg shadow-black/10">ع</span>
                  <div className="min-w-0">
                    <span className="block truncate font-bold tracking-tight text-white">عالم الحجابات الأنيقة</span>
                    <span className="mt-0.5 block truncate text-[10px] tracking-[0.12em] text-sidebar-foreground/55">منصة التشغيل</span>
                  </div>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-1 px-2 py-3" dir="rtl">
            {menuGroups.map(group => (
              <SidebarGroup key={group.label} className="shrink-0 p-0">
                <SidebarGroupLabel className="h-7 px-3 text-[10px] font-bold tracking-[0.12em] text-sidebar-foreground/45">{group.label}</SidebarGroupLabel>
                <SidebarMenu className="gap-1">
                  {group.items.map(item => {
                    const isActive = location === item.path || (item.path === "/settings/store" && location === "/settings/delivery");
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={item.label}
                          className="h-10 rounded-xl px-3 font-medium text-sidebar-foreground/74 hover:bg-white/8 hover:text-white data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:shadow-md data-[active=true]:shadow-black/10"
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                          {isActive && !isCollapsed ? <ChevronLeft className="mr-auto h-3.5 w-3.5 opacity-65" /> : null}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter className="border-t border-sidebar-border/70 p-3" dir="rtl">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/8 group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  <Avatar className="h-9 w-9 shrink-0 border border-white/15">
                    <AvatarFallback className="bg-white/10 text-xs font-medium text-white">{user?.name?.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    <p className="truncate text-sm font-medium leading-none text-white">{user?.name || "-"}</p>
                    <p className="mt-1.5 truncate text-xs text-sidebar-foreground/50">{user?.email || "-"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="ml-2 h-4 w-4" />
                  <span>تسجيل الخروج</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div className={`absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/30 ${isCollapsed ? "hidden" : ""}`} onMouseDown={() => !isCollapsed && setIsResizing(true)} style={{ zIndex: 50 }} />
      </div>

      <SidebarInset dir="rtl" className="min-w-0 overflow-x-hidden">
        {isMobile ? (
          <div className="sticky top-0 z-40 flex min-h-16 items-center justify-between border-b border-border/70 bg-background/88 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/78">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-10 w-10 rounded-xl border bg-card text-foreground shadow-sm" />
              <div className="flex flex-col">
                <span className="font-bold tracking-tight text-foreground">{activeMenuItem?.label ?? "المنصة"}</span>
                <span className="mt-0.5 max-w-[190px] truncate text-[10px] text-muted-foreground">{pageDescriptions[location] ?? "منصة التشغيل الداخلية"}</span>
              </div>
            </div>
            <NotificationButton unread={unreadNotifications} onClick={() => setLocation("/notifications")} mobile />
          </div>
        ) : (
          <div className="flex min-h-16 items-center justify-between border-b border-border/70 bg-background/78 px-5 backdrop-blur-xl" dir="rtl">
            <div>
              <p className="text-sm font-bold text-foreground">{activeMenuItem?.label ?? "منصة التشغيل"}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{pageDescriptions[location] ?? "إدارة المتجر من مساحة موحّدة"}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setLocation("/store")} className="inline-flex h-9 items-center gap-2 rounded-full border bg-card px-3 text-xs font-bold text-foreground shadow-sm transition-colors hover:border-primary/45 hover:bg-secondary" aria-label="فتح واجهة المتجر">
                <ShoppingBag className="h-4 w-4 text-primary" />واجهة المتجر<ExternalLink className="h-3 w-3 text-muted-foreground" />
              </button>
              <NotificationButton unread={unreadNotifications} onClick={() => setLocation("/notifications")} />
            </div>
          </div>
        )}
        <main data-platform-page className="min-w-0 flex-1 p-3 sm:p-5 lg:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}

function NotificationButton({ unread, onClick, mobile = false }: { unread: number; onClick: () => void; mobile?: boolean }) {
  return (
    <button onClick={onClick} className={`relative flex items-center justify-center border bg-card text-foreground shadow-sm transition-colors hover:border-primary/45 hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mobile ? "h-10 w-10 rounded-xl" : "h-9 w-9 rounded-full"}`} aria-label="فتح مركز التنبيهات">
      <Bell className="h-4 w-4" />
      {unread > 0 ? <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">{unread > 9 ? "9+" : unread}</span> : null}
    </button>
  );
}
