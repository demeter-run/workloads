import { METRIC_NAME } from '@demeter-sdk/framework';
import client from 'prom-client';
// Initialize the prometheus registry
export const register = new client.Registry();

const LABEL_NAMES = ['project', 'service', 'service_type', 'tenancy'];

export const dcuCounter = new client.Counter({
  name: METRIC_NAME.dcu,
  help: METRIC_NAME.dcu,
  labelNames: LABEL_NAMES
});

export const statusGauge = new client.Gauge({
  name: METRIC_NAME.status,
  help: METRIC_NAME.status,
  labelNames: LABEL_NAMES
});

export const ageGauge = new client.Gauge({
  name: METRIC_NAME.age,
  help: METRIC_NAME.age,
  labelNames: LABEL_NAMES
});

export const restartCount = new client.Counter({
  name: METRIC_NAME.restarts,
  help: METRIC_NAME.restarts,
  labelNames: LABEL_NAMES
});

register.registerMetric(dcuCounter);
register.registerMetric(statusGauge);
register.registerMetric(ageGauge);
register.registerMetric(restartCount);