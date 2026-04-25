import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'zapmass_' });

const sessionCommandsTotal = new client.Counter({
  name: 'zapmass_session_commands_total',
  help: 'Total de comandos publicados no barramento de sessao',
  labelNames: ['type']
});

const sessionCommandResultsTotal = new client.Counter({
  name: 'zapmass_session_command_results_total',
  help: 'Resultado de processamento de comando por worker',
  labelNames: ['status']
});

const connectedSessionsGauge = new client.Gauge({
  name: 'zapmass_connected_sessions',
  help: 'Quantidade de sessoes conectadas atualmente'
});

register.registerMetric(sessionCommandsTotal);
register.registerMetric(sessionCommandResultsTotal);
register.registerMetric(connectedSessionsGauge);

export const markSessionCommandPublished = (type: string) => {
  sessionCommandsTotal.labels(type).inc();
};

export const markSessionCommandResult = (status: 'ok' | 'error') => {
  sessionCommandResultsTotal.labels(status).inc();
};

export const setConnectedSessionsGauge = (value: number) => {
  connectedSessionsGauge.set(Math.max(0, Number(value) || 0));
};

export const metricsContentType = () => register.contentType;

export const collectMetrics = async (): Promise<string> => register.metrics();
