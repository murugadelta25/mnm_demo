import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { DEFAULT_APP_NAME } from '../config/branding';

const BrandingContext = createContext(null);

function applyFavicon(url) {
  if (!url) return;
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
}

export function BrandingProvider({ children }) {
  const [siteTitle, setSiteTitle] = useState(DEFAULT_APP_NAME);
  const [faviconUrl, setFaviconUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    return api
      .get('/api/config/branding')
      .then((response) => {
        const title = (response.data?.siteTitle || '').trim() || DEFAULT_APP_NAME;
        setSiteTitle(title);
        setFaviconUrl(response.data?.faviconUrl || null);
        setLoaded(true);
        return title;
      })
      .catch(() => {
        setSiteTitle(DEFAULT_APP_NAME);
        setLoaded(true);
        return DEFAULT_APP_NAME;
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    document.title = siteTitle;
  }, [siteTitle]);

  useEffect(() => {
    applyFavicon(faviconUrl);
  }, [faviconUrl]);

  const value = useMemo(
    () => ({
      siteTitle,
      faviconUrl,
      loaded,
      reload,
    }),
    [siteTitle, faviconUrl, loaded, reload],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within BrandingProvider');
  }
  return context;
}
