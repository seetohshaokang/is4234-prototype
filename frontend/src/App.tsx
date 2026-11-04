import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell";
import SCCLibrary from "./pages/ClaimRegistry";
import ChecksCollectors from "./pages/ControlTests";
import ChangeRequests from "./pages/GateReview";
import FindingsPage from "./pages/FindingsPage";
import EscalationsPage from "./pages/EscalationsPage";
import AuditTrail from "./pages/AuditTrail";
import AboutPage from "./pages/AboutPage";
import SCCDetail from "./pages/SCCDetail";
import Resolver from "./pages/Resolver";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/sccs" replace />} />
        <Route path="/sccs" element={<SCCLibrary />} />
        <Route path="/sccs/:id" element={<SCCDetail />} />
        <Route path="/checks" element={<ChecksCollectors />} />
        <Route path="/changes" element={<ChangeRequests />} />
        <Route path="/findings" element={<FindingsPage />} />
        <Route path="/escalations" element={<EscalationsPage />} />
        <Route path="/resolver" element={<Resolver />} />
        <Route path="/audit" element={<AuditTrail />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
    </AppShell>
  );
}
