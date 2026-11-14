import Fastify from "fastify";

const fastify = Fastify({ logger: true });

fastify.get("/", async () => {
  return { status: "ok" };
});

const start = async (): Promise<void> => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
