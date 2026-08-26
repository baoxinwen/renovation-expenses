import db, { getSetting } from '../db.js';

export default async function (app) {
  app.get('/settings', async () => {
    return { total_budget: getSetting('total_budget') };
  });

  app.put('/settings', async (req, reply) => {
    const n = Number(req.body?.total_budget);
    if (!Number.isFinite(n) || n < 0) {
      return reply.status(400).send({ message: '预算目标必须是非负数字' });
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES ('total_budget', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(n));
    return { ok: true };
  });
}
