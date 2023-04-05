terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.12.1"
    }
  }
}

variable "namespace" {
  description = "the namespace where the resources will be created"
}

locals {
  cm_name = "workloads"
}

resource "kubernetes_config_map" "workloads" {
  metadata {
    namespace = var.namespace
    name      = local.cm_name
  }

  data = {
    "compute.json" = "${file("${path.module}/compute.json")}"
    "extras.json"  = "${file("${path.module}/extras.json")}"
  }
}

output "cm_name" {
  value = local.cm_name
}
