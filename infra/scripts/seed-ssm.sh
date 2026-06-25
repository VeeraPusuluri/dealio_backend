#!/usr/bin/env bash
# Seed a backend environment's runtime config into SSM Parameter Store from a
# local .env file. The deploy workflow reads these back on the EC2 box to render
# /home/<user>/dealio-backend/.env at deploy time.
#
# Usage:
#   ./seed-ssm.sh dev  ../../.env.dev
#   ./seed-ssm.sh prod ../../.env.prod
#
# Every key is stored as a SecureString under /dealio/<env>/backend/<KEY>.
set -euo pipefail

ENV_NAME="${1:?usage: seed-ssm.sh <dev|prod> <path-to-.env>}"
ENV_FILE="${2:?usage: seed-ssm.sh <dev|prod> <path-to-.env>}"
REGION="${AWS_REGION:-us-east-1}"

[[ "$ENV_NAME" == "dev" || "$ENV_NAME" == "prod" ]] || { echo "env must be dev or prod"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "no such file: $ENV_FILE"; exit 1; }

while IFS= read -r line || [[ -n "$line" ]]; do
  # skip blanks and comments (#, //, ;)
  [[ -z "$line" || "$line" =~ ^[[:space:]]*(#|//|\;) ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  key="$(echo "$key" | xargs)"                 # trim
  val="${val%\"}"; val="${val#\"}"             # strip surrounding quotes
  [[ -z "$key" ]] && continue

  echo "  putting /dealio/${ENV_NAME}/backend/${key}"
  aws ssm put-parameter \
    --name "/dealio/${ENV_NAME}/backend/${key}" \
    --value "$val" \
    --type SecureString \
    --overwrite \
    --region "$REGION" >/dev/null
done < "$ENV_FILE"

echo "Done. Verify: aws ssm get-parameters-by-path --path /dealio/${ENV_NAME}/backend/ --recursive --region ${REGION} --query 'Parameters[].Name'"
