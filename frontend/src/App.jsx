import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PlatformAuthProvider } from './context/PlatformAuthContext';
import { FeatureFlagsProvider } from './context/FeatureFlagsContext';
import { ThemeProvider } from './context/ThemeContext';
import { BrandingProvider } from './context/BrandingContext';
import { EmbedProvider } from './context/EmbedContext';
import AppShell from './components/layout/AppShell';
import IdleTimeoutGuard from './components/IdleTimeoutGuard';
import FeatureRouteGuard from './components/FeatureRouteGuard';
import Login from './pages/Login';
import PlatformLogin from './pages/platform/PlatformLogin';
import FeatureModulesAdmin from './pages/platform/FeatureModulesAdmin';
import Dashboard from './pages/Dashboard';
import DataEntry from './pages/DataEntry';
import ModelChange from './pages/ModelChange';
import Breakdown from './pages/Breakdown';
import MaintenanceDashboard from './pages/MaintenanceDashboard';
import LossTracker from './pages/LossTracker';
import ProductionPlanning from './pages/ProductionPlanning';
import WorkOrderManagement from './pages/WorkOrderManagement';
import EmailAlerts from './pages/EmailAlerts';
import ProcessSetpointAlerts from './pages/ProcessSetpointAlerts';
import { ConfigProvider } from './context/ConfigContext';
import Configuration from './pages/Configuration';
import FactorySetup from './pages/FactorySetup';
import MachineConfig from './pages/MachineConfig';
import MachineHourlyOutput from './pages/MachineHourlyOutput';
import UserManagement from './pages/UserManagement';
import OperatorWorkInstructionDashboard from './pages/OperatorWorkInstructionDashboard';
import QcApprovals from './pages/QcApprovals';
import PartManagement from './pages/PartManagement';
import ToolManagement from './pages/ToolManagement';
import AutoLogin from './pages/AutoLogin';
import WorkInstructionRevision from './pages/WorkInstructionRevision';
import DatabaseManagement from './pages/DatabaseManagement';
import OperatorManagement from './pages/OperatorManagement';
import MyWorkHours from './pages/MyWorkHours';
import FactoryOverview from './pages/FactoryOverview';
import LineOverview from './pages/LineOverview';
import EquipmentOverview from './pages/EquipmentOverview';
import MonitorMode from './pages/MonitorMode';
import FmmsAssetManagement from './pages/fmms/FmmsAssetManagement';
import FmmsAssetHierarchy from './pages/fmms/FmmsAssetHierarchy';
import FmmsDashboard from './pages/fmms/FmmsDashboard';
import FmmsWorkOrders from './pages/fmms/FmmsWorkOrders';
import FmmsRingiSor from './pages/fmms/FmmsRingiSor';
import FmmsAmcCalibration from './pages/fmms/FmmsAmcCalibration';
import FmmsBreakdownRca from './pages/fmms/FmmsBreakdownRca';
import FmmsPicAssignment from './pages/fmms/FmmsPicAssignment';
import FmmsPicMaster from './pages/fmms/FmmsPicMaster';
import FmmsCompliance from './pages/fmms/FmmsCompliance';
import FmmsAssetMonitoring from './pages/fmms/FmmsAssetMonitoring';
import FmmsSparePartsInventory from './pages/fmms/FmmsSparePartsInventory';
import FmmsPlanning from './pages/fmms/FmmsPlanning';
import FmmsIntegrations from './pages/fmms/FmmsIntegrations';
import FmmsIncidentTracking from './pages/fmms/FmmsIncidentTracking';
import TacoDashboard from './pages/fmms/taco/TacoDashboard';
import TacoVendors from './pages/fmms/taco/TacoVendors';
import TacoVendorWorkflow from './pages/fmms/taco/TacoVendorWorkflow';
import TacoCalibrationCost from './pages/fmms/taco/TacoCalibrationCost';
import TacoTestingEquipment from './pages/fmms/taco/TacoTestingEquipment';
import TacoBooking from './pages/fmms/taco/TacoBooking';
import TacoTestingKpis from './pages/fmms/taco/TacoTestingKpis';

/** CPLM Root + Outlet pattern — shell wraps all authenticated routes */
function AuthenticatedShell() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/login" replace />;
  return (
    <IdleTimeoutGuard>
      <FeatureRouteGuard>
        <AppShell />
      </FeatureRouteGuard>
    </IdleTimeoutGuard>
  );
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/platform/login" element={<PlatformLogin />} />
      <Route path="/platform/modules" element={<FeatureModulesAdmin />} />
      <Route path="/platform" element={<Navigate to="/platform/login" replace />} />

      <Route path="/login" element={<Login />} />
      <Route path="/autologin" element={<AutoLogin />} />
      <Route element={<AuthenticatedShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/overview/factory" element={<FactoryOverview />} />
        <Route path="/overview/line" element={<LineOverview />} />
        <Route path="/overview/line/:lineId" element={<LineOverview />} />
        <Route path="/overview/equipment" element={<EquipmentOverview />} />
        <Route path="/overview/equipment/:machineId" element={<EquipmentOverview />} />
        <Route path="/overview/monitor" element={<MonitorMode />} />
        <Route path="/planning" element={<ProductionPlanning />} />
        <Route path="/work-orders" element={<WorkOrderManagement />} />
        <Route path="/entry" element={<DataEntry />} />
        <Route path="/model-change" element={<ModelChange />} />
        <Route path="/breakdown" element={<Breakdown />} />
        <Route path="/maintenance" element={<MaintenanceDashboard />} />
        <Route path="/loss-tracker" element={<LossTracker />} />
        <Route path="/alerts/email" element={<EmailAlerts />} />
        <Route path="/alerts/process-setpoints" element={<ProcessSetpointAlerts />} />
        <Route path="/factory-setup" element={<FactorySetup />} />
        <Route path="/config" element={<Configuration />} />
        <Route path="/machines" element={<MachineConfig />} />
        <Route path="/hourly-output" element={<MachineHourlyOutput />} />
        <Route path="/work-instructions" element={<OperatorWorkInstructionDashboard />} />
        <Route path="/qc-approvals" element={<QcApprovals />} />
        <Route path="/parts" element={<PartManagement />} />
        <Route path="/tools" element={<ToolManagement />} />
        <Route path="/wi-revisions" element={<WorkInstructionRevision />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/operators" element={<OperatorManagement />} />
        <Route path="/my-work-hours" element={<MyWorkHours />} />
        <Route path="/database-management" element={<DatabaseManagement />} />
        <Route path="/fmms/dashboard" element={<FmmsDashboard />} />
        <Route path="/fmms/assets" element={<FmmsAssetManagement />} />
        <Route path="/fmms/asset-hierarchy" element={<FmmsAssetHierarchy />} />
        <Route path="/fmms/work-orders" element={<FmmsWorkOrders />} />
        <Route path="/fmms/ringi-sor" element={<FmmsRingiSor />} />
        <Route path="/fmms/amc-calibration" element={<FmmsAmcCalibration />} />
        <Route path="/fmms/breakdown-rca" element={<FmmsBreakdownRca />} />
        <Route path="/fmms/pic-assignment" element={<FmmsPicAssignment />} />
        <Route path="/fmms/pic-master" element={<FmmsPicMaster />} />
        <Route path="/fmms/pmc-planning" element={<Navigate to="/fmms/planning?tab=pmc" replace />} />
        <Route path="/fmms/compliance" element={<FmmsCompliance />} />
        <Route path="/fmms/monitoring" element={<FmmsAssetMonitoring />} />
        <Route path="/fmms/spare-parts" element={<FmmsSparePartsInventory />} />
        <Route path="/fmms/planning" element={<FmmsPlanning />} />
        <Route path="/fmms/integrations" element={<FmmsIntegrations />} />
        <Route path="/fmms/incidents" element={<FmmsIncidentTracking />} />
        <Route path="/taco-fmms/dashboard" element={<TacoDashboard />} />
        <Route path="/taco-fmms/vendors" element={<TacoVendors />} />
        <Route path="/taco-fmms/vendor-workflow" element={<TacoVendorWorkflow />} />
        <Route path="/taco-fmms/calibration-cost" element={<TacoCalibrationCost />} />
        <Route path="/taco-fmms/testing-equipment" element={<TacoTestingEquipment />} />
        <Route path="/taco-fmms/booking" element={<TacoBooking />} />
        <Route path="/taco-fmms/testing-kpis" element={<TacoTestingKpis />} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <FeatureFlagsProvider>
        <PlatformAuthProvider>
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
        </PlatformAuthProvider>
      </FeatureFlagsProvider>
    </ThemeProvider>
  );
}
