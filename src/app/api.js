const baseUrl = '/api/task-management';
let onExpired = () => {};

export function setSessionExpiredHandler(handler) {
    onExpired = handler;
}

export async function request(path, { method = 'GET', body, signal, notifyExpired = true, responseType = 'json' } = {}) {
    const timeout = AbortSignal.timeout(responseType === 'blob' ? 180000 : 20000);
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Task-Management': '1',
            'X-Task-Workflow': '1',
            'X-Live-Statuses': '1',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.ok && responseType === 'blob') {
        return await response.blob();
    }
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

export function uploadFile(path, { file, uploadId, signal, onProgress }) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append('file', file);
        form.append('uploadId', uploadId);
        xhr.open('POST', `${baseUrl}${path}`);
        xhr.withCredentials = true;
        xhr.timeout = 180000;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Task-Management', '1');
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress?.(Math.round(event.loaded / event.total * 100));
            }
        };
        function fail(message, status) {
            const error = new Error(message);
            error.status = status;
            reject(error);
        }
        function abort() {
            xhr.abort();
        }
        function cleanup() {
            signal?.removeEventListener('abort', abort);
        }
        xhr.onload = () => {
            cleanup();
            let payload;
            try {
                payload = JSON.parse(xhr.responseText);
            }
            catch {
                payload = null;
            }
            if (xhr.status === 401) {
                onExpired();
            }
            if (xhr.status >= 200 && xhr.status < 300 && payload) {
                resolve(payload);
            }
            else {
                const validation = payload?.errors ? Object.values(payload.errors).flat().join(' ') : null;
                fail(payload?.message || validation || (xhr.status === 413 ? 'The file exceeds the upload size limit.' :
                    'Could not upload this file. Please try again.'), xhr.status);
            }
        };
        xhr.onerror = () => {
            cleanup();
            fail('Upload connection failed. Retry to check whether the file was saved.');
        };
        xhr.ontimeout = () => {
            cleanup();
            fail('Upload timed out. Retry to check whether the file was saved.');
        };
        xhr.onabort = () => {
            cleanup();
            fail('Upload cancelled.', 0);
        };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
            cleanup();
            fail('Upload cancelled.', 0);
            return;
        }
        xhr.send(form);
    });
}
