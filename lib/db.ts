import mongoose from "mongoose";

declare global {
  // eslint-disable-next-line no-var
  var __mongoose:
    | { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null }
    | undefined;
}

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/portfolio_tracker";

const cache =
  global.__mongoose ??
  (global.__mongoose = { conn: null, promise: null });

export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 8000,
      })
      .then((m) => {
        m.set("strictQuery", true);
        return m;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
