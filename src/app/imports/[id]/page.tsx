import { Suspense } from "react";
import { LoadingBlock } from "@/components/ui";
import { WorkspaceFromParams } from "./workspace";

export default function ImportPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading import…" />}>
      <WorkspaceFromParams />
    </Suspense>
  );
}
