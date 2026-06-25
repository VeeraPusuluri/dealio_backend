// Existing resources we reference but do NOT manage/recreate.

data "aws_vpc" "main" {
  id = var.vpc_id
}

// Public subnets in the VPC — used to place the ALB (needs >= 2 AZs).
data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
  filter {
    name   = "map-public-ip-on-launch"
    values = ["true"]
  }
}

// The already-running prod EC2 (for its IP + as an ALB target).
data "aws_instance" "prod" {
  instance_id = var.prod_instance_id
}

// Both existing RDS instances (for endpoints in outputs).
data "aws_db_instance" "prod" {
  db_instance_identifier = var.rds_prod_identifier
}

data "aws_db_instance" "dev" {
  db_instance_identifier = var.rds_dev_identifier
}
