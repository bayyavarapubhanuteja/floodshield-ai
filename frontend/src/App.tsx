import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useApp } from "./context/AppContext";
import AppShell from "./components/layout/AppShell";
import { Loading } from "./components/ui";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import Forgot from "./pages/auth/Forgot";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const LiveMap = lazy(() => import("./pages/LiveMap"));
const Rainfall = lazy(() => import("./pages/Rainfall"));
const Terrain = lazy(() => import("./pages/Terrain"));
const Drainage = lazy(() => import("./pages/Drainage"));
const Prediction = lazy(() => import("./pages/Prediction"));
const Risk = lazy(() => import("./pages/Risk"));
const WhatIf = lazy(() => import("./pages/WhatIf"));
const Routing = lazy(() => import("./pages/Routing"));
const Infrastructure = lazy(() => import("./pages/Infrastructure"));
const Cctv = lazy(() => import("./pages/Cctv"));
const CitizenReports = lazy(() => import("./pages/CitizenReports"));
const Historical = lazy(() => import("./pages/Historical"));
const Maintenance = lazy(() => import("./pages/Maintenance"));
const Emergency = lazy(() => import("./pages/Emergency"));
const Copilot = lazy(() => import("./pages/Copilot"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));

function Protected({ children, officer }: { children: React.ReactNode; officer?: boolean }) {
  const { user, loadingUser, isOfficer } = useApp();
  const loc = useLocation();
  if (loadingUser) return <Loading text="Starting FloodShield AI…" className="h-screen" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (officer && !isOfficer) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const O = (el: React.ReactNode) => <Protected officer>{el}</Protected>;
  return (
    <Suspense fallback={<Loading className="h-screen" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<Forgot />} />
        <Route element={<Protected><AppShell /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="map" element={<LiveMap />} />
          <Route path="rainfall" element={<Rainfall />} />
          <Route path="terrain" element={O(<Terrain />)} />
          <Route path="drainage" element={O(<Drainage />)} />
          <Route path="prediction" element={O(<Prediction />)} />
          <Route path="risk" element={O(<Risk />)} />
          <Route path="whatif" element={O(<WhatIf />)} />
          <Route path="routing" element={<Routing />} />
          <Route path="infrastructure" element={O(<Infrastructure />)} />
          <Route path="cctv" element={<Cctv />} />
          <Route path="citizen-reports" element={<CitizenReports />} />
          <Route path="historical" element={O(<Historical />)} />
          <Route path="maintenance" element={O(<Maintenance />)} />
          <Route path="emergency" element={<Emergency />} />
          <Route path="copilot" element={<Copilot />} />
          <Route path="incidents" element={O(<Incidents />)} />
          <Route path="reports" element={O(<Reports />)} />
          <Route path="settings" element={<Settings />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
