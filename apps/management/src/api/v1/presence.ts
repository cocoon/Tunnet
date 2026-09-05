import { createListenClient, schema } from "@tunnet/db";
import { formatIp } from "@tunnet/ip";
import { and, desc, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../lib/db";
import {
  ENTITY_NOTIFY_CHANNEL,
  PRESENCE_NOTIFY_CHANNEL,
} from "../../lib/notify";
import {
  serializePresenceEvent,
  serializePresencePatch,
} from "../../lib/serialize-device";
import { getAuth, requireAuth } from "./middleware/authz";
import { notFound } from "./middleware/session";

export const presenceRoutes = new Elysia()
  .use(requireAuth)
  .get(
    "/organizations/:orgId/presence/stream",
    ({ authContext, params, request }) => {
      getAuth({ authContext });

      const orgId = params.orgId;
      const encoder = new TextEncoder();

      let listenClient: ReturnType<typeof createListenClient> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let cancelled = false;
      let listenPromise: Promise<void> | null = null;
      let cleanupPromise: Promise<void> | null = null;

      const stream = new ReadableStream({
        start: (controller) => {
          const send = (data: unknown) => {
            if (cancelled) return;

            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
              );
            } catch {
              cancelled = true;
            }
          };

          const cleanup = async () => {
            if (cleanupPromise) {
              return cleanupPromise;
            }

            cleanupPromise = (async () => {
              cancelled = true;

              if (heartbeat) {
                clearInterval(heartbeat);
                heartbeat = null;
              }

              const client = listenClient;
              listenClient = null;

              if (!client) {
                return;
              }

              /*
               * Do not destroy the PostgreSQL connection while a LISTEN
               * operation is still being established. This prevents
               * postgres from throwing CONNECTION_DESTROYED from inside
               * listen().
               */
              if (listenPromise) {
                try {
                  await listenPromise;
                } catch (error) {
                  /*
                   * If the stream was cancelled while LISTEN was starting,
                   * the error can be a consequence of the cancellation
                   * itself. Log it for diagnostics but continue cleanup.
                   */
                  if (!cancelled) {
                    console.error(
                      "[presence] listen initialization failed during cleanup:",
                      error,
                    );
                  }
                }
              }

              try {
                await client.end();
              } catch (error) {
                console.error(
                  "[presence] failed to close listen client:",
                  error,
                );
              }
            })();

            return cleanupPromise;
          };

          request.signal.addEventListener(
            "abort",
            () => {
              void cleanup().finally(() => {
                try {
                  controller.close();
                } catch {
                  // already closed
                }
              });
            },
            { once: true },
          );

          void (async () => {
            try {
              send({ type: "ready", organizationId: orgId });

              if (request.signal.aborted) {
                await cleanup();
                return;
              }

              listenClient = createListenClient();

              const client = listenClient;

              /*
               * Keep the promise so cleanup can wait for LISTEN to finish
               * before closing the PostgreSQL connection.
               */
              listenPromise = client.listen(
                PRESENCE_NOTIFY_CHANNEL,
                async (payload: string) => {
                  if (cancelled) return;

                  try {
                    const parsed = JSON.parse(payload) as {
                      organizationId?: string;
                      endpointId?: string;
                    };

                    if (
                      parsed.organizationId !== orgId ||
                      !parsed.endpointId
                    ) {
                      return;
                    }

                    const row = await db.query.devices.findFirst({
                      where: and(
                        eq(schema.devices.endpointId, parsed.endpointId),
                        eq(schema.devices.organizationId, orgId),
                      ),
                      with: {
                        memberships: {
                          limit: 1,
                        },
                      },
                    });

                    if (!row || cancelled) return;

                    const networkId = row.memberships[0]?.networkId;

                    if (!networkId) return;

                    send({
                      type: "presence",
                      patch: serializePresencePatch({
                        ...row,
                        networkId,
                      }),
                    });
                  } catch (error) {
                    if (!cancelled) {
                      console.error(
                        "[presence] failed to process presence payload:",
                        error,
                      );
                    }
                  }
                },
              );

              try {
                await listenPromise;
              } finally {
                listenPromise = null;
              }

              if (cancelled) {
                await cleanup();
                return;
              }

              await client.listen(
                ENTITY_NOTIFY_CHANNEL,
                (payload: string) => {
                  if (cancelled) return;

                  try {
                    const parsed = JSON.parse(payload) as {
                      organizationId?: string;
                      kind?: string;
                      entityId?: string;
                      networkId?: string | null;
                    };

                    if (
                      parsed.organizationId !== orgId ||
                      !parsed.kind ||
                      !parsed.entityId
                    ) {
                      return;
                    }

                    send({
                      type: "entity",
                      kind: parsed.kind,
                      entityId: parsed.entityId,
                      networkId: parsed.networkId ?? null,
                    });
                  } catch (error) {
                    if (!cancelled) {
                      console.error(
                        "[presence] failed to process entity payload:",
                        error,
                      );
                    }
                  }
                },
              );

              if (cancelled) {
                await cleanup();
                return;
              }

              heartbeat = setInterval(() => {
                if (cancelled) {
                  if (heartbeat) {
                    clearInterval(heartbeat);
                    heartbeat = null;
                  }
                  return;
                }

                try {
                  controller.enqueue(encoder.encode(": keepalive\n\n"));
                } catch (error) {
                  console.error("[presence] heartbeat failed:", error);
                  void cleanup();
                }
              }, 25_000);
            } catch (error) {
              if (!cancelled) {
                console.error(
                  `[presence] stream failed for organization ${orgId}:`,
                  error,
                );
              }

              await cleanup();

              try {
                controller.error(error);
              } catch {
                // already closed
              }
            }
          })();
        },

        cancel: async () => {
          await cleanup();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    },
  )
  .get(
    "/organizations/:orgId/devices/:endpointId/presence",
    async ({ authContext, params }) => {
      const auth = getAuth({ authContext });

      const device = await db.query.devices.findFirst({
        where: and(
          eq(schema.devices.endpointId, params.endpointId),
          eq(schema.devices.organizationId, auth.organizationId),
        ),
      });

      if (!device) return notFound("Device not found");

      const events = await db.query.devicePresenceEvents.findMany({
        where: eq(
          schema.devicePresenceEvents.endpointId,
          params.endpointId,
        ),
        orderBy: desc(schema.devicePresenceEvents.at),
        limit: 100,
      });

      return {
        events: events.map(serializePresenceEvent),
      };
    },
  )
  .get(
    "/organizations/:orgId/devices/:endpointId/addresses",
    async ({ authContext, params }) => {
      const auth = getAuth({ authContext });

      const device = await db.query.devices.findFirst({
        where: and(
          eq(schema.devices.endpointId, params.endpointId),
          eq(schema.devices.organizationId, auth.organizationId),
        ),
        with: {
          memberships: {
            with: { network: true },
          },
        },
      });

      if (!device) return notFound("Device not found");

      return {
        endpointId: device.endpointId,
        publicIp: device.publicIp ? formatIp(device.publicIp) : null,
        ipv6Enabled: device.ipv6Enabled,
        tenantIpv6:
          device.ipv6Enabled && device.tenantIpv6
            ? formatIp(device.tenantIpv6)
            : null,
        addresses: device.memberships.map((m) => ({
          networkId: m.networkId,
          networkName: m.network.name,
          assignedIp: formatIp(m.assignedIp),
        })),
      };
    },
  );
