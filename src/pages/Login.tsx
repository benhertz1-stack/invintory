import { useState, FormEvent } from 'react';
import { Wine, Loader } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!passphrase.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(passphrase.trim());
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Not signed in' ? err.message : 'Incorrect passcode');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-wine-700 p-4 rounded-full">
              <Wine size={32} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">Invintory</h1>
          <p className="text-slate-400 mt-1.5">Your wine cellar</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-900 rounded-2xl p-7 border border-slate-800 space-y-4">
          <div>
            <label htmlFor="passphrase" className="block text-xs text-slate-400 mb-1.5">
              Passcode
            </label>
            <input
              id="passphrase"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-wine-500"
            />
          </div>
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-3 py-2 text-sm">{error}</div>
          )}
          <button
            type="submit"
            disabled={busy || !passphrase.trim()}
            className="w-full flex items-center justify-center gap-2 bg-wine-700 hover:bg-wine-600 disabled:bg-slate-700 text-white font-medium py-3 rounded-lg transition-colors"
          >
            {busy ? <Loader size={16} className="animate-spin" /> : 'Sign in'}
          </button>
          <p className="text-xs text-slate-600 text-center">Single-owner access. Sessions last 30 days.</p>
        </form>
      </div>
    </div>
  );
}
