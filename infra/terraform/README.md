# Dealio backend — dev/prod infrastructure (Terraform)

Implements the branch-based dev/prod design on **EC2 + docker-compose** (the model
your `.github/workflows/deploy.yml` already targets), plus an **Application Load
Balancer** and an optional **ACM HTTPS** path.

```
push dev  → GitHub Env "dev"  → dev EC2  → dealio-dev RDS  (database: dealio_dev)
push main → GitHub Env "prod" → prod EC2 → database-1 RDS  (database: dealio_prod)
                         │
                    one ALB ──→ :80 (always) / :443 (when a domain is set)
```

## What Terraform creates vs. references

| Created (new) | Referenced (existing, not modified destructively) |
|---|---|
| Dev EC2 + IAM instance role (ECR + SSM) | Prod EC2 `i-030031e5bd44ee410` |
| ALB, target groups, listeners | Both RDS instances (endpoints only) |
| Security groups (ALB, dev app) | VPC `vpc-0783717fb3b7ea803`, subnets |
| Ingress rules on existing prod-EC2 & RDS SGs | (rule added, SG itself untouched) |
| ACM cert + HTTPS listener *(only if `domain_name` set)* | |
| Non-secret SSM params | |

> Note: `terraform` was not available in the authoring environment, so run
> `terraform init && terraform validate && terraform plan` and review the plan
> before applying — that's your validation step.

## 1. Apply

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # optional; defaults already work
terraform init
terraform plan                                  # REVIEW carefully — it's billable
terraform apply
```

Outputs include the URLs: `alb_http_url`, `dev_instance_public_ip`,
`prod_instance_public_ip`, `rds_prod_endpoint`, `rds_dev_endpoint`.

## 2. Seed runtime config into SSM

The deploy workflow renders each box's `.env` from SSM. Seed it from the env files:

```bash
cd infra/scripts
./seed-ssm.sh dev  ../../.env.dev
./seed-ssm.sh prod ../../.env.prod   # after filling <PROD_DB_PASSWORD>
```

## 3. Create the prod database (one-time)

`database-1` has no database yet. Create `dealio_prod` the same way dev was done:

```bash
# with .env.prod loaded (real password in place)
npm run migrate          # init-db creates the DB from DATABASE_URL, then prisma db push
```

## 4. Point CI/CD at the two boxes

In GitHub → Settings → Environments, set per-environment secrets:

| Secret | dev | prod |
|---|---|---|
| `EC2_HOST` | `dev_instance_public_ip` output | `prod_instance_public_ip` output |
| `EC2_USER` | `ubuntu` | `ubuntu` |
| `EC2_SSH_KEY` | PEM for `dealio_backend_pem` | same |
| `AWS_DEPLOY_ROLE_ARN` | OIDC deploy role | same |

Then: push to `dev` deploys dev, push to `main` deploys prod.

## 5. (Later) Turn on HTTPS — needs a domain

ACM/HTTPS is gated behind `domain_name` (blank today). Once you own a domain:

```hcl
# terraform.tfvars
domain_name     = "dealio.app"
prod_host       = "api.dealio.app"
dev_host        = "api-dev.dealio.app"
route53_zone_id = "Z0..."   # if the zone is in Route 53 → automatic cert validation
```

`terraform apply` then issues the cert and adds the `:443` listener. If the zone
isn't in Route 53, Terraform prints the validation CNAME — add it at your DNS
host, then apply again. Finally point `prod_host`/`dev_host` (CNAME) at the ALB.
Your WhatsApp webhook becomes `https://api.dealio.app/api/whatsapp/webhook`.

## Cost note
Adds: 1× t3.micro (dev) + 1× ALB (~$16/mo + LCU) on top of current resources.
`terraform destroy` removes everything created here (existing prod EC2 and both
RDS are referenced, not managed, so they are **not** destroyed).
