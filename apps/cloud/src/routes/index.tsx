import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/marketing/home-page";

export const Route = createFileRoute("/")({ component: HomePage });
