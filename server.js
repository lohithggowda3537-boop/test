require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { connectToDatabase } = require('./db');

const { PORT = 3000 } = process.env;
const uploadDirectory = path.join(__dirname, 'uploads');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (file.mimetype !== 'image/jpeg') {
      callback(new Error('Photo must be a JPEG image.'));
      return;
    }
    callback(null, true);
  },
});
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function formatReport(report) {
  return {
    id: report.publicId,
    area: report.area,
    road: report.road,
    severity: report.severity,
    details: report.details || '',
    status: report.status,
    date: report.createdAt.toLocaleString(),
    photo: report.photoPath
      ? `/uploads/${encodeURIComponent(report.photoPath)}`
      : report.photo ? `/api/reports/${encodeURIComponent(report.publicId)}/photo` : null,
  };
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'gundi-watch-db.html'));
});
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(uploadDirectory, { dotfiles: 'deny', index: false }));

app.use('/api', (req, res, next) => {
  connectToDatabase()
    .then(({ reports }) => {
      app.locals.reports = reports;
      next();
    })
    .catch(next);
});

app.get('/api/reports', asyncRoute(async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 5;
  const reports = await app.locals.reports
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  res.json(reports.map(formatReport));
}));

app.get('/api/reports/:id', asyncRoute(async (req, res) => {
  if (!/^GW-\d{6}$/.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid report ID.' });
    return;
  }
  const report = await app.locals.reports.findOne(
    { publicId: req.params.id },
    { projection: { _id: 0 } },
  );
  res.json(report ? { ...formatReport(report), found: true } : { found: false });
}));

app.get('/api/reports/:id/photo', asyncRoute(async (req, res) => {
  if (!/^GW-\d{6}$/.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid report ID.' });
    return;
  }
  const report = await app.locals.reports.findOne(
    { publicId: req.params.id },
    { projection: { _id: 0, photo: 1 } },
  );
  if (!report || !report.photo) {
    res.status(404).json({ error: 'Photo not found.' });
    return;
  }
  const photo = Buffer.isBuffer(report.photo)
    ? report.photo
    : report.photo.buffer.subarray(0, report.photo.position);
  res.type('image/jpeg').send(photo);
}));

app.post('/api/reports', upload.single('photo'), asyncRoute(async (req, res) => {
  const area = typeof req.body.area === 'string' ? req.body.area.trim() : '';
  const road = typeof req.body.road === 'string' ? req.body.road.trim() : '';
  const severity = req.body.severity;
  const details = typeof req.body.details === 'string' ? req.body.details.trim() : '';

  if (!area || area.length > 120 || !road || road.length > 160) {
    res.status(400).json({ error: 'Area and road are required and must be within their length limits.' });
    return;
  }
  if (!['low', 'medium', 'high'].includes(severity)) {
    res.status(400).json({ error: 'Choose a valid severity.' });
    return;
  }
  if (details.length > 1000) {
    res.status(400).json({ error: 'Details must be 1000 characters or fewer.' });
    return;
  }

  const report = {
    area,
    road,
    severity,
    details,
    status: 'open',
    createdAt: new Date(),
  };
  if (req.file) {
    report.photo = req.file.buffer;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    report.publicId = `GW-${crypto.randomInt(100000, 1000000)}`;
    try {
      await app.locals.reports.insertOne(report);
      res.status(201).json({ id: report.publicId });
      return;
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
  }
  throw new Error('Could not generate a unique report ID.');
}));

app.get('/api/stats', asyncRoute(async (_req, res) => {
  const [total, resolved, open] = await Promise.all([
    app.locals.reports.countDocuments(),
    app.locals.reports.countDocuments({ status: 'resolved' }),
    app.locals.reports.countDocuments({ status: 'open' }),
  ]);
  res.json({ total, resolved, open });
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'Processed photo must be 2 MB or smaller.' });
    return;
  }
  if (error.message === 'Photo must be a JPEG image.') {
    res.status(400).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: 'The server could not complete the request.' });
});

async function start() {
  await fs.mkdir(uploadDirectory, { recursive: true });
  const { reports } = await connectToDatabase();
  app.locals.reports = reports;
  app.listen(PORT, () => {
    console.log(`Gundi Watch is running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Could not start the server:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
