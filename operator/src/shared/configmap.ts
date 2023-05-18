import { Backend, BackendWithStorage, CustomResource, Frontend, GenericWorkload, MetricsStatus } from '@demeter-run/workloads-types';
import { CoreV1Api, V1ConfigMap } from '@kubernetes/client-node';

const SUFFIX = 'config';

export function buildConfigMapName(name: string) {
    return `${name}-${SUFFIX}`;
}

type Spec = Backend.Spec | Frontend.Spec | BackendWithStorage.Spec;

function buildConfigMapData(spec: Spec) {
    const output: Record<string, string> = {};
    if (spec.config) {
        spec.config.forEach(config => {
            output[config.name] = config.config;
        });
    }
    return output;
}

export function configmap(name: string, spec: Spec, owner: CustomResource<GenericWorkload, MetricsStatus>): V1ConfigMap {
    return {
        metadata: {
            name: buildConfigMapName(name),
            ownerReferences: [
                {
                    apiVersion: owner.apiVersion!,
                    kind: owner.kind!,
                    uid: owner.metadata!.uid!,
                    name,
                },
            ],
        },
        data: buildConfigMapData(spec),
    };
}

export async function checkConfigMapExistsOrCreate(core: CoreV1Api, ns: string, name: string, spec: Spec, owner: CustomResource<GenericWorkload, MetricsStatus>) {
    const configMap = configmap(name, spec, owner);
    const cmName = buildConfigMapName(name);
    try {
        const cm = await core.readNamespacedConfigMap(cmName, ns);
        cm.body.data = buildConfigMapData(spec);
        return core.replaceNamespacedConfigMap(cmName, ns, cm.body);
    } catch (err: any) {
        console.log(err.body);
        return core.createNamespacedConfigMap(ns, configMap);
    }
}
