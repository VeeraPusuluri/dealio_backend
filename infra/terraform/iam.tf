// Instance role for the dev EC2: pull images from ECR and read the env-scoped
// SSM parameters the deploy workflow renders into .env. (Attach the same policy
// to the prod box's role too — see README.)

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2_dev" {
  name               = "${var.project}-dev-ec2"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

// ECR read-only (pull images)
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2_dev.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

// SSM parameter read for /dealio/dev/backend/* plus decrypt of SecureString.
data "aws_iam_policy_document" "ssm_read" {
  statement {
    sid     = "ReadBackendParams"
    actions = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:*:parameter/dealio/dev/backend/*",
    ]
  }
  statement {
    sid       = "DecryptSecureStrings"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ssm_read" {
  name   = "${var.project}-dev-ssm-read"
  role   = aws_iam_role.ec2_dev.id
  policy = data.aws_iam_policy_document.ssm_read.json
}

resource "aws_iam_instance_profile" "ec2_dev" {
  name = "${var.project}-dev-ec2"
  role = aws_iam_role.ec2_dev.name
}
