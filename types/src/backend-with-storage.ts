import { EnvVar, GenericWorkload, MetricsStatus, StorageClass, StorageItem, WorkloadConfig } from ".";

export type Spec = GenericWorkload & {
  image: string;
  replicas: number;
  envVars: EnvVar[];
  args: string;
  command: string;
  config: WorkloadConfig[];
  storage: {
    class: StorageClass,
    size: string,
  };
}

export type Status = MetricsStatus & {
  availableEnvVars: string[];
  storage: StorageItem[]
};