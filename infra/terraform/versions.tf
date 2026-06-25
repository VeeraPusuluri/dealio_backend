terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Optional but recommended: keep state in S3 so it's shared and not on one laptop.
  # Create the bucket first, then uncomment and `terraform init -migrate-state`.
  # backend "s3" {
  #   bucket = "dealio-terraform-state"
  #   key    = "backend/infra.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
}
