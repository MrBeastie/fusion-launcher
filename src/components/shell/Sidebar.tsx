'use client';

import { Compass, Database, Download, FolderHeart, Home, Library, Settings, type LucideIcon } from 'lucide-react';
import type { LauncherView } from '../../stores/launcherStore.ts';

const NAV_ITEMS: Array<{ id: LauncherView; label: string; icon: LucideIcon }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'collections', label: 'Collections', icon: FolderHeart },
  { id: 'settings', label: 'Settings', icon: Settings }
];

interface SidebarProps {
  activeView: LauncherView;
  repositoriesCount: number;
  activeDownloadsCount: number;
  onNavigate: (view: LauncherView) => void;
  onFocus: (focusId: string) => void;
}

export function Sidebar({
  activeView,
  repositoriesCount,
  activeDownloadsCount,
  onNavigate,
  onFocus
}: SidebarProps) {
  return (
    <aside className="rh-sidebar">
      <div>
        <div className="rh-sidebar-brand">P2P Retro Launcher</div>
      </div>

      <nav className="rh-nav-list">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const count = item.id === 'downloads' ? activeDownloadsCount : 0;
          const focusId = `nav:${item.id}`;

          return (
            <button
              key={item.id}
              data-focus-id={focusId}
              data-focus-zone="sidebar"
              onFocus={() => onFocus(focusId)}
              onClick={() => onNavigate(item.id)}
              className={`rh-nav-item rh-focusable ${activeView === item.id ? 'rh-nav-item-active' : ''}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {count > 0 && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/76">{count}</span>}
            </button>
          );
        })}
      </nav>

      <div className="rh-profile-block">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-2 font-black uppercase tracking-wide text-white/48">
              <Database className="h-3.5 w-3.5" />
              Repositories
            </span>
            <span className="font-black text-white/84">{repositoriesCount}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-2 font-black uppercase tracking-wide text-white/48">
              <Download className="h-3.5 w-3.5" />
              Active downloads
            </span>
            <span className="font-black text-white/84">{activeDownloadsCount}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
