import { EnvVar, GenericWorkload, MetricsStatus, StorageClass, StorageItem } from ".";

export type Spec = GenericWorkload & {
  image: string;
  replicas: number;
  envVars: EnvVar[];
  args: string;
  storage: {
    class: StorageClass,
    size: string,
  };
}

export type Status = MetricsStatus & {
  availableEnvVars: string[];
  storage: StorageItem[]
};