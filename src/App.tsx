import { useEffect, useMemo, useState } from 'react';
import Editor, {
  TRANSLATIONS,
  detectUiLang,
  isVideoPath,
  loadSettings,
  resolveTheme,
  saveSettings,
  LAST_VIDEO_KEY,
  type UiLang,
  type ThemePref,
  type ResolvedTheme,
} from './Editor';
import TabBar from './TabBar';
import UpdateBanner from './UpdateBanner';

const TABS_KEY = 'subbi:tabs:v1';
const MAX_TABS = 50;

export type Tab = { id: string; videoPath: string | null };
type TabsState = { tabs: Tab[]; activeTabId: string };

function newTabId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function emptyTab(): Tab {
  return { id: newTabId(), videoPath: null };
}

function loadTabs(): TabsState {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const tabs: Tab[] = parsed.tabs.slice(0, MAX_TABS).map((t: any) => ({
          id: typeof t.id === 'string' && t.id ? t.id : newTabId(),
          videoPath: typeof t.videoPath === 'string' ? t.videoPath : null,
        }));
        const activeTabId =
          typeof parsed.activeTabId === 'string' && tabs.some(t => t.id === parsed.activeTabId)
            ? parsed.activeTabId
            : tabs[0].id;
        return { tabs, activeTabId };
      }
    }
  } catch {}

  try {
    const legacy = localStorage.getItem(LAST_VIDEO_KEY);
    if (legacy) {
      localStorage.removeItem(LAST_VIDEO_KEY);
      const tab: Tab = { id: newTabId(), videoPath: legacy };
      return { tabs: [tab], activeTabId: tab.id };
    }
  } catch {}

  const tab = emptyTab();
  return { tabs: [tab], activeTabId: tab.id };
}

function saveTabs(state: TabsState) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(state));
  } catch {}
}

export default function App() {
  const initialSettings = useMemo(loadSettings, []);
  const [uiLang, setUiLang] = useState<UiLang>(() => initialSettings.uiLang ?? detectUiLang());
  const [themePref, setThemePref] = useState<ThemePref>(() => initialSettings.theme ?? 'system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(initialSettings.theme ?? 'system'),
  );

  const initial = useMemo(loadTabs, []);
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(initial.activeTabId);

  useEffect(() => {
    saveSettings({ uiLang, theme: themePref });
  }, [uiLang, themePref]);

  useEffect(() => {
    const next = resolveTheme(themePref);
    setResolvedTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  }, [themePref]);

  useEffect(() => {
    const overlay = resolvedTheme === 'light'
      ? { color: '#dcdcdc', symbolColor: '#222222' }
      : { color: '#1d1d1d', symbolColor: '#ffffff' };
    window.subbi.setTitleBarOverlay?.(overlay).catch(() => {});
  }, [resolvedTheme]);

  useEffect(() => {
    if (themePref !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? 'light' : 'dark';
      setResolvedTheme(next);
      document.documentElement.setAttribute('data-theme', next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themePref]);

  useEffect(() => {
    saveTabs({ tabs, activeTabId });
  }, [tabs, activeTabId]);

  const t = (k: string) => TRANSLATIONS[uiLang][k] ?? TRANSLATIONS.en[k];

  function handleNewTab() {
    if (tabs.length >= MAX_TABS) return;
    const tab = emptyTab();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function handleCloseTab(id: string) {
    if (tabs.length <= 1) {
      const tab = emptyTab();
      setTabs([tab]);
      setActiveTabId(tab.id);
      return;
    }
    const idx = tabs.findIndex(t => t.id === id);
    const next = tabs.filter(t => t.id !== id);
    setTabs(next);
    if (id === activeTabId) {
      const fallback = next[Math.max(0, idx - 1)] ?? next[0];
      setActiveTabId(fallback.id);
    }
  }

  function handleDropPaths(paths: string[]): boolean {
    const videoPaths = paths.filter(isVideoPath);
    if (videoPaths.length === 0) return false;

    const current = tabs.find(t => t.id === activeTabId) ?? tabs[0];
    const currentEmpty = !current.videoPath;

    let nextTabs = [...tabs];
    let firstAssignedId: string | null = null;
    let remaining = videoPaths.slice();

    if (currentEmpty && remaining.length > 0) {
      const [first, ...rest] = remaining;
      const replacement: Tab = { id: newTabId(), videoPath: first };
      nextTabs = nextTabs.map(t => (t.id === current.id ? replacement : t));
      firstAssignedId = replacement.id;
      remaining = rest;
    }

    for (const p of remaining) {
      if (nextTabs.length >= MAX_TABS) break;
      const tab: Tab = { id: newTabId(), videoPath: p };
      nextTabs.push(tab);
      if (firstAssignedId === null) firstAssignedId = tab.id;
    }

    setTabs(nextTabs);
    if (firstAssignedId) setActiveTabId(firstAssignedId);
    return true;
  }

  function handleSelectTab(id: string) {
    if (id === activeTabId) return;
    setActiveTabId(id);
  }

  return (
    <div className="app-shell">
      <UpdateBanner
        labels={{
          available: (v) => t('updateAvailable').replace('{v}', v),
          download: t('updateDownload'),
          dismiss: t('updateDismiss'),
        }}
      />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        maxTabs={MAX_TABS}
        onSelect={handleSelectTab}
        onClose={handleCloseTab}
        onNew={handleNewTab}
        labels={{
          untitled: t('tabUntitled'),
          newTab: t('tabNew'),
          closeTab: t('tabClose'),
          maxReached: t('tabMaxReached').replace('{n}', String(MAX_TABS)),
        }}
      />
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className="tab-editor-host"
            style={{
              display: isActive ? 'contents' : 'none',
            }}
          >
            <Editor
              tabId={tab.id}
              isActive={isActive}
              initialVideoPath={tab.videoPath}
              uiLang={uiLang}
              onUiLangChange={setUiLang}
              themePref={themePref}
              resolvedTheme={resolvedTheme}
              onThemePrefChange={setThemePref}
              onVideoPathChange={(path) => {
                setTabs(prev => prev.map(t => (t.id === tab.id ? { ...t, videoPath: path } : t)));
              }}
              onDropPaths={handleDropPaths}
            />
          </div>
        );
      })}
    </div>
  );
}
