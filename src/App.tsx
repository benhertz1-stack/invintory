import { Routes, Route, Navigate } from 'react-router-dom';
import { Wine } from 'lucide-react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Collection from './pages/Collection';
import WineDetail from './pages/WineDetail';
import Advisor from './pages/Advisor';
import Fridges from './pages/Fridges';
import Locate from './pages/Locate';
import Reports from './pages/Reports';
import Login from './pages/Login';
import { useAuth } from './context/AuthContext';

export default function App() {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">
        <Wine className="animate-pulse" size={28} />
      </div>
    );
  }
  if (status === 'out') return <Login />;

  return (
    <Routes>
      <Route path="/locate/:wineId/:bottleId" element={<Locate />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/collection" replace />} />
        <Route path="collection" element={<Collection />} />
        <Route path="collection/:id" element={<WineDetail />} />
        <Route path="fridges" element={<Fridges />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="advisor" element={<Advisor />} />
        <Route path="*" element={<Navigate to="/collection" replace />} />
      </Route>
    </Routes>
  );
}
