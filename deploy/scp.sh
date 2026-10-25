#!/usr/bin/env bash
# Resumable rsync uploads share the existing release verification and lifecycle.
set -euo pipefail

operation=${1:-}
[[ "$operation" =~ ^(setup|upload|probe|received|retry|verify|deliver|cleanup)$ ]]
trap 'echo "phase=transfer-control status=failed operation=$operation line=$LINENO" >&2' ERR

DEPLOY_PORT=${DEPLOY_PORT:-22}
DEPLOY_PATH=${DEPLOY_PATH:-/opt/hehuoda}
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ ]]
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$DEPLOY_PORT" =~ ^[0-9]+$ && "$DEPLOY_PORT" -ge 1 && "$DEPLOY_PORT" -le 65535 ]]
[[ "$DEPLOY_PATH" =~ ^/[a-zA-Z0-9/_-]+$ && "$DEPLOY_PATH" != / ]]
[[ "${DEPLOY_TLS:-false}" =~ ^(true|false)$ ]]
[[ "${DEPLOY_ARCHIVE_ACTIVATE:-false}" =~ ^(true|false)$ ]]
[[ -z "${DEPLOY_PUBLIC_URL:-}" || "$DEPLOY_PUBLIC_URL" =~ ^https?://[a-zA-Z0-9.:-]+/?$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ && "$DEPLOY_ACTION" =~ ^(prepare|deploy|rollback)$ ]]
[[ -n "$DEPLOY_KNOWN_HOSTS" ]]
if [[ "$DEPLOY_ACTION" == rollback ]]; then
  destination="$DEPLOY_PATH/controller/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
else
  destination="$DEPLOY_PATH/releases/$RELEASE_SHA/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
fi
staging="$destination.incoming"
source_dir=".scp-upload-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
task_dir="$RUNNER_TEMP/hehuoda-scp-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
umask 077
mkdir -p "$task_dir"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$task_dir/known_hosts"
ssh_args=(-T -p "$DEPLOY_PORT" -o StrictHostKeyChecking=yes -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no -o "UserKnownHostsFile=\"$task_dir/known_hosts\"" -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
install_runner_package() {
  if ! { sudo apt-get update -qq && sudo apt-get install -y -qq "$1"; } > "$task_dir/install.log" 2>&1; then
    echo 'phase=configuration status=failed category=dependency-missing side=runner' >&2
    exit 44
  fi
}
if [[ -n "${DEPLOY_SSH_KEY:-}" && -z "${DEPLOY_PASSWORD:-}" ]]; then
  printf '%s\n' "$DEPLOY_SSH_KEY" > "$task_dir/key"
  ssh_args+=(-o BatchMode=yes -o IdentitiesOnly=yes -i "$task_dir/key")
  transport=(ssh)
elif [[ -n "${DEPLOY_PASSWORD:-}" && -z "${DEPLOY_SSH_KEY:-}" ]]; then
  if ! command -v sshpass >/dev/null; then
    install_runner_package sshpass
  fi
  export SSHPASS="$DEPLOY_PASSWORD"
  transport=(sshpass -e ssh)
  ssh_args+=(-o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no)
else
  echo 'phase=configuration status=invalid-authentication' >&2
  exit 1
fi

remote() {
  local code category
  if timeout --signal=TERM --kill-after=5s "${2:-60}" "${transport[@]}" -n "${ssh_args[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$1" 2> "$task_dir/ssh.stderr"; then
    return 0
  else
    code=$?
  fi
  category=remote-command
  case "$code" in
    124|137) category=timeout ;;
    5) category=authentication ;;
    6|7) category=host-key ;;
    127) category=command-unavailable ;;
    42) category=integrity-mismatch ;;
    44) category=dependency-missing ;;
    45) category=dependency-version ;;
    *)
      if grep -Eqi 'host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED' "$task_dir/ssh.stderr"; then category=host-key;
      elif grep -Eqi 'permission denied|authentication failed' "$task_dir/ssh.stderr"; then category=authentication;
      elif grep -Eqi 'timed out|timeout' "$task_dir/ssh.stderr"; then category=timeout;
      elif grep -Eqi 'connection refused|connection reset|no route|could not resolve|broken pipe' "$task_dir/ssh.stderr"; then category=connection;
      fi ;;
  esac
  echo "phase=ssh status=failed operation=$operation exit_code=$code category=$category" >&2
  return "$code"
}

check_file() {
  local name="$1" path="$2" digest bytes
  digest=$(sha256sum "$GITHUB_WORKSPACE/$source_dir/$name" | cut -d' ' -f1)
  bytes=$(wc -c < "$GITHUB_WORKSPACE/$source_dir/$name")
  remote "test -f '$path' && test \"\$(wc -c < '$path')\" = '$bytes' && test \"\$(sha256sum '$path' | cut -d' ' -f1)\" = '$digest' || exit 42"
}

trusted_keys() {
  ssh-keygen -F "$lookup" -f "$task_dir/known_hosts" > "$task_dir/matches" 2>/dev/null
  if grep -q '^@revoked[[:space:]]' "$task_dir/matches"; then
    echo 'phase=configuration status=revoked-host-key' >&2
    return 1
  fi
  awk '!/^#/ && NF >= 3 && $1 !~ /^@/ {print $2 " " $3}' "$task_dir/matches" | sort -u > "$task_dir/keys"
  if ! awk '{if (seen[$1]++) exit 1}' "$task_dir/keys"; then
    echo 'phase=configuration status=ambiguous-host-keys' >&2
    return 1
  fi
}

require_rsync_version() {
  local version major minor
  version=$(awk '$1 == "rsync" && $2 == "version" {print $3; exit}' "$1")
  if [[ "$version" =~ ^([0-9]+)\.([0-9]+)\. ]]; then
    major=${BASH_REMATCH[1]}; minor=${BASH_REMATCH[2]}
    if (( major > 3 || (major == 3 && minor >= 1) )); then return 0; fi
  fi
  echo "phase=configuration status=failed category=dependency-version side=$2 minimum=3.1" >&2
  return 45
}

case "$operation" in
  setup)
    lookup="$DEPLOY_HOST"
    if [[ "$DEPLOY_PORT" != 22 ]]; then lookup="[$DEPLOY_HOST]:$DEPLOY_PORT"; fi
    trusted_keys
    printf '::add-mask::%s\n' "$staging" "$destination"
    echo 'phase=connect status=started'
    remote "test -d '$DEPLOY_PATH' && test -f '$DEPLOY_PATH/.env' && command -v node >/dev/null && docker info >/dev/null && test -w '$DEPLOY_PATH'"
    if ! command -v rsync >/dev/null; then
      install_runner_package rsync
    fi
    rsync --version > "$task_dir/local-rsync" 2> "$task_dir/rsync.stderr"
    require_rsync_version "$task_dir/local-rsync" runner
    remote 'command -v rsync >/dev/null || exit 44; rsync --version' > "$task_dir/remote-rsync"
    require_rsync_version "$task_dir/remote-rsync" server
    remote "umask 077 && mkdir -p '$staging/probe' '$staging/upload/.rsync-partial' && chmod 700 '$staging' '$staging/probe' '$staging/upload' '$staging/upload/.rsync-partial'"
    mkdir -p "$GITHUB_WORKSPACE/$source_dir"
    cp "$RUNNER_TEMP/payload.tar.gz" "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz"
    head -c 1048576 /dev/urandom > "$GITHUB_WORKSPACE/$source_dir/probe"
    chmod 700 "$GITHUB_WORKSPACE/$source_dir"
    chmod 600 "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz" "$GITHUB_WORKSPACE/$source_dir/probe"
    printf 'SCP_SOURCE_DIR=%s\nSCP_STAGING=%s\n' "$source_dir" "$staging" >> "$GITHUB_ENV"
    echo 'phase=connect status=verified'
    ;;
  upload)
    kind=${2:-}
    attempt=${3:-1}
    [[ "$kind" =~ ^(probe|payload)$ && "$attempt" =~ ^[12]$ ]]
    if [[ "$kind" == probe ]]; then name=probe; remote_path="$staging/probe/probe"; wall=90;
    elif [[ "$attempt" == 1 ]]; then name=payload.tar.gz; remote_path="$staging/upload/payload.tar.gz"; wall=1440;
    else name=payload.tar.gz; remote_path="$staging/upload/payload.tar.gz"; wall=840; fi
    { printf '#!/usr/bin/env bash\nexec '; printf '%q ' "${transport[@]}" "${ssh_args[@]}"; printf '"$@"\n'; } > "$task_dir/rsync-ssh"
    chmod 700 "$task_dir/rsync-ssh"
    node "$(dirname "$0")/rsync.mjs" "$GITHUB_WORKSPACE/$source_dir/$name" "$DEPLOY_USER@$DEPLOY_HOST:$remote_path" "$task_dir/rsync-ssh" "$task_dir" "$kind" "$attempt" "$wall"
    ;;
  probe)
    check_file probe "$staging/probe/probe"
    echo 'phase=link-probe status=verified bytes=1048576 transport=rsync'
    ;;
  received)
    # A lost client response need not retransmit a complete, verified file.
    if check_file payload.tar.gz "$staging/upload/payload.tar.gz"; then
      echo 'valid=true' >> "$GITHUB_OUTPUT"
    else
      echo 'valid=false' >> "$GITHUB_OUTPUT"
    fi
    ;;
  retry)
    echo 'phase=payload status=retrying attempt=2 transport=rsync'
    sleep 10
    ;;
  verify)
    check_file payload.tar.gz "$staging/upload/payload.tar.gz"
    digest=$(sha256sum "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz" | cut -d' ' -f1)
    bytes=$(wc -c < "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz")
    # The application payload stays sealed until its received bytes have been verified.
    remote "mkdir -p '$staging/verified' && tar -xzf '$staging/upload/payload.tar.gz' -C '$staging/verified' && printf '%s %s' '$digest' '$bytes' > '$staging/verified/.payload' && test ! -e '$destination' && mv '$staging/verified' '$destination'" 120
    echo "phase=payload status=verified bytes=$bytes transport=rsync"
    ;;
  deliver)
    echo "phase=delivery status=started action=$DEPLOY_ACTION"
    remote "cd '$destination' && DEPLOY_ROOT='$DEPLOY_PATH' DEPLOY_ENV_FILE='$DEPLOY_PATH/.env' DEPLOY_STATE_DIR='$DEPLOY_PATH/state' DEPLOY_BACKUP_DIR='$DEPLOY_PATH/backups' DEPLOY_TLS='${DEPLOY_TLS:-false}' DEPLOY_PUBLIC_URL='${DEPLOY_PUBLIC_URL:-}' DEPLOY_ARCHIVE_ACTIVATE='${DEPLOY_ARCHIVE_ACTIVATE:-false}' node deploy/delivery.mjs '$DEPLOY_ACTION' '$RELEASE_SHA' '$destination'" 1200
    ;;
  cleanup)
    # Only this run/attempt's validated staging path is disposable; never remove the release.
    remote "rm -rf '$staging'" || true
    rm -rf -- "$GITHUB_WORKSPACE/$source_dir" "$task_dir"
    echo 'phase=cleanup status=finished'
    ;;
esac
