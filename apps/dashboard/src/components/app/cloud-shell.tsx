import { Separator } from "@tunnet/ui/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@tunnet/ui/components/sidebar";
import type { ReactNode } from "react";
import { CloudSidebar } from "@/components/app/cloud-sidebar";

type CloudShellProps = {
  children: ReactNode;
};

export function CloudShell({ children }: CloudShellProps) {
  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <CloudSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-background px-4 sm:px-6">
          <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
          <Separator orientation="vertical" className="hidden h-5 sm:block" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="text-sm font-medium">Tunnet Cloud</p>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
