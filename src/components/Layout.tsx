import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Wine, LayoutDashboard, List, DollarSign, LogOut, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/', end: true, icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/collection', icon: List, label: 'Collection' },
  { to: '/update-prices', icon: DollarSign, label: 'Update Prices' },
  { to: '/advisor', icon: Sparkles, label: 'Wine Advisor' },
];

export default function Layout() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Wine className="text-wine-500" size={26} />
            <span className="text-lg font-bold tracking-tight">Invintory</span>
          </div>
          {profile && (
            <p className="mt-2 text-xs text-slate-500 truncate">
              {profile.firstName} {profile.lastName}
            </p>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ to, end, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
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

        <div className="p-3 border-t border-slate-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
