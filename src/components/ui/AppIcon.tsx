import { type ComponentProps } from "react";
import { type LucideIcon } from "lucide-react";

export type AppIconSize = "xs" | "sm" | "md" | "lg" | "xl";

const iconSizes: Record<AppIconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
};

export type AppIconProps = Omit<ComponentProps<LucideIcon>, "size" | "strokeWidth"> & {
  icon: LucideIcon;
  size?: AppIconSize | number;
  strokeWidth?: number;
};

export function AppIcon({
  icon: Icon,
  size = "md",
  strokeWidth = 1.9,
  ...props
}: AppIconProps) {
  const resolvedSize = typeof size === "number" ? size : iconSizes[size];

  return (
    <Icon
      aria-hidden={props["aria-label"] ? undefined : true}
      focusable="false"
      size={resolvedSize}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
