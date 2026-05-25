import mongoose from "mongoose";
import dns from "dns";

// Force Google's DNS to avoid ISP DNS flakiness with MongoDB Atlas SRV lookups
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

const MONGODB_URI = process.env.MONGODB_URI as string;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable inside .env.local");
}

let cached = (global as { mongoose?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } }).mongoose;

if (!cached) {
  cached = (global as typeof globalThis & { mongoose: typeof cached }).mongoose = { conn: null, promise: null };
}

function resetCache() {
  cached!.conn = null;
  cached!.promise = null;
}

async function dbConnect() {
  if (cached!.conn) return cached!.conn;

  if (!cached!.promise) {
    cached!.promise = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      })
      .then((m) => m)
      .catch((err) => {
        resetCache();
        throw err;
      });
  }

  try {
    cached!.conn = await cached!.promise;
  } catch (err) {
    resetCache();
    throw err;
  }

  return cached!.conn;
}

export default dbConnect;
