import { Navigate, useLocation } from 'react-router-dom';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { isRouteEnabled } from '../config/featureRegistry';

/** Redirect to dashboard when a disabled feature route is opened directly. */
export default function FeatureRouteGuard({ children }) {
  const { pathname } = useLocation();
  const { modules, loading } = useFeatureFlags();

  if (loading) return children;

  if (pathname.startsWith('/platform')) return children;

  if (!isRouteEnabled(pathname, modules)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
