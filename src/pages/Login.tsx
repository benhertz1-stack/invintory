import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wine, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const [refreshToken, setRefreshToken] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(refreshToken.trim(), googleApiKey.trim());
      navigate('/');
    } catch {
      setError('Authentication failed. Please check your credentials and try again.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-wine-700 p-4 rounded-full">
              <Wine size={36} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">Invintory</h1>
          <p className="text-slate-400 mt-1.5">Wine Collection Manager</p>
        </div>

        <div className="bg-slate-900 rounded-2xl p-8 border border-slate-800">
          <h2 className="text-base font-semibold text-white mb-5">Connect Your Account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Google API Key
              </label>
              <input
                type="text"
                value={googleApiKey}
                onChange={(e) => setGoogleApiKey(e.target.value)}
                required
                placeholder="AIzaSy..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Firebase Refresh Token
              </label>
              <textarea
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                required
                rows={3}
                placeholder="Paste your refresh token here..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent resize-none text-sm"
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-wine-700 hover:bg-wine-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {isLoading ? 'Connecting...' : 'Connect to Invintory'}
            </button>
          </form>

          <div className="mt-5 p-4 bg-slate-800 rounded-lg border border-slate-700">
            <p className="text-xs font-medium text-slate-400 mb-2">How to find your credentials</p>
            <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
              <li>Log in to invintorywines.com in your browser</li>
              <li>Open DevTools → Application → IndexedDB → firebaseLocalStorage</li>
              <li>Copy the <code className="text-slate-300">refreshToken</code> and <code className="text-slate-300">apiKey</code></li>
            </ol>
            <a
              href="https://github.com/withinfocus/invintory-updater"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-wine-400 hover:text-wine-300 mt-3 transition-colors"
            >
              <ExternalLink size={11} />
              invintory-updater reference
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
