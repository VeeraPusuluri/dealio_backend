// New dev backend box. Mirrors the prod image; the deploy workflow SSHes in,
// renders .env from SSM, and runs docker compose. user_data just makes sure
// Docker + the compose plugin + AWS CLI are present on first boot.

locals {
  user_data = <<-BASH
    #!/bin/bash
    set -euxo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg unzip

    # Docker Engine + compose plugin
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable --now docker
    usermod -aG docker ubuntu || true

    # AWS CLI v2 (for ECR login + SSM param fetch by the deploy script)
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscli.zip
    unzip -q /tmp/awscli.zip -d /tmp
    /tmp/aws/install || /tmp/aws/install --update

    mkdir -p /home/ubuntu/dealio-backend
    chown -R ubuntu:ubuntu /home/ubuntu/dealio-backend
  BASH
}

resource "aws_instance" "dev" {
  ami                    = var.dev_ami
  instance_type          = var.instance_type
  subnet_id              = var.dev_subnet_id
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.app_dev.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_dev.name
  user_data              = local.user_data

  tags = {
    Name = "${var.project}-dev"
    Env  = "dev"
  }
}
