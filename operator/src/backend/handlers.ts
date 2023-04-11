import { PatchUtils, V1Pod, V1Container, V1EnvVar, V1Volume, V1VolumeMount, V1Deployment } from '@kubernetes/client-node';
import { getClients, slugToNamespace, readProjectUnsecure, Network, namespaceToSlug } from '@demeter-sdk/framework';
import { API_VERSION, API_GROUP, PLURAL } from './constants';
import { CustomResource, CustomResourceResponse, Backend, Pod } from '@demeter-run/workloads-types';
import { buildEnvVars, getDependenciesForNetwork, isCardanoNodeEnabled } from '../shared/dependencies';
import * as nodes from '@demeter-features/cardano-nodes';
import { getComputeDCUPerMin, getDeploymentStatus, getNetworkFromAnnotations, getResourcesFromComputeClass, loadPods } from '../shared';

export async function handleResource(ns: string, name: string, spec: Backend.Spec, owner: CustomResource<Backend.Spec, Backend.Status>): Promise<void> {
    const { apps } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const envVars = await buildEnvVars(deps, network);
    const usesCardanoNode = isCardanoNodeEnabled(deps);
    const volumesList = volumes(usesCardanoNode);
    const containerList = containers(spec, envVars, usesCardanoNode);
    try {
        await apps.readNamespacedDeployment(name, ns);
        //@TODO sync 
        await updateResource(ns, name, spec, containerList, volumesList, owner);
    } catch (err: any) {
        console.log(err?.body)
        await apps.createNamespacedDeployment(ns, deployment(name, spec, owner, containerList, volumesList));
    }
}

export async function updateResource(ns: string, name: string, spec: Backend.Spec, containers: V1Container[], volumes: V1Volume[] | undefined, owner: CustomResource<Backend.Spec, Backend.Status>): Promise<void> {
    const { apps, core } = getClients();
    // containers should be replaced because of we might need to remove socat and replace ENV VARS
    const containersList = [
        {
            op: 'replace',
            path: '/spec/template/spec/containers',
            value: containers
        }
    ];

    await apps.patchNamespacedDeployment(name, ns, containersList, undefined, undefined, undefined, undefined, undefined, { headers: { 'content-type': PatchUtils.PATCH_FORMAT_JSON_PATCH } });

    // patch resource
    const patchBody = {
        metadata: {
            labels: {
                // needed for migration
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
                ...spec.annotations,
            },
            ownerReferences: [
                {
                    apiVersion: owner.apiVersion!,
                    kind: owner.kind!,
                    uid: owner.metadata!.uid!,
                    name,
                },
            ],
        },
        spec: {
            replicas: spec.enabled ? spec.replicas : 0,
            template: {
                metadata: {
                    labels: {
                        'demeter.run/version': owner.apiVersion!.split('/')[1],
                        'demeter.run/kind': owner.kind!,
                    },
                },
                spec: {
                    restartPolicy: 'Always',
                    volumes
                },
            },
        },
    };

    let options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_STRATEGIC_MERGE_PATCH } };
    await apps.patchNamespacedDeployment(name, ns, patchBody, undefined, undefined, undefined, undefined, undefined, options);



}

export async function updateResourceStatus(ns: string, name: string, resource: V1Deployment): Promise<void> {
    const { crd, apps } = getClients();

    const mainContainer = resource.spec?.template.spec?.containers.find(i => i.name === 'main');

    const availableEnvVars = mainContainer?.env?.map(i => i.name);

    const runningStatus = getDeploymentStatus(resource.status!, resource.spec?.replicas!);

    let computeDCUPerMin = 0;
    if (runningStatus === 'running') {
        const owner = await loadResource(ns, name);
        computeDCUPerMin = getComputeDCUPerMin(owner.spec.computeClass, resource.spec?.replicas!)
    }
    let storageDCUPerMin = 0;

    const deploymentRevision = resource.metadata?.annotations?.['deployment.kubernetes.io/revision'];
    const rs = await apps.listNamespacedReplicaSet(ns, undefined, undefined, undefined, undefined, `demeter.run/instance=${name}`);
    const rsRevision = rs.body.items.find(i => i.metadata?.annotations?.['deployment.kubernetes.io/revision'] === deploymentRevision);
    
    const patch = {
        status: {
            availableReplicas: rsRevision?.status?.availableReplicas || 0,
            runningStatus,
            computeDCUPerMin,
            storageDCUPerMin,
        },
    };

    const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, name, patch, undefined, undefined, undefined, options);

    // env vars should not be merged.
    const envPatch = [{
        op: 'replace',
        path: '/status/availableEnvVars',
        value: availableEnvVars,
    }];

    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, name, envPatch, undefined, undefined, undefined, { headers: { 'content-type': PatchUtils.PATCH_FORMAT_JSON_PATCH } });

}


export async function podUpdated(ns: string, name: string, resource: V1Pod): Promise<void> {
    const { crd, apps } = await getClients();
    const main = resource.status?.containerStatuses?.find(item => item.name === 'main');
    if (main && !main.ready && main.restartCount > 1) {
        const patch = {
            status: {
                runningStatus: 'error',
            },
        };
        const owner = resource.metadata?.ownerReferences![0]!;
        const ownerDataRes = await apps.readNamespacedReplicaSet(owner.name, ns);
        const ownerData = ownerDataRes.body.metadata?.ownerReferences![0]!
        const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
        await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, ownerData.name, patch, undefined, undefined, undefined, options);
    }
}

export async function listResourcePods(projectSlug: string, instanceId: string) {
    const { core } = getClients();
    const ns = slugToNamespace(projectSlug);

    try {
        const pods = await core.listNamespacedPod(ns, undefined, undefined, undefined, undefined, `demeter.run/instance=${instanceId}`);
        return pods.body.items.map(podToModel);
    } catch (err) {
        return null;
    }
}


function buildSocatArgs(spec: Backend.Spec) {
    const nodePrivateDNS = nodes.defaultNodePrivateDns(getNetworkFromAnnotations(spec.annotations));
    return ['UNIX-LISTEN:/ipc/node.socket,reuseaddr,fork,unlink-early', `TCP-CONNECT:${nodePrivateDNS}:${nodes.N2C_PORT}`]
}

function deployment(name: string, spec: Backend.Spec, owner: CustomResource<Backend.Spec, Backend.Status>, containers: V1Container[], volumes: V1Volume[] | undefined): V1Deployment {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
                ...spec.annotations,
            },
            ownerReferences: [
                {
                    apiVersion: owner.apiVersion!,
                    kind: owner.kind!,
                    uid: owner.metadata!.uid!,
                    name,
                },
            ],
        },
        spec: {
            replicas: spec.enabled ? spec.replicas : 0,
            revisionHistoryLimit: 5,
            selector: {
                matchLabels: {
                    'demeter.run/instance': name,
                },
            },
            template: {
                metadata: {
                    name,
                    labels: {
                        'demeter.run/instance': name,
                        'demeter.run/version': owner.apiVersion!.split('/')[1],
                        'demeter.run/kind': owner.kind!,
                    },
                },
                spec: {
                    tolerations: [
                        {
                            key: 'demeter.run/workload',
                            operator: 'Equal',
                            value: 'ephemeral',
                            effect: 'NoSchedule',
                        },
                    ],
                    securityContext: {
                        fsGroup: 1000,
                    },
                    containers,
                    restartPolicy: 'Always',
                    volumes
                },
            },
        },
    };
}

function podToModel(pod: V1Pod): Pod {
    const name = pod.metadata?.name!;
    return {
        name,
        uid: pod.metadata?.uid!,
        status: pod.status?.phase!,
        containers: pod.status?.containerStatuses!,
        startTime: String(pod.status?.startTime!),
    };
}

function containers(spec: Backend.Spec, envVars: V1EnvVar[], usesCardanoNode: boolean): V1Container[] {
    const args = spec.args ? spec.args.split(' ') : [];
    const volumeMounts: V1VolumeMount[] = []

    if (usesCardanoNode) {
        volumeMounts.push({
            name: 'ipc',
            mountPath: '/ipc',
        })
    }

    const containers: V1Container[] = [
        {
            name: 'main',
            resources: getResourcesFromComputeClass(spec.computeClass),
            image: spec.image,
            imagePullPolicy: 'IfNotPresent',
            volumeMounts,
            args,
            env: [...envVars, ...spec.envVars]
        }
    ];

    if (usesCardanoNode) {
        containers.push(
            {
                name: 'socat',
                image: 'alpine/socat',
                securityContext: {
                    runAsUser: 1000,
                    runAsGroup: 1000,
                },
                args: [...buildSocatArgs(spec)],
                volumeMounts: [
                    {
                        name: 'ipc',
                        mountPath: '/ipc',
                    },
                ],
            }
        )
    }

    return containers;
}

function volumes(usesCardanoNode: boolean): V1Volume[] | undefined {
    if (usesCardanoNode) {
        return [
            {
                name: 'ipc',
                emptyDir: {},
            },
        ]
    }
}

async function loadResource(ns: string, name: string) {
    const { crd } = getClients();
    const res = await crd.getNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name) as CustomResourceResponse<Backend.Spec, Backend.Status>;
    return res.body;
}