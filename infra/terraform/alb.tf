// One internet-facing ALB fronting both environments.
//   • HTTP :80 always on (default → prod; dev reachable via host rule once a
//     domain exists, otherwise via the dev box's own public IP:8090).
//   • HTTPS :443 + host-based routing light up when domain_name is set (acm.tf).

resource "aws_lb" "main" {
  name               = var.project
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.public.ids

  tags = { Name = var.project }
}

// ── Target groups (app listens on 8090) ─────────────────────────────────────
resource "aws_lb_target_group" "prod" {
  name        = "${var.project}-prod"
  port        = 8090
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Env = "prod" }
}

resource "aws_lb_target_group" "dev" {
  name        = "${var.project}-dev"
  port        = 8090
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Env = "dev" }
}

// ── Attach instances ────────────────────────────────────────────────────────
resource "aws_lb_target_group_attachment" "prod" {
  target_group_arn = aws_lb_target_group.prod.arn
  target_id        = var.prod_instance_id
  port             = 8090
}

resource "aws_lb_target_group_attachment" "dev" {
  target_group_arn = aws_lb_target_group.dev.arn
  target_id        = aws_instance.dev.id
  port             = 8090
}

// ── HTTP listener ───────────────────────────────────────────────────────────
// When a domain is set, :80 redirects to HTTPS. Until then it forwards to prod.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.domain_name == "" ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.prod.arn
    }
  }

  dynamic "default_action" {
    for_each = var.domain_name == "" ? [] : [1]
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

// Host-based rule so the dev hostname hits dev over HTTP (only with a domain).
resource "aws_lb_listener_rule" "dev_http" {
  count        = var.domain_name == "" ? 0 : 1
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dev.arn
  }

  condition {
    host_header {
      values = [var.dev_host]
    }
  }
}
