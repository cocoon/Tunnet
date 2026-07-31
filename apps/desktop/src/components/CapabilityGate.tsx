import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";

export function CapabilityGate({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasPermission } = useApp();

  if (hasPermission(permission)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (isValidElement(children)) {
    const element = children as ReactElement<{
      disabled?: boolean;
      className?: string;
    }>;
    return cloneElement(element, {
      disabled: true,
      className: cn(element.props.className, "opacity-50"),
    });
  }

  return null;
}
