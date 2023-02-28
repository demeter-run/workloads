import { CustomResourceListResponse, ISpec, IStatus } from "@demeter-run/workloads-types";
import { getClients } from "@demeter-sdk/framework";

const DESIRED_INTERVAL = process.env.SCRAPE_INTERVAL_S ? Number(process.env.SCRAPE_INTERVAL_S) * 1000 : 30 * 1000;

export function getDiffInMinutes(start: number, end: number) {
  return Math.min(start - end, 2 * DESIRED_INTERVAL) / 1000 / 60;
}

export async function loadProjectInstances(apiGroup: string, apiVersion: string, plural: string ) {
  const { crd } = getClients();

  // @TODO try to filter by labelSelector - need to add label to CR
  const res = (await crd.listClusterCustomObject(
    apiGroup,
    apiVersion,
    plural,
  )) as CustomResourceListResponse<ISpec, IStatus>;

  return res.body.items;

}
