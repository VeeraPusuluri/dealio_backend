# Deployment setup — Backend (EC2 via ECR)

CI builds the Docker image, pushes it to **Amazon ECR**, then SSHes into the
**EC2** instance and runs `docker compose up -d`. Auth to AWS uses **GitHub
OIDC** (no long-lived keys). Triggers: push to `main`, or manual run.

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

`deploy-policy.json` (ECR push for backend + Amplify trigger for frontend):

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
    { "Sid": "AmplifyDeploy", "Effect": "Allow", "Action": ["amplify:StartJob", "amplify:GetJob"], "Resource": "*" }
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

2. **Let the instance pull from ECR** — attach an IAM **instance role** with the
   managed policy `AmazonEC2ContainerRegistryReadOnly` to the EC2 instance.

3. **Create the app dir + runtime env file**
   ```bash
   mkdir -p ~/dealio-backend/uploads
   cd ~/dealio-backend
   # create .env with the production values the app reads at runtime:
   #   DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID, SMTP_*, WHATSAPP_*,
   #   ANTHROPIC_API_KEY, TWILIO_*/MSG91_*, etc.
   vi .env
   ```
   The workflow copies `docker-compose.yml` here on each deploy.

4. **Security group** — allow inbound `8090` (and whatever your reverse proxy /
   load balancer needs). Outbound 443 must be open for ECR pulls.

---

## 3. GitHub secrets — repo `VeeraPusuluri/dealio_backend`

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::687159379528:role/dealio-github-deploy` |
| `EC2_HOST` | EC2 public IP or DNS |
| `EC2_USER` | `ec2-user` (Amazon Linux) or `ubuntu` |
| `EC2_SSH_KEY` | the **private** key (full PEM contents) for the instance key pair |
| `EC2_SSH_PORT` | *(optional)* defaults to `22` |

---

## 4. Notes / knobs

- ECR repo name defaults to `dealio-backend` (`ECR_REPOSITORY` in the workflow);
  it's auto-created on first run. Change it there if you prefer the existing repo.
- DB schema is synced with `prisma db push --skip-generate` on each deploy
  (project has no `prisma/migrations/`). Remove that step in `deploy.yml` if you
  want to manage schema changes manually.
- First deploy: push to `main`, or run **Actions → Deploy Backend (EC2) → Run workflow**.
