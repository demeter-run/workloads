import { ISpec, IStatus, ResourceRequest } from ".";

export interface Spec extends ISpec {
  image: string;
  replicas: number;
  enabled: boolean;
  args: string;
  envVars: Record<string, string>[];
  annotations: Record<string, string>;
  resources: {
    requests: ResourceRequest,
    limits: ResourceRequest
  }
  storage: {
    class: string,
    size: string,
  };
  tenancy: 'cluster' | 'project' | 'proxy'
};

export interface Status extends IStatus {
  // privateDns: string;
  runningStatus: 'paused' | 'running' | 'provisioning' | 'syncing';
  availableReplicas: number;
  observedGeneration?: number;
};