import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../DeploymentTools/Deploy-ParallelSystems-TaskManagement.ps1', import.meta.url));
const windows = process.platform === 'win32';

function runLauncher(argumentsList = []) {
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, ...argumentsList], {
        input: 'NO\n',
        encoding: 'utf8',
        timeout: 15000,
    });
}

test('deployment PowerShell parses without syntax errors', { skip: !windows }, () => {
    const escaped = launcher.replaceAll("'", "''");
    const command = [
        '$tokens = $null',
        '$errors = $null',
        `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref] $tokens, [ref] $errors) | Out-Null`,
        'if ($errors.Count -gt 0) {',
        '    $errors | Out-String | Write-Output',
        '    exit 1',
        '}',
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
        encoding: 'utf8',
        timeout: 15000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout || result.stderr);
});

test('declining deployment exits before building or uploading', { skip: !windows }, () => {
    const result = runLauncher();
    assert.equal(result.status, 0, result.error?.message || result.stdout || result.stderr);
    assert.match(result.stdout, /Cancelled\. Nothing was built, uploaded, or deployed\./);
    assert.doesNotMatch(result.stdout, /\[1\/5\]/);
});

test('deployment rejects unsafe URL and SSH arguments before work begins', { skip: !windows }, () => {
    for (const argumentsList of [
        ['-SiteUrl', 'http://example.com/receipts/'],
        ['-SiteUrl', 'https://example.com/?unexpected=1'],
        ['-SiteUrl', 'https://user:password@example.com'],
        ['-Server', 'ubuntu@example.com;echo unsafe'],
        ['-Server', '-ubuntu@example.com'],
        ['-NginxHost', 'example.com;echo unsafe'],
    ]) {
        const result = runLauncher(argumentsList);
        assert.equal(result.status, 1, result.error?.message || result.stdout || result.stderr);
        assert.match(result.stdout, /DEPLOYMENT FAILED:/);
        assert.doesNotMatch(result.stdout, /\[1\/5\]/);
    }
});
