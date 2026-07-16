import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import AccountingEntries from "./pages/AccountingEntries.jsx";
import AccountingPeriods from "./pages/AccountingPeriods.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import ApprovalInbox from "./pages/ApprovalInbox.jsx";
import CostCenters from "./pages/CostCenters.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ExchangeRates from "./pages/ExchangeRates.jsx";
import ExpenseTypes from "./pages/ExpenseTypes.jsx";
import Login from "./pages/Login.jsx";
import RequestCreate from "./pages/RequestCreate.jsx";
import RequestDetail from "./pages/RequestDetail.jsx";
import RequestsList from "./pages/RequestsList.jsx";
import SireExport from "./pages/SireExport.jsx";
import Suppliers from "./pages/Suppliers.jsx";
import TreasuryQueue from "./pages/TreasuryQueue.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="requests" element={<RequestsList />} />
          <Route path="requests/new" element={<ProtectedRoute roles={["Admin", "Solicitor"]} />}>
            <Route index element={<RequestCreate />} />
          </Route>
          <Route path="requests/:id/edit" element={<ProtectedRoute roles={["Admin", "Solicitor"]} />}>
            <Route index element={<RequestCreate />} />
          </Route>
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="approvals" element={<ProtectedRoute roles={["Admin", "Approver"]} />}>
            <Route index element={<ApprovalInbox />} />
          </Route>
          <Route path="accounting" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<AccountingEntries />} />
            <Route path="periods" element={<AccountingPeriods />} />
            <Route path="sire" element={<SireExport />} />
          </Route>
          <Route path="treasury" element={<ProtectedRoute roles={["Admin", "Treasury"]} />}>
            <Route index element={<TreasuryQueue />} />
          </Route>
          <Route path="suppliers" element={<ProtectedRoute roles={["Admin", "Accounting", "Treasury", "Solicitor"]} />}>
            <Route index element={<Suppliers />} />
          </Route>
          <Route path="cost-centers" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<CostCenters />} />
          </Route>
          <Route path="expense-types" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<ExpenseTypes />} />
          </Route>
          <Route path="exchange-rates" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<ExchangeRates />} />
          </Route>
          <Route path="users" element={<ProtectedRoute roles={["Admin"]} />}>
            <Route index element={<AdminUsers />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
