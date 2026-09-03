import { Route as rootRoute } from "./routes/__root";
import { appRoute } from "./routes/app";
import { Route as appFirewallRoute } from "./routes/app/firewall";
import { Route as appIndexRoute } from "./routes/app/index";
import { Route as appPeersRoute } from "./routes/app/peers";
import { Route as appServeRoute } from "./routes/app/serve";
import { Route as appSshRoute } from "./routes/app/ssh";
import { Route as indexRoute } from "./routes/index";
import { Route as installRoute } from "./routes/install";
import { Route as setupRoute } from "./routes/setup";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  installRoute,
  setupRoute,
  appRoute.addChildren([
    appIndexRoute,
    appPeersRoute,
    appFirewallRoute,
    appServeRoute,
    appSshRoute,
  ]),
]);
