#!/usr/bin/env bash
# Render a runtime .env from AWS SSM Parameter Store params under
# /dealio/<env>/backend/. Run ON the EC2 box (uses the instance IAM role) for a
# manual deploy. CI does this inline in .github/workflows/deploy.yml.
#
#   ENV_NAME=prod ./scripts/render-env-from-ssm.sh > .env && chmod 600 .env
set -euo pipefail

ENV_NAME="${ENV_NAME:?set ENV_NAME (dev|prod)}"
AWS_REGION="${AWS_REGION:-us-east-1}"

aws ssm get-parameters-by-path \
  --path "/dealio/${ENV_NAME}/backend/" --with-decryption --recursive \
  --region "$AWS_REGION" --query 'Parameters[].[Name,Value]' --output text \
  | while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done
