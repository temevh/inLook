// Verifies the Atlas connection with a read-only query. Prints counts only, never the connection string.
import { prisma } from "./db";

const [facts, strategies, people, reviews, messages, events] = await Promise.all([
  prisma.facts.count(), prisma.strategies.count(), prisma.people.count(),
  prisma.reviews.count(), prisma.messages.count(), prisma.events.count(),
]);
console.log({ facts, strategies, people, reviews, messages, events });
const sample = await prisma.facts.findFirst({ select: { id: true, key: true, label: true, status: true } });
console.log("sample fact:", sample);
await prisma.$disconnect();
