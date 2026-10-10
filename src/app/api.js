const baseUrl = '/api/task-management';
let onExpired = () => {};

export function setSessionExpiredHandler(handler) {
    onExpired = handler;
}

export async function request(path, { method = 'GET', body, signal, notifyExpired = true } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Task-Management': '1',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401 && notifyExpired) {
            onExpired();
        }
        const validation = payload?.errors ? Object.values(payload.errors).flat().join(' ') : null;
        const error = new Error(
            payload?.message || validation || 'The request could not be completed. Please try again.',
        );
        error.status = response.status;
        throw error;
    }
    return payload;
}
