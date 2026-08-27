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
import CRM from "./pages/CRM";
import Inbox from "./pages/Inbox";
import CustomerBot from "./pages/CustomerBot";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/store/:productCode"} component={Storefront} />
      <Route path={"/store"} component={Storefront} />
      <Route path={"/"} component={OperationsOverview} />
      <Route path={"/permissions"} component={AccessControl} />
      <Route path={"/products"} component={Products} />
      <Route path={"/orders"} component={Orders} />
      <Route path={"/crm"} component={CRM} />
      <Route path={"/inbox"} component={Inbox} />
      <Route path={"/customer-bot"} component={CustomerBot} />
      <Route path={"/settings/store"} component={StoreSettings} />
      <Route path={"/settings/delivery"} component={StoreSettings} />
      <Route path={"/content-posts"} component={ContentPosts} />
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
  if (location === "/store" || location.startsWith("/store/")) return <Router />;
  return <DashboardLayout><Router /></DashboardLayout>;
}

export default App;
