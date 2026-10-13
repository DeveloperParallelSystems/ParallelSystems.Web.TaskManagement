[CmdletBinding()]
param(
    [string] $SiteUrl = 'http://3.24.250.195',
    [string] $NginxHost = '',
    [string] $Server = 'ubuntu@3.24.250.195',
    [string] $KeyPath = 'C:\Projects\ParallelSystems\Deployment\ps-prod-app-key.pem',
    [switch] $SkipNginxSetup
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$deploymentDirectory = Join-Path (Split-Path $projectDirectory -Parent) 'Deployment'
$zipPath = Join-Path $deploymentDirectory 'ParallelSystems.Web.TaskManagement.zip'
$temporaryZip = Join-Path $env:TEMP ("ParallelSystems.Web.TaskManagement-{0}.zip" -f [guid]::NewGuid())
$stamp = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$remotePrefix = "/home/ubuntu/ParallelSystems.Web.TaskManagement.$stamp"
$remoteZip = "$remotePrefix.zip"
$remoteHelper = "$remotePrefix.py"
$remoteSnippet = "$remotePrefix.conf"
$remoteScript = "$remotePrefix.sh"
$locationPushed = $false

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)] [string] $Command,
        [Parameter(Mandatory)] [string[]] $Arguments,
        [Parameter(Mandatory)] [string] $FailureMessage
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

try {
    $uri = [Uri] $SiteUrl
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https') -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $uri.AbsolutePath -notin @('/', '/task-management', '/task-management/') -or
        $uri.Host -notmatch '^[A-Za-z0-9.-]+$') {
        throw 'SiteUrl must be the existing HTTP/HTTPS origin, optionally ending in /task-management/.'
    }
    if ($Server -notmatch '^[A-Za-z0-9_][A-Za-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*$') {
        throw 'Server must have the form ubuntu@hostname or ubuntu@IPv4-address.'
    }
    $origin = $uri.GetLeftPart([UriPartial]::Authority)
    $siteHost = $uri.Host
    if ($NginxHost) {
        $siteHost = $NginxHost
    }
    if ($siteHost -notmatch '^[A-Za-z0-9.-]+$') {
        throw 'NginxHost must be a hostname without a scheme, path or port.'
    }
    $publicSiteUrl = "$origin/task-management/"
    Write-Host 'ParallelSystems.Web.TaskManagement production deployment' -ForegroundColor Cyan
    Write-Host "Deployment/check URL: $publicSiteUrl"
    Write-Host "Nginx hostname: $siteHost"
    Write-Host "SSH target: $Server"
    Write-Host 'This will test, build, upload and activate a separate Task Management release.'
    Write-Host 'Existing Timesheet and Receipts pages and the shared API will be checked.'
    if ($SkipNginxSetup) {
        Write-Host 'Existing /task-management/ routing must already be installed.' -ForegroundColor Yellow
    }
    else {
        Write-Host 'A Task Management include will be added to the existing Timesheet content server.'
        Write-Host 'Nginx configuration and the previous release will be restored if remote checks fail.'
    }
    Write-Host 'Deploy the updated shared Server separately before deploying this frontend.'
    if ((Read-Host 'Type YES to deploy Task Management to production') -cne 'YES') {
        Write-Host 'Cancelled. Nothing was built, uploaded, or deployed.' -ForegroundColor Yellow
        exit 0
    }

    foreach ($command in @('git.exe', 'node.exe', 'npm.cmd', 'scp.exe', 'ssh.exe', 'curl.exe')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Required command not found: $command"
        }
    }
    if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
        throw "EC2 private key not found: $KeyPath"
    }
    $nodeVersionText = & node.exe --version
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to read the Node.js version.'
    }
    $nodeVersion = [Version] $nodeVersionText.Trim().TrimStart('v')
    if ($nodeVersion -lt [Version] '22.12.0') {
        throw 'Task Management requires Node.js 22.12.0 or newer.'
    }
    Push-Location -LiteralPath $projectDirectory
    $locationPushed = $true
    $repositoryRoot = & git.exe rev-parse --show-toplevel
    if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($repositoryRoot) -ne $projectDirectory) {
        throw 'Run this launcher from its own Task Management Git repository.'
    }
    $pendingChanges = @(git.exe status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to read Git working-tree status.'
    }
    if ($pendingChanges.Count -gt 0) {
        $pendingChanges | ForEach-Object { Write-Host "  $_" }
        throw 'Commit all intended Task Management and DeploymentTools changes before deploying.'
    }
    $commit = & git.exe rev-parse --short HEAD
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to identify the committed website version.'
    }
    foreach ($file in @('package.json', 'package-lock.json', 'index.html',
        'DeploymentTools/deploy_task_management.sh', 'DeploymentTools/configure_task_management_nginx.py',
        'DeploymentTools/task-management.nginx.conf')) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Required deployment file missing: $file"
        }
    }

    Write-Host '[1/5] Installing dependencies, testing and building...' -ForegroundColor Cyan
    Invoke-NativeCommand 'npm.cmd' @('ci') 'npm ci failed'
    Invoke-NativeCommand 'npm.cmd' @('test') 'Task Management tests failed'
    Invoke-NativeCommand 'npm.cmd' @('run', 'build', '--', '--base=/task-management/') 'Task Management build failed'
    $distDirectory = Join-Path $projectDirectory 'dist'
    foreach ($file in @('index.html', 'logo.png')) {
        if (-not (Test-Path -LiteralPath (Join-Path $distDirectory $file) -PathType Leaf)) {
            throw "Missing built file: $file"
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $distDirectory 'assets') -PathType Container)) {
        throw 'Missing compiled assets directory.'
    }
    $html = Get-Content -LiteralPath (Join-Path $distDirectory 'index.html') -Raw
    if ($html -notmatch '/task-management/assets/') {
        throw 'Built HTML does not use /task-management/ asset paths.'
    }

    Write-Host '[2/5] Packaging compiled dist contents...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $deploymentDirectory -Force | Out-Null
    Compress-Archive -Path (Join-Path $distDirectory '*') -DestinationPath $temporaryZip -CompressionLevel Optimal
    Move-Item -LiteralPath $temporaryZip -Destination $zipPath -Force
    $archiveHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "Package: $zipPath"

    Write-Host '[3/5] Uploading package and deployment helpers...' -ForegroundColor Cyan
    $uploads = @(
        @{ Local = $zipPath; Remote = $remoteZip },
        @{ Local = (Join-Path $PSScriptRoot 'configure_task_management_nginx.py'); Remote = $remoteHelper },
        @{ Local = (Join-Path $PSScriptRoot 'task-management.nginx.conf'); Remote = $remoteSnippet },
        @{ Local = (Join-Path $PSScriptRoot 'deploy_task_management.sh'); Remote = $remoteScript }
    )
    foreach ($upload in $uploads) {
        Invoke-NativeCommand 'scp.exe' @('-i', $KeyPath, $upload.Local, "${Server}:$($upload.Remote)") 'EC2 upload failed'
    }

    Write-Host '[4/5] Activating release and validating all three apps/API...' -ForegroundColor Cyan
    $skip = '0'
    if ($SkipNginxSetup) {
        $skip = '1'
    }
    # Validated origins/hosts and generated paths are safe as single-quoted Bash arguments.
    # Both tools modify the same vhost; also respect the unchanged Receipts tool's lock.
    $remotePipeline = "sed 's/\r$//' '$remoteScript' | sudo flock --nonblock /var/lock/parallel-systems-task-management.deploy.lock flock --nonblock /var/lock/parallel-systems-receipts.deploy.lock bash -s -- '$remoteZip' '$remoteHelper' '$remoteSnippet' '$origin' '$siteHost' '$stamp' '$skip' '$archiveHash'"
    $remoteCommand = 'bash -o pipefail -c "' + $remotePipeline + '"'
    Invoke-NativeCommand 'ssh.exe' @('-i', $KeyPath, $Server, $remoteCommand) 'EC2 deployment/checks failed (review rollback output)'

    Write-Host '[5/5] Checking website accessibility from this computer...' -ForegroundColor Cyan
    Invoke-NativeCommand 'curl.exe' @('--fail', '--silent', '--show-error', '--location', '--max-time', '30',
        '--header', "Host: $siteHost", '--output', 'NUL', $publicSiteUrl) 'Remote checks passed, but the public website check failed'
    Write-Host 'DEPLOYMENT SUCCEEDED' -ForegroundColor Green
    Write-Host "Website: $publicSiteUrl"
    Write-Host "Commit: $commit"
    Write-Host 'Sign in to Task Management, open a task link, and refresh it in the browser.'
}
catch {
    Write-Host "DEPLOYMENT FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if (Test-Path -LiteralPath $temporaryZip -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryZip -Force
    }
    if ($locationPushed) {
        Pop-Location
    }
}
