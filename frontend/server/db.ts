import { PrismaClient } from "@prisma/client";

// One client per process. Reads DATABASE_URL from frontend/.env.
export const prisma = new PrismaClient();
