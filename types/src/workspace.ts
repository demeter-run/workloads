import { GenericWorkload, MetricsStatus, StorageClass, StorageItem, WorkloadStatus } from '.';

export type GitRepository = {
    url: string;
    authorName: string;
    authorEmail: string;
    branch: string;
};

export type Extras = {
    id: string;
    weight: number;
    name: string;
    description: string;
    vsCodeExtensions: string[];
    dockerMods: string[];
    tags: string[];
    logo: string;
};

export type Ide = {
    type: 'openvscode';
    image: string;
    authToken: string;
};

export type Spec = GenericWorkload & {
    ide: Ide;
    extras: string[];
    sourceCode: GitRepository;
    pinned: boolean;
    storage: {
        class: StorageClass;
        size: string;
    };
};

export type Status = MetricsStatus & {
    runningStatus: WorkloadStatus;
    availableEnvVars: string[];
    storage: StorageItem[];
    lastSeen: number;
    lastUpdated: number;
    openUrl: string;
    healthUrl: string;
};
