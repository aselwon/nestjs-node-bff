import "dotenv/config";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function jwtSecret(): string {
  const secret = requiredEnv("JWT_SECRET");
  if (secret.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  return secret;
}

export function redisOptions() {
  const url = new URL(requiredEnv("REDIS_URL"));
  if (!["redis:", "rediss:"].includes(url.protocol))
    throw new Error("Invalid REDIS_URL protocol");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
