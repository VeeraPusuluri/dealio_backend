// The deploy workflow renders each box's runtime .env from SSM params under
// /dealio/<env>/backend/*. Only NON-SECRET keys are managed here; secrets
// (DATABASE_URL, JWT_SECRET, WHATSAPP_*, REDIS_URL, etc.) are seeded out of band
// so they never land in Terraform state — see scripts/seed-ssm.sh in the README.
//
// ignore_changes lets you tweak a value in the console/CLI without TF drift.

locals {
  nonsecret_params = {
    "/dealio/dev/backend/NODE_ENV"  = "development"
    "/dealio/dev/backend/PORT"      = "8090"
    "/dealio/prod/backend/NODE_ENV" = "production"
    "/dealio/prod/backend/PORT"     = "8090"
  }
}

resource "aws_ssm_parameter" "nonsecret" {
  for_each = local.nonsecret_params

  name  = each.key
  type  = "String"
  value = each.value

  lifecycle {
    ignore_changes = [value]
  }

  tags = { Project = var.project }
}
