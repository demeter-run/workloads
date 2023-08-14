import type { Workspace } from '@demeter-run/workloads-types';
import type { V1EnvVar } from '@kubernetes/client-node';
import type { Extras } from '@demeter-run/workloads-types/dist/workspace';
import { CLUSTER_DNS_ZONE, CLUSTER_ALIAS_DNS_ZONE } from './constants';
import fs from 'fs';

const extrasSource = fs.readFileSync('./config/extras.json', 'utf8');
const extras = JSON.parse(extrasSource) as Extras[];

export function buildDnsZone(spec: Workspace.Spec) {
    if ('demeter.run/override-dns-zone' in spec.annotations) {
        return [spec.annotations['demeter.run/override-dns-zone']];
    }
    if (CLUSTER_DNS_ZONE === CLUSTER_ALIAS_DNS_ZONE) {
        return [CLUSTER_DNS_ZONE];
    }
    return [CLUSTER_DNS_ZONE, CLUSTER_ALIAS_DNS_ZONE];
}

const DEFAULT_MODS = ['ghcr.io/demeter-run/docker-mods-install-vsx:latest', 'ghcr.io/demeter-run/docker-mods-setup-repo:latest'];

export function buildWorkspaceExtras(spec: Workspace.Spec) {
    const vsCodeExtensions: string[] = [];
    const dockerMods: string[] = [...DEFAULT_MODS];
    const output: Record<string, string[]> = {
        vsCodeExtensions: [],
        dockerMods: [],
    };
    for (const extra of spec.extras) {
        const found = extras?.find(e => e.id === extra);
        if (found) {
            vsCodeExtensions.push(...found.vsCodeExtensions);
            dockerMods.push(...found.dockerMods);
        }
    }
    output.vsCodeExtensions = Array.from(new Set(vsCodeExtensions));
    output.dockerMods = Array.from(new Set(dockerMods));
    return output;
}

export function buildDefaultEnvVars(spec: Workspace.Spec): V1EnvVar[] {
    const extras = buildWorkspaceExtras(spec);
    return [
        { name: 'PUID', value: '1000' },
        { name: 'PGID', value: '1000' },
        { name: 'CONNECTION_TOKEN', value: spec.ide.authToken },
        { name: 'REPO_URL', value: spec.sourceCode.url },
        { name: 'UMASK', value: '000' },
        { name: 'GIT_AUTHOR_NAME', value: spec.sourceCode.authorName },
        { name: 'GIT_AUTHOR_EMAIL', value: spec.sourceCode.authorEmail },
        { name: 'GIT_BRANCH', value: spec.sourceCode.branch },
        { name: 'DOCKER_MODS', value: extras.dockerMods.join('|') },
        { name: 'NO_PROXY', value: '*' },
        { name: 'VSCODE_EXTENSION_IDS', value: extras.vsCodeExtensions.join('|') },
    ];
}

export function buildOpenUrl(name: string, spec: Workspace.Spec): string {
    const clusterDnsZone = buildDnsZone(spec);
    // if we have multiple DNS_ZONES, we want the alias to be used only as open url
    const dnsZone = clusterDnsZone.length > 1 ? CLUSTER_ALIAS_DNS_ZONE : clusterDnsZone[0];
    return `https://wks-${name}.${dnsZone}?tkn=${spec.ide.authToken}&folder=/config/workspace/repo`;
}

export function buildHealthUrl(name: string, namespace: string): string {
    // @TODO use internal DNS
    return `http://${name}.${namespace}.svc.cluster.local:3000/healthz`;
}

export const INITIAL_ENV_VAR_NAMES = [
    'PUID',
    'PGID',
    'CONNECTION_TOKEN',
    'REPO_URL',
    'UMASK',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_BRANCH',
    'DOCKER_MODS',
    'NO_PROXY',
    'VSCODE_EXTENSION_IDS',
];
