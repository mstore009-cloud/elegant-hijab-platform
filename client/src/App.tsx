import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import { recordPerformanceMetric, appBootStartedAt } from "./performance";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";

const NotFound = lazy(() => import("@/pages/NotFound"));
const AccessControl = lazy(() => import("@/pages/AccessControl"));
const ContentPosts = lazy(() => import("@/pages/ContentPosts"));
const OperationsOverview = lazy(() => import("@/pages/OperationsOverview"));
const Products = lazy(() => import("@/pages/Products"));
const Storefront = lazy(() => import("@/pages/Storefront"));
const Orders = lazy(() => import("@/pages/Orders"));
const StoreSettings = lazy(() => import("@/pages/StoreSettings"));
const OneDriveSettings = lazy(() => import("@/pages/OneDriveSettings"));
const CRM = lazy(() => import("@/pages/CRM"));
const Inbox = lazy(() => import("@/pages/Inbox"));
const CustomerBot = lazy(() => import("@/pages/CustomerBot"));
const CustomerBotPlayground = lazy(() => import("@/pages/CustomerBotPlayground"));
const CustomerBotLearning = lazy(() => import("@/pages/CustomerBotLearning"));
const CustomerBotTesting = lazy(() => import("@/pages/CustomerBotTesting"));
const CustomerBotSettings = lazy(() => import("@/pages/CustomerBotSettings"));
const Marketing = lazy(() => import("@/pages/Marketing"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Loyalty = lazy(() => import("@/pages/Loyalty"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const EmployeeBot = lazy(() => import("@/pages/EmployeeBot"));
const Financials = lazy(() => import("@/pages/Financials"));
const MetaConnections = lazy(() => import("@/pages/MetaConnections"));
const MetaPlatformSettings = lazy(() => import("@/pages/MetaPlatformSettings"));
const PublicLegal = lazy(() => import("@/pages/PublicLegal"));
const AiPlatformSettings = lazy(() => import("@/pages/AiPlatformSettings"));
let firstOpenRecorded = false;

function PageLoading() {
  return <div className="grid min-h-[40vh] place-items-center p-8 text-sm text-muted-foreground">جارٍ تحميل الصفحة…</div>;
}

function PerformanceTelemetry() {
  const [location] = useLocation();
  useEffect(() => {
    const now = performance.now();
    const metricName = firstOpenRecorded ? "route_navigation" : "first_open";
    firstOpenRecorded = true;
    recordPerformanceMetric(metricName, now - appBootStartedAt, location);
  }, [location]);
  return null;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/privacy-policy"} component={PublicLegal} />
      <Route path={"/terms"} component={PublicLegal} />
      <Route path={"/data-deletion"} component={PublicLegal} />
      <Route path={"/store/:productCode"} component={Storefront} />
      <Route path={"/store"} component={Storefront} />
      <Route path={"/"} component={OperationsOverview} />
      <Route path={"/permissions"} component={AccessControl} />
      <Route path={"/products"} component={Products} />
      <Route path={"/financials"} component={Financials} />
      <Route path={"/orders"} component={Orders} />
      <Route path={"/crm"} component={CRM} />
      <Route path={"/loyalty"} component={Loyalty} />
      <Route path={"/inbox"} component={Inbox} />
      <Route path={"/customer-bot/playground"} component={CustomerBotPlayground} />
      <Route path={"/customer-bot/commands"} component={LegacyCustomerBotCommands} />
      <Route path={"/customer-bot/learning"} component={CustomerBotLearning} />
      <Route path={"/customer-bot/testing"} component={CustomerBotTesting} />
      <Route path={"/customer-bot/settings"} component={CustomerBotSettings} />
      <Route path={"/customer-bot"} component={CustomerBot} />
      <Route path={"/employee-bot"} component={EmployeeBot} />
      <Route path={"/settings/store"} component={StoreSettings} />
      <Route path={"/settings/onedrive"} component={OneDriveSettings} />
      <Route path={"/settings/delivery"} component={StoreSettings} />
      <Route path={"/meta-connections"} component={MetaConnections} />
      <Route path={"/settings/meta-app"} component={MetaPlatformSettings} />
      <Route path={"/settings/ai"} component={AiPlatformSettings} />
      <Route path={"/content-posts"} component={ContentPosts} />
      <Route path={"/marketing"} component={Marketing} />
      <Route path={"/analytics"} component={Analytics} />
      <Route path={"/notifications"} component={Notifications} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function LegacyCustomerBotCommands() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/customer-bot/learning?tab=assistant"); }, [setLocation]);
  return <div className="p-8 text-sm text-muted-foreground">جارٍ فتح مساعد التعليم داخل المعرفة والتعلم…</div>;
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <PerformanceTelemetry />
          <Suspense fallback={<PageLoading />}><PublicOrDashboard /></Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function PublicOrDashboard() {
  const [location] = useLocation();
  if (location === "/store" || location.startsWith("/store/") || location === "/privacy-policy" || location === "/terms" || location === "/data-deletion") return <Router />;
  return <DashboardLayout><Router /></DashboardLayout>;
}

export default App;
