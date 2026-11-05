const { MongoClient } = require('mongodb');

async function connectToDatabase() {
  const { MONGODB_URI, MONGODB_DB = 'gundi_watch' } = process.env;
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required. Set it in your .env file.');
  }

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const reports = client.db(MONGODB_DB).collection('reports');
    await reports.createIndex({ publicId: 1 }, { unique: true });
    return { client, reports };
  } catch (error) {
    await client.close();
    throw error;
  }
}

module.exports = { connectToDatabase };
