import { Outlet, NavLink } from 'react-router-dom';
import { Wine, LayoutDashboard, List, Sparkles } from 'lucide-react';

const navItems = [
  { to: '/collection', icon: List, label: 'Collection' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/advisor', icon: Sparkles, label: 'Wine Advisor' },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Wine className="text-wine-500" size={26} />
            <span className="text-lg font-bold tracking-tight">Wine Cellar</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-wine-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
