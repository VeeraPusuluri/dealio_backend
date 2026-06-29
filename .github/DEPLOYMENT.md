# Deployment — Backend (EC2 · dev/prod from one repo)

Same codebase, two environments selected by **branch**:

```
push to `dev`   → GitHub Environment `dev`   → dev  EC2 box  → dev  RDS   (image tag dev-*)
push to `main`  → GitHub Environment `prod`  → prod EC2 box  → prod RDS  (image tag prod-*)
```

CI builds the Docker image, pushes it to **one ECR repo** (`dealio-backend`) with
`<env>-<sha>` / `<env>-latest` tags, then SSHes into that environment's EC2 box,
renders `.env` from **SSM Parameter Store**, and runs `docker compose up -d`.
Auth to AWS uses **GitHub OIDC** (no long-lived keys).

Account `687159379528`, region `us-east-1`.

---

## Where secrets live (and where they do NOT)

| Kind | Examples | Store | Read by |
|---|---|---|---|
| **App runtime secrets** | `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `SMTP_*`, `WHATSAPP_*` | **AWS SSM Parameter Store** `SecureString`, per env: `/dealio/dev/backend/*`, `/dealio/prod/backend/*` | the **EC2 box at runtime** via its instance IAM role |
| **CI/deploy secrets** | `AWS_DEPLOY_ROLE_ARN`, `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` | **GitHub Environments** (`dev`, `prod`) | GitHub Actions only |
| **Templates (no secrets)** | required keys, dummy values | **git** (`.env.example`) | humans |

Rules of thumb:
- **Never** commit real secrets (`.gitignore` blocks `.env` and `.env.*`, allows `.env.example`).
- App secrets go in **AWS**, fetched at runtime by the workload's IAM identity — they never pass through CI logs, and you rotate in one place.
- GitHub Secrets hold only "how to authenticate to AWS and reach the box."
- SSM `SecureString` (standard tier) is free. Use **Secrets Manager** instead only if you want built-in auto-rotation (~$0.40/secret/mo).

---

## 1. One-time AWS setup

### a. GitHub OIDC provider (skip if it already exists)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### b. Deploy role assumed by CI via OIDC (`AWS_DEPLOY_ROLE_ARN`)

`trust-policy.json` — allow both repos / all branches:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::687159379528:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": [
        "repo:VeeraPusuluri/dealio_backend:*",
        "repo:VeeraPusuluri/dealio:*"
      ] }
    }
  }]
}
```

`deploy-policy.json` — CI only needs to push images to ECR:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ECRAuth", "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    { "Sid": "ECRPushPull", "Effect": "Allow", "Action": [
        "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage",
        "ecr:PutImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
        "ecr:DescribeRepositories", "ecr:CreateRepository"
    ], "Resource": "*" }
  ]
}
```

```bash
aws iam create-role --role-name dealio-github-deploy \
  --assume-role-policy-document file://trust-policy.json
aws iam put-role-policy --role-name dealio-github-deploy \
  --policy-name dealio-deploy --policy-document file://deploy-policy.json
# ARN -> AWS_DEPLOY_ROLE_ARN: arn:aws:iam::687159379528:role/dealio-github-deploy
```

### c. Let each EC2 box read its env's SSM params

The instance role (current prod box: **`dealio-ec2-ecr-role`**) needs SSM read +
KMS decrypt. Attach this inline policy to each environment's instance role
(scope the `Resource` path to that env):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "SsmRead", "Effect": "Allow",
      "Action": ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"],
      "Resource": "arn:aws:ssm:us-east-1:687159379528:parameter/dealio/prod/backend/*" },
    { "Sid": "KmsDecrypt", "Effect": "Allow", "Action": "kms:Decrypt",
      "Resource": "*" }
  ]
}
```

```bash
aws iam put-role-policy --role-name dealio-ec2-ecr-role \
  --policy-name dealio-ssm-prod --policy-document file://ssm-read-prod.json
```

(The box also keeps `AmazonEC2ContainerRegistryReadOnly` for ECR pulls.)

### d. Put the runtime secrets into SSM (source of truth)

From a machine with admin creds, load each env's values (helper script provided):

```bash
./scripts/put-ssm-secrets.sh prod .env.prod   # uploads to /dealio/prod/backend/*
./scripts/put-ssm-secrets.sh dev  .env.dev    # uploads to /dealio/dev/backend/*
```

`.env.prod` / `.env.dev` are gitignored working files — keep them off git; SSM is
the real store. Each env should have its **own** `DATABASE_URL` (its RDS),
`ALLOWED_ORIGINS`/`FRONTEND_URL`, and a distinct `JWT_SECRET`.

---

## 2. GitHub Environments — repo `VeeraPusuluri/dealio_backend`

Settings → **Environments** → create **`dev`** and **`prod`**. In each, add these
**environment secrets** (values differ per env):

| Secret | dev | prod |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::687159379528:role/dealio-github-deploy` | same |
| `EC2_HOST` | dev box IP/DNS | prod box IP/DNS (e.g. `100.28.134.6`) |
| `EC2_USER` | `ubuntu` | `ubuntu` |
| `EC2_SSH_KEY` | dev instance PEM | prod instance PEM |
| `EC2_SSH_PORT` | *(optional, 22)* | *(optional, 22)* |

Optionally add a **required reviewer** on `prod` so production deploys need an
approval click.

---

## 3. Deploy

- **Dev:** `git push origin dev` → builds `dev-*`, deploys to the dev box.
- **Prod:** merge/push to `main` → builds `prod-*`, deploys to the prod box.
- **Manual:** Actions → *Deploy Backend (EC2 · dev/prod)* → Run workflow (pick branch).

The workflow renders `.env` from SSM on the box each deploy, so secret changes
take effect by re-running SSM `put-parameter` then redeploying (no code change).

---

## Notes / knobs

- **DB schema** is synced with `prisma db push --skip-generate` on every deploy
  (no `prisma/migrations/`). Remove that step if you want manual schema control.
- **One box, both envs?** This design assumes a **separate EC2 per env**. To run
  both on one box, give each a distinct `COMPOSE_PROJECT_NAME` and host port.
- **HTTPS:** the app listens on `:8090` (HTTP). An HTTPS frontend (Amplify) needs
  TLS in front of it (reverse proxy / ALB) before browser calls succeed.
- **Single ECR repo** holds both envs via `dev-*` / `prod-*` tags; split into two
  repos later if you want separate lifecycle policies.
