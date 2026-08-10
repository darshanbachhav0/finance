import {
  BarChart3,
  Bell,
  Building2,
  CalendarRange,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileSpreadsheet,
  Landmark,
  LogOut,
  Menu,
  ReceiptText,
  Settings2,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import api from "../api/client.js";
import LanguageToggle from "../components/LanguageToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";

const groups = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", path: "/", icon: BarChart3 }]
  },
  {
    label: "Operations",
    items: [
      { label: "Requests", path: "/requests", icon: ReceiptText },
      { label: "Approval Inbox", path: "/approvals", icon: ClipboardCheck, roles: ["Admin", "Approver"], counter: "approval" }
    ]
  },
  {
    label: "Finance",
    items: [
      { label: "Accounting Entries", path: "/accounting", icon: FileSpreadsheet, roles: ["Admin", "Accounting"], counter: "accounting" },
      { label: "Treasury", path: "/treasury", icon: Landmark, roles: ["Admin", "Treasury"], counter: "payable" },
      { label: "Budget Control", path: "/budget", icon: WalletCards, roles: ["Admin", "Approver", "Accounting"] },
      { label: "Accounting Periods", path: "/accounting/periods", icon: CalendarRange, roles: ["Admin", "Accounting"] },
      { label: "SIRE Export", path: "/accounting/sire", icon: FileSpreadsheet, roles: ["Admin", "Accounting"] },
      { label: "Management Reports", path: "/reports", icon: ChartNoAxesCombined, roles: ["Admin", "Approver", "Accounting", "Treasury"] }
    ]
  },
  {
    label: "Master Data",
    items: [
      { label: "Suppliers", path: "/suppliers", icon: Building2, roles: ["Admin", "Accounting", "Treasury", "Solicitor"], counter: "suppliers" },
      { label: "Cost Centers", path: "/cost-centers", icon: CircleDollarSign, roles: ["Admin", "Accounting"] },
      { label: "Expense Types", path: "/expense-types", icon: Settings2, roles: ["Admin", "Accounting"] },
      { label: "Exchange Rates", path: "/exchange-rates", icon: CircleDollarSign, roles: ["Admin", "Accounting"] }
    ]
  },
  {
    label: "Administration",
    items: [{ label: "Users", path: "/users", icon: Users, roles: ["Admin"] }]
  }
];

const routeTitles = [
  [/^\/$/, "Dashboard"],
  [/^\/requests\/new$/, "New request"],
  [/^\/requests\/[^/]+\/edit$/, "Edit request"],
  [/^\/requests\/[^/]+$/, "Request details"],
  [/^\/requests/, "Requests"],
  [/^\/approvals/, "Approval Inbox"],
  [/^\/treasury/, "Treasury Payment Queue"],
  [/^\/budget/, "Budget Control"],
  [/^\/reports/, "Management Reports"],
  [/^\/accounting\/periods/, "Accounting Periods"],
  [/^\/accounting\/sire/, "SIRE RCE Export"],
  [/^\/accounting/, "Accounting Entries"],
  [/^\/suppliers/, "Suppliers"],
  [/^\/cost-centers/, "Cost Centers"],
  [/^\/expense-types/, "Expense Types"],
  [/^\/exchange-rates/, "Exchange Rates"],
  [/^\/users/, "Users"]
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("erp_sidebar_collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tasks, setTasks] = useState({ items: [], total: 0, counters: {} });
  const [taskOpen, setTaskOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const menusRef = useRef(null);
  const mobileBackdrop = useAnimatedPresence(mobileOpen, 180);

  const visibleGroups = useMemo(() => groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(user.role))
  })).filter((group) => group.items.length), [user.role]);

  const pageTitle = routeTitles.find(([pattern]) => pattern.test(location.pathname))?.[1] || "Financial Control";
  const breadcrumb = location.pathname === "/" ? [] : [{ label: "Dashboard", path: "/" }, { label: pageTitle }];

  function loadTasks() {
    api.get("/dashboard/tasks").then((response) => setTasks(response.data)).catch(() => setTasks({ items: [], total: 0, counters: {} }));
  }

  useEffect(() => {
    setMobileOpen(false);
    setTaskOpen(false);
    loadTasks();
  }, [location.pathname]);

  useEffect(() => {
    const refresh = () => loadTasks();
    window.addEventListener("erp:tasks-changed", refresh);
    return () => window.removeEventListener("erp:tasks-changed", refresh);
  }, [user.role]);

  useEffect(() => {
    const closeMenus = (event) => !menusRef.current?.contains(event.target) && (setTaskOpen(false), setUserOpen(false));
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      localStorage.setItem("erp_sidebar_collapsed", String(!current));
      return !current;
    });
  }

  return (
    <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " mobile-nav-open" : ""}`}>
      {mobileBackdrop.shouldRender && <button type="button" className={`mobile-nav-backdrop motion-${mobileBackdrop.phase}`} onClick={() => setMobileOpen(false)} aria-label={t("Close navigation")} />}
      <aside className="sidebar" aria-label={t("Primary navigation")}>
        <div className="brand">
          <div className="brand-mark">FC</div>
          <div className="brand-copy">
            <strong>{t("Financial Control")}</strong>
            <span>{t("Requests & payments")}</span>
          </div>
          <button type="button" className="icon-button sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label={t("Close navigation")}><X size={19} /></button>
        </div>

        <nav className="nav-groups">
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{t(group.label)}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                const count = item.counter ? tasks.counters?.[item.counter] : 0;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    className="nav-item"
                    data-tooltip={t(item.label)}
                    aria-label={t(item.label)}
                  >
                    <Icon size={18} />
                    <span className="nav-label">{t(item.label)}</span>
                    {count > 0 && <span className="nav-counter" aria-label={t("{count} pending tasks").replace("{count}", count)}>{count > 99 ? "99+" : count}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <button type="button" className="sidebar-collapse" onClick={toggleCollapsed} aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")}>
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          <span>{t("Collapse sidebar")}</span>
        </button>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button type="button" className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label={t("Open navigation")}><Menu size={20} /></button>
            <div>
              {breadcrumb.length > 0 && (
                <nav className="breadcrumbs" aria-label={t("Breadcrumbs")}>
                  {breadcrumb.map((item, index) => item.path ? <Link key={item.label} to={item.path}>{t(item.label)}</Link> : <span key={item.label} aria-current="page">{t(item.label)}</span>).reduce((items, item, index) => index ? [...items, <span className="breadcrumb-separator" key={`separator-${index}`}>/</span>, item] : [item], [])}
                </nav>
              )}
              <h1>{t(pageTitle)}</h1>
            </div>
          </div>

          <div className="topbar-actions" ref={menusRef}>
            <LanguageToggle />
            <div className="topbar-menu">
              <button type="button" className="icon-button notification-button" onClick={() => { setTaskOpen((current) => !current); setUserOpen(false); }} aria-label={t("Open task notifications")} aria-expanded={taskOpen}>
                <Bell size={19} />
                {tasks.total > 0 && <span className="notification-dot">{tasks.total > 99 ? "99+" : tasks.total}</span>}
              </button>
              {taskOpen && (
                <div className="topbar-popover task-popover">
                  <div className="popover-heading">
                    <strong>{t("Tasks and alerts")}</strong>
                    <span>{tasks.total}</span>
                  </div>
                  <div className="task-list">
                    {tasks.items.filter((item) => item.count > 0).map((item) => (
                      <Link key={item.key} to={item.path} className="task-item">
                        <span className={`task-indicator tone-${item.tone}`} />
                        <span>{t(item.label)}</span>
                        <strong>{item.count}</strong>
                      </Link>
                    ))}
                    {!tasks.items.some((item) => item.count > 0) && <p className="popover-empty">{t("No pending tasks.")}</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="topbar-menu">
              <button type="button" className="user-menu-button" onClick={() => { setUserOpen((current) => !current); setTaskOpen(false); }} aria-expanded={userOpen}>
                <span className="user-avatar">{user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
                <span className="user-summary"><strong>{user.name}</strong><small>{t(user.role)} · {user.area}</small></span>
                <ChevronDown size={15} />
              </button>
              {userOpen && (
                <div className="topbar-popover user-popover">
                  <div className="user-popover-info">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <small>{t(user.role)} · {user.area}</small>
                  </div>
                  <button type="button" onClick={logout}><LogOut size={16} /><span>{t("Log out")}</span></button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
