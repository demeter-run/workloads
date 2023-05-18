import { EnvVar, GenericWorkload, MetricsStatus, WorkloadConfig } from '.';

export type Spec = GenericWorkload & {
    image: string;
    replicas: number;
    envVars: EnvVar[];
    args: string;
    command: string;
    config: WorkloadConfig[];
};

export type Status = MetricsStatus & {
    availableEnvVars: string[];
};
