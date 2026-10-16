import * as React from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-border bg-background hover:bg-muted",
  ghost: "hover:bg-muted",
  destructive: "bg-red-600 text-white hover:bg-red-700",
} as const;
const sizes = { default: "h-10 px-4 py-2", sm: "h-8 px-3 text-sm", lg: "h-12 px-6 text-base" } as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

/** Style helper so <Link> can look like a button without nesting interactive elements. */
export function buttonClass(variant: keyof typeof variants = "default", size: keyof typeof sizes = "default") {
  return cn(
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring",
    variants[variant],
    sizes[size],
  );
}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}
