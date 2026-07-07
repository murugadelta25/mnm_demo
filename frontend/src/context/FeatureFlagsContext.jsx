import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import { getDefaultFeatureModules } from '../config/featureRegistry';

const FeatureFlagsCtx = createContext({
  modules: getDefaultFeatureModules(),
  registry: null,
  loading: true,
  reload: () => {},
  isEnabled: () => true,
});

export function FeatureFlagsProvider({ children }) {
  const [modules, setModules] = useState(getDefaultFeatureModules);
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    return api.get('/api/features/')
      .then(r => {
        setModules({ ...getDefaultFeatureModules(), ...(r.data?.modules || {}) });
        if (r.data?.registry) setRegistry(r.data.registry);
      })
      .catch(() => {
        setModules(getDefaultFeatureModules());
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const isEnabled = useCallback(
    featureId => !featureId || modules[featureId] !== false,
    [modules],
  );

  return (
    <FeatureFlagsCtx.Provider value={{ modules, registry, loading, reload, isEnabled }}>
      {children}
    </FeatureFlagsCtx.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsCtx);
}
