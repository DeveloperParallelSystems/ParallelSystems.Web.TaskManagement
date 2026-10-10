import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { LockKeyhole, ArrowRight } from 'lucide-react';
import { login } from '../../app/store';

export default function LoginPage() {
    const dispatch = useDispatch();
    const { busy, error } = useSelector((state) => state.auth);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);

    async function submit(event) {
        event.preventDefault();
        await dispatch(login({ username: username.trim(), password, rememberMe }));
        setPassword('');
    }

    return (
        <main className="login-page">
            <section className="login-card">
                <div className="login-brand">
                    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
                    <div>
                        <strong>Parallel Systems</strong>
                        <span>Task Management</span>
                    </div>
                </div>
                <div className="login-copy">
                    <span className="login-lock">
                        <LockKeyhole size={22} />
                    </span>
                    <h1>Welcome back</h1>
                    <p>Sign in to plan, review, and deliver work with your team.</p>
                </div>
                {error && (
                    <div className="error" role="alert">
                        {error}
                    </div>
                )}
                <form onSubmit={submit}>
                    <label className="field">
                        <span>Username</span>
                        <input
                            autoFocus
                            autoComplete="username"
                            required
                            maxLength={256}
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                        />
                    </label>
                    <label className="field">
                        <span>Password</span>
                        <input
                            type="password"
                            autoComplete="current-password"
                            required
                            maxLength={1000}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                    </label>
                    <label className="checkbox">
                        <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(event) => setRememberMe(event.target.checked)}
                        />
                        Keep me signed in on this computer
                    </label>
                    <button className="button primary login-submit" disabled={busy}>
                        {busy ? 'Signing in…' : 'Sign in'}
                        <ArrowRight size={16} />
                    </button>
                </form>
                <p className="login-footnote">Use your Parallel Systems account.</p>
            </section>
            <span className="login-copyright">PARALLEL SYSTEMS · WORKSPACE</span>
        </main>
    );
}
