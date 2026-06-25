// ── ALB security group: public HTTP/HTTPS in ────────────────────────────────
resource "aws_security_group" "alb" {
  name        = "${var.project}-alb"
  description = "Public ingress to the ALB (80/443)"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-alb" }
}

// ── Dev app security group: app port from ALB, SSH from admin ────────────────
resource "aws_security_group" "app_dev" {
  name        = "${var.project}-app-dev"
  description = "Dev backend: app port from ALB, SSH from admin"
  vpc_id      = var.vpc_id

  ingress {
    description     = "App port from ALB"
    from_port       = 8090
    to_port         = 8090
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_ssh_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-app-dev" }
}

// ── Allow the ALB to reach the EXISTING prod box on the app port ─────────────
// (rule added to prod's existing SG; the SG itself stays unmanaged by TF)
resource "aws_vpc_security_group_ingress_rule" "prod_app_from_alb" {
  security_group_id            = var.prod_instance_sg_id
  description                  = "App port from ALB"
  from_port                    = 8090
  to_port                      = 8090
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

// ── Let each app box reach its own RDS on 5432 (rules on existing RDS SGs) ────
resource "aws_vpc_security_group_ingress_rule" "rds_dev_from_app_dev" {
  security_group_id            = var.rds_dev_sg_id
  description                  = "Postgres from dev backend"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.app_dev.id
}

# NOTE: prod backend -> prod RDS (5432) already exists on the prod RDS SG
# (created outside Terraform), so it's not managed here — adding it errors with
# InvalidPermission.Duplicate. The access is already in place; nothing to do.
