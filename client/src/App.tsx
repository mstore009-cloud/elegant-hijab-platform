import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import AccessControl from "./pages/AccessControl";
import ContentPosts from "./pages/ContentPosts";
import OperationsOverview from "./pages/OperationsOverview";
import Products from "./pages/Products";
import Storefront from "./pages/Storefront";
import Orders from "./pages/Orders";
import StoreSettings from "./pages/StoreSettings";
import OneDriveSettings from "./pages/OneDriveSettings";
import CRM from "./pages/CRM";
import Inbox from "./pages/Inbox";
import CustomerBot from "./pages/CustomerBot";
import Marketing from "./pages/Marketing";
import Analytics from "./pages/Analytics";
import Loyalty from "./pages/Loyalty";
import Notifications from "./pages/Notifications";
import EmployeeBot from "./pages/EmployeeBot";
import Financials from "./pages/Financials";
import MetaConnections from "./pages/MetaConnections";
import MetaPlatformSettings from "./pages/MetaPlatformSettings";
import PublicLegal from "./pages/PublicLegal";

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
      <Route path={"/customer-bot"} component={CustomerBot} />
      <Route path={"/employee-bot"} component={EmployeeBot} />
      <Route path={"/settings/store"} component={StoreSettings} />
      <Route path={"/settings/onedrive"} component={OneDriveSettings} />
      <Route path={"/settings/delivery"} component={StoreSettings} />
      <Route path={"/meta-connections"} component={MetaConnections} />
      <Route path={"/settings/meta-app"} component={MetaPlatformSettings} />
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
          <PublicOrDashboard />
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
