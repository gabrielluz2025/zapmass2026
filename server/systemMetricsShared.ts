import os from 'os';

let lastCpuInfo = os.cpus();

const getCpuUsage = (): number => {
  const current = os.cpus();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < current.length; i++) {
    const prev = lastCpuInfo[i];
    const times = current[i].times;
    for (const t of Object.keys(times) as (keyof typeof times)[]) {
      const diff = times[t] - (prev?.times[t] ?? 0);
      total += diff;
      if (t === 'idle') idle += diff;
    }
  }
  lastCpuInfo = current;
  return total > 0 ? Math.max(0, Math.min(100, Math.round(100 - (100 * idle) / total))) : 0;
};

export const getSystemMetrics = () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ram = Math.round((usedMem / totalMem) * 100);
  const secs = Math.floor(process.uptime());
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const uptime = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const toGb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;
  return {
    cpu: getCpuUsage(),
    ram,
    uptime,
    ramTotalGb: toGb(totalMem),
    ramFreeGb: toGb(freeMem),
    ramUsedGb: toGb(usedMem),
    platform: process.platform
  };
};
