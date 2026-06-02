"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_8px_24px_-12px_rgba(99,102,241,0.6)] hover:bg-accent-glow active:translate-y-px",
        secondary:
          "bg-white/[0.04] text-ink hover:bg-white/[0.07] border border-white/5 hover:border-white/10",
        ghost: "text-ink-muted hover:text-ink hover:bg-white/[0.05]",
        outline:
          "border border-white/10 bg-transparent text-ink hover:bg-white/[0.04]",
        danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
        link: "text-accent-glow underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-5",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
