#!/usr/bin/env bash
# Upload a local env file into AWS SSM Parameter Store as SecureString params
# under /dealio/<env>/backend/<KEY>. This is the source of truth for runtime
# secrets — run it LOCALLY with admin AWS creds, never in CI.
#
#   ./scripts/put-ssm-secrets.sh prod .env.prod
#   ./scripts/put-ssm-secrets.sh dev  .env.dev
#
# Re-run any time you change a value; --overwrite updates in place.
set -euo pipefail

ENV_NAME="${1:?usage: put-ssm-secrets.sh <dev|prod> <envfile>}"
ENVFILE="${2:?usage: put-ssm-secrets.sh <dev|prod> <envfile>}"
AWS_REGION="${AWS_REGION:-us-east-1}"

[ -f "$ENVFILE" ] || { echo "no such file: $ENVFILE" >&2; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  # skip blanks and comments
  case "$line" in ''|\#*|//*|\;*) continue;; esac
  key="${line%%=*}"
  val="${line#*=}"
  # trim whitespace around the key; strip one layer of surrounding quotes
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  val="${val%\"}"; val="${val#\"}"
  [ -z "$key" ] && continue
  # SSM SecureString can't store an empty value; an empty/unset var is the app
  # default anyway, so skip it (e.g. disabled WhatsApp).
  [ -z "$val" ] && { echo "skip (empty): ${key}"; continue; }

  aws ssm put-parameter --region "$AWS_REGION" \
    --name "/dealio/${ENV_NAME}/backend/${key}" \
    --type SecureString --value "$val" --overwrite >/dev/null
  echo "put /dealio/${ENV_NAME}/backend/${key}"
done < "$ENVFILE"

echo "Done. Verify with: aws ssm get-parameters-by-path --path /dealio/${ENV_NAME}/backend/ --recursive --region ${AWS_REGION} --query 'Parameters[].Name'"
