"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast-provider";

export function JobSpecRedirectToast() {
  const { toast } = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    toast(
      "Draft created from your job spec. Review each step and generate the HTML template before publishing.",
      "info",
    );
  }, [toast]);

  return null;
}
