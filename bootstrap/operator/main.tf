variable "namespace" {}

variable "image_tag" {}

variable "cluster_name" {}

variable "scrape_interval" {
  description = "the inverval for polling workspaces data (in seconds)"
  default     = "30"
}
variable "per_min_dcus" {
  default = {
    "compute" : {
      "nano" : 154,
      "small" : 308,
      "medium": 729,
      "large": 1458,
    },
    "storage" : {
      "fast" : 16,
      "gp3" : 8
    }
  }
}

variable "dns_zone" {
  description = "publicly-available dns zone of the cluster"
  default     = "demeter.run"
}

resource "kubernetes_deployment_v1" "operator" {
  wait_for_rollout = false

  metadata {
    namespace = var.namespace
    name      = "operator"
    labels = {
      role = "operator"
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        role = "operator"
      }
    }

    template {
      metadata {
        labels = {
          role = "operator"
        }
      }

      spec {
        container {
          image   = "ghcr.io/demeter-run/workloads-operator:${var.image_tag}"
          name    = "main"
          command = ["npm", "run", "start"]

          env {
            name  = "PORT"
            value = 9946
          }

          env {
            name  = "K8S_IN_CLUSTER"
            value = "true"
          }

          env {
            name  = "SCRAPE_INTERVAL_S"
            value = var.scrape_interval
          }

          env {
            name  = "NANO_COMPUTE_PER_MIN_DCUS"
            value = var.per_min_dcus.compute.nano
          }

          env {
            name  = "SMALL_COMPUTE_PER_MIN_DCUS"
            value = var.per_min_dcus.compute.small
          }

          env {
            name  = "MEDIUM_COMPUTE_PER_MIN_DCUS"
            value = var.per_min_dcus.compute.medium
          }

          env {
            name  = "LARGE_COMPUTE_PER_MIN_DCUS"
            value = var.per_min_dcus.compute.large
          }

          env {
            name  = "GP3_STORAGE_PER_GB_PER_MIN_DCUS"
            value = var.per_min_dcus.storage.gp3
          }

          env {
            name  = "FAST_STORAGE_PER_GB_PER_MIN_DCUS"
            value = var.per_min_dcus.storage.fast
          }

          resources {
            limits = {
              memory = "250Mi"
            }
            requests = {
              cpu    = "50m"
              memory = "250Mi"
            }
          }

          port {
            name           = "metrics"
            container_port = 9946
            protocol       = "TCP"
          }
        }
      }
    }
  }
}

