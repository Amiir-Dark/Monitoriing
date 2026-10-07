import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { wsService } from '../services/ws';
import {
  Activity,
  Server,
  AlertTriangle,
  FolderKanban,
  Settings,
  LogOut,
  Sun,
  Moon,
  Plus,
  Wifi,
  WifiOff,
  Menu,
  X,
} from 'lucide-react';
import AddNodeModal from '../components/nodes/AddNodeModal';
import { getGroups } from '../services/api';

export default function DashboardLayout({ activeTab, onTabChange, children, alertsCount = 0 }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isLive, setIsLive] = useState(wsService.isConnected);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    const unsub = wsService.subscribe('connection_status', (data) => {
      setIsLive(data.connected);
    });
    getGroups()
      .then((data) => setGroups(Array.isArray(data) ? data : []))
      .catch(() => setGroups([]));
    return unsub;
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'nodes', label: 'Nodes', icon: Server },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle, badge: alertsCount },
    { id: 'groups', label: 'Groups', icon: FolderKanban },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleNavClick = (id) => {
    onTabChange(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-dark-950 text-dark-100 flex flex-col md:flex-row antialiased selection:bg-brand-500 selection:text-white">
      {/* Mobile Top Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-dark-900 border-b border-dark-800 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-sm shadow-glow-brand">
            NW
          </div>
          <span className="font-semibold text-white tracking-tight">NodeWatch</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddModalOpen(true)}
            className="p-1.5 bg-brand-600 text-white rounded-lg"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 text-dark-300 hover:text-white"
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      {/* Sidebar (Desktop + Mobile overlay) */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-40 h-screen w-64 bg-dark-900 border-r border-dark-800 flex flex-col justify-between transition-transform duration-200 md:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Logo & Brand */}
          <div className="p-5 flex items-center justify-between border-b border-dark-800/80">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-sm shadow-glow-brand">
                NW
              </div>
              <div>
                <h1 className="text-sm font-bold text-white tracking-tight">NodeWatch</h1>
                <p className="text-[10px] text-dark-400 font-mono">v1.0 • Linux Monitor</p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-brand-600/10 text-brand-400 border border-brand-500/20 font-semibold'
                      : 'text-dark-400 hover:text-dark-200 hover:bg-dark-850'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className={isActive ? 'text-brand-400' : 'text-dark-400'} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500 text-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom User Profile & Controls */}
        <div className="p-3 border-t border-dark-800/80 space-y-2">
          {/* Quick Add Node button */}
          <button
            onClick={() => setAddModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-all shadow-glow-brand"
          >
            <Plus size={15} /> Add Server Node
          </button>

          {/* User profile card */}
          <div className="p-2.5 rounded-xl bg-dark-950 border border-dark-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-dark-800 border border-dark-700 flex items-center justify-center text-xs font-bold text-dark-200 uppercase">
                {user?.username ? user.username[0] : 'A'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">{user?.username || 'Admin'}</p>
                <p className="text-[10px] text-dark-500 capitalize">{user?.role || 'Administrator'}</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={toggleTheme}
                title="Toggle Theme"
                className="p-1.5 text-dark-400 hover:text-white rounded-lg hover:bg-dark-800 transition-colors"
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                onClick={logout}
                title="Sign Out"
                className="p-1.5 text-dark-400 hover:text-rose-400 rounded-lg hover:bg-dark-800 transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header Bar */}
        <header className="hidden md:flex items-center justify-between px-8 py-3.5 bg-dark-900/60 backdrop-blur-md border-b border-dark-800 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-white capitalize">{activeTab}</h2>
          </div>

          <div className="flex items-center gap-3.5">
            {/* Live WebSocket Status indicator */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-dark-950 border border-dark-800 text-xs">
              {isLive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-glow-emerald animate-pulse"></span>
                  <span className="text-dark-300 font-mono text-[11px] flex items-center gap-1">
                    <Wifi size={12} className="text-emerald-400" /> Live Sync
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span className="text-dark-400 font-mono text-[11px] flex items-center gap-1">
                    <WifiOff size={12} className="text-amber-400" /> Connecting...
                  </span>
                </>
              )}
            </div>

            <button
              onClick={() => setAddModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors shadow-glow-brand"
            >
              <Plus size={14} /> Add Node
            </button>
          </div>
        </header>

        {/* Page Content View */}
        <main className="p-4 md:p-8 flex-1 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Add Node Modal */}
      <AddNodeModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        groups={groups}
        onNodeCreated={() => {
          window.dispatchEvent(new CustomEvent('node:created'));
        }}
      />
    </div>
  );
}
