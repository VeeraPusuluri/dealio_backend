// ─────────────────────────────────────────────────────────────────────────────
// All values default to the EXISTING resources discovered in account
// 687159379528 / us-east-1, so `terraform plan` works out of the box.
// Override any of them in terraform.tfvars.
// ─────────────────────────────────────────────────────────────────────────────

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "dealio-backend"
}

// ── Existing network ─────────────────────────────────────────────────────────
variable "vpc_id" {
  type    = string
  default = "vpc-0783717fb3b7ea803"
}

// ── Existing PROD compute (already running; referenced, not recreated) ────────
variable "prod_instance_id" {
  description = "The existing EC2 box that serves prod."
  type        = string
  default     = "i-030031e5bd44ee410"
}

variable "prod_instance_sg_id" {
  description = "Security group attached to the prod EC2 that the ALB and app use. Confirm which of the box's SGs allows app traffic (port 8090)."
  type        = string
  default     = "sg-003281e909e7ff7d4"
}

// ── New DEV compute ──────────────────────────────────────────────────────────
variable "dev_ami" {
  description = "AMI for the new dev box. Defaults to the same image prod runs."
  type        = string
  default     = "ami-0b6d9d3d33ba97d99"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "dev_subnet_id" {
  description = "Public subnet for the dev EC2."
  type        = string
  default     = "subnet-0f64c94609f90f140"
}

variable "key_name" {
  description = "EC2 key pair for SSH (the deploy workflow SSHes in)."
  type        = string
  default     = "dealio_backend_pem"
}

variable "admin_ssh_cidr" {
  description = "CIDR allowed to SSH (port 22). DEFAULT IS OPEN — restrict to your IP/32."
  type        = string
  default     = "0.0.0.0/0"
}

// ── Existing RDS security groups (rules added so the app boxes can reach 5432) ─
variable "rds_prod_sg_id" {
  type    = string
  default = "sg-00830fffbaad94460"
}

variable "rds_dev_sg_id" {
  type    = string
  default = "sg-01ee01720308b029d"
}

variable "rds_prod_identifier" {
  type    = string
  default = "database-1"
}

variable "rds_dev_identifier" {
  type    = string
  default = "dealio-dev"
}

// ── HTTPS / domain (OPTIONAL — leave blank until you own a domain) ────────────
// When domain_name is "", no ACM cert / HTTPS listener is created and the ALB
// serves plain HTTP on :80. Set these once you have a domain to light up HTTPS.
variable "domain_name" {
  description = "Apex domain you own, e.g. dealio.app. Empty = HTTPS disabled."
  type        = string
  default     = ""
}

variable "prod_host" {
  description = "Hostname routed to prod, e.g. api.dealio.app."
  type        = string
  default     = ""
}

variable "dev_host" {
  description = "Hostname routed to dev, e.g. api-dev.dealio.app."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for the domain (enables automatic ACM DNS validation). Empty = you add validation records manually."
  type        = string
  default     = ""
}
