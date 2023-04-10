import { EnvVar, GenericWorkload, MetricsStatus } from ".";

export type Spec = GenericWorkload & {
  image: string;
  replicas: number;
  envVars: EnvVar[];
  args: string;
}

export type Status = MetricsStatus & {
  availableEnvVars: string[];
};