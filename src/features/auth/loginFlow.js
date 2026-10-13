export function initialLoginFlow() {
    return { step: 'identifier', identifier: '', username: '', password: '', confirmPassword: '',
        busy: false, requestId: null, error: null, message: '' };
}

export function loginFlow(state, action) {
    if (action.type === 'field') {
        return { ...state, [action.name]: action.value, error: null };
    }
    if (action.type === 'back') {
        return { ...initialLoginFlow(), identifier: state.identifier };
    }
    if (action.type === 'started') {
        return { ...state, busy: true, requestId: action.requestId, error: null, message: '' };
    }
    if (action.requestId !== state.requestId) {
        return state;
    }
    if (action.type === 'lookup') {
        if (['password', 'createAccount'].includes(action.nextStep)) {
            return { ...state, step: action.nextStep, busy: false, requestId: null,
                password: '', confirmPassword: '' };
        }
        return { ...state, busy: false, requestId: null,
            error: 'This username or email is not available. Contact your administrator.' };
    }
    if (action.type === 'registered') {
        return { ...state, step: 'password', busy: false, requestId: null, password: '', confirmPassword: '',
            message: 'Account created. Enter your password to sign in.' };
    }
    if (action.type === 'finished') {
        return { ...state, busy: false, requestId: null, password: '', confirmPassword: '', error: action.error || null };
    }
    return state;
}

export function registrationError({ username, password, confirmPassword }) {
    const value = username.trim();
    if (value.length < 3 || value.length > 100 || !/^[\p{L}\p{N}._@-]+$/u.test(value)) {
        return 'Username must be 3–100 characters and use only letters, numbers, periods, underscores, hyphens and @.';
    }
    if (password.length < 8) {
        return 'Password must be at least 8 characters.';
    }
    if (password !== confirmPassword) {
        return 'Passwords do not match.';
    }
    return null;
}
