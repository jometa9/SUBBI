import React from 'react';
import type { Tab } from './App';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

type Props = {
  tabs: Tab[];
  activeTabId: string;
  maxTabs: number;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  labels: {
    untitled: string;
    newTab: string;
    closeTab: string;
    maxReached: string;
  };
};

const MAX_TITLE_CHARS = 20;

function tabTitle(tab: Tab, untitled: string): string {
  const raw = tab.videoPath ? tab.videoPath.split(/[\\/]/).pop() || untitled : untitled;
  if (raw.length <= MAX_TITLE_CHARS) return raw;
  return raw.slice(0, MAX_TITLE_CHARS - 1) + '…';
}

export default function TabBar({
  tabs,
  activeTabId,
  maxTabs,
  onSelect,
  onClose,
  onNew,
  labels,
}: Props) {
  const atMax = tabs.length >= maxTabs;
  return (
    <div className={'tab-bar drag-region' + (IS_MAC ? ' is-mac' : '')}>
      <div className="tab-bar-list">
        {tabs.map(tab => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              className={'tab no-drag' + (active ? ' is-active' : '')}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(tab.id);
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              title={tab.videoPath ?? labels.untitled}
            >
              <span className="tab-title">{tabTitle(tab, labels.untitled)}</span>
              <span
                role="button"
                tabIndex={-1}
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                title={labels.closeTab}
                aria-label={labels.closeTab}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.3 5.71L12 12.01l-6.3-6.3-1.4 1.4 6.29 6.3-6.29 6.29 1.4 1.42 6.3-6.3 6.3 6.3 1.4-1.42-6.29-6.29 6.29-6.3z" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="tab-new no-drag"
        onClick={onNew}
        disabled={atMax}
        title={atMax ? labels.maxReached : labels.newTab}
        aria-label={labels.newTab}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
