import { useEffect, useReducer, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { LockKeyhole, ArrowRight } from 'lucide-react';
import { clearLoginError, login } from '../../app/store';
import { request } from '../../app/api';
import { initialLoginFlow, loginFlow, registrationError } from './loginFlow';

export default function LoginPage() {
    const dispatch = useDispatch();
    const { busy, error } = useSelector((state) => state.auth);
    const [flow, update] = useReducer(loginFlow, undefined, initialLoginFlow);
    const [rememberMe, setRememberMe] = useState(false);
    const requestRef = useRef(null);
    const nextFieldRef = useRef(null);
    const pending = busy || flow.busy;

    useEffect(() => {
        nextFieldRef.current?.focus();
    }, [flow.step]);

    useEffect(() => {
        return () => {
            requestRef.current?.abort();
        };
    }, []);

    function change(name, value) {
        dispatch(clearLoginError());
        update({ type: 'field', name, value });
    }

    function back() {
        requestRef.current?.abort();
        dispatch(clearLoginError());
        update({ type: 'back' });
    }

    async function submit(event) {
        event.preventDefault();
        if (pending) {
            return;
        }
        dispatch(clearLoginError());
        const controller = new AbortController();
        requestRef.current = controller;
        const requestId = controller;
        update({ type: 'started', requestId });
        try {
            if (flow.step === 'identifier') {
                const result = await request('/auth/lookup', {
                    method: 'POST', body: { identifier: flow.identifier.trim() },
                    signal: controller.signal, notifyExpired: false,
                });
                update({ type: 'lookup', requestId, nextStep: result.nextStep });
            }
            else if (flow.step === 'createAccount') {
                const invalid = registrationError(flow);
                if (invalid) {
                    update({ type: 'finished', requestId, error: invalid });
                    return;
                }
                await request('/auth/register', {
                    method: 'POST', body: { email: flow.identifier.trim(), username: flow.username.trim(),
                        password: flow.password, confirmPassword: flow.confirmPassword },
                    signal: controller.signal, notifyExpired: false,
                });
                update({ type: 'registered', requestId });
            }
            else {
                await dispatch(login({ username: flow.identifier.trim(), password: flow.password, rememberMe })).unwrap();
                update({ type: 'finished', requestId });
            }
        }
        catch (failure) {
            if (failure.name !== 'AbortError') {
                update({ type: 'finished', requestId, error: failure.message || String(failure) });
            }
        }
    }

    let heading = 'Welcome back';
    let description = 'Enter your username or staff email to continue.';
    let button = pending ? 'Checking…' : 'Continue';
    if (flow.step === 'password') {
        description = 'Enter your password to sign in to Task Management.';
        button = pending ? 'Signing in…' : 'Sign in';
    }
    else if (flow.step === 'createAccount') {
        heading = 'Create your account';
        description = 'Your staff email is eligible. Choose a username and password.';
        button = pending ? 'Creating account…' : 'Create account';
    }

    return (
        <main className="login-page">
            <section className="login-card">
                <div className="login-brand">
                    <img src={`${import.meta.env.BASE_URL}login-logo.png`} alt="" />
                    <div>
                        <strong>Parallel Systems</strong>
                        <span>Task Management</span>
                    </div>
                </div>
                <div className="login-copy">
                    <span className="login-lock">
                        <LockKeyhole size={22} />
                    </span>
                    <h1>{heading}</h1>
                    <p>{description}</p>
                </div>
                {(flow.error || error) && (
                    <div className="error" role="alert">
                        {flow.error || error}
                    </div>
                )}
                {flow.message && <p className="login-message" role="status">{flow.message}</p>}
                <form onSubmit={submit} aria-busy={pending}>
                    {flow.step === 'identifier' ? (
                        <label className="field">
                            <span>Username or email</span>
                            <input
                                ref={nextFieldRef}
                                autoComplete="username"
                                required
                                disabled={pending}
                                maxLength={320}
                                value={flow.identifier}
                                onChange={(event) => change('identifier', event.target.value)}
                            />
                        </label>
                    ) : (
                        <div className="login-identity">
                            <span>{flow.identifier.trim()}</span>
                            <button type="button" className="text-button" disabled={pending} onClick={back}>Change</button>
                        </div>
                    )}
                    {flow.step === 'createAccount' && (
                        <label className="field">
                            <span>Username</span>
                            <input ref={nextFieldRef} autoComplete="username" required minLength={3} maxLength={100}
                                disabled={pending} value={flow.username} onChange={(event) => change('username', event.target.value)} />
                        </label>
                    )}
                    {flow.step !== 'identifier' && (
                        <label className="field">
                            <span>Password</span>
                            <input
                                ref={flow.step === 'password' ? nextFieldRef : undefined}
                                type="password"
                                autoComplete={flow.step === 'password' ? 'current-password' : 'new-password'}
                                required
                                minLength={flow.step === 'createAccount' ? 8 : undefined}
                                maxLength={1000}
                                disabled={pending}
                                value={flow.password}
                                onChange={(event) => change('password', event.target.value)}
                            />
                        </label>
                    )}
                    {flow.step === 'createAccount' && (
                        <>
                            <label className="field">
                                <span>Confirm password</span>
                                <input type="password" autoComplete="new-password" required maxLength={1000}
                                    disabled={pending} value={flow.confirmPassword} onChange={(event) => change('confirmPassword', event.target.value)} />
                            </label>
                            <p className="muted login-role">Creates a standard user account linked to your staff profile.</p>
                        </>
                    )}
                    {flow.step === 'password' && (
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                disabled={pending}
                                checked={rememberMe}
                                onChange={(event) => setRememberMe(event.target.checked)}
                            />
                            Keep me signed in on this computer
                        </label>
                    )}
                    <button className="button primary login-submit" disabled={pending}>
                        {button}
                        <ArrowRight size={16} />
                    </button>
                </form>
                <p className="login-footnote">Use your Parallel Systems account.</p>
            </section>
            <span className="login-copyright">PARALLEL SYSTEMS · WORKSPACE</span>
        </main>
    );
}
