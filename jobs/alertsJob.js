// src/jobs/alertsJob.js
const cron = require('node-cron');
const alertsService = require('../services/alertsService');


const schedule = process.env.ALERT_CRON || '*/5 * * * *'; // ← Cada 5 minutos

const start = () => {
  console.log('[alertsJob] Iniciando job de alertas con cron:', schedule);

  
  setTimeout(async () => {
    try {
      console.log('[alertsJob] Ejecutando primera verificación de alertas...');
      const created = await alertsService.checkAndCreateAlerts();
      console.log(`[alertsJob] Primera verificación - ${created.length} alertas creadas`);
    } catch (err) {
      console.error('[alertsJob] Error en primera verificación:', err);
    }
  }, 10000); // 10 segundos después del inicio

  // programar el job recurrente
  cron.schedule(schedule, async () => {
    console.log('[alertsJob] Ejecutando chequeo periódico de alertas...');
    try {
      const created = await alertsService.checkAndCreateAlerts();
      if (created.length > 0) {
        console.log(`[alertsJob] ${created.length} nuevas alertas creadas`);
      } else {
        console.log('[alertsJob] No hay nuevas alertas');
      }
    } catch (err) {
      console.error('[alertsJob] Error en checkAndCreateAlerts', err);
    }
  }, {
    timezone: process.env.ALERT_TIMEZONE || 'America/Argentina/Buenos_Aires'
  });
};

module.exports = { start };