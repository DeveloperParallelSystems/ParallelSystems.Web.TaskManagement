#!/usr/bin/env bash
# Invoked by the Windows launcher under deployment locks. Deploy frontend only.
set -Eeuo pipefail
archive=$1
helper=$2
snippet=$3
origin=$4
site_host=$5
stamp=$6
skip_nginx=$7
archive_hash=$8
[[ "$stamp" =~ ^[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$ ]] || exit 2
[[ "$archive_hash" =~ ^[a-f0-9]{64}$ ]] || exit 2
release_root=/var/www/parallel-systems-task-management/releases
current=/var/www/parallel-systems-task-management/current
release="$release_root/$stamp"
state="/var/backups/parallel-systems-task-management/$stamp/nginx/state.json"
previous=''
activated=0
receipts_before=''

site_curl() {
    curl --header "Host: $site_host" "$@"
}

# Reload returns before all new Nginx workers are ready. Compare the exact shell.
wait_for_task_shell() {
    local expected=$1 response_file=$2
    local attempt status actual transport_code
    for attempt in {1..10}; do
        actual='unavailable'
        if status=$(site_curl --silent --show-error --location --connect-timeout 2 --max-time 3 \
            --header 'Cache-Control: no-cache' --output "$response_file" --write-out '%{http_code}' "$origin/task-management/"); then
            transport_code=0
        else
            transport_code=$?
        fi
        if [ -f "$response_file" ]; then
            actual=$(sha256sum "$response_file" | cut -d ' ' -f1)
        fi
        if [ "$transport_code" -eq 0 ] && [ "$status" = '200' ] && [ "$actual" = "$expected" ]; then
            echo "Task Management route ready (attempt $attempt/10)."
            return 0
        fi
        echo "Waiting for Task Management ($attempt/10): HTTP ${status:-unknown}, curl exit $transport_code." >&2
        if [ "$attempt" -lt 10 ]; then
            sleep 1
        fi
    done
    echo 'Task Management did not serve the uploaded page within the retry window; rolling back.' >&2
    echo "Checked URL: $origin/task-management/ (Host: $site_host)" >&2
    echo "Expected SHA-256: $expected; received: $actual" >&2
    if [ "$actual" = "$timesheet_before" ]; then
        echo 'The response is the Timesheet page. Check the Task Management include and active Nginx workers.' >&2
    fi
    echo "Last response retained for inspection: $response_file" >&2
    return 1
}

check_task_api() {
    local status
    # No cookie or user credentials. Redirects/404/HTML fallback are not accepted.
    status=$(site_curl --silent --show-error --max-time 10 --output /dev/null \
        --write-out '%{http_code}' "$origin/api/task-management/auth/me")
    if [ "$status" != '401' ]; then
        echo "Task Management session endpoint returned HTTP $status; expected 401 without a login." >&2
        echo 'Deploy the updated shared Server separately and check the existing /api proxy.' >&2
        return 1
    fi
}

for tool in python3 unzip nginx curl sha256sum systemctl realpath; do
    if ! command -v "$tool" >/dev/null; then
        echo "Missing EC2 tool: $tool" >&2
        exit 1
    fi
done
test -f "$archive"
test -f "$helper"
test -f "$snippet"
printf '%s  %s\n' "$archive_hash" "$archive" | sha256sum --check --status
nginx -t

timesheet_before=$(site_curl --fail --silent --show-error --location --max-time 30 "$origin/" | sha256sum | cut -d ' ' -f1)
test -f /var/www/parallel-systems-timesheet/current/index.html
timesheet_file=$(sha256sum /var/www/parallel-systems-timesheet/current/index.html | cut -d ' ' -f1)
if [ "$timesheet_before" != "$timesheet_file" ]; then
    echo 'The supplied origin is not serving the expected Timesheet release; no activation performed.' >&2
    exit 1
fi
receipts_current=/var/www/parallel-systems-receipts/current
if [ -e "$receipts_current" ] || [ -L "$receipts_current" ]; then
    test -f "$receipts_current/receipts/index.html"
    receipts_before=$(site_curl --fail --silent --show-error --location --max-time 30 "$origin/receipts/" | sha256sum | cut -d ' ' -f1)
    receipts_file=$(sha256sum "$receipts_current/receipts/index.html" | cut -d ' ' -f1)
    if [ "$receipts_before" != "$receipts_file" ]; then
        echo 'Existing Receipts route is not serving its active release; no activation performed.' >&2
        exit 1
    fi
fi
site_curl --fail --silent --show-error --location --max-time 30 "$origin/health" >/dev/null
check_task_api
if [ -L "$current" ]; then
    previous=$(realpath -e "$current")
    case "$previous" in
        "$release_root/"*)
            test -f "$previous/task-management/index.html"
            ;;
        *)
            echo 'Task Management current target is outside its release directory; refusing to replace it.' >&2
            exit 1
            ;;
    esac
elif [ -e "$current" ]; then
    echo 'Task Management current path is not a symlink; refusing to replace it.' >&2
    exit 1
fi
test ! -e "$release"
test ! -L "$release"

rollback() {
    result=$?
    if [ "$result" -ne 0 ]; then
        set +e
        echo 'Deployment failed; restoring the previous Task Management release and Nginx configuration.' >&2
        rollback_failed=0
        if [ "$activated" -eq 1 ]; then
            if [ -n "$previous" ]; then
                ln -s "$previous" "$current.rollback-$stamp" &&
                    mv -Tf "$current.rollback-$stamp" "$current" || rollback_failed=1
            else
                test -L "$current" && unlink "$current" || rollback_failed=1
            fi
        fi
        if [ -f "$state" ]; then
            python3 "$helper" restore --state "$state" || rollback_failed=1
        fi
        if nginx -t; then
            systemctl reload nginx || rollback_failed=1
        else
            rollback_failed=1
        fi
        if [ "$rollback_failed" -ne 0 ]; then
            echo "ROLLBACK NEEDS ATTENTION. Retained backup state: $state" >&2
        else
            echo "Rollback completed. Failed release retained for inspection: $release" >&2
        fi
    fi
    exit "$result"
}
trap rollback EXIT

mkdir -p "$release/task-management"
unzip_status=0
unzip -oq "$archive" -d "$release/task-management" || unzip_status=$?
if [ "$unzip_status" -gt 1 ]; then
    exit "$unzip_status"
fi
for file in index.html logo.png; do
    test -f "$release/task-management/$file"
done
test -d "$release/task-management/assets"
chown -R root:root "$release"
find "$release" -type d -exec chmod 755 {} \;
find "$release" -type f -exec chmod 644 {} \;

if [ "$skip_nginx" = '0' ]; then
    python3 "$helper" prepare --host "$site_host" --snippet-source "$snippet" --state "$state"
fi
ln -s "$release" "$current.next-$stamp"
mv -Tf "$current.next-$stamp" "$current"
activated=1
nginx -t
systemctl reload nginx

expected=$(sha256sum "$release/task-management/index.html" | cut -d ' ' -f1)
validation_dir="/var/backups/parallel-systems-task-management/$stamp/validation"
mkdir -p "$validation_dir"
chmod 700 "$validation_dir"
wait_for_task_shell "$expected" "$validation_dir/task-shell.body"
for path in /task-management/ /task-management/tasks /task-management/dashboard \
    /task-management/projects /task-management/notifications \
    /task-management/tasks/00000000-0000-0000-0000-000000000001; do
    actual=$(site_curl --fail --silent --show-error --location --max-time 30 "$origin$path" | sha256sum | cut -d ' ' -f1)
    if [ "$actual" != "$expected" ]; then
        echo "Wrong app/SPA fallback served at $path" >&2
        exit 1
    fi
done
redirect_status=$(site_curl --silent --show-error --max-time 30 --output /dev/null \
    --write-out '%{http_code}' "$origin/task-management")
if [ "$redirect_status" != '308' ]; then
    echo 'The /task-management path must redirect to /task-management/ with HTTP 308.' >&2
    exit 1
fi

expected_logo=$(sha256sum "$release/task-management/logo.png" | cut -d ' ' -f1)
actual_logo=$(site_curl --fail --silent --show-error --location --max-time 30 "$origin/task-management/logo.png" | sha256sum | cut -d ' ' -f1)
test "$expected_logo" = "$actual_logo"
while IFS= read -r asset; do
    expected_asset=$(sha256sum "$release$asset" | cut -d ' ' -f1)
    actual_asset=$(site_curl --fail --silent --show-error --location --max-time 30 "$origin$asset" | sha256sum | cut -d ' ' -f1)
    if [ "$actual_asset" != "$expected_asset" ]; then
        echo "Wrong Task Management asset served: $asset" >&2
        exit 1
    fi
done < <(grep -oE '/task-management/assets/[^" ]+' "$release/task-management/index.html" | sort -u)
missing_status=$(site_curl --silent --show-error --location --max-time 30 --output /dev/null \
    --write-out '%{http_code}' "$origin/task-management/assets/deployment-check-missing.js")
if [ "$missing_status" != '404' ]; then
    echo 'Missing assets must return 404, not an SPA document.' >&2
    exit 1
fi

timesheet_after=$(site_curl --fail --silent --show-error --location --max-time 30 "$origin/" | sha256sum | cut -d ' ' -f1)
if [ "$timesheet_before" != "$timesheet_after" ]; then
    echo 'Timesheet root response changed; rolling back.' >&2
    exit 1
fi
if [ -n "$receipts_before" ]; then
    receipts_after=$(site_curl --fail --silent --show-error --location --max-time 30 "$origin/receipts/" | sha256sum | cut -d ' ' -f1)
    if [ "$receipts_before" != "$receipts_after" ]; then
        echo 'Receipts response changed; rolling back.' >&2
        exit 1
    fi
fi
site_curl --fail --silent --show-error --location --max-time 30 "$origin/health"
check_task_api
echo
echo "Task Management release active: $release"
echo "Previous Task Management target: ${previous:-none (first deployment)}"
echo "Deployment/check URL: $origin/task-management/ (Host: $site_host)"
