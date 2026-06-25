// HTTPS — entirely gated on var.domain_name. With it blank, nothing here is
// created and the ALB is HTTP-only. Set domain_name + prod_host + dev_host
// (and ideally route53_zone_id) and re-apply to issue the cert and add :443.

resource "aws_acm_certificate" "main" {
  count                     = var.domain_name == "" ? 0 : 1
  domain_name               = var.prod_host
  subject_alternative_names = [var.dev_host]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = var.project }
}

// Automatic DNS validation when the zone lives in Route 53.
// (If route53_zone_id is blank, Terraform prints the CNAME to add manually.)
resource "aws_route53_record" "cert_validation" {
  for_each = (var.domain_name == "" || var.route53_zone_id == "") ? {} : {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  count                   = (var.domain_name == "" || var.route53_zone_id == "") ? 0 : 1
  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

// ── HTTPS listener + host-based routing ─────────────────────────────────────
resource "aws_lb_listener" "https" {
  count             = var.domain_name == "" ? 0 : 1
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = (
    var.route53_zone_id == ""
    ? aws_acm_certificate.main[0].arn
    : aws_acm_certificate_validation.main[0].certificate_arn
  )

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.prod.arn
  }
}

resource "aws_lb_listener_rule" "dev_https" {
  count        = var.domain_name == "" ? 0 : 1
  listener_arn = aws_lb_listener.https[0].arn
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
