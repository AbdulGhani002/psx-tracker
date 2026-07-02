"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CompoundingModel as CompoundingModelType } from "./CompoundingModel";

// The compounding model drags in recharts (~100KB+ of JS). On the holding page
// it sits below the fold, so: (1) code-split it out of the page bundle, and
// (2) don't even download it until the user scrolls near it.
const CompoundingModel = dynamic(
  () => import("./CompoundingModel").then((m) => m.CompoundingModel),
  { ssr: false, loading: () => <ModelSkeleton /> }
);

function ModelSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-[360px] w-full" />
    </div>
  );
}

export function CompoundingModelLazy(props: ComponentProps<typeof CompoundingModelType>) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShow(true);
      },
      { rootMargin: "500px" } // start fetching the chunk well before it's visible
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  return <div ref={ref}>{show ? <CompoundingModel {...props} /> : <ModelSkeleton />}</div>;
}
