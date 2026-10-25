import { Routes, Route } from "react-router-dom";
import AppShell from "./components/AppShell";
import Dashboard from "./pages/Dashboard";
import ClaimRegistry from "./pages/ClaimRegistry";
import ControlTests from "./pages/ControlTests";
import FindingsPage from "./pages/FindingsPage";
import EscalationsPage from "./pages/EscalationsPage";
import GateReview from "./pages/GateReview";
import AuditTrail from "./pages/AuditTrail";
import AboutPage from "./pages/AboutPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/claims" element={<ClaimRegistry />} />
        <Route path="/controls" element={<ControlTests />} />
        <Route path="/findings" element={<FindingsPage />} />
        <Route path="/escalations" element={<EscalationsPage />} />
        <Route path="/gate" element={<GateReview />} />
        <Route path="/audit" element={<AuditTrail />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
    </AppShell>
  );
}
