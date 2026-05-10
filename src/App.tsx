import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Collection from './pages/Collection';
import WineDetail from './pages/WineDetail';
import Advisor from './pages/Advisor';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/collection" replace />} />
        <Route path="collection" element={<Collection />} />
        <Route path="collection/:id" element={<WineDetail />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="advisor" element={<Advisor />} />
      </Route>
    </Routes>
  );
}
