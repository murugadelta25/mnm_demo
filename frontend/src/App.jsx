import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { BrandingProvider } from './context/BrandingContext';
import { EmbedProvider } from './context/EmbedContext';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DataEntry from './pages/DataEntry';
import ModelChange from './pages/ModelChange';
import Breakdown from './pages/Breakdown';
import MaintenanceDashboard from './pages/MaintenanceDashboard';
import LossTracker from './pages/LossTracker';
import ProductionPlanning from './pages/ProductionPlanning';
import EmailAlerts from './pages/EmailAlerts';
import { ConfigProvider } from './context/ConfigContext';
import Configuration from './pages/Configuration';
import FactorySetup from './pages/FactorySetup';
import MachineConfig from './pages/MachineConfig';
import MachineHourlyOutput from './pages/MachineHourlyOutput';
import UserManagement from './pages/UserManagement';
import OperatorWorkInstructionDashboard from './pages/OperatorWorkInstructionDashboard';
import QcApprovals from './pages/QcApprovals';
import PartManagement from './pages/PartManagement';
import WorkInstructionRevision from './pages/WorkInstructionRevision';

/** CPLM Root + Outlet pattern — shell wraps all authenticated routes */
function AuthenticatedShell() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell />;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AuthenticatedShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/planning" element={<ProductionPlanning />} />
        <Route path="/entry" element={<DataEntry />} />
        <Route path="/model-change" element={<ModelChange />} />
        <Route path="/breakdown" element={<Breakdown />} />
        <Route path="/maintenance" element={<MaintenanceDashboard />} />
        <Route path="/loss-tracker" element={<LossTracker />} />
        <Route path="/alerts/email" element={<EmailAlerts />} />
        <Route path="/factory-setup" element={<FactorySetup />} />
        <Route path="/config" element={<Configuration />} />
        <Route path="/machines" element={<MachineConfig />} />
        <Route path="/hourly-output" element={<MachineHourlyOutput />} />
        <Route path="/work-instructions" element={<OperatorWorkInstructionDashboard />} />
        <Route path="/qc-approvals" element={<QcApprovals />} />
        <Route path="/parts" element={<PartManagement />} />
        <Route path="/wi-revisions" element={<WorkInstructionRevision />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <BrandingProvider>
            <EmbedProvider>
              <ConfigProvider>
                <AppRoutes />
              </ConfigProvider>
            </EmbedProvider>
          </BrandingProvider>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
