import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Command, LogIn, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { login } from '../../auth';

function SlackIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 122 122" xmlns="http://www.w3.org/2000/svg">
            <path d="M25.7 77.5a12.8 12.8 0 1 1-25.7 0 12.8 12.8 0 0 1 25.7 0zm6.4 0a19.2 19.2 0 0 0-19.2-19.2H6.4a19.2 19.2 0 0 0 0 38.4h6.5a19.2 19.2 0 0 0 19.2-19.2z" fill="#E01E5A"/>
            <path d="M44.5 96.3a12.8 12.8 0 1 1 0 25.7 12.8 12.8 0 0 1 0-25.7zm0-6.4a19.2 19.2 0 0 0-19.2 19.2v6.5a19.2 19.2 0 0 0 38.4 0v-6.5a19.2 19.2 0 0 0-19.2-19.2z" fill="#E01E5A"/>
            <path d="M96.3 44.5a12.8 12.8 0 1 1 25.7 0 12.8 12.8 0 0 1-25.7 0zm-6.4 0a19.2 19.2 0 0 0 19.2 19.2h6.5a19.2 19.2 0 0 0 0-38.4h-6.5a19.2 19.2 0 0 0-19.2 19.2z" fill="#2EB67D"/>
            <path d="M77.5 25.7a12.8 12.8 0 1 1 0-25.7 12.8 12.8 0 0 1 0 25.7zm0 6.4a19.2 19.2 0 0 0 19.2-19.2V6.4a19.2 19.2 0 0 0-38.4 0v6.5a19.2 19.2 0 0 0 19.2 19.2z" fill="#2EB67D"/>
            <path d="M25.7 44.5a12.8 12.8 0 1 1-25.7 0 12.8 12.8 0 0 1 25.7 0zm6.4 0a19.2 19.2 0 0 0-19.2-19.2H6.4a19.2 19.2 0 0 0 0 38.4h6.5a19.2 19.2 0 0 0 19.2-19.2z" fill="#ECB22E"/>
            <path d="M44.5 25.7a12.8 12.8 0 1 1 0-25.7 12.8 12.8 0 0 1 0 25.7zm0 6.4a19.2 19.2 0 0 0 19.2-19.2V6.4a19.2 19.2 0 0 0-38.4 0v6.5a19.2 19.2 0 0 0 19.2 19.2z" fill="#ECB22E"/>
            <path d="M96.3 77.5a12.8 12.8 0 1 1 25.7 0 12.8 12.8 0 0 1-25.7 0zm-6.4 0a19.2 19.2 0 0 0 19.2 19.2h6.5a19.2 19.2 0 0 0 0-38.4h-6.5a19.2 19.2 0 0 0-19.2 19.2z" fill="#36C5F0"/>
            <path d="M77.5 96.3a12.8 12.8 0 1 1 0 25.7 12.8 12.8 0 0 1 0-25.7zm0-6.4a19.2 19.2 0 0 0-19.2 19.2v6.5a19.2 19.2 0 0 0 38.4 0v-6.5a19.2 19.2 0 0 0-19.2-19.2z" fill="#36C5F0"/>
        </svg>
    );
}

export function LoginPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [ssoEnabled, setSsoEnabled] = useState(false);

    // Check SSO availability and URL error params
    useEffect(() => {
        const urlError = searchParams.get('error');
        if (urlError) {
            setError(decodeURIComponent(urlError));
        }

        fetch('/api/sso/config')
            .then(r => r.json())
            .then(data => setSsoEnabled(data.enabled))
            .catch(() => {});
    }, [searchParams]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await login({ username, password });
            if (result.ok) {
                navigate('/');
            } else {
                setError(result.error || 'Login failed');
            }
        } catch {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    };

    const handleSsoLogin = () => {
        window.location.href = '/auth/sso';
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                {/* Header with Logo */}
                <div className="p-8 pb-6 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mb-6 text-primary-600">
                        <Command className="w-8 h-8" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome Back</h1>
                    <p className="text-sm text-gray-500">
                        Sign in to access your Siclaw workspace
                    </p>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="p-8 pt-0 space-y-4">
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* SSO Login Button */}
                    {ssoEnabled && (
                        <>
                            <button
                                type="button"
                                onClick={handleSsoLogin}
                                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-all font-medium shadow-lg shadow-primary-100"
                            >
                                <ExternalLink className="w-5 h-5" />
                                <span>Sign in with SSO</span>
                            </button>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t border-gray-100" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-white px-2 text-gray-400">or sign in with password</span>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="space-y-2">
                        <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                            Username
                        </label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            placeholder="Enter your username"
                            required
                            autoFocus={!ssoEnabled}
                            disabled={loading}
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            placeholder="Enter your password"
                            required
                            disabled={loading}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-all font-medium shadow-lg shadow-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <LogIn className="w-5 h-5" />
                        )}
                        <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                    </button>

                </form>
            </div>

            {/* Footer */}
            <div className="mt-8 text-center text-xs text-gray-400 space-y-2">
                <div className="flex items-center justify-center gap-4">
                    <a
                        href="https://github.com/scitix/siclaw"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-gray-600 transition-colors"
                    >
                        GitHub
                    </a>
                    <span className="text-gray-200">|</span>
                    <a
                        href="https://join.slack.com/t/siclaw-scitix/shared_invite/zt-3rrsoc2ic-JIfbfvT1_04sqgQorSRfmw"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-gray-600 transition-colors"
                    >
                        <SlackIcon />
                        Slack
                    </a>
                    <span className="text-gray-200">|</span>
                    <a
                        href="https://siclaw.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-gray-600 transition-colors"
                    >
                        siclaw.ai
                    </a>
                </div>
                <div>&copy; 2025 Siclaw. All rights reserved.</div>
            </div>
        </div>
    );
}
