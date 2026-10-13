import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLoginFlow, loginFlow, registrationError } from '../src/features/auth/loginFlow.js';

test('identity lookup selects password or registration and refuses unknown responses', () => {
    const state = loginFlow(initialLoginFlow(), { type: 'started', requestId: 'lookup' });
    assert.equal(loginFlow(state, { type: 'lookup', requestId: 'lookup', nextStep: 'password' }).step, 'password');
    assert.equal(loginFlow(state, { type: 'lookup', requestId: 'lookup', nextStep: 'createAccount' }).step, 'createAccount');
    const unknown = loginFlow(state, { type: 'lookup', requestId: 'lookup', nextStep: 'unknown' });
    assert.equal(unknown.step, 'identifier');
    assert.match(unknown.error, /not available/);
});

test('changing identity clears credentials and rejects an earlier lookup or registration result', () => {
    const pending = { ...initialLoginFlow(), identifier: 'staff@example.test', password: 'secret',
        confirmPassword: 'secret', username: 'staff', step: 'createAccount', requestId: 'old', busy: true };
    const changed = loginFlow(pending, { type: 'back' });
    assert.equal(changed.identifier, 'staff@example.test');
    assert.equal(changed.password, '');
    assert.equal(changed.confirmPassword, '');
    assert.equal(changed.username, '');
    assert.deepEqual(loginFlow(changed, { type: 'lookup', requestId: 'old', nextStep: 'password' }), changed);
    assert.deepEqual(loginFlow(changed, { type: 'registered', requestId: 'old' }), changed);
});

test('registration validates username/password and returns to password sign-in without retaining secrets', () => {
    assert.match(registrationError({ username: 'bad name', password: 'long-password', confirmPassword: 'long-password' }), /Username/);
    assert.match(registrationError({ username: 'staff', password: 'short', confirmPassword: 'short' }), /at least 8/);
    assert.match(registrationError({ username: 'staff', password: 'long-password', confirmPassword: 'different' }), /do not match/);
    assert.equal(registrationError({ username: ' staff.name ', password: 'long-password', confirmPassword: 'long-password' }), null);
    const state = { ...initialLoginFlow(), step: 'createAccount', identifier: 'staff@example.test',
        password: 'secret-pass', confirmPassword: 'secret-pass', requestId: 'create', busy: true };
    const saved = loginFlow(state, { type: 'registered', requestId: 'create' });
    assert.equal(saved.step, 'password');
    assert.equal(saved.identifier, state.identifier);
    assert.equal(saved.password, '');
    assert.equal(saved.confirmPassword, '');
    assert.equal(saved.busy, false);
});
