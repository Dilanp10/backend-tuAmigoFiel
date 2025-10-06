// src/jobs/alertsJob.js
const cron = require('node-cron');
const alertsService = require('../services/alertsService');

const schedule = process.env.ALERT_CRON || '0 8 * * *'; // por defecto: todos los días 08:00

const start = () => {
  console.log('[alertsJob] Iniciando job de alertas con cron:', schedule);

  // correr al arrancar una primera vez (opcional)
  alertsService.checkAndCreateAlerts().then(created => {
    if (created && created.length) {
      console.log(`[alertsJob] Alertas creadas al inicio: ${created.length}`);
    } else {
      console.log('[alertsJob] No se crearon alertas en el inicio.');
    }
  }).catch(err => console.error('[alertsJob] Error inicial', err));

  // programar el job
  cron.schedule(schedule, async () => {
    console.log('[alertsJob] Ejecutando chequeo de alertas...');
    try {
      const created = await alertsService.checkAndCreateAlerts();
      console.log('[alertsJob] checkAndCreateAlerts finalizado — nuevas alertas:', (created && created.length) || 0);
    } catch (err) {
      console.error('[alertsJob] Error en checkAndCreateAlerts', err);
    }
  }, {
    timezone: process.env.ALERT_TIMEZONE || 'America/Argentina/Buenos_Aires'
  });
};

module.exports = { start };