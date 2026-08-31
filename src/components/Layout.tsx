import { Outlet, NavLink } from 'react-router-dom';
import { Wine, LayoutDashboard, List, Sparkles, Refrigerator, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/collection', icon: List, label: 'Collection' },
  { to: '/fridges', icon: Refrigerator, label: 'Fridges' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/advisor', icon: Sparkles, label: 'Wine Advisor' },
];

export default function Layout() {
  const { logout } = useAuth();
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-wine-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
    }`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="md:w-60 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex md:flex-col shrink-0">
        <div className="p-4 md:p-6 md:border-b border-slate-800 flex items-center gap-2.5">
          <Wine className="text-wine-500" size={24} />
          <span className="text-lg font-bold tracking-tight">Invintory</span>
        </div>

        <nav className="flex-1 flex md:flex-col gap-1 md:gap-0.5 p-2 md:p-3 overflow-x-auto items-center md:items-stretch">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className={linkCls}>
              <Icon size={16} />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-2 md:p-3 md:border-t border-slate-800 flex items-center">
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-200 transition-colors w-full"
            title="Sign out"
          >
            <LogOut size={16} />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
