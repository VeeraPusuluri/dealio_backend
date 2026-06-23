# Deployment setup — Backend (EC2 via ECR)

CI builds the Docker image, pushes it to **Amazon ECR**, then deploys to **EC2**
via **AWS SSM Run Command** (keyless — no SSH key, no inbound port 22). The SSM
agent on the box runs `docker compose up -d`, pulling from ECR with the
instance's IAM role. Auth to AWS uses **GitHub OIDC** (no long-lived keys).
Triggers: push to `main`, or manual run.

Account `687159379528`, region `us-east-1`.

---

## 1. One-time AWS setup (shared by both repos)

### a. Create the GitHub OIDC provider (skip if it already exists)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### b. Create the deploy role used by **both** repos

`trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::687159379528:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": [
          "repo:VeeraPusuluri/dealio_backend:*",
          "repo:VeeraPusuluri/dealio:*"
        ]
      }
    }
  }]
}
```

`deploy-policy.json` (ECR push for backend + Amplify trigger for frontend +
SSM deploy):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ECRAuth", "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    { "Sid": "ECRPushPull", "Effect": "Allow", "Action": [
        "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage",
        "ecr:PutImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
        "ecr:DescribeRepositories", "ecr:CreateRepository"
      ], "Resource": "*" },
    { "Sid": "AmplifyDeploy", "Effect": "Allow", "Action": ["amplify:StartJob", "amplify:GetJob"], "Resource": "*" },
    { "Sid": "SSMDeploy", "Effect": "Allow", "Action": [
        "ssm:SendCommand", "ssm:GetCommandInvocation", "ssm:ListCommandInvocations",
        "ssm:DescribeInstanceInformation"
      ], "Resource": "*" }
  ]
}
```

```bash
aws iam create-role --role-name dealio-github-deploy \
  --assume-role-policy-document file://trust-policy.json

aws iam put-role-policy --role-name dealio-github-deploy \
  --policy-name dealio-deploy --policy-document file://deploy-policy.json

# Note the ARN it prints -> this is AWS_DEPLOY_ROLE_ARN for BOTH repos:
#   arn:aws:iam::687159379528:role/dealio-github-deploy
```

---

## 2. EC2 instance prep (one-time)

1. **Install Docker + compose plugin + AWS CLI**

   Amazon Linux 2023:
   ```bash
   sudo dnf install -y docker
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER        # log out/in after this
   sudo dnf install -y docker-compose-plugin   # or the compose v2 binary
   # aws cli is preinstalled on AL2023
   ```
   Ubuntu: install `docker.io`, the `docker-compose-plugin`, and `awscli`.

2. **Let the instance pull from ECR and be managed by SSM** — attach an IAM
   **instance role** with `AmazonEC2ContainerRegistryReadOnly` **and**
   `AmazonSSMManagedInstanceCore` (here: role `dealio-ec2-ecr-role` via instance
   profile `dealio-ec2-ecr-profile`). AL2023 ships the SSM agent; it registers a
   few minutes after the role is attached. Verify with:
   ```bash
   aws ssm describe-instance-information --region us-east-1 \
     --filters "Key=InstanceIds,Values=<instance-id>"
   ```

3. **Create the runtime env file** at `/home/ec2-user/dealio-backend/.env` with
   the production values the app reads (`DATABASE_URL`, `JWT_SECRET`,
   `GOOGLE_CLIENT_ID`, `SMTP_*`, `WHATSAPP_*`, `ANTHROPIC_API_KEY`,
   `TWILIO_*`/`MSG91_*`, …). The deploy writes `docker-compose.yml` itself, so
   `.env` is the only file you must place. The box also needs Docker + the
   compose plugin installed.

4. **Security group** — with SSM you do **not** need inbound `22`. Only open
   inbound `8090` if you want to reach the app directly (or front it with an ALB).
   Outbound `443` must be open for ECR + SSM.

---

## 3. GitHub secrets — repo `VeeraPusuluri/dealio_backend`

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::687159379528:role/dealio-github-deploy` |
| `EC2_INSTANCE_ID` | target instance id, e.g. `i-030031e5bd44ee410` |

---

## 4. Notes / knobs

- ECR repo name defaults to `dealio-backend` (`ECR_REPOSITORY` in the workflow);
  it's auto-created on first run. Change it there if you prefer the existing repo.
- DB schema is synced with `prisma db push --skip-generate` on each deploy
  (project has no `prisma/migrations/`). Remove that step in `deploy.yml` if you
  want to manage schema changes manually.
- First deploy: push to `main`, or run **Actions → Deploy Backend (EC2) → Run workflow**.
