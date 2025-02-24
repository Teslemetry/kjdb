import { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import Fastify from "fastify";
import fs from "fs";
import { JSONSchema } from "json-schema-to-ts";
import { request as lock } from "piscina-locks";
//import { request as send } from "undici";

const PATH = "/home/brett/Teslemetry/kjdb"; //"/home/node/cache";
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

/*const peers = config.get<string[]>("peers");

const sender = async (ip: string, id: string, body: string) => {
  try {
    const response = await send(`http://${ip}/${id}`, { method: "PUT", body });
    if (response.statusCode > 299) {
      throw new Error();
    }
    return;
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return sender(ip, id, body);
  }
};

const replicate = async (id: string, body: string) =>
  Promise.all(peers.map((ip: string) => sender(ip, id, body)));
  */

const listeners: Record<string, ((data: any) => void)[]> = {};

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

app.get(
  "/:id/next",
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
      return new Promise((resolve, reject) => {
        listeners[id] ??= [];
        listeners[id].push(resolve);
      }).then((data) => {
        delete listeners[id];
        return reply.send(data);
      });
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
          const data = JSON.stringify(request.body);
          listeners[id]?.forEach((x) => x(data));
          return fs.promises.writeFile(`${PATH}/${id}.json`, data);
        case "POST":
          return fs.promises.readFile(`${PATH}/${id}.json`, "utf8").then(
            async (raw) => {
              const data = JSON.stringify({
                ...JSON.parse(raw),
                ...request.body,
              });
              listeners[id]?.forEach((x) => x(data));
              return fs.promises
                .writeFile(`${PATH}/${id}.json`, data)
                .then(() => reply.status(201).send());
            },
            (error) => {
              request.log.error(error);
              return reply.status(404).send();
            },
          );
        case "PATCH":
          return fs.promises.readFile(`${PATH}/${id}.json`, "utf8").then(
            async (raw) => {
              const data = JSON.stringify(
                deepMerge(JSON.parse(raw), request.body),
              );
              listeners[id]?.forEach((x) => x(data));
              return fs.promises
                .writeFile(`${PATH}/${id}.json`, data)
                .then(() => reply.status(201).send());
            },
            (error) => {
              request.log.error(error);
              return reply.status(404).send();
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
