// ── URLs you asked for ──────────────────────────────────────────────────────

output "alb_dns_name" {
  description = "ALB DNS name (the AWS-provided hostname)."
  value       = aws_lb.main.dns_name
}

output "alb_http_url" {
  description = "Plain-HTTP entry point (works today, no domain needed)."
  value       = "http://${aws_lb.main.dns_name}"
}

output "https_url" {
  description = "HTTPS URL — populated only once domain_name/prod_host are set."
  value       = var.prod_host == "" ? "(set domain_name + prod_host to enable HTTPS)" : "https://${var.prod_host}"
}

output "whatsapp_webhook_callback_url" {
  description = "Paste this into Meta once HTTPS is live."
  value       = var.prod_host == "" ? "(needs a domain)" : "https://${var.prod_host}/api/whatsapp/webhook"
}

// ── Compute ─────────────────────────────────────────────────────────────────
output "dev_instance_id" {
  value = aws_instance.dev.id
}

output "dev_instance_public_ip" {
  description = "Put this in the GitHub 'dev' Environment as EC2_HOST."
  value       = aws_instance.dev.public_ip
}

output "prod_instance_public_ip" {
  description = "Existing prod box (GitHub 'prod' Environment EC2_HOST)."
  value       = data.aws_instance.prod.public_ip
}

// ── Databases ───────────────────────────────────────────────────────────────
output "rds_prod_endpoint" {
  value = "${data.aws_db_instance.prod.endpoint}"
}

output "rds_dev_endpoint" {
  value = "${data.aws_db_instance.dev.endpoint}"
}
