const { MongoClient } = require('mongodb');

let connectionPromise;

async function connectToDatabase() {
  const { MONGODB_URI, MONGODB_DB = 'gundi_watch' } = process.env;
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required. Set it in the deployment environment.');
  }

  if (!connectionPromise) {
    const client = new MongoClient(MONGODB_URI);
    connectionPromise = client.connect()
      .then(async () => {
        const reports = client.db(MONGODB_DB).collection('reports');
        await reports.createIndex({ publicId: 1 }, { unique: true });
        return { client, reports };
      })
      .catch(async (error) => {
        connectionPromise = undefined;
        try {
          await client.close();
        } catch (closeError) {
          console.error('Could not close the MongoDB client after connection failed:', closeError);
        }
        throw error;
      });
  }

  return connectionPromise;
}

module.exports = { connectToDatabase };
