variable "namespace" {}

variable "image_tag" {}

variable "cluster_name" {}

variable "scrape_interval" {
  description = "the inverval for polling workspaces data (in seconds)"
  default     = "30"
}
variable "per_min_dcus" {
  default = {
    "shared" : {
      "mainnet" : 22,
      "default" : 8,
    },
    "custom" : {
      "compute" : {
        "mainnet" : 1458,
        "default" : 486,
      },
      "storage" : {
        "mainnet" : 83
        "default" : 28
      }
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
            name  = "DNS_ZONE"
            value = var.dns_zone
          }

          env {
            name  = "CLUSTER_NAME"
            value = var.cluster_name
          }

          env {
            name  = "SCRAPE_INTERVAL_S"
            value = var.scrape_interval
          }

          env {
            name  = "CUSTOM_COMPUTE_PER_MIN_DEFAULT_DCUS"
            value = var.per_min_dcus["custom"]["compute"]["default"]
          }

          env {
            name  = "CUSTOM_COMPUTE_PER_MIN_MAINNET_DCUS"
            value = var.per_min_dcus["custom"]["compute"]["mainnet"]
          }

          env {
            name  = "CUSTOM_STORAGE_PER_MIN_DEFAULT_DCUS"
            value = var.per_min_dcus["custom"]["storage"]["default"]
          }

          env {
            name  = "CUSTOM_STORAGE_PER_MIN_MAINNET_DCUS"
            value = var.per_min_dcus["custom"]["storage"]["mainnet"]
          }

          env {
            name  = "SHARED_PER_MIN_DEFAULT_DCUS"
            value = var.per_min_dcus["shared"]["default"]
          }

          env {
            name  = "SHARED_PER_MIN_MAINNET_DCUS"
            value = var.per_min_dcus["shared"]["mainnet"]
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

