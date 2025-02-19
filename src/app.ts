import { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import Fastify from "fastify";
import fs from "fs";
import { JSONSchema } from "json-schema-to-ts";
import { request as lock } from "piscina-locks";

const PATH = "/home/node/cache";
const app = Fastify().withTypeProvider<JsonSchemaToTsProvider>();

function deepMerge(target: Record<string, any>, source: Record<string, any>) {
  for (const key in source) {
    if (source[key] instanceof Object && key in target) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

app.get(
  "/:id",
  {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      } as const satisfies JSONSchema,
    },
  },
  async (request, reply) => {
    const { id } = request.params;
    return lock(id, async () => {
      try {
        return reply.send(fs.createReadStream(`${PATH}/${id}.json`));
      } catch (error) {
        console.error(error);
        return reply.status(404).send("404");
      }
    });
  },
);

app.route({
  url: "/:id",
  method: ["POST", "PATCH", "PUT"],
  schema: {
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    } as const satisfies JSONSchema,
    body: {
      type: "object",
    } as const satisfies JSONSchema,
  },
  handler: async (request, reply) => {
    const { id } = request.params;
    return lock(id, async () => {
      switch (request.method) {
        case "PUT":
          return new Promise((resolve, reject) => {
            const writeStream = fs
              .createWriteStream(`${PATH}/${id}.json`)
              .on("error", (err) => {
                reply.status(404).send();
                resolve();
              });
            request.raw.pipe(writeStream);
            request.raw.on("end", () => {
              writeStream.end();
              reply.status(201).send();
              resolve();
            });
            request.raw.on("error", (error) => {
              request.log.error(error);
              writeStream.end();
              reply.status(500).send();
              resolve();
            });
          });
        case "POST":
          return fs.promises.readFile(`${PATH}/${id}.json`, "utf8").then(
            (raw) =>
              fs.promises
                .writeFile(
                  `${PATH}/${id}.json`,
                  JSON.stringify({ ...JSON.parse(raw), ...request.body }),
                )
                .then(() => reply.status(201).send()),
            (error) => {
              request.log.error(error);
              reply.status(404).send();
            },
          );
        case "PATCH":
          return fs.promises.readFile(`${PATH}/${id}.json`, "utf8").then(
            (raw) =>
              fs.promises
                .writeFile(
                  `${PATH}/${id}.json`,
                  JSON.stringify(deepMerge(JSON.parse(raw), request.body)),
                )
                .then(() => reply.status(201).send()),
            (error) => {
              request.log.error(error);
              reply.status(404).send();
            },
          );
      }
    });
  },
});

app.listen({ port: 10001 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
