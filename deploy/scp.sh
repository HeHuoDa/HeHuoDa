#!/usr/bin/env bash
# SCP Action owns uploads; this controller only prepares, verifies and activates them.
set -euo pipefail

operation=${1:-}
[[ "$operation" =~ ^(setup|probe|received|retry|verify|deliver|cleanup)$ ]]
trap 'echo "phase=scp-control status=failed operation=$operation line=$LINENO" >&2' ERR

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
ssh_args=(-n -T -p "$DEPLOY_PORT" -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$task_dir/known_hosts" -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
if [[ -n "${DEPLOY_SSH_KEY:-}" && -z "${DEPLOY_PASSWORD:-}" ]]; then
  printf '%s\n' "$DEPLOY_SSH_KEY" > "$task_dir/key"
  ssh_args+=(-o BatchMode=yes -o IdentitiesOnly=yes -i "$task_dir/key")
  transport=(ssh)
elif [[ -n "${DEPLOY_PASSWORD:-}" && -z "${DEPLOY_SSH_KEY:-}" ]]; then
  if ! command -v sshpass >/dev/null; then
    sudo apt-get update -qq > "$task_dir/install.log" 2>&1
    sudo apt-get install -y -qq sshpass >> "$task_dir/install.log" 2>&1
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
  if timeout --signal=TERM --kill-after=5s "${2:-60}" "${transport[@]}" "${ssh_args[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$1" 2> "$task_dir/ssh.stderr"; then
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

case "$operation" in
  setup)
    # Only a pinned known_hosts entry for this exact endpoint may supply the Action fingerprint.
    lookup="$DEPLOY_HOST"
    if [[ "$DEPLOY_PORT" != 22 ]]; then lookup="[$DEPLOY_HOST]:$DEPLOY_PORT"; fi
    ssh-keygen -F "$lookup" -f "$task_dir/known_hosts" > "$task_dir/matches" 2>/dev/null
    if grep -q '^@revoked[[:space:]]' "$task_dir/matches"; then
      echo 'phase=configuration status=revoked-host-key' >&2
      exit 1
    fi
    awk '!/^#/ && NF >= 3 && $1 !~ /^@/ {print $2 " " $3}' "$task_dir/matches" | sort -u > "$task_dir/keys"
    # Match drone-scp 1.6.14's x/crypto v0.17 raw host-key preference.
    # Never discover trust with keyscan; missing negotiated keys fail closed in the Action.
    awk '$1 == "ecdsa-sha2-nistp256" {print 1, $0} $1 == "ecdsa-sha2-nistp384" {print 2, $0} $1 == "ecdsa-sha2-nistp521" {print 3, $0} $1 == "ssh-rsa" {print 4, $0} $1 == "ssh-ed25519" {print 5, $0}' "$task_dir/keys" | sort -k1,1n > "$task_dir/ranked"
    selected=$(head -n 1 "$task_dir/ranked" | cut -d' ' -f2)
    [[ -n "$selected" ]]
    awk -v algorithm="$selected" '$1 == algorithm' "$task_dir/keys" > "$task_dir/selected"
    if [[ $(wc -l < "$task_dir/selected") != 1 ]]; then
      echo 'phase=configuration status=ambiguous-host-keys' >&2
      exit 1
    fi
    fingerprint=$(ssh-keygen -lf "$task_dir/selected" -E sha256 2>/dev/null | awk '{print $2}')
    [[ "$fingerprint" =~ ^SHA256:[A-Za-z0-9+/]+$ ]]
    printf '::add-mask::%s\n' "$staging" "$destination" "$fingerprint"
    mkdir -p "$GITHUB_WORKSPACE/$source_dir"
    cp "$RUNNER_TEMP/payload.tar.gz" "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz"
    head -c 1048576 /dev/urandom > "$GITHUB_WORKSPACE/$source_dir/probe"
    # The pinned Action runs as UID 1000, not the hosted runner's user. No credentials live here.
    chmod 755 "$GITHUB_WORKSPACE/$source_dir"
    chmod 644 "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz" "$GITHUB_WORKSPACE/$source_dir/probe"
    printf 'SCP_SOURCE_DIR=%s\nSCP_STAGING=%s\nSCP_FINGERPRINT=%s\nSCP_PORT=%s\n' "$source_dir" "$staging" "$fingerprint" "$DEPLOY_PORT" >> "$GITHUB_ENV"
    echo 'phase=connect status=started'
    remote "test -d '$DEPLOY_PATH' && test -f '$DEPLOY_PATH/.env' && command -v node >/dev/null && docker info >/dev/null && test -w '$DEPLOY_PATH' && umask 077 && mkdir -p '$staging/probe' '$staging/upload' && chmod 700 '$staging' '$staging/probe' '$staging/upload'"
    echo 'phase=connect status=verified'
    ;;
  probe)
    check_file probe "$staging/probe/probe"
    echo 'phase=link-probe status=verified bytes=1048576 transport=scp'
    ;;
  received)
    # A lost Action response need not retransmit a complete, verified file.
    if check_file payload.tar.gz "$staging/upload/payload.tar.gz"; then
      echo 'valid=true' >> "$GITHUB_OUTPUT"
    else
      echo 'valid=false' >> "$GITHUB_OUTPUT"
    fi
    ;;
  retry)
    remote "rm -f '$staging/upload/payload.tar.gz'"
    echo 'phase=payload status=retrying attempt=2 transport=scp'
    sleep 10
    ;;
  verify)
    check_file payload.tar.gz "$staging/upload/payload.tar.gz"
    digest=$(sha256sum "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz" | cut -d' ' -f1)
    bytes=$(wc -c < "$GITHUB_WORKSPACE/$source_dir/payload.tar.gz")
    # The Action extracts only its wrapper. The application payload stays sealed until verified.
    remote "mkdir -p '$staging/verified' && tar -xzf '$staging/upload/payload.tar.gz' -C '$staging/verified' && printf '%s %s' '$digest' '$bytes' > '$staging/verified/.payload' && test ! -e '$destination' && mv '$staging/verified' '$destination'" 120
    echo "phase=payload status=verified bytes=$bytes transport=scp"
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
